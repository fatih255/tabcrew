// End-to-end test in a throwaway Chrome for Testing profile.
//   node test/e2e/run.mjs <path to chrome.exe>
// Starts a local test site, launches Chrome with the unpacked extension, flips the throwaway
// profile to permission mode allow_all through its DevTools port, then drives every tool
// through the real MCP server (mcp/server.js) like an MCP client would.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const chromePath = process.argv[2];
if (!chromePath) { console.error("usage: node test/e2e/run.mjs <chrome.exe>"); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failures = 0;
function check(name, cond, detail = "") {
  results.push(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? `\n      ${String(detail).slice(0, 600).replace(/\n/g, "\n      ")}` : ""}`);
  if (!cond) failures++;
}

// ---------- local site ----------
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/api/ping") { res.writeHead(200, { "content-type": "text/plain" }); return res.end("pong"); }
  const f = path.join(here, "pages", u.pathname === "/" ? "index.html" : path.basename(u.pathname));
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end("nope"); }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  // frames.html embeds a cross-site frame: same server, but "localhost" instead of 127.0.0.1.
  res.end(fs.readFileSync(f, "utf8").replaceAll("{{XO_BASE}}", `http://localhost:${server.address().port}`));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ---------- chrome ----------
const browsers = [];
function launchBrowser() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "tca-e2e-"));
  const port = 9300 + Math.floor(Math.random() * 500) + browsers.length * 500;
  const proc = spawn(chromePath, [
    `--user-data-dir=${profile}`, `--load-extension=${path.join(root, "extension")}`,
    `--remote-debugging-port=${port}`, "--no-first-run", "--no-default-browser-check",
    "--disable-features=DisableLoadExtensionCommandLineSwitch", "--window-size=1280,900", "about:blank",
  ], { stdio: "ignore" });
  const b = { profile, port, proc };
  browsers.push(b);
  return b;
}
const first = launchBrowser();
const profile = first.profile;
const DT_PORT = first.port;

async function devtoolsTargets(port = DT_PORT) {
  for (let i = 0; i < 50; i++) {
    try { return await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(200); }
  }
  throw new Error("DevTools port did not open");
}

async function serviceWorker(port) {
  for (let i = 0; i < 50; i++) {
    const t = (await devtoolsTargets(port)).find((t) => t.type === "service_worker" && t.url.includes("kpnajnknfhjhflpbppnfmikpjobaennd"));
    if (t) return t;
    await sleep(300);
  }
  return null;
}

/**
 * Write the permission settings through the extension's service worker and read them back.
 * Retries with a fresh service-worker target: right after install the worker can be replaced,
 * and an evaluate sent to the old one is lost silently (a lost write left the profile in "ask"
 * mode, so the next tool call waited for a permission popup and timed out).
 */
async function setPerms(port, perms) {
  perms = { modeSet: true, ...perms }; // as if picked in the popup
  const want = JSON.stringify(perms);
  for (let i = 0; i < 20; i++) {
    const sw = await serviceWorker(port);
    if (sw) {
      const got = await cdpEval(sw.webSocketDebuggerUrl,
        `chrome.storage.local.set({tca_perms:${want}}).then(() => chrome.storage.local.get("tca_perms")).then((v) => JSON.stringify(v.tca_perms))`).catch(() => null);
      let back = null;
      try { back = JSON.parse(got?.result?.value); } catch {}
      // Compare field by field: storage may return the keys in another order.
      if (back && back.mode === perms.mode && JSON.stringify(back.blocked) === JSON.stringify(perms.blocked)) return true;
    }
    await sleep(300);
  }
  return false;
}

/** The browserId (device id) the extension in this browser reports, once it has connected. */
async function deviceIdOf(sw) {
  for (let i = 0; i < 50; i++) {
    const v = (await cdpEval(sw.webSocketDebuggerUrl, `chrome.storage.local.get("tca_device_id").then((v) => v.tca_device_id || null)`))?.result?.value;
    if (v) return v;
    await sleep(200);
  }
  return null;
}

function cdpEval(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) { ws.close(); resolve(m.result); } };
    ws.onerror = reject;
    ws.onclose = () => resolve(null); // target went away before answering
    setTimeout(() => { try { ws.close(); } catch {} resolve(null); }, 10000);
  });
}

const swTarget = await serviceWorker(DT_PORT);
check("extension service worker started with the fixed ID", !!swTarget);
if (!swTarget) { await cleanup(); }
check("permission mode set to allow_all", await setPerms(DT_PORT, { mode: "allow_all", sites: {}, blocked: ["blocked.example"] }));

process.on("uncaughtException", (e) => { check("no crash", false, e.stack); cleanup(); });
process.on("unhandledRejection", (e) => { check("no crash", false, e?.stack || e); cleanup(); });

// ---------- MCP client ----------
var mcp = spawn(process.execPath, [path.join(root, "mcp", "server.js")], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const waiting = new Map();
mcp.stdout.setEncoding("utf8");
mcp.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    waiting.get(m.id)?.(m); waiting.delete(m.id);
  }
});
mcp.stderr.on("data", (d) => process.stderr.write(d));
let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((r) => waiting.set(id, r));
}
async function call(name, args = {}) {
  const r = await rpc("tools/call", { name, arguments: args });
  const res = r.result || { content: [{ type: "text", text: JSON.stringify(r.error) }], isError: true };
  res.text = res.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  res.images = res.content.filter((c) => c.type === "image");
  return res;
}

await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "0" } });
const list = await rpc("tools/list", {});
check("tools/list returns 26 tools", list.result.tools.length === 26, list.result.tools.length);

// Select this test browser explicitly (other browsers of this OS user may be connected too).
const dev1 = await deviceIdOf(swTarget);
let sel;
for (let i = 0; i < 40; i++) {
  sel = await call("select_browser", { browserId: dev1 });
  if (!sel.isError) break;
  await sleep(500);
}
check("select_browser picks the test browser", !sel.isError, sel.text);

// wait for the extension to connect to the host
let ctx;
for (let i = 0; i < 40; i++) {
  ctx = await call("tabs_context_mcp", { createIfEmpty: true });
  if (!ctx.isError) break;
  await sleep(500);
}
check("tabs_context_mcp creates the agent group", !ctx.isError && /availableTabs/.test(ctx.text), ctx.text);
const tabId = JSON.parse(ctx.text).selectedTabId;

let r = await call("navigate", { tabId, url: `${BASE}/` });
check("navigate", !r.isError && r.text.includes("Navigated to") && r.text.includes("Tab Context"), r.text);
if (r.isError) {
  console.log("DIAG targets:", JSON.stringify((await devtoolsTargets()).map((t) => [t.type, t.url.slice(0, 120)])));
  console.log("DIAG perms:", JSON.stringify((await cdpEval(swTarget.webSocketDebuggerUrl, `chrome.storage.local.get(null).then((v) => JSON.stringify(v))`))?.result?.value));
}

r = await call("read_console_messages", { tabId });
await call("navigate", { tabId, url: `${BASE}/` }); // reload so tracking sees load-time messages
await call("read_network_requests", { tabId });
await call("navigate", { tabId, url: `${BASE}/` });
await sleep(500);

r = await call("computer", { tabId, action: "screenshot" });
check("screenshot returns a JPEG image", !r.isError && r.images.length === 1 && r.images[0].mimeType === "image/jpeg" && /ss_\w+/.test(r.text), r.text);
const ssId = r.text.match(/ss_\w+/)?.[0];
const frame = r.text.match(/\((\d+)x(\d+), jpeg\)/);

r = await call("read_page", { tabId, filter: "interactive" });
check("read_page lists refs", !r.isError && /textbox "Full name" \[ref_\d+\]/.test(r.text) && /Viewport: \d+x\d+/.test(r.text), r.text);
check("read_page redacts password value", !/hunter2secret/.test(r.text), r.text);
const ref = (re) => r.text.match(re)?.[1];
// Accessible names prefer the <label> over placeholder/selected option (commit 679b25b).
const refName = ref(/textbox "Full name" \[(ref_\d+)\]/);
const refCountry = ref(/combobox "Country" \[(ref_\d+)\]/);
const refAgree = ref(/checkbox "I agree" \[(ref_\d+)\]/);
const refFile = ref(/button "Attachment" \[(ref_\d+)\]/);
const refSubmit = ref(/button "Send form" \[(ref_\d+)\]/);
const refNotes = ref(/textbox "Notes" \[(ref_\d+)\]/);
check("refs found for all form fields", refName && refCountry && refAgree && refFile && refSubmit && refNotes, r.text);

r = await call("read_page", { tabId, filter: "interactive" });
check("refs are stable across read_page calls", r.text.includes(`textbox "Full name" [${refName}]`), r.text);

r = await call("find", { tabId, query: "send button" });
check("find returns the submit button", !r.isError && r.text.includes(refSubmit), r.text);

r = await call("form_input", { tabId, ref: refName, value: "Ada Lovelace" });
check("form_input text", !r.isError && /Set text value to "Ada Lovelace"/.test(r.text), r.text);
r = await call("form_input", { tabId, ref: refCountry, value: "Germany" });
check("form_input select", !r.isError && /Selected option "Germany"/.test(r.text), r.text);
r = await call("form_input", { tabId, ref: refAgree, value: true });
check("form_input checkbox", !r.isError && /Checkbox checked/.test(r.text), r.text);

r = await call("find", { tabId, query: "Pro plan radio" });
const refPro = r.text.match(/(ref_\d+): radio "Pro plan"/)?.[1];
r = await call("form_input", { tabId, ref: refPro, value: true });
check("form_input radio", !r.isError && /Radio checked/.test(r.text), r.text);
r = await call("find", { tabId, query: "Bio" });
const refBio = r.text.match(/(ref_\d+): \w+ "Bio"/)?.[1];
r = await call("form_input", { tabId, ref: refBio, value: "Hello bio" });
check("form_input contenteditable", !r.isError && /Set text to "Hello bio"/.test(r.text), r.text);
r = await call("javascript_tool", { tabId, action: "javascript_exec", text: "document.querySelector('input[name=plan]:checked').value + '|' + document.getElementById('bio').textContent" });
check("radio + contenteditable values applied", r.text.startsWith("pro|Hello bio"), r.text);

const tmpFile = path.join(profile, "hello.txt");
fs.writeFileSync(tmpFile, "hello world");
r = await call("file_upload", { tabId, ref: refFile, paths: [tmpFile] });
check("file_upload", !r.isError && /Uploaded 1 file/.test(r.text), r.text);

r = await call("computer", { tabId, action: "left_click", ref: refNotes });
check("click by ref", !r.isError && /Clicked on element/.test(r.text), r.text);
r = await call("computer", { tabId, action: "type", text: "Hi Ünïcode 👋!" });
check("type", !r.isError, r.text);
r = await call("computer", { tabId, action: "left_click", ref: refSubmit });
r = await call("javascript_tool", { tabId, action: "javascript_exec", text: "document.getElementById('out').textContent" });
check("form submitted with all values", r.text.includes("sent:Ada Lovelace|de|true|hello.txt:11|Hi Ünïcode 👋!"), r.text);

r = await call("javascript_tool", { tabId, action: "javascript_exec", text: "const a = await Promise.resolve(20); a + 22" });
check("javascript_tool top-level await", r.text.startsWith("42"), r.text);
r = await call("javascript_tool", { tabId, action: "javascript_exec", text: "return {apiKey:'x', ok:true}" });
check("javascript_tool return + redaction", /"apiKey": "\[redacted\]"/.test(r.text) && /"ok": true/.test(r.text), r.text);
r = await call("javascript_tool", { tabId, action: "javascript_exec", text: "throw new Error('boom')" });
check("javascript_tool error", r.isError && /boom/.test(r.text), r.text);

// coordinate click: find the double-click button position in screenshot pixels
r = await call("javascript_tool", { tabId, action: "javascript_exec", text: "const b=document.getElementById('dbl').getBoundingClientRect(); JSON.stringify({x:b.left+b.width/2,y:b.top+b.height/2,w:innerWidth,h:innerHeight})" });
const pos = JSON.parse(r.text.split("\n\nTab Context")[0]);
const sw = Number(frame?.[1]), sh = Number(frame?.[2]);
const cx = Math.round((pos.x * sw) / pos.w), cy = Math.round((pos.y * sh) / pos.h);
r = await call("computer", { tabId, action: "double_click", coordinate: [cx, cy] });
r = await call("javascript_tool", { tabId, action: "javascript_exec", text: "document.getElementById('dbl').textContent" });
check("double_click by screenshot coordinate", r.text.includes("double clicked"), r.text);

r = await call("computer", { tabId, action: "key", text: "Escape shift+a ctrl+a", repeat: 1 });
r = await call("javascript_tool", { tabId, action: "javascript_exec", text: "document.getElementById('keys').textContent" });
check("key presses", /Escape,(Shift,)?A,(Control,)?a/.test(r.text), r.text);

r = await call("computer", { tabId, action: "key", text: "ctrl+plus" });
check("zoom shortcut refused", r.isError && /zoom/i.test(r.text), r.text);

r = await call("computer", { tabId, action: "scroll", coordinate: [100, 100], scroll_direction: "down", scroll_amount: 5 });
check("scroll returns screenshot", !r.isError && r.images.length === 1 && /Scrolled down by 5/.test(r.text), r.text);
r = await call("javascript_tool", { tabId, action: "javascript_exec", text: "scrollY" });
check("page actually scrolled", Number(r.text.split("\n")[0]) > 100, r.text);

r = await call("find", { tabId, query: "bottom button" });
const refBottom = r.text.match(/(ref_\d+): button "Bottom button"/)?.[1];
r = await call("computer", { tabId, action: "scroll_to", ref: refBottom });
check("scroll_to", !r.isError, r.text);
r = await call("computer", { tabId, action: "left_click", ref: refBottom });
r = await call("javascript_tool", { tabId, action: "javascript_exec", text: "document.getElementById('bottom').textContent" });
check("click after scroll_to", r.text.includes("bottom clicked"), r.text);

r = await call("computer", { tabId, action: "screenshot" });
r = await call("computer", { tabId, action: "zoom", region: [0, 0, 200, 100] });
check("zoom returns PNG", !r.isError && r.images[0]?.mimeType === "image/png", r.text);
r = await call("computer", { tabId, action: "left_click", coordinate: [99999, 5] });
check("out-of-frame coordinate rejected", r.isError && /outside the coordinate frame/.test(r.text), r.text);
r = await call("computer", { tabId, action: "hover", coordinate: [50, 50] });
check("hover", !r.isError && /Hovered at/.test(r.text), r.text);
r = await call("computer", { tabId, action: "left_click_drag", start_coordinate: [10, 10], coordinate: [60, 60] });
check("drag", !r.isError && /Dragged from/.test(r.text), r.text);
r = await call("computer", { tabId, action: "wait", duration: 0.2 });
check("wait", !r.isError && /Waited/.test(r.text), r.text);

r = await call("read_console_messages", { tabId, pattern: "test error" });
check("console capture", !r.isError && /test error from page/.test(r.text), r.text);
r = await call("read_console_messages", { tabId, onlyErrors: true });
check("console onlyErrors", /\[ERROR\]/.test(r.text) && !/page loaded/.test(r.text), r.text);
r = await call("read_network_requests", { tabId, urlPattern: "/api/ping" });
check("network capture + redaction", /api\/ping\?token=REDACTED/.test(r.text) && /statusCode: 200/.test(r.text), r.text);

r = await call("upload_image", { tabId, imageId: ssId, ref: refFile, filename: "shot.jpg" });
check("upload_image from screenshot cache", !r.isError && /Uploaded image/.test(r.text), r.text);

r = await call("browser_batch", { actions: [
  { name: "navigate", input: { tabId, url: `${BASE}/second.html` } },
  { name: "get_page_text", input: { tabId } },
  { name: "computer", input: { tabId, action: "screenshot", scale: 0.5 } },
] });
check("browser_batch", !r.isError && /\[navigate\] Navigated/.test(r.text) && /Source element: <article>/.test(r.text) && r.images.length === 1 && /0.5-scale/.test(r.text), r.text);
r = await call("browser_batch", { actions: [
  { name: "get_page_text", input: { tabId } },
  { name: "computer", input: { tabId, action: "left_click", coordinate: [-5, 0] } },
  { name: "get_page_text", input: { tabId } },
] });
check("browser_batch stops at the first error", r.isError && /actions\[1\] \(computer:left_click\) failed/.test(r.text) && /1 completed, 1 remaining/.test(r.text), r.text);

r = await call("navigate", { tabId, url: "back" });
check("navigate back", !r.isError && r.text.includes(`${BASE}/`), r.text);

r = await call("navigate", { tabId, url: "https://blocked.example/" });
check("blocked site refused", r.isError && /blocked/.test(r.text), r.text);

r = await call("navigate", { tabId, url: `${BASE}/leave.html` });
await call("computer", { tabId, action: "left_click", coordinate: [100, 100] });
await call("computer", { tabId, action: "type", text: "dirty" });
r = await call("navigate", { tabId, url: `${BASE}/second.html` });
check("beforeunload blocks navigation", r.isError && /Leave site/.test(r.text), r.text);
r = await call("navigate", { tabId, url: `${BASE}/second.html`, force: true });
check("force navigation accepts beforeunload", !r.isError && r.text.includes("second.html"), r.text);

r = await call("resize_window", { tabId, width: 1000, height: 800 });
check("resize_window", !r.isError && /1000x800/.test(r.text), r.text);

r = await call("tabs_create_mcp");
const newTab = Number(r.text.match(/Tab ID: (\d+)/)?.[1]);
check("tabs_create_mcp", !r.isError && newTab > 0, r.text);
r = await call("tabs_context_mcp");
check("new tab is in the group", r.text.includes(`"tabId":${newTab}`), r.text);
r = await call("tabs_close_mcp", { tabId: newTab });
check("tabs_close_mcp", !r.isError && /Closed tab/.test(r.text), r.text);
r = await call("get_page_text", { tabId: 1 });
check("tab outside the group refused", r.isError && /not in the agent's tab group|does not exist/.test(r.text), r.text);
r = await call("nonexistent_tool", {});
check("unknown tool", r.isError, r.text);

// stale refs after a reload
await call("navigate", { tabId, url: `${BASE}/` });
r = await call("read_page", { tabId, filter: "interactive" });
const oldRef = r.text.match(/textbox "Full name" \[(ref_\d+)\]/)?.[1];
await call("computer", { tabId, action: "key", text: "F5" });
await sleep(1000);
r = await call("form_input", { tabId, ref: oldRef, value: "x" });
check("ref is stale after reload", r.isError && /not found|removed/.test(r.text), r.text);
r = await call("read_page", { tabId, filter: "interactive" });
const refBeforeNav = r.text.match(/button "Send form" \[(ref_\d+)\]/)?.[1];
await call("navigate", { tabId, url: `${BASE}/second.html` });
r = await call("computer", { tabId, action: "left_click", ref: refBeforeNav });
check("ref is stale after cross-document navigation", r.isError && /not found|removed/.test(r.text), r.text);
await call("navigate", { tabId, url: `${BASE}/` });
r = await call("javascript_tool", { tabId, action: "javascript_exec", text: "({password:'p', token:'t', n:1})" });
check("javascript_tool reports redaction count", /2 value\(s\) redacted/.test(r.text), r.text);

// ---------- iframes (same-origin srcdoc + cross-site frame) ----------
// Recording on: its screenshot after navigate made the first click into the cross-site frame
// get dropped before the post-scroll wait existed (found by a real agent run).
await call("gif_creator", { tabId, action: "start_recording" });
await call("navigate", { tabId, url: `${BASE}/frames.html` });
await sleep(800);
r = await call("read_page", { tabId, filter: "all" });
const innerBtn = r.text.match(/button "Inner button" \[(ref_f\d+_\d+)\]/)?.[1];
const xoBtn = r.text.match(/button "Frame button" \[(ref_f\d+_\d+)\]/)?.[1];
const xoIn = r.text.match(/textbox "Frame input" \[(ref_f\d+_\d+)\]/)?.[1];
check("read_page includes same-origin and cross-site iframe content", innerBtn && xoBtn && xoIn, r.text);
// First interaction with the cross-site frame while it is still below the fold: the click
// has to scroll it into view and must still land (regression found by a real agent run).
r = await call("computer", { tabId, action: "left_click", ref: xoBtn });
r = await call("get_page_text", { tabId });
check("click by ref in a cross-site iframe that first has to be scrolled into view", /x clicked/.test(r.text), r.text);
await call("gif_creator", { tabId, action: "clear" });
await call("javascript_tool", { tabId, action: "javascript_exec", text: "scrollTo(0, 0); 'ok'" });
r = await call("read_page", { tabId, filter: "interactive" });
check("read_page interactive also descends into iframes", r.text.includes(innerBtn), r.text);
r = await call("find", { tabId, query: "frame input" });
check("find searches inside iframes", r.text.includes(xoIn) && /in iframe/.test(r.text), r.text);
r = await call("computer", { tabId, action: "left_click", ref: innerBtn });
r = await call("javascript_tool", { tabId, action: "javascript_exec", text: "document.getElementById('inner').contentDocument.getElementById('ib').textContent" });
check("click by ref inside a same-origin iframe", r.text.startsWith("inner clicked"), r.text);
r = await call("computer", { tabId, action: "left_click", ref: xoBtn });
check("click by ref inside a cross-site iframe", !r.isError, r.text);
r = await call("form_input", { tabId, ref: xoIn, value: "hello" });
check("form_input inside a cross-site iframe", !r.isError && /Set text value to "hello"/.test(r.text), r.text);
await call("computer", { tabId, action: "left_click", ref: xoIn });
await call("computer", { tabId, action: "key", text: "End" });
await call("computer", { tabId, action: "type", text: "!" });
r = await call("get_page_text", { tabId });
check("get_page_text includes iframe text; clicks and typing reached the cross-site frame",
  /Top paragraph text/.test(r.text) && /Cross origin frame text/.test(r.text) && /x clicked/.test(r.text) && /typed:hello!/.test(r.text), r.text);
r = await call("form_input", { tabId, ref: "ref_f99999_1", value: "x" });
check("unknown frame ref is an error", r.isError, r.text);

// ---------- gif_creator ----------
r = await call("gif_creator", { tabId, action: "export" });
check("gif export without frames is an error", r.isError && /No frames/.test(r.text), r.text);
r = await call("gif_creator", { tabId, action: "start_recording" });
check("gif start_recording", !r.isError && /Started recording/.test(r.text), r.text);
await call("navigate", { tabId, url: `${BASE}/` });
r = await call("find", { tabId, query: "Your name" });
const gifRef = r.text.match(/(ref_\d+): textbox/)?.[1];
await call("browser_batch", { actions: [
  { name: "computer", input: { tabId, action: "left_click", ref: gifRef } },
  { name: "computer", input: { tabId, action: "type", text: "secret words" } },
  { name: "computer", input: { tabId, action: "scroll", coordinate: [200, 200], scroll_direction: "down", scroll_amount: 3 } },
] });
r = await call("gif_creator", { tabId, action: "stop_recording" });
const nFrames = Number(r.text.match(/(\d+) frame/)?.[1]);
check("gif stop_recording counts frames (start, navigate, click, type, scroll, end)", nFrames === 6, r.text);
const gifPath = path.join(profile, "out", "test.gif");
r = await call("gif_creator", { tabId, action: "export", path: gifPath });
const gifOk = fs.existsSync(gifPath) && fs.readFileSync(gifPath).subarray(0, 6).toString() === "GIF89a";
check("gif export saves a GIF file at the given path", !r.isError && /Saved test\.gif/.test(r.text) && gifOk, r.text);
if (gifOk) {
  const b64 = fs.readFileSync(gifPath).toString("base64");
  r = await call("javascript_tool", { tabId, action: "javascript_exec", text:
    `const u = Uint8Array.from(atob("${b64}"), (c) => c.charCodeAt(0));
     const d = new ImageDecoder({ data: u, type: "image/gif" });
     await d.tracks.ready;
     const n = d.tracks.selectedTrack.frameCount;
     const last = await d.decode({ frameIndex: n - 1 });
     JSON.stringify({ n, w: last.image.displayWidth, h: last.image.displayHeight })` });
  let info = {};
  try { info = JSON.parse(r.text.split("\n\nTab Context")[0]); } catch {}
  check("Chrome decodes every frame of the exported GIF", info.n === nFrames && info.w > 100 && info.w <= 800 && info.h > 100, r.text);
}
r = await call("gif_creator", { tabId, action: "clear" });
check("gif clear", !r.isError && /Cleared 6 frame/.test(r.text), r.text);

// permission prompt in "ask" mode, answered through the popup page
check("permission mode set to ask", await setPerms(DT_PORT, { mode: "ask", sites: {}, blocked: [] }));
async function answerPopup(choice) {
  for (let i = 0; i < 40; i++) {
    const t = (await devtoolsTargets()).find((x) => x.url.includes("/permission/permission.html"));
    if (t) {
      for (let k = 0; k < 40; k++) {
        const ok = (await cdpEval(t.webSocketDebuggerUrl, `window.__tcaReady === true`))?.result?.value;
        if (ok) break;
        await sleep(100);
      }
      await cdpEval(t.webSocketDebuggerUrl, `document.getElementById(${JSON.stringify(choice)}).click()`);
      return t.url;
    }
    await sleep(250);
  }
  return null;
}
let pending = call("get_page_text", { tabId });
const popupUrl = await answerPopup("once");
r = await pending;
check("permission popup appears and 'Allow once' lets the call through", popupUrl && /type=read_page_content/.test(popupUrl) && !r.isError && /Title: TCA test form/.test(r.text), r.text);
pending = call("computer", { tabId, action: "left_click", coordinate: [5, 5] });
await answerPopup("deny");
r = await pending;
check("'Deny' refuses the call", r.isError && /denied/.test(r.text), r.text);
pending = call("find", { tabId, query: "send" });
await answerPopup("always");
r = await pending;
r = await call("find", { tabId, query: "name" });
check("'Always' is remembered (no second prompt)", !r.isError && /Found/.test(r.text), r.text);

// ---------- a second browser (another profile) ----------
const second = launchBrowser();
const sw2 = await serviceWorker(second.port);
check("second browser permission mode set to allow_all", await setPerms(second.port, { mode: "allow_all", sites: {}, blocked: [] }));
const dev2 = await deviceIdOf(sw2);
let l;
for (let i = 0; i < 40; i++) { l = await call("list_connected_browsers"); if (dev2 && l.text.includes(dev2)) break; await sleep(500); }
check("list_connected_browsers shows both test browsers", l.text.includes(dev1) && l.text.includes(dev2), l.text);

// Rename the second browser in its popup page; agents should see the new name.
const panel = await (await fetch(`http://127.0.0.1:${second.port}/json/new?chrome-extension://kpnajnknfhjhflpbppnfmikpjobaennd/popup/popup.html`, { method: "PUT" })).json();
for (let i = 0; i < 40; i++) {
  if ((await cdpEval(panel.webSocketDebuggerUrl, `document.getElementById("bname").value.length > 0`))?.result?.value) break;
  await sleep(150);
}
await cdpEval(panel.webSocketDebuggerUrl, `document.getElementById("bname").value = "E2E Second"; document.getElementById("saveName").click(); "ok"`);
for (let i = 0; i < 40; i++) { l = await call("list_connected_browsers"); if (l.text.includes("E2E Second")) break; await sleep(250); }
check("browser name set in the popup is shown to agents", l.text.includes("E2E Second"), l.text);

r = await call("select_browser", { browserId: "e2e second" });
check("select_browser by name", !r.isError, r.text);
r = await call("tabs_context_mcp", { createIfEmpty: true });
const tab2 = JSON.parse(r.text.split("\n\nTab Context")[0] || "{}").selectedTabId;
r = await call("navigate", { tabId: tab2, url: `${BASE}/second.html` });
check("tools run in the selected second browser", !r.isError && /second\.html/.test(r.text), r.text);
r = await call("select_browser", { browserId: dev1 });
r = await call("tabs_context_mcp");
const urls1 = JSON.parse(r.text).availableTabs.map((t) => t.url);
check("switching back reaches the first browser's own tabs", urls1.length && urls1.every((u) => !u.endsWith("/second.html")), r.text);

await cleanup();

async function cleanup() {
  console.log(results.join("\n"));
  console.log(`\n${results.length - failures}/${results.length} passed`);
  mcp?.kill?.();
  // Close each browser through DevTools (killing the launcher alone leaves child processes).
  for (const b of browsers) {
    try {
      const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${b.port}/json/version`)).json();
      await new Promise((res) => { const ws = new WebSocket(webSocketDebuggerUrl); ws.onopen = () => { ws.send(JSON.stringify({ id: 1, method: "Browser.close" })); setTimeout(res, 300); }; ws.onerror = res; });
    } catch {}
    await new Promise((res) => { if (b.proc.exitCode !== null) return res(); b.proc.once("exit", res); setTimeout(res, 5000); });
  }
  server.close();
  await sleep(1500);
  for (const b of browsers) { try { fs.rmSync(b.profile, { recursive: true, force: true }); } catch {} }
  process.exit(failures ? 1 : 0);
}
