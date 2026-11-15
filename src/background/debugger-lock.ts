// قفل واحد لأي استخدام لـ chrome.debugger.
// inspect_code وexport_pdf لا يجب أن يرفقا في نفس الوقت (كروم يسمح بمرفق واحد لكل تبويب)،
// وإلا يفشل أحدهما برسالة "Another debugger is already attached".
let chain: Promise<unknown> = Promise.resolve();

export function withDebugger<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
