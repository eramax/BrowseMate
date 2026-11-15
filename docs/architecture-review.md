# Architecture Review — Beyond TTS

## Why this review

The TTS failures exposed a broader pattern: state and side effects were spread across
several owners, with no single concurrency/lifecycle model. This review lists the systemic
issues found across the extension, what was fixed, and what remains.

## Fixed in 0.5.0

### 1. Session store was not atomic
`append`/`patchMessage`/`update` did read-modify-write on the whole session. A streaming
draft patch could overwrite a user message, or two panels could lose each other's writes.

- every per-session mutation now goes through a per-session promise lock
- `get()` returns a clone so callers cannot mutate stored state
- `append()` trims to 200 messages with a trim marker; `enforceQuota()` runs at startup
- verified with 80 concurrent appends and a clone-isolation test

### 2. Approvals could hang forever
A pending approval had no owner and no timeout. Closing the panel left the tool awaiting a
promise that could never resolve.

- approvals carry `sessionId` + `runId`
- `rejectRun` / `rejectSession` cancel only the right work
- 5-minute timeout
- panel disconnect rejects that session's approvals; run teardown rejects its own
- stop aborts only the current session's runs, not every run in the extension

### 3. Run ownership was global
`stop` aborted every run regardless of session; `activeSessionId` was global.

- per-panel session map (`panelSessions`)
- a second chat in the same session is rejected with `RUN_IN_PROGRESS`
- panel disconnect aborts that session only if no other panel still displays it

### 4. Tools followed the active tab, not the request
A long run could start on tab A, the user switches to tab B, and a later tool acts on B.

- the active tab is captured **when the message is sent** (including queued messages)
- `chat.tabId` is passed to `runChat`
- `ToolContext.defaultTabId` is used by `resolveTabId`, `navigate`, `screenshot`
- if the original tab is gone, tools fall back explicitly

### 5. Tool status could bind to the wrong parallel call
`tool-result` matched by tool name + running, so two parallel calls with the same name could
update the wrong UI entry.

- `ToolCallInfo.id` added; agent records `toolCallId`; UI matches by id first

### 6. Model history had no budget
`toModelMessages` sent all 200 messages and full assistant text; this can exceed context.

- 60k character budget, 24k per message, newest-first retention, trim notice
- exported and unit-tested

### 7. Queued messages crossed sessions
The queue was global; switching sessions could send queued text into the wrong chat.

- queue items carry `sessionId` + `tabId`
- flush only sends the current session's item
- `busy` is reserved synchronously to avoid double-send races

### 8. Workspace writes could lose files
`writeFile`/`appendFile` were read-modify-write with no lock.

- all workspace mutations are serialized

### 9. Message list rendered everything
Long sessions rendered up to 200 markdown messages.

- render the newest 80 with an explicit “show older” action

### 10. TTS ownership (previous phase)
- Edge-only, no browser fallback
- long text split into <=280-char segments with a playlist/prefetch
- panel-hosted iframe engine through a dedicated Port; no `chrome.offscreen`
- `voiceId` binds live and saved cards; one card per reply; text view + complete MP3 download

## Fixed in 0.5.1 — Edge endpoint migration

The 0.5.0 TTS failures (`EDGE_WS_CLOSED:1006`, no audio) were not caused by the panel
iframe or the user's profile. The legacy synthesis host `speech.platform.bing.com` is being
retired: it returns 403 in many countries, and in our region it accepts the WebSocket
upgrade and then closes it without audio. Evidence: a raw Node WebSocket, the Python
`edge-tts` 7.3.1 client, direct connections and Tor all failed the same way, while the
voice list still returned HTTP 200.

0.5.1 fixes this by synthesizing through the Edge 155+ host:

- `wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1` with
  `Ocp-Apim-Subscription-Key=<legacy trusted token>` and the legacy `Sec-MS-GEC` token;
- the voice list stays on the legacy host;
- Edge-UA DNR rules for both hosts at priority `2147483647`, verified on every connect and
  force-re-added after a handshake rejection (other UA extensions use priority 110);
- no idle warm-up connection; the WS opens on the first actual speak;
- a 60-second circuit breaker after two server-side closes, with
  `EDGE_SERVICE_UNAVAILABLE` and a clear user-facing message instead of repeated retries;
- `ws-close` diagnostics now include `opened`, `bytes`, and `ageMs`.

Verified in a real side panel: a 101 handshake to `api.msedgeservices.com`, 48 audio frames
received, and an 810-character Arabic text played and exported as one 436 KB MP3.

## Remaining high-priority work

1. **TTS provider resilience.** The legacy-host retirement is fixed, but Edge remains an
   unofficial cloud endpoint. A production design still needs:
   - a provider interface (Edge / local offline / system)
   - the circuit breaker + backoff now implemented, surfaced in Settings
   - an explicit local Arabic fallback (Piper/ONNX/WASM) only if the user opts in
   - diagnostics visible in Settings (endpoint, close code, opened/bytes/ageMs)
2. **`chrome.ttsEngine` spike.** Chrome's `onSpeakWithAudioStream` was verified in a POC:
   Chrome registers the voice and plays the stream, with start/end events. This can remove
   the panel iframe and allow background/browser-TTS use, but needs:
   - Edge PCM output or a WASM MP3 decoder in the service worker
   - handling the Edge UA/DNR limitation for service-worker WebSockets
   - seek/pause trade-offs and testing
3. **Persist/restore TTS and run state.** The controller lives only in SW memory; a paused
   playback can outlive the SW state. Persist structural state in `chrome.storage.session`
   or make the engine iframe the source of truth.
4. **Move sessions/messages to IndexedDB.** `chrome.storage.local` rewrites the whole
   session object; with 200 messages this is O(n²) per run. IndexedDB with per-message
   records and transactions is the next storage step.
5. **Split the RPC router.** `index.ts` is a 400-line switch mixing settings, sessions,
   skills, debug, artifacts and TTS. Extract typed handlers per domain.
6. **Model-aware budgets.** A fixed 60k character budget is a safety net, not a token
   strategy; use model limits and tool-result truncation.
7. **Tool security review.** Workspace paths are sanitized, but `preview_html`, debug
   exports, and broad `<all_urls>`/`debugger` permissions need a dedicated threat model.
8. **Tests for agent/UI.** Most tests cover pure modules; add integration tests for
   run-scoped events, approvals, queues and panel reconnect.
