// chat_* tools: work with AI chat sites (ChatGPT, Gemini, DeepSeek, …) through per-site ops.
// Each op is a small script in providers/<id>/<op>.js that runs in the page (see providers/CONTRACT.md).
// The site is detected from the tab's URL, so agents never need site-specific code.
import * as cdp from "./cdp.js";
import { ToolError } from "./router.js";
import { PROVIDERS, providerFor } from "../providers/index.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_WAIT_S = 100; // below the MCP server's 120 s tool timeout

// Read on every call (a local file, fast): an adapter fix takes effect without reloading the extension.
async function opSource(id, op) {
  return (await fetch(chrome.runtime.getURL(`providers/${id}/${op}.js`), { cache: "no-store" })).text();
}

function siteOf(tab, op) {
  const p = providerFor(tab.url);
  if (!p) throw new ToolError(`Tab ${tab.id} is not on a supported chat site (${tab.url}). Supported: ${PROVIDERS.map((x) => `${x.name} ${x.urlNew}`).join(", ")}. Open one with navigate first.`, "chat_unsupported_site");
  if (op && !p.ops.includes(op)) throw new ToolError(`${p.name} does not support this (${op}).`, "chat_unsupported_op");
  return p;
}

/** Run one op in the tab. `values` replace the placeholders on the op's first line. */
async function runOp(tab, p, op, values = {}) {
  const src = await opSource(p.id, op);
  const nl = src.indexOf("\n");
  let first = nl < 0 ? src : src.slice(0, nl);
  for (const [ph, v] of Object.entries(values)) first = first.replace(ph, v);
  const expression = (first + (nl < 0 ? "" : src.slice(nl))).replace(/^\s*await\s+/, "");
  for (let attempt = 0; ; attempt++) {
    const r = await cdp.send(tab.id, "Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true, timeout: 45000 }, 50000)
      .catch((e) => ({ exceptionDetails: { text: e.message } }));
    const d = r.exceptionDetails;
    if (!d) return r.result?.value;
    const msg = d.exception?.description || d.text || "error";
    // The site redirected while the op ran (for example a logged-out visitor): run it once more.
    if (attempt === 0 && /navigated or closed|Execution context was destroyed|Cannot find context/i.test(msg)) { await sleep(1500); continue; }
    throw new ToolError(`${p.name} ${op} failed: ${msg}`, "chat_op_error");
  }
}

// ---------- reply decoding (wait_read returns pct3-encoded chunks with a length and hash) ----------
export function fnv(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}
export function decodeReply(r) {
  let text = (r.chunks || []).join("");
  if (r.enc === "pct3") text = text.replace(/%(25|26|3B)/g, (m, c) => ({ 25: "%", 26: "&", "3B": ";" })[c]);
  if (r.len != null && [...text].length !== r.len) throw new ToolError(`reply length ${[...text].length} != ${r.len}`, "chat_read_mismatch");
  if (r.h && fnv(text) !== r.h) throw new ToolError("reply hash mismatch", "chat_read_mismatch");
  return text;
}

const utf8b64 = (s) => { const b = new TextEncoder().encode(s); let bin = ""; for (let i = 0; i < b.length; i += 32768) bin += String.fromCharCode(...b.subarray(i, i + 32768)); return btoa(bin); };
const json = (o) => ({ type: "text", text: JSON.stringify(o) });

/** Poll an op that waits ≤ 30 s per call until it is done, fails, or `wait` seconds pass. */
async function poll(tab, p, op, mode, wait, signal) {
  const until = Date.now() + Math.min(Math.max(Number(wait) || 90, 1), MAX_WAIT_S) * 1000;
  let usedMode = mode || "after_send";
  for (;;) {
    if (signal?.aborted) throw new ToolError("cancelled", "cancelled");
    const r = await runOp(tab, p, op, { __MODE__: JSON.stringify(usedMode) });
    // A reload forgets the last send; without an explicit mode, read the newest reply instead.
    if (r?.err === "no_send_in_this_page" && !mode && usedMode === "after_send") { usedMode = "last"; continue; }
    if (!r || r.status !== "generating" && r.status !== "waiting" || Date.now() > until) return { r, usedMode };
    await sleep(500);
  }
}

// ---------- tools ----------
export async function chatSites() {
  return JSON.stringify(PROVIDERS.map((p) => ({ id: p.id, name: p.name, url: p.urlNew, images: p.ops.includes("images"), toggles: p.ops.includes("toggle") })));
}

export async function chatStatus(_args, { tab }) {
  const p = siteOf(tab);
  const r = await runOp(tab, p, "status");
  if (r && typeof r.title === "string") r.title = r.title.replace(/^(⏳|✅) /, ""); // the page indicator's mark
  return JSON.stringify({ site: p.id, ...r });
}

export async function chatSend({ text }, { tab }) {
  if (typeof text !== "string" || !text) throw new ToolError("text is required (or path, a local text file)", "input_invalid");
  const p = siteOf(tab);
  // Chat inputs turn CRLF into LF; send LF so the typed text matches what was asked.
  return JSON.stringify({ site: p.id, ...(await runOp(tab, p, "send", { __MSG__: JSON.stringify(text.replace(/\r\n?/g, "\n")) })) });
}

export async function chatRead({ mode, wait, save }, { tab, signal }) {
  const p = siteOf(tab);
  const { r, usedMode } = await poll(tab, p, "wait_read", mode, wait, signal);
  if (r?.status !== "done") return { content: [json({ site: p.id, mode: usedMode, ...r })] };
  const text = decodeReply(r);
  const { chunks, enc, h, ...meta } = r;
  // The chat's own URL can appear only after the reply (a new Gemini chat): report the current one.
  const url = (await chrome.tabs.get(tab.id).catch(() => tab)).url;
  const content = [json({ site: p.id, mode: usedMode, url, ...meta })];
  // With a path the reply goes to that file only, so it does not fill the agent's context twice.
  if (save) content.push({ type: "file", name: "reply.md", mimeType: "text/markdown", data: utf8b64(text) });
  else content.push({ type: "text", text });
  return { content };
}

export async function chatImages({ mode, wait }, { tab, signal }) {
  const p = siteOf(tab, "images");
  const { r, usedMode } = await poll(tab, p, "images", mode, wait, signal);
  return JSON.stringify({ site: p.id, mode: usedMode, ...r });
}

export async function chatSaveImage({ index = 0, mode, name }, { tab }) {
  const p = siteOf(tab, "save_image");
  let usedMode = mode || "last";
  let r = await runOp(tab, p, "save_image", { __SAVE__: JSON.stringify({ i: Number(index) || 0, mode: usedMode }) });
  if (!r?.ok) return JSON.stringify({ site: p.id, mode: usedMode, ...r });
  const { data, ...meta } = r;
  const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[r.type];
  const base = String(name || `${p.id}-image-${Number(index) || 0}`).replace(/\.(png|jpe?g|webp)$/i, "").replace(/[^\w.-]+/g, "-").slice(0, 80) || "image";
  return { content: [json({ site: p.id, mode: usedMode, ...meta }), { type: "file", name: `${base}.${ext}`, mimeType: r.type, data }] };
}

export async function chatToggle({ name, on }, { tab }) {
  if (!name) throw new ToolError("name is required (text of the toggle, a case-insensitive pattern)", "input_invalid");
  const p = siteOf(tab, "toggle");
  return JSON.stringify({ site: p.id, ...(await runOp(tab, p, "toggle", { __NAME__: `new RegExp(${JSON.stringify(String(name))},'i')`, __ON__: on === false ? "false" : "true" })) });
}
