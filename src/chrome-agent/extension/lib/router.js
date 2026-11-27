// Tool router: name -> handler, with per-call timeout, abort and a uniform result envelope.
// Pure module (no chrome.* use) so it can be unit-tested under Node.

export class ToolError extends Error {
  constructor(message, code = "tool_error") {
    super(message);
    this.code = code;
  }
}

export const text = (t) => ({ content: [{ type: "text", text: String(t) }] });

/** Normalize any handler return value into {content:[...], isError?}. */
export function normalize(r) {
  if (r == null) return text("ok");
  if (typeof r === "string") return text(r);
  if (Array.isArray(r.content)) return r;
  return text(JSON.stringify(r, null, 2));
}

export class Router {
  constructor({ defaultTimeoutMs = 60000, onCall } = {}) {
    this.handlers = new Map();
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.inflight = new Map(); // id -> AbortController
    this.onCall = onCall || (() => {});
  }

  register(name, handler, { timeoutMs } = {}) {
    this.handlers.set(name, { handler, timeoutMs });
  }

  names() { return [...this.handlers.keys()]; }

  cancel(id) {
    const ac = this.inflight.get(id);
    if (ac) ac.abort(new ToolError("cancelled by client", "cancelled"));
  }

  /** Run one tool call; always resolves to a tool_response envelope. */
  async dispatch({ id, tool, args }, ctx = {}) {
    const started = Date.now();
    const entry = this.handlers.get(tool);
    const done = (body) => {
      const env = { type: "tool_response", id, ...body };
      this.onCall({ id, tool, ok: !body.error, ms: Date.now() - started, error: body.error?.message });
      return env;
    };
    if (!entry) return done({ error: { message: `Unknown tool: ${tool}`, code: "unknown_tool" } });

    const ac = new AbortController();
    this.inflight.set(id, ac);
    const timeoutMs = entry.timeoutMs ?? this.defaultTimeoutMs;
    let timer;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => entry.handler(args || {}, { ...ctx, signal: ac.signal, id })),
        new Promise((_, rej) => {
          timer = setTimeout(() => rej(new ToolError(`${tool} timed out after ${timeoutMs} ms`, "timeout")), timeoutMs);
        }),
        new Promise((_, rej) => ac.signal.addEventListener("abort", () => rej(ac.signal.reason), { once: true })),
      ]);
      return done({ result: normalize(result) });
    } catch (e) {
      return done({ error: { message: e?.message || String(e), code: e?.code || "tool_error" } });
    } finally {
      clearTimeout(timer);
      this.inflight.delete(id);
    }
  }
}
