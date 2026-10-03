// Sandboxed executor. This script runs inside a manifest-declared sandbox page
// (opaque origin, no `browser`/`chrome`, no extension API, no shared DOM), which
// is the only place Manifest V3's CSP allows dynamic code (eval/new Function).
//
// It receives { code, args } from its parent (the offscreen document on Chrome
// or the background page on Firefox), evaluates the user's `dynamicBookmark`
// function purely, and posts the result back. A synchronous infinite loop here
// hangs only this frame; the host times out and rebuilds it.

interface RunMessage {
  __dyn: true;
  id: string;
  code: string;
  args: unknown;
}

function isRunMessage(value: unknown): value is RunMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __dyn?: unknown }).__dyn === true &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { code?: unknown }).code === "string"
  );
}

window.addEventListener("message", (event) => {
  const data = event.data;
  if (!isRunMessage(data)) return;

  let out: { __dyn: true; id: string; ok: boolean; value?: unknown; error?: string };
  try {
    // The user code defines `function dynamicBookmark(args) { ... }`; compile it
    // and return the reference. No host globals are exposed.
    const factory = new Function(
      `"use strict";\n${data.code}\n;return typeof dynamicBookmark === "function" ? dynamicBookmark : null;`,
    );
    const fn = factory() as ((args: unknown) => unknown) | null;
    if (typeof fn !== "function") {
      throw new Error("dynamicBookmark is not defined");
    }
    const result = fn(data.args);
    out = { __dyn: true, id: data.id, ok: true, value: result ?? null };
  } catch (error) {
    out = {
      __dyn: true,
      id: data.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  parent.postMessage(out, "*");
});
