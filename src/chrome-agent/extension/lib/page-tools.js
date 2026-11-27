// Tab-bound tools other than "computer".
import * as cdp from "./cdp.js";
import { ToolError } from "./router.js";
import { clearFrame } from "./screenshot.js";
import * as frames from "./frames.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function inject(tabId, func, args = []) {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args, injectImmediately: true });
    return res?.result;
  } catch (e) {
    throw new ToolError(`Could not run in page: ${e.message}`, "injected_script_failed");
  }
}

const ensureContent = (tabId, frameId = 0) => frames.ensureContent(tabId, frameId);

function waitForLoad(tabId, timeoutMs = 15000, abort = null) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (status) => { if (done) return; done = true; chrome.tabs.onUpdated.removeListener(l); clearTimeout(t); resolve(status); };
    const l = (id, info) => { if (id === tabId && info.status === "complete") finish("complete"); };
    const t = setTimeout(() => finish("loading"), timeoutMs);
    chrome.tabs.onUpdated.addListener(l);
    if (abort) {
      // The dialog may already have opened while chrome.tabs.update was still pending.
      if (abort.fired) return finish("aborted");
      abort.fire = () => finish("aborted");
    }
    chrome.tabs.get(tabId).then((tab) => { if (tab.status === "complete") setTimeout(() => chrome.tabs.get(tabId).then((t2) => t2.status === "complete" && finish("complete")), 300); });
  });
}

// ---------------- navigate ----------------
export async function navigate({ tabId, url, force }, { checkPerm }) {
  if (!url) throw new ToolError("url is required", "input_invalid");
  clearFrame(tabId);
  if (url === "back" || url === "forward") {
    const before = (await chrome.tabs.get(tabId)).url;
    const step = url === "back" ? chrome.tabs.goBack(tabId) : chrome.tabs.goForward(tabId);
    // chrome.tabs.goBack refuses entries Chrome marks as skippable (e.g. pages the user never
    // interacted with), even when history has them; CDP history works in that case.
    await step.catch(() => cdp.historyStep(tabId, url === "back" ? -1 : 1));
    await waitForLoad(tabId);
    const t = await chrome.tabs.get(tabId);
    return `Navigated ${url} to ${t.url}${t.url === before ? " (the URL did not change)" : ""}`;
  }
  url = String(url).trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = "https://" + url;
  if (/^(javascript|chrome|chrome-extension|devtools|edge|brave|view-source|data|blob):/i.test(url)) {
    throw new ToolError(`Navigation to ${url.split(":")[0]}: URLs is not allowed.`, "navigate_blocked_scheme");
  }
  if (/^https?:/i.test(url)) {
    let u = null;
    try { u = new URL(url); } catch {}
    // Chrome would "repair" these into odd hosts (e.g. "ht!tp" from "ht!tp://x"); refuse instead.
    if (!u || !u.hostname || /\s/.test(url.split(/[/?#]/, 3).join("")) || !/^[\p{L}\p{N}._-]+$|^\[[0-9a-f:.]+\]$/iu.test(decodeURIComponent(u.hostname))) {
      throw new ToolError(`"${url}" is not a valid web address.`, "navigate_invalid_url");
    }
  }
  await checkPerm("navigate", url);

  // Handle "Leave site?" beforeunload dialogs through CDP when already attached.
  let dialogNote = "";
  const tab = await chrome.tabs.get(tabId);
  const attachable = /^https?:|^about:blank$|^chrome:\/\/newtab/i.test(tab.url || "");
  let onEvent;
  const abort = {};
  // An open alert/confirm/prompt freezes the page; leaving it means cancelling it (never "OK").
  let leftDialog = "";
  const open = cdp.openDialog(tabId);
  if (open && open.type !== "beforeunload") {
    await cdp.send(tabId, "Page.handleJavaScriptDialog", { accept: false }, 5000).catch(() => {});
    leftDialog = ` (the open ${open.type} dialog was cancelled)`;
  }
  if (attachable) {
    await cdp.attach(tabId).catch(() => {});
    // Start console/network capture before the load so the page's own requests are listed.
    await cdp.enableConsole(tabId).catch(() => {});
    await cdp.enableNetwork(tabId).catch(() => {});
    onEvent = (src, method, p) => {
      if (src.tabId === tabId && method === "Page.javascriptDialogOpening" && p.type === "beforeunload") {
        cdp.send(tabId, "Page.handleJavaScriptDialog", { accept: !!force }).catch(() => {});
        dialogNote = force ? " (a 'Leave site?' dialog was accepted)" : "BLOCKED";
        if (!force) { abort.fired = true; abort.fire?.(); }
      }
    };
    chrome.debugger.onEvent.addListener(onEvent);
  }
  try {
    await chrome.tabs.update(tabId, { url });
    let status = await waitForLoad(tabId, 15000, abort);
    if (dialogNote === "BLOCKED") throw new ToolError("The page showed a 'Leave site?' dialog; navigation was cancelled. Pass force: true to leave anyway.", "navigate_beforeunload_blocked");
    let t = await chrome.tabs.get(tabId);
    // A fresh new-tab page sometimes drops the first update (seen in e2e runs): the tab stays on
    // chrome://newtab with nothing pending. Try once more.
    if (/^chrome:\/\/newtab|^about:blank$/i.test(t.url || "") && !t.pendingUrl && t.url !== url) {
      await chrome.tabs.update(tabId, { url });
      status = await waitForLoad(tabId, 15000, abort);
      t = await chrome.tabs.get(tabId);
    }
    return `Navigated to ${t.url}${status === "loading" ? " (still loading)" : ""}${dialogNote}${leftDialog}`;
  } finally {
    if (onEvent) chrome.debugger.onEvent.removeListener(onEvent);
  }
}

// ---------------- read_page / find ----------------
const MAX_FRAME_DEPTH = 5;

/** Outline of one frame, with the outlines of its child frames spliced in at their iframe. */
async function frameOutline(tabId, frameId, { filter, depth, maxChars, ref }, level = 0) {
  await ensureContent(tabId, frameId);
  const r = await frames.runIn(tabId, frameId, (f, d, m, ref) => window.__tca.tree(f, d, m, ref), [filter, depth, maxChars, ref]);
  if (!r) throw new ToolError("Could not read the page.", "injected_script_failed");
  if (r.error) throw new ToolError(r.error, r.errorCode);
  const out = [];
  let kids = null; // window.frames index -> frameId, looked up on the first iframe
  for (const line of frames.globalizeText(frameId, r.pageContent).split("\n")) {
    const m = /^( *)@@frame (\d+)@@$/.exec(line);
    if (!m) { if (line) out.push(line); continue; }
    const indent = m[1].length;
    if (level >= MAX_FRAME_DEPTH) { out.push(`${m[1]}(nested frame not expanded)`); continue; }
    kids ??= await frames.childFrames(tabId, frameId);
    const child = kids.get(Number(m[2]));
    if (child == null) { out.push(`${m[1]}(frame content unavailable)`); continue; }
    try {
      const sub = await frameOutline(tabId, child, { filter, depth: Math.max(1, depth - indent), maxChars, ref: null }, level + 1);
      for (const l of sub.text.split("\n")) if (l) out.push(m[1] + l);
    } catch (e) {
      out.push(`${m[1]}(frame content unavailable: ${e.message})`);
    }
  }
  return { text: out.join("\n"), viewport: r.viewport };
}

export async function readPage({ tabId, filter = "all", depth = 15, ref_id, max_chars = 50000 }) {
  if (!["all", "interactive"].includes(filter)) throw new ToolError('filter must be "all" or "interactive"', "input_invalid");
  const maxChars = Number(max_chars) || 50000;
  const start = ref_id ? frames.parseRef(ref_id) : { frameId: 0, local: null };
  const o = await frameOutline(tabId, start.frameId, { filter, depth: Number(depth) || 15, maxChars, ref: start.local });
  let text = o.text;
  if (text.length > maxChars) {
    const cut = text.lastIndexOf("\n", maxChars);
    text = text.slice(0, cut > 0 ? cut : maxChars) + `\n[output truncated at ${maxChars} of ${o.text.length} characters. Pass a larger max_chars, or use ref_id or a smaller depth to focus.]`;
  }
  const vp = start.frameId ? "" : `\n\nViewport: ${o.viewport.width}x${o.viewport.height}`;
  return `${text || "(no matching elements in the viewport; try filter \"all\" or scroll)"}${vp}`;
}

export async function find({ tabId, query }) {
  if (!query) throw new ToolError("query is required", "input_invalid");
  const results = await frames.runInAll(tabId, (q) => window.__tca?.find(q, 20) || null, [String(query)]);
  let total = 0;
  const items = [];
  for (const { frameId, result } of results) {
    if (!result) continue;
    total += result.total;
    for (const it of result.items) items.push({ ...it, ref: frames.globalRef(frameId, it.ref), frameId });
  }
  if (!total) throw new ToolError(`No elements matched "${query}". Try other words, or read_page with filter "interactive".`, "find_no_match");
  items.sort((a, b) => b.score - a.score || a.frameId - b.frameId);
  const lines = items.slice(0, 20).map((it) => `- ${it.ref}: ${it.desc}${it.frameId ? " (in iframe)" : ""}`);
  return `Found ${total} matching element${total === 1 ? "" : "s"}${total > 20 ? " (showing 20)" : ""}\n\n${lines.join("\n")}`;
}

// ---------------- form_input ----------------
export async function formInput({ tabId, ref, value }) {
  if (!ref) throw new ToolError("ref is required", "input_invalid");
  if (value === undefined) throw new ToolError("value is required", "input_invalid");
  const { frameId, local } = frames.parseRef(ref);
  await ensureContent(tabId, frameId);
  const r = await frames.runIn(tabId, frameId, async (ref, value) => {
    const el = window.__tca.resolve(ref);
    if (!el) return { error: `Element ${ref} not found; it may have been removed from the page.`, code: "ref_stale" };
    el.scrollIntoView({ block: "center", behavior: "instant" });
    const secret = window.__tca.isSensitive(el);
    const show = (v) => (secret ? "[redacted]" : String(v));
    const fire = () => { el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
    if (el.tagName === "SELECT") {
      const prev = el.selectedOptions[0]?.textContent.trim();
      const v = String(value);
      const opt = [...el.options].find((o) => o.value === v) || [...el.options].find((o) => o.textContent.trim() === v) || [...el.options].find((o) => o.textContent.trim().toLowerCase().includes(v.toLowerCase()));
      if (!opt) return { error: `No option matching "${v}". Options: ${[...el.options].map((o) => o.textContent.trim()).join(", ")}`, code: "input_invalid" };
      el.selectedIndex = opt.index; fire();
      return { out: `Selected option "${opt.textContent.trim()}" (previous: "${prev}")` };
    }
    if (el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio")) {
      const want = el.type === "radio" ? true : value === true || value === "true" || value === 1 || value === "1";
      const prev = el.checked;
      if (el.indeterminate) return { error: "Checkbox is in a mixed state; click it instead.", code: "element_unsupported" };
      const until = Date.now() + 750;
      while (el.checked !== want && Date.now() < until) { el.focus(); el.click(); await new Promise((r) => setTimeout(r, 50)); }
      if (el.checked !== want) return { error: "Could not change the checkbox state.", code: "element_unsupported" };
      return { out: `${el.type === "radio" ? "Radio" : "Checkbox"} ${want ? "checked" : "unchecked"} (previous: ${prev ? "checked" : "unchecked"})` };
    }
    if (el.tagName === "INPUT" && el.type === "file") return { error: "Use file_upload for file inputs.", code: "element_unsupported" };
    if (el.isContentEditable) {
      const prev = el.textContent; el.focus(); el.textContent = String(value); fire();
      return { out: `Set text to "${show(value)}" (previous: "${show(prev.slice(0, 100))}")` };
    }
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const prev = el.value;
      const proto = el.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, String(value)); // works with React-controlled inputs
      el.focus();
      try { el.setSelectionRange(el.value.length, el.value.length); } catch {}
      fire();
      return { out: `Set ${el.type || "text"} value to "${show(value)}" (previous: "${show(prev)}")` };
    }
    return { error: `Element ${ref} (${el.tagName.toLowerCase()}) is not a form field.`, code: "element_unsupported" };
  }, [local, value]);
  if (!r) throw new ToolError("form_input failed; the page may have navigated.", "page_navigated_or_closed");
  if (r.error) throw new ToolError(r.error.replace(local, ref), r.code);
  return r.out;
}

// ---------------- get_page_text ----------------
export async function getPageText({ tabId, max_chars = 50000 }) {
  const r = await inject(tabId, (max) => {
    const sels = ["article", "main", "[class*=articleBody]", "[class*=article-body]", "[class*=post-content]", "[class*=entry-content]", "[class*=content-body]", "[role=main]", ".content", "#content"];
    let best = null;
    for (const s of sels) {
      const els = [...document.querySelectorAll(s)];
      if (els.length) { best = els.sort((a, b) => b.innerText.length - a.innerText.length)[0]; break; }
    }
    let src = best;
    let t = (best?.innerText || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (t.length < 10) { src = document.body; t = (document.body?.innerText || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(); }
    let note = "";
    if (t.length > max) { const cut = t.lastIndexOf("\n", max); note = `\n[truncated at ${max} of ${t.length} characters]`; t = t.slice(0, cut > 0 ? cut : max); }
    return { title: document.title, url: location.href, tag: src?.tagName.toLowerCase() || "body", text: t + note };
  }, [Number(max_chars) || 50000]);
  // Text of iframes (each labelled), within the remaining character budget.
  let budget = (Number(max_chars) || 50000) - (r?.text?.length || 0);
  let frameText = "";
  if (budget > 200) {
    const subs = await frames.runInAll(tabId, () => (window === top ? null : { url: location.href, text: (document.body?.innerText || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() })).catch(() => []);
    for (const { frameId, result } of subs) {
      if (!frameId || !result?.text || budget <= 200) continue;
      const t = result.text.length > budget ? result.text.slice(0, budget) + "\n[frame text truncated]" : result.text;
      frameText += `\n\n--- iframe ${frameId} (${result.url}) ---\n${t}`;
      budget -= t.length;
    }
  }
  if ((!r || !r.text) && !frameText) throw new ToolError("The page has no text content.", "get_page_text_no_content");
  return `Title: ${String(r.title).replace(/^(⏳|✅) /, "")}\nURL: ${r.url}\nSource element: <${r.tag}>\n---\n${r.text}${frameText}`;
}

// ---------------- javascript_tool ----------------
const SECRET_KEY = /(pass(word)?|token|secret|api[_-]?key|auth|credential|private[_-]?key|access[_-]?key|bearer|oauth|session|cookies?)/i;
const SECRET_VAL = [/^ey[\w-]+\.[\w-]+\.[\w-]+$/, /^[A-Za-z0-9+/]{40,}={0,2}$/, /^[a-f0-9]{32,}$/i, /^[^=;&\s]+=[^;&]*([;&]\s*[^=;&\s]+=[^;&]*)+$/];

export function sanitize(v, depth = 0, seen = new WeakSet(), stats = { redacted: 0 }) {
  if (v === null || typeof v !== "object") {
    if (typeof v === "string") {
      // URLs (with their query strings) are not secrets by shape; tokens in them are masked by key below.
      const isUrl = /^[a-z][\w+.-]*:\/\//i.test(v.trim());
      if (!isUrl && SECRET_VAL.some((r) => r.test(v.trim()))) { stats.redacted++; return "[redacted]"; }
      if (isUrl && /[?&#](?:[^=&#]*(?:token|key|secret|password|auth|session|sig)[^=&#]*)=/i.test(v)) {
        const masked = v.replace(/([?&#][^=&#]*(?:token|key|secret|password|auth|session|sig)[^=&#]*=)[^&#]+/gi, "$1[redacted]");
        if (masked !== v) { stats.redacted++; v = masked; }
      }
      return v.length > 1000 ? v.slice(0, 1000) + `… (${v.length} chars)` : v;
    }
    return v;
  }
  if (depth >= 5) return "[depth limit]";
  if (seen.has(v)) return "[circular]";
  seen.add(v);
  if (Array.isArray(v)) {
    const a = v.slice(0, 100).map((x) => sanitize(x, depth + 1, seen, stats));
    if (v.length > 100) a.push(`… ${v.length - 100} more`);
    return a;
  }
  const o = {};
  for (const [k, x] of Object.entries(v)) {
    if (SECRET_KEY.test(k)) { stats.redacted++; o[k] = "[redacted]"; } else o[k] = sanitize(x, depth + 1, seen, stats);
  }
  return o;
}

export async function javascriptTool({ tabId, text, action }) {
  if (action && action !== "javascript_exec") throw new ToolError('action must be "javascript_exec"', "input_invalid");
  if (!text) throw new ToolError("text (code) is required", "input_invalid");
  const run = (expression, replMode) => cdp.send(tabId, "Runtime.evaluate", { expression, replMode, awaitPromise: true, returnByValue: true, userGesture: true, timeout: 45000 }, 50000);
  let r = await run(`{${text}\n}`, true).catch((e) => ({ exceptionDetails: { text: e.message } }));
  if (r.exceptionDetails && /return/.test(text) && /Illegal return/i.test(r.exceptionDetails.exception?.description || r.exceptionDetails.text || "")) {
    r = await run(`(async()=>{${text}\n})()`, false);
  }
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new ToolError(`JavaScript execution error: ${d.exception?.description || d.text}`, "js_execution_error");
  }
  const res = r.result || {};
  let out;
  const stats = { redacted: 0 };
  if (res.type === "undefined") out = "undefined";
  else if (res.subtype === "null") out = "null";
  else if (res.type === "function") out = `[function ${res.description?.slice(0, 80)}]`;
  else if ("value" in res) out = typeof res.value === "string" ? sanitize(res.value, 0, new WeakSet(), stats) : JSON.stringify(sanitize(res.value, 0, new WeakSet(), stats), null, 2);
  else out = res.description || res.type;
  // Never hand back what is typed in a password field, however the script got hold of it.
  const pw = await cdp.send(tabId, "Runtime.evaluate", {
    expression: "[...document.querySelectorAll('input[type=password],input[autocomplete~=current-password],input[autocomplete~=new-password],input[autocomplete~=one-time-code]')].map((e) => e.value).filter((v) => v && v.length >= 4)",
    returnByValue: true,
  }, 5000).then((x) => x.result?.value || []).catch(() => []);
  for (const v of pw) {
    if (out.includes(v)) { out = out.split(v).join("[redacted]"); stats.redacted++; }
  }
  if (stats.redacted) out += `
[${stats.redacted} value(s) redacted because they look like secrets]`;
  if (out && out.length > 50000) out = out.slice(0, 50000) + "\n[output truncated at 50000 characters]";
  return out;
}

// ---------------- console / network ----------------
export async function readConsole({ tabId, onlyErrors, clear, pattern, limit = 100 }) {
  const first = !(cdp.getConsole(tabId).length);
  await cdp.enableConsole(tabId);
  let items = cdp.getConsole(tabId);
  if (onlyErrors) items = items.filter((m) => ["error", "exception", "assert"].includes(m.type));
  if (pattern) {
    let re; try { re = new RegExp(pattern, "i"); } catch { re = null; }
    items = items.filter((m) => (re ? re.test(m.text) : m.text.toLowerCase().includes(String(pattern).toLowerCase())));
  }
  const total = items.length;
  items = items.slice(0, Number(limit) || 100);
  if (clear) cdp.clearConsole(tabId);
  if (!total) return `No console messages found${first ? ". Console tracking starts with the first call of this tool on a tab; reload or act on the page, then call again" : ""}.`;
  const body = items.map((m, i) => `[${i + 1}] [${new Date(m.timestamp || Date.now()).toISOString().slice(11, 23)}] [${m.type.toUpperCase()}]${m.url ? ` (${m.url}:${m.lineNumber}:${m.columnNumber})` : ""}\n${m.text}${m.stackTrace ? `\nStack trace:\n${m.stackTrace}` : ""}`).join("\n\n");
  return `Found ${total} console messages (showing first ${items.length} of ${total}):\n\n${body}`;
}

const redactUrl = (u) => u.replace(/([?&](?:token|key|api_key|access_token|auth|sig|signature|password|code|session)[^=]*=)[^&#]+/gi, "$1REDACTED");

export async function readNetwork({ tabId, urlPattern, clear, limit = 100 }) {
  const first = !(cdp.getNetwork(tabId).length);
  await cdp.enableNetwork(tabId);
  let items = cdp.getNetwork(tabId);
  if (urlPattern) items = items.filter((r) => r.url.includes(urlPattern));
  const total = items.length;
  items = items.slice(0, Number(limit) || 100);
  if (clear) cdp.clearNetwork(tabId);
  if (!total) return `No network requests found${urlPattern ? ` matching "${urlPattern}"` : ""}${first ? ". Network tracking starts with the first call of this tool on a tab; reload the page, then call again" : ""}.`;
  const body = items.map((r, i) => `${i + 1}. url: ${redactUrl(r.url)}\n   method: ${r.method}\n   statusCode: ${r.status ?? "pending"}${r.failed ? `\n   error: ${r.failed}` : ""}`).join("\n");
  return `Found ${total} network requests${urlPattern ? ` (filtered by URL pattern: "${urlPattern}")` : ""} (showing first ${items.length}):\n\n${body}`;
}

// ---------------- resize_window ----------------
export async function resizeWindow({ tabId, width, height }) {
  width = Math.round(Number(width)); height = Math.round(Number(height));
  if (!(width > 0 && height > 0 && width <= 7680 && height <= 4320)) throw new ToolError("width and height must be positive and at most 7680x4320", "input_invalid");
  const tab = await chrome.tabs.get(tabId);
  // Keep the window's current top-left corner: it is on a visible display. Restoring a
  // maximized window on a secondary monitor can put its "normal" bounds off-screen, and
  // Chrome then rejects a size-only update ("at least 50% within visible screen space").
  const before = await chrome.windows.get(tab.windowId);
  await chrome.windows.update(tab.windowId, { state: "normal" }).catch(() => {});
  try {
    await chrome.windows.update(tab.windowId, { left: before.left, top: before.top, width, height });
  } catch (e) {
    try { await chrome.windows.update(tab.windowId, { width, height }); }
    catch { throw new ToolError(`Could not resize the window to ${width}x${height}: ${e.message}`, "input_invalid"); }
  }
  clearFrame(tabId);
  return `Successfully resized window containing tab ${tabId} to ${width}x${height} pixels`;
}

// ---------------- uploads ----------------
const MAX_UPLOAD = 10 * 1024 * 1024;

async function dropFiles(tabId, files, { ref, point }) {
  const { frameId, local } = ref ? frames.parseRef(ref) : { frameId: 0, local: null };
  await ensureContent(tabId, frameId);
  const r = await frames.runIn(tabId, frameId, (files, ref, point) => {
    const list = new DataTransfer();
    for (const f of files) {
      const bin = atob(f.data); const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      list.items.add(new File([bytes], f.name, { type: f.mimeType || "application/octet-stream" }));
    }
    const target = ref ? window.__tca.resolve(ref) : document.elementFromPoint(point[0], point[1]);
    if (!target) return { error: ref ? `Element ${ref} not found; it may have been removed from the page.` : "Nothing at that point.", code: ref ? "ref_stale" : "input_invalid" };
    if (target.tagName === "INPUT" && target.type === "file") {
      target.files = list.files;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return { mode: "input" };
    }
    if (ref && !point) {
      const fileInput = target.querySelector?.("input[type=file]");
      if (fileInput) { fileInput.files = list.files; fileInput.dispatchEvent(new Event("change", { bubbles: true })); return { mode: "input" }; }
    }
    const rect = target.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, dataTransfer: list, clientX: point ? point[0] : rect.left + rect.width / 2, clientY: point ? point[1] : rect.top + rect.height / 2 };
    for (const t of ["dragenter", "dragover", "drop"]) target.dispatchEvent(new DragEvent(t, opts));
    return { mode: "drop" };
  }, [files, local, point || null]);
  if (!r) throw new ToolError("Upload script failed; the page may have navigated.", "injected_script_failed");
  if (r.error) throw new ToolError(r.error, r.code);
  return r.mode;
}

export async function fileUpload({ tabId, ref, files, paths }) {
  if (paths && !files) throw new ToolError("This extension needs file contents: pass files:[{data (base64), name, mimeType}]. The MCP server reads local paths for you.", "upload_caller_outdated");
  if (!ref) throw new ToolError("ref is required", "input_invalid");
  if (!Array.isArray(files) || !files.length) throw new ToolError("files must be a non-empty array", "input_invalid");
  let size = 0;
  for (const f of files) {
    if (!f.data || !f.name) throw new ToolError("each file needs data (base64) and name", "input_invalid");
    if (f.name.length > 255 || /[\\/]/.test(f.name)) throw new ToolError("file names must be plain names of at most 255 characters", "input_invalid");
    size += Math.floor((f.data.length * 3) / 4);
  }
  if (size > MAX_UPLOAD) throw new ToolError("total upload size is limited to 10 MB", "input_invalid");
  const mode = await dropFiles(tabId, files, { ref });
  if (mode !== "input") throw new ToolError(`${ref} is not a file input.`, "element_unsupported");
  return `Uploaded ${files.length} file(s) to file input: ${files.map((f) => f.name).join(", ")} (${(size / 1024).toFixed(1)} KB total)`;
}

/** Make the file extension agree with the bytes (a .png name must not carry JPEG data). Pure. */
export function imageFilename(name, mimeType) {
  const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }[mimeType];
  if (!ext) return name;
  const m = name.match(/^(.*)\.([A-Za-z0-9]{1,5})$/);
  if (!m) return `${name}.${ext}`;
  const cur = m[2].toLowerCase();
  if (cur === ext || (ext === "jpg" && cur === "jpeg")) return name;
  return /^(png|jpe?g|webp|gif|bmp)$/.test(cur) ? `${m[1]}.${ext}` : `${name}.${ext}`;
}

export async function uploadImage({ tabId, imageId, ref, coordinate, filename = "image.png" }, { images, toViewport }) {
  if (!imageId) throw new ToolError("imageId is required", "input_invalid");
  if (!!ref === !!coordinate) throw new ToolError("pass exactly one of ref or coordinate", "input_invalid");
  const img = images.get(imageId);
  if (!img) throw new ToolError(`No cached screenshot with ID ${imageId}. Take a screenshot first; IDs expire after 30 minutes.`, "screenshot_bytes_unavailable");
  const point = coordinate ? toViewport(tabId, coordinate) : null;
  filename = imageFilename(String(filename || "image.png"), img.mimeType);
  const mode = await dropFiles(tabId, [{ data: img.data, name: filename, mimeType: img.mimeType }], { ref, point });
  return `Uploaded image ${imageId} as ${filename} via ${mode === "input" ? "file input" : "drag and drop"}`;
}
