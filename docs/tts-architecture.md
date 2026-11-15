# TTS / Read-Aloud Architecture

## Why this refactor

The earlier implementation kept playback state in several places at once:

- `edge.ts` had its own active tab and stop rules.
- `tts.ts` had another active tab.
- `tts-session.ts` had a panel state.
- the content-script player had its own state.
- the hidden audio document had its own pending/audio state.
- the panel had a temporary player plus saved voice cards.

That made failures look random: a tab navigation could stop text-only speech, a page `stop`
could kill a newer playback in another tab, a stale synthesis timeout could kill a newer
request, and the saved voice message could claim `edge` while the real fallback was
`browser`.

The current design has one owner for playback, one identity per voice message, and one
transport for the Edge handshake.

## Invariants

1. **One playback at a time.** Starting a playback halts both engines before doing any
   network/synthesis work.
2. **The playback knows its session.** `TtsPanelState.sessionId` is set from the run/tool
   context, never from “the session currently open in the panel”.
3. **Stops are scoped.** A tab may stop only its own page playback. A panel stops the
   playback of its session (or all, when no session is given). A tab can never stop a
   text-only playback.
4. **The saved card and the live card are the same identity.** `voiceId` is generated for
   one read-aloud action and kept across all of its paragraphs. It becomes the saved
   `VoiceMessage.id`.
5. **Stale events are ignored.** Every engine event carries `playbackId`; the controller
   drops events that do not belong to the active playback.
6. **A failed start is not a successful voice message.** A silent failure never produces a
   card claiming success.
7. **Edge only.** Production read-aloud never falls back to `chrome.tts`; a browser voice
   may not support Arabic and can read only digits. If Edge fails, the tool reports the
   error and the model must not retry with a browser voice.
8. **One voice message per assistant reply.** The last successful read-aloud in a run wins;
   old messages with several voices are displayed as their last (Edge) voice only.

## Layers

```
Side panel (Svelte)
  ChatView / VoiceMessage
        │  Port (tts-state) + RPC
        ▼
Service worker
  tts-session.ts      runtime wiring (engines, tab messages, emitter)
  tts-controller.ts   pure state machine: start / stop / pause / seek / events
  tts-voice.ts        pure language + voice selection
  tts.ts              chrome.tts engine (browser voices)
  edge.ts             Edge protocol, DNR UA rule, engine Port transport
        │  Port (tts-engine)
        ▼
Panel iframe (public/tts-engine.js)
  WebSocket + SSML + MP3 assembly + audio + prefetch cache
```

`tts-controller.ts` and `tts-voice.ts` have no `chrome` dependency and are unit-tested with
fake engines.

## Session and ownership model

Every `read_aloud` call receives `ctx.sessionId` from the agent run and passes it to:

- `speakTextDirect(...)` for free text, or
- the content reader for page reading (`read` payload → `tts-speak`).

The content reader keeps `readerSession` and `readerVoiceId` for the whole page reading and
sends both with every paragraph. Switching the panel to another chat does **not** re-tag or
move the playback. The panel only renders cards whose `state.sessionId === currentId`.

Stop scopes:

| Source | Scope | Effect |
| --- | --- | --- |
| In-page Stop button / page navigation | `tab` | stops only that tab's playback |
| Panel Stop | `session` | stops the playback owned by that chat session |
| `stop_reading` tool / session deletion | `all` / `session` | stops the owning playback and remote-stops its page |

`chrome.tabs.onRemoved` and `onUpdated(status=loading|discarded)` are handled once in
`tts-session.initTtsLifecycle`; engine modules no longer register their own competing
listeners.

`read_aloud` registers a **pending page read** (tab, session, voiceId) before calling
`withReader('read')`. If Stop arrives before the content sends its first `tts-speak`, the
pending voiceId is cancelled and the tab is sent `remote-stop`; the late request is
rejected before it can start or steal another playback. The panel Stop button uses the
same cancellation path.

## Identity: playbackId vs voiceId

- `playbackId` changes for every synthesized paragraph/utterance. It is used for stale
  event filtering and `EDGE_STOPPED`/`EDGE_REPLACED` races.
- `voiceId` is stable for one read-aloud action (all paragraphs of one page reading, or
  one free-text message). It is used as the saved `VoiceMessage.id`.

`ChatView` first tries an exact `voiceId` match. Text/voice equality remains as a fallback
for old messages. The “last voice message in the tab” fallback is kept only for legacy
messages without `voiceId`.

## Edge only + long-text playlist

`chrome.tts` remains as an internal/test adapter, but production tools, settings and the
panel force `edge` and normalize legacy browser voice names away. A browser voice name can
never reach the Edge WebSocket.

A single Edge request stops responding for long text (~1000+ chars). `tts-split.ts` splits
free text into segments of at most 280 characters at sentence/word boundaries. The
controller plays them as a **playlist**: the first segment starts immediately, the next two
are prefetched, and `end` advances to the next segment with the same `voiceId`. The card
stays one message; its text is the full original text.

## Warm engine and caching

The Edge engine runs in a hidden iframe **inside the side panel**, not in a `chrome.offscreen`
document. The iframe has an ordinary page lifetime: it exists exactly as long as the panel,
so there is no 30-second `AUDIO_PLAYBACK` shutdown, no silent keepalive audio, and no
offscreen message channel. The iframe connects a direct Port to the SW at load and the SW
opens the Edge WebSocket immediately. First playback after a long idle is just the first
segment synthesis (~1-3s in testing, depending on text length/network).

Synthesized audio is cached in the iframe by `text|voice|rate` (LRU 48). Replays and
downloads reuse cached segments. The cache is in-memory and survives normal stop/play, but
not a panel reload/browser restart; a new unique text is always synthesized once.

## Download and transcript

Each voice card has:
- **Show text** (📄): expands the full text, scrollable and selectable, with a text download.
- **Download audio** (⬇): the SW splits the saved text again, reuses cached segments or
  synthesizes missing ones in the panel iframe, merges all MP3 segments, and downloads one
  complete MP3 via `chrome.downloads`. Long exports run over the panel Port (not a one-shot
  RPC) so they are not cut by message timeouts. The iframe does not expire while the panel
  is open, so exports have no 30-second limit.

## Edge transport

Edge’s speech endpoint rejects Chrome’s `User-Agent`. The first implementation spoofed it
with `chrome.debugger.attach` + `Network.setUserAgentOverride` for every connection. That
was the source of several failures:

- `Another debugger is already attached` when DevTools or another tool was attached.
- attach/detach races between paragraphs and speed changes.
- a browser-wide “started debugging” infobar.
- 5 ms fallbacks that left the browser default voice reading only digits.

The current implementation installs a **declarativeNetRequest session rule** once per
browser session:

```
id: 910731
condition: urlFilter ||speech.platform.bing.com, resourceTypes [websocket, xmlhttprequest]
action: modifyHeaders user-agent = Edge UA
```

Verified end-to-end: the panel iframe `navigator.userAgent` stays Chrome, while the Edge
WebSocket handshake succeeds. No debugger is involved in TTS. (`debugger` remains in the
manifest only for `inspect_code` and `export_pdf`, and those two now share a
`withDebugger` lock.)

## Panel engine protocol and races

Operations: `edge-connect`, `edge-speak`, `edge-halt`, `edge-reset`, `edge-stop`,
`edge-pause`, `edge-resume`, `edge-seek`, `edge-state`, `edge-ping`.

Key fixes:

- **Timeout is captured per request**, not read from the global `pending`. An old timer can
  no longer kill a newer synthesis.
- **A new `edge-speak` halts the current audio and pending request first.** No two
  utterances overlap; the old promise resolves `EDGE_REPLACED`.
- **`edge-halt` keeps the WebSocket and prefetch cache when idle.** A normal paragraph
  transition does not pay reconnect cost. If a turn/audio is active, it closes the socket
  so a cancelled turn cannot mix with the next turn; the cache is still kept.
- **Timestamps as epochs.** `edge-halt`/`edge-stop` send a monotonically increasing epoch;
  an `edge-speak` that arrives after them with an older epoch is rejected. The epoch is
  timestamp-based so it stays monotonic across service-worker restarts.
- **Voice cancellation.** Stopping a reading cancels its `voiceId`. A paragraph request
  that was already in flight is rejected before it can steal the playback from a newer
  action. Explicit replay (`replay: true`) bypasses this guard.
- **`edge-stop` clears the cache and closes the socket.** Used only for full reset.
- Cache keys include `blockId|engine|voice|rate`, so old-rate entries are never reused.
- Events carry `playbackId`, `tabId`, `currentTime`, `duration`, and word boundaries.
- `edge-state` exposes `playbackId`, `open`, `playing`, `cached`, `prefetch`.

## Failure ladder

For Edge playback:

1. Reuse an open WS, otherwise `edge-connect`.
2. On channel/WS errors, `edge-reset` (reconnect, keep the document) and retry once.
3. On another connection error, reset the Port engine/WebSocket and retry once.
4. If Edge still fails, return a clear error (`EDGE_*` / `edgeError`). Do **not** use a
   browser voice and do **not** save a voice message.

`speakTextDirect` and the page reader both return the actual `engine`/`voice`, and the tool
result stores those values.

## Panel state

- The SW broadcasts `tts-state` to every connected panel port; each panel filters by
  session.
- On port connect the SW sends the current state immediately, so reopening the panel while
  audio is playing restores the card.
- If the SW restarted, the live state is intentionally ephemeral; the durable source is the
  saved `VoiceMessage` in the assistant message. `initTtsLifecycle` stops orphaned engine audio after a restart.
- The composer, queue, and run events are session-filtered in `App.svelte`.

## Tests

- `tests/tts-controller.test.ts` — ownership, halt-before-start, fallback, stale events,
  session/tab stop scopes, voiceId stability.
- `tests/tts-voice.test.ts` — Arabic/English detection, Edge defaults, browser voice choice.
- `tests/voice-message.test.ts` — saved message uses the playback `voiceId`.
- `tests/reader.test.ts` — extraction/highlighting (unchanged).

## Known limits

- Browser TTS depends on voices installed in the OS/Chrome; on a Linux profile with no
  voices, the fallback correctly returns an error instead of a silent “success”.
- Edge’s private protocol and `Sec-MS-GEC` version can change; `SEC_MS_GEC_VERSION` is the
  single place to update.
- `declarativeNetRequest` header modification requires the host permission and a recent
  Chrome; older versions fall back to the browser engine.
