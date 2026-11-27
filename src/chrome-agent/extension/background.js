// tabcrew-chrome service worker: native link + tool router + tool wiring.
import { Router, ToolError, normalize } from "./lib/router.js";
import { NativeLink } from "./lib/native.js";
import * as tabs from "./lib/tabs.js";
import * as perms from "./lib/permissions.js";
import * as page from "./lib/page-tools.js";
import { computer, lastPoint } from "./lib/computer.js";
import * as recorder from "./lib/recorder.js";
import { toViewport } from "./lib/screenshot.js";
import * as cdp from "./lib/cdp.js";
import * as chat from "./lib/chat.js";

// ---------- call log for the popup ----------
const callLog = [];
const logCall = (entry) => {
  callLog.unshift({ ...entry, at: Date.now() });
  callLog.length = Math.min(callLog.length, 50);
  chrome.runtime.sendMessage({ type: "TCA_LOG", entry: callLog[0] }).catch(() => {});
};

// ---------- screenshot cache for upload_image (30 min TTL) ----------
const images = new Map();
function cacheImage(id, data, mimeType) {
  images.set(id, { data, mimeType, at: Date.now() });
  for (const [k, v] of images) if (Date.now() - v.at > 30 * 60 * 1000) images.delete(k);
  while (images.size > 10) images.delete(images.keys().next().value);
}

// ---------- permission mapping ----------
function permType(tool, args) {
  switch (tool) {
    case "computer":
      if (["left_click", "right_click", "double_click", "triple_click", "left_click_drag"].includes(args.action)) return "click";
      if (["type", "key"].includes(args.action)) return "type";
      if (args.action === "wait") return null;
      return "read_page_content";
    case "read_page": case "find": case "get_page_text": case "read_console_messages": case "read_network_requests": return "read_page_content";
    case "form_input": return "type";
    case "javascript_tool": return "execute_javascript";
    case "file_upload": case "upload_image": return "upload";
    case "gif_creator": return "read_page_content";
    case "chat_status": case "chat_read": case "chat_images": case "chat_save_image": return "read_page_content";
    case "chat_send": case "chat_toggle": return "type";
    default: return null;
  }
}

const TAB_TOOLS = new Set(["navigate", "computer", "read_page", "find", "form_input", "get_page_text", "javascript_tool",
  "read_console_messages", "read_network_requests", "resize_window", "file_upload", "upload_image", "gif_creator",
  "chat_status", "chat_send", "chat_read", "chat_images", "chat_save_image", "chat_toggle"]);

/** Caption of a GIF frame. Typed text is not shown (it may be private). */
function frameLabel(name, a) {
  if (name === "navigate") return `navigate ${a.url}`;
  const where = a.ref ? ` ${a.ref}` : a.coordinate ? ` (${a.coordinate.join(", ")})` : "";
  switch (a.action) {
    case "type": return `type (${String(a.text || "").length} characters)`;
    case "key": return `key ${a.text}`;
    case "scroll": return `scroll ${a.scroll_direction || "down"}${where}`;
    default: return `${a.action}${where}`;
  }
}

/** Short English caption shown next to the agent's cursor in the page. Typed text is never shown. */
function activityLabel(name, a) {
  const host = (u) => { try { return new URL(/^[a-z]+:/i.test(u) ? u : `https://${u}`).host; } catch { return u; } };
  const q = (s, n = 24) => { s = String(s || ""); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
  switch (name) {
    case "navigate": return a.url === "back" ? "Going back" : a.url === "forward" ? "Going forward" : `Opening ${host(a.url)}`;
    case "computer":
      switch (a.action) {
        case "left_click": return "Click";
        case "double_click": return "Double-click";
        case "triple_click": return "Triple-click";
        case "right_click": return "Right-click";
        case "left_click_drag": return "Dragging";
        case "hover": return "Pointing";
        case "type": return "Typing";
        case "key": return `Pressing ${q(a.text, 20)}`;
        case "scroll": case "scroll_to": return "Scrolling";
        case "wait": return "Waiting";
        case "screenshot": case "zoom": return "Looking at the page";
        default: return q(a.action);
      }
    case "read_page": case "get_page_text": return "Reading the page";
    case "find": return `Finding “${q(a.query)}”`;
    case "form_input": return "Filling in a field";
    case "javascript_tool": return "Running a script";
    case "file_upload": case "upload_image": return "Attaching a file";
    case "read_console_messages": case "read_network_requests": return "Checking the page";
    case "chat_status": return "Checking the chat";
    case "chat_send": return "Sending a message";
    case "chat_read": return "Waiting for the reply";
    case "chat_images": return "Waiting for images";
    case "chat_save_image": return "Saving an image";
    case "chat_toggle": return `Turning ${q(a.name, 16)} ${a.on === false ? "off" : "on"}`;
    default: return "";
  }
}

async function setActivity(tabId, label) {
  try { await chrome.tabs.sendMessage(tabId, { type: "TCA_ACTIVE", label }); } catch {}
}
const setDone = (tabId) => chrome.tabs.sendMessage(tabId, { type: "TCA_DONE" }).catch(() => {});

// Follow an agent (the eye in the popup): the window shows the tab that agent acts on, so you can
// watch it work. One agent at a time; other agents never move the view. Switching tabs yourself
// in that window stops following.
const validAgent = (a) => (a && typeof a.id === "string" && /^[\w-]{1,32}$/.test(a.id)
  ? { id: a.id, name: String(a.name || "Agent").slice(0, 80) } : null);
let follow = null;      // agent id
let switching = null;   // tab id we are activating ourselves
chrome.storage.session.get(tabs.FOLLOW_KEY).then((v) => { follow = v[tabs.FOLLOW_KEY] || null; });
chrome.storage.onChanged.addListener((c, area) => { if (area === "session" && c[tabs.FOLLOW_KEY]) follow = c[tabs.FOLLOW_KEY].newValue || null; });
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  if (!follow) return;
  if (tabId === switching) { switching = null; return; }
  const g = await tabs.getGroup().catch(() => null);
  if (g && g.windowId === windowId) chrome.storage.session.remove(tabs.FOLLOW_KEY);
});

/** Wrap a tab-bound tool: group check, protected-page check, permissions, tab context suffix. */
function tabTool(name, fn) {
  return async (args, ctx) => {
    const tab = await tabs.assertInGroup(args.tabId);
    const type = permType(name, args);
    if (type) {
      if (cdp.isProtectedUrl(tab.url) && name !== "computer") {
        throw new ToolError(`Tab ${tab.id} shows a protected page (${tab.url}). Navigate it to a website first.`, "chrome_protected_page");
      }
      const files = name === "file_upload" && Array.isArray(args.files) ? ` (files: ${args.files.map((f) => f.name).join(", ")})` : "";
      await perms.check(type, tab.url, `${name}${args.action ? ":" + args.action : ""}${files}`);
    }
    // An open alert/confirm/prompt blocks input, scripts and screenshots: fail fast instead of
    // timing out. navigate (which replaces the page) and computer:wait still work.
    const dialog = cdp.openDialog(tab.id);
    if (dialog && name !== "navigate" && !(name === "computer" && args.action === "wait")) {
      throw new ToolError(cdp.dialogText(dialog), "js_dialog_open");
    }
    setActivity(tab.id, activityLabel(name, args));
    if (ctx.agent) tabs.noteAgent(tab.id, ctx.agent);
    // Switches the tab inside its window only; it never focuses the window.
    if (follow && ctx.agent?.id === follow && !tab.active) {
      switching = tab.id;
      chrome.tabs.update(tab.id, { active: true }).catch(() => { switching = null; });
    }
    let raw;
    try { raw = await fn(args, { ...ctx, tab, images, toViewport, checkPerm: (t, u) => perms.check(t, u) }); }
    finally { setDone(tab.id); }
    if (recorder.isRecording() && !cdp.openDialog(tab.id) && (name === "navigate" || (name === "computer" && args.action !== "zoom"))) {
      await recorder.recordFrame(tab.id, frameLabel(name, args), name === "computer" ? lastPoint.get(tab.id) || null : null);
    }
    const res = normalize(raw);
    if (raw && raw.imageId) cacheImage(raw.imageId, raw.imageData, raw.imageMime || "image/jpeg");
    const content = [...res.content];
    const firstImg = content.findIndex((c) => c.type === "image");
    const ctxText = { type: "text", text: await tabs.tabContextText(args.tabId) };
    if (firstImg === -1) content.push(ctxText); else content.splice(firstImg, 0, ctxText);
    return { content, isError: res.isError };
  };
}

// ---------- router ----------
const router = new Router({ defaultTimeoutMs: 60000, onCall: logCall });
router.register("tabs_context_mcp", (a) => tabs.tabsContext(a));
router.register("tabs_create_mcp", (args, ctx) => tabs.tabsCreate(ctx.agent));
router.register("tabs_close_mcp", (a) => tabs.tabsClose(a));
router.register("navigate", tabTool("navigate", page.navigate), { timeoutMs: 45000 });
router.register("computer", tabTool("computer", computer), { timeoutMs: 45000 });
router.register("read_page", tabTool("read_page", page.readPage));
router.register("find", tabTool("find", page.find));
router.register("form_input", tabTool("form_input", page.formInput));
router.register("get_page_text", tabTool("get_page_text", page.getPageText));
router.register("javascript_tool", tabTool("javascript_tool", page.javascriptTool), { timeoutMs: 60000 });
router.register("read_console_messages", tabTool("read_console_messages", page.readConsole));
router.register("read_network_requests", tabTool("read_network_requests", page.readNetwork));
router.register("resize_window", tabTool("resize_window", page.resizeWindow));
router.register("file_upload", tabTool("file_upload", page.fileUpload));
router.register("upload_image", tabTool("upload_image", page.uploadImage));
router.register("gif_creator", tabTool("gif_creator", recorder.gifCreator), { timeoutMs: 180000 });
router.register("chat_sites", chat.chatSites);
router.register("chat_status", tabTool("chat_status", chat.chatStatus), { timeoutMs: 60000 });
router.register("chat_send", tabTool("chat_send", chat.chatSend), { timeoutMs: 60000 });
router.register("chat_read", tabTool("chat_read", chat.chatRead), { timeoutMs: 115000 });
router.register("chat_images", tabTool("chat_images", chat.chatImages), { timeoutMs: 115000 });
router.register("chat_save_image", tabTool("chat_save_image", chat.chatSaveImage), { timeoutMs: 90000 });
router.register("chat_toggle", tabTool("chat_toggle", chat.chatToggle), { timeoutMs: 60000 });
router.register("browser_batch", browserBatch, { timeoutMs: 300000 });

async function browserBatch({ actions }, ctx) {
  if (!Array.isArray(actions) || !actions.length) throw new ToolError("actions must be a non-empty array of {name, input}", "batch_invalid_input");
  for (const [i, a] of actions.entries()) {
    if (!a || typeof a.name !== "string") throw new ToolError(`actions[${i}] needs a name`, "batch_invalid_input");
    if (a.name === "browser_batch") throw new ToolError("browser_batch cannot be nested", "batch_invalid_input");
    if (!router.handlers.has(a.name)) throw new ToolError(`actions[${i}]: unknown tool ${a.name}`, "batch_unknown_tool");
    if (TAB_TOOLS.has(a.name)) await tabs.assertInGroup(a.input?.tabId).catch((e) => { throw new ToolError(`actions[${i}]: ${e.message}`, "batch_tab_outside_group"); });
  }
  const content = [];
  for (const [i, a] of actions.entries()) {
    if (ctx.signal?.aborted) throw new ToolError("batch cancelled", "batch_cancelled");
    const label = a.name + (a.input?.action ? ":" + a.input.action : "");
    const entry = router.handlers.get(a.name);
    let res;
    try {
      res = normalize(await entry.handler(a.input || {}, ctx));
    } catch (e) {
      content.unshift({ type: "text", text: `actions[${i}] (${label}) failed: ${e.message} (${i} completed, ${actions.length - i - 1} remaining)` });
      content.push({ type: "text", text: await tabs.tabContextText(a.input?.tabId).catch(() => "") });
      return { content, isError: true };
    }
    // Drop the per-item tab context; one is added at the end.
    for (const c of res.content) {
      if (c.type === "text" && c.text.startsWith("\n\nTab Context:")) continue;
      // Trailing newline: some MCP clients join adjacent text blocks with no separator.
      content.push(c.type === "text" ? { type: "text", text: `[${label}] ${c.text}\n` } : c);
    }
    if (a.input?.tabId != null && cdp.openDialog(a.input.tabId)) {
      content.push({ type: "text", text: `Stopped after actions[${i}]: a JavaScript dialog opened.` });
      break;
    }
    if (i < actions.length - 1 && a.input?.tabId != null) {
      const until = Date.now() + 3000;
      while (Date.now() < until && (await chrome.tabs.get(a.input.tabId).catch(() => ({}))).status === "loading") await new Promise((r) => setTimeout(r, 100));
    }
  }
  const last = [...actions].reverse().find((a) => a.input?.tabId != null);
  content.push({ type: "text", text: await tabs.tabContextText(last?.input.tabId) });
  return { content };
}

// ---------- native link ----------
const chunks = new Map(); // id -> parts
// ---------- browser identity (shown to MCP clients by list_connected_browsers) ----------
function browserBrand() {
  const brands = (navigator.userAgentData?.brands || []).map((b) => b.brand).filter((b) => !/not.?a.?brand/i.test(b));
  return brands.find((b) => b !== "Chromium") || brands[0] || "Chromium";
}

// One promise for the id, so concurrent first calls (the hello to the host and the popup)
// cannot each create and store a different random id.
let deviceIdPromise = null;
function deviceId() {
  deviceIdPromise ||= chrome.storage.local.get("tca_device_id").then(async (v) => {
    if (v.tca_device_id) return v.tca_device_id;
    const id = crypto.randomUUID();
    await chrome.storage.local.set({ tca_device_id: id });
    return id;
  }).catch((e) => { deviceIdPromise = null; throw e; });
  return deviceIdPromise;
}

async function identity() {
  const [id, v] = await Promise.all([deviceId(), chrome.storage.local.get("tca_browser_name")]);
  const browser = browserBrand();
  return { deviceId: id, browser, name: v.tca_browser_name || `${browser} · ${id.slice(0, 4)}` };
}

const link = new NativeLink({
  helloInfo: identity,
  onRequest: async (msg) => {
    if (msg.type === "cancel") return router.cancel(msg.id);
    return router.dispatch(msg, { agent: validAgent(msg.agent) });
  },
  onState: (s) => chrome.runtime.sendMessage({ type: "TCA_STATE", state: s }).catch(() => {}),
});
// Large requests (file uploads) arrive split into chunks by the host.
const origOnMessage = link.onMessage.bind(link);
link.onMessage = async (msg) => {
  if (msg?.type === "chunk") {
    let c = chunks.get(msg.id);
    if (!c) {
      if (!(msg.total > 0 && msg.total <= 64)) return;
      c = { parts: [], size: 0, total: msg.total, timer: setTimeout(() => {
        chunks.delete(msg.id);
        link.post({ type: "tool_response", id: msg.id, error: { message: "request chunks did not complete within 30 s", code: "chunk_timeout" } });
      }, 30000) };
      chunks.set(msg.id, c);
    }
    if (typeof msg.data !== "string" || msg.seq !== c.parts.length || msg.total !== c.total) {
      clearTimeout(c.timer); chunks.delete(msg.id);
      return link.post({ type: "tool_response", id: msg.id, error: { message: "malformed chunk sequence", code: "chunk_invalid" } });
    }
    c.parts.push(msg.data);
    c.size += msg.data.length;
    if (c.size > 16 * 1024 * 1024) {
      clearTimeout(c.timer); chunks.delete(msg.id);
      return link.post({ type: "tool_response", id: msg.id, error: { message: "request too large", code: "chunk_too_large" } });
    }
    if (c.parts.length === c.total) {
      clearTimeout(c.timer); chunks.delete(msg.id);
      return origOnMessage(JSON.parse(c.parts.join("")));
    }
    return;
  }
  return origOnMessage(msg);
};
link.connect();

chrome.runtime.onStartup.addListener(() => link.connect());
chrome.runtime.onInstalled.addListener(() => link.connect());
chrome.alarms.create("tca-keepalive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "tca-keepalive" && !link.port) link.connect(); });

// ---------- popup / permission page messaging ----------

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  // Settings and permission answers only from our own extension pages (the popup, or one
  // of them opened as a tab), never from content scripts: their sender.url is the web page's URL.
  if (!(sender.url || "").startsWith(chrome.runtime.getURL(""))) return;
  switch (msg?.type) {
    case "TCA_PERMISSION_ANSWER":
      perms.answer(msg.id, msg.choice);
      reply({ ok: true });
      break;
    case "TCA_GET_STATE":
      Promise.all([perms.load(), identity()]).then(([p, id]) => reply({ state: link.state, log: callLog, tools: router.names(), perms: p, extId: chrome.runtime.id, identity: id }));
      return true;
    case "TCA_SET_NAME": {
      const name = String(msg.name || "").trim().slice(0, 60);
      (name ? chrome.storage.local.set({ tca_browser_name: name }) : chrome.storage.local.remove("tca_browser_name"))
        .then(() => link.sendHello())
        .then(() => reply({ ok: true }));
      return true;
    }
    case "TCA_SET_PERMS":
      perms.save(msg.perms).then(() => reply({ ok: true }));
      return true;
    case "TCA_RECONNECT":
      link.attempt = 0;
      link.connect();
      reply({ ok: true });
      break;
  }
});
