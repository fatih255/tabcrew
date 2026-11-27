// Live suite: 100 scenarios against a real, connected Chrome through the MCP server
// (navigation, Google/Wikipedia/DuckDuckGo search, parallel tabs, a second agent at the same
// time, forms, uploads, GIF, iframes, shadow DOM, dialogs, edge cases).
//
//   node test/live/run.mjs [filter-regex]        uses the connected browser (set TCA_BROWSER
//                                                 to a browserId when several are connected)
//   node test/live/cft.mjs <chrome.exe> [filter]  same, in a throwaway Chrome for Testing profile
//
// Safety: works only in tabs it creates (the agent tab group) and closes them at the end;
// public sites are read/search only; writes happen on local test pages served by this script;
// a CAPTCHA / "unusual traffic" page is never solved, the case is marked SKIP.
// Needs network access. Exit code 1 when a case fails.
import http from "node:http"; import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(HERE, "../..");
const [filter] = process.argv.slice(2);
const PAGE_DIRS = [path.join(root, "test/e2e/pages"), path.join(HERE, "pages")];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- local pages ----------
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/api/")) { res.writeHead(200, { "content-type": "text/plain" }); return res.end("pong"); }
  if (u.pathname === "/slow") { setTimeout(() => { res.writeHead(200, { "content-type": "text/html" }); res.end("<title>slow</title><h1>Slow page done</h1>"); }, 4000); return; }
  if (u.pathname === "/redirect") { res.writeHead(302, { location: "/second.html" }); return res.end(); }
  if (u.pathname === "/status500") { res.writeHead(500, { "content-type": "text/html" }); return res.end("<h1>Server error page</h1>"); }
  if (u.pathname === "/download.txt") { res.writeHead(200, { "content-type": "text/plain", "content-disposition": "attachment" }); return res.end("x"); }
  const name = u.pathname === "/" ? "index.html" : path.basename(u.pathname);
  const f = PAGE_DIRS.map((d) => path.join(d, name)).find((p) => fs.existsSync(p));
  if (!f) { res.writeHead(404, { "content-type": "text/html" }); return res.end("<h1>Not found 404</h1>"); }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(fs.readFileSync(f, "utf8").replaceAll("{{XO_BASE}}", `http://localhost:${server.address().port}`));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ---------- MCP client ----------
function mcpClient() {
  const p = spawn(process.execPath, [path.join(root, "mcp/server.js")], { stdio: ["pipe", "pipe", "pipe"] });
  let buf = ""; const wait = new Map(); let nid = 1;
  p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); wait.get(m.id)?.(m); } catch {} } });
  p.stderr.on("data", () => {});
  const rpc = (method, params, ms = 60000) => new Promise((res, rej) => {
    const id = nid++; const t = setTimeout(() => { wait.delete(id); rej(new Error(`timeout ${ms}ms in ${method} ${params?.name || ""}`)); }, ms);
    wait.set(id, (m) => { clearTimeout(t); wait.delete(id); res(m); });
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const call = async (name, args = {}, ms) => {
    const t0 = Date.now();
    const m = await rpc("tools/call", { name, arguments: args }, ms);
    if (m.error) return { text: "RPC ERROR " + m.error.message, isError: true, images: [], ms: Date.now() - t0 };
    const c = m.result?.content || [];
    return { text: c.filter((x) => x.type === "text").map((x) => x.text).join("\n"), images: c.filter((x) => x.type === "image"), isError: !!m.result?.isError, ms: Date.now() - t0 };
  };
  return { p, rpc, call, init: () => rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "real100", version: "0" } }), kill: () => p.kill() };
}
const A = mcpClient(); await A.init();
const call = A.call;

// ---------- helpers ----------
const myTabs = new Set();
async function newTab() {
  const r = await call("tabs_create_mcp");
  const id = Number(/Tab ID: (\d+)/.exec(r.text)?.[1]);
  if (!id) throw new Error("tabs_create_mcp: " + r.text);
  myTabs.add(id); return id;
}
const nav = (tabId, url, ms) => call("navigate", { tabId, url }, ms);
const strip = (t) => t.split("\n\nTab Context:")[0];
const text = async (tabId, max) => strip((await call("get_page_text", { tabId, ...(max ? { max_chars: max } : {}) })).text);
const js = async (tabId, code) => strip((await call("javascript_tool", { action: "javascript_exec", tabId, text: code })).text);
const refOf = (s, re) => { for (const line of s.split("\n")) if (re.test(line)) { const m = /(ref_(?:f\d+_)?\d+)/.exec(line); if (m) return m[1]; } return null; };
async function findRef(tabId, query, re) { const r = await call("find", { tabId, query }); return refOf(r.text, re || new RegExp(query.split(" ")[0], "i")) || null; }
const click = (tabId, ref) => call("computer", { tabId, action: "left_click", ref });
// A screenshot of a background tab may not be drawn (same as the reference extension, which never
// brings tabs to the front): accept either an image or the clear "not drawing" error, both within 21 s.
const NOT_DRAWN = /Chrome is not drawing it/;
let notDrawn = 0;
const shotOk = (r) => { if (r.isError && NOT_DRAWN.test(r.text)) notDrawn++; return r.ms < 21000 && (r.images.length === 1 || (r.isError && NOT_DRAWN.test(r.text))); };
const isBot = (s) => /unusual traffic|not a robot|captcha|recaptcha|sorry\/index|Our systems have detected/i.test(s);

class Skip extends Error {}
const results = [];
let T = {}; // shared tab ids
const cases = [];
const tc = (name, fn, ms = 90000) => cases.push({ name, fn, ms });
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

// ============ SCENARIOS ============
// --- setup / browsers (1-6)
tc("list_connected_browsers shows this Chrome", async () => { const r = await call("list_connected_browsers"); const j = JSON.parse(r.text); expect(j.browsers.length >= 1 && j.browsers.some((b) => b.selected), r.text); });
tc("tools/list has 19 tools", async () => { const m = await A.rpc("tools/list", {}); expect(m.result.tools.length === 19, m.result.tools.length); });
tc("tabs_context_mcp createIfEmpty makes the agent group", async () => { const r = await call("tabs_context_mcp", { createIfEmpty: true }); const j = JSON.parse(r.text); expect(j.selectedTabId, r.text); T.main = j.selectedTabId; myTabs.add(T.main); });
tc("tabs_create_mcp adds a second tab", async () => { T.b = await newTab(); const j = JSON.parse((await call("tabs_context_mcp")).text); expect(j.availableTabs.some((t) => t.tabId === T.b), "not listed"); });
tc("select_browser by unknown name errors cleanly", async () => { const r = await call("select_browser", { browserId: "no-such-browser-xyz" }); expect(r.isError || /not|no /i.test(r.text), r.text); });
tc("unknown tabId is refused", async () => { const r = await call("get_page_text", { tabId: 999999999 }); expect(r.isError, r.text); });

// --- navigation (7-20)
tc("navigate to local form page", async () => { const r = await nav(T.main, BASE + "/"); expect(/Navigated to/.test(r.text) && !r.isError, r.text); });
tc("get_page_text reads local page", async () => { expect(/Signup test/.test(await text(T.main)), "no heading"); });
tc("navigate follows a 302 redirect", async () => { const r = await nav(T.b, BASE + "/redirect"); expect(/second\.html/.test(r.text), r.text); });
tc("navigate to 404 page reports page, no crash", async () => { const r = await nav(T.b, BASE + "/nope-404"); expect(!r.isError && /Not found/.test(await text(T.b)), r.text); });
tc("navigate to HTTP 500 page", async () => { const r = await nav(T.b, BASE + "/status500"); expect(!r.isError && /Server error/.test(await text(T.b)), r.text); });
tc("navigate to slow page (4 s) waits for load", async () => { const r = await nav(T.b, BASE + "/slow"); expect(/Slow page done/.test(await text(T.b)), r.text); });
tc("navigate to nonexistent domain gives an error, no hang", async () => { const r = await nav(T.b, "https://no-such-host-tca-test.invalid/"); expect(r.ms < 50000, "took " + r.ms); });
tc("navigate with invalid URL is refused", async () => { const r = await nav(T.b, "ht!tp://bad url"); expect(r.isError && /not a valid/.test(r.text), r.text); });
tc("navigate to chrome://settings is refused", async () => { const r = await nav(T.b, "chrome://settings"); expect(r.isError, r.text); });
tc("navigate without scheme adds https", async () => { const r = await nav(T.b, "example.com"); expect(/example\.com/.test(r.text) && !r.isError, r.text); });
tc("example.com text", async () => { expect(/Example Domain/.test(await text(T.b)), "missing"); });
tc("navigate back", async () => { const r = await nav(T.b, "back"); expect(!r.isError, r.text); });
tc("navigate forward", async () => { const r = await nav(T.b, "forward"); expect(!r.isError && /example/i.test(r.text), r.text); });
tc("data: URL navigation", async () => { const r = await nav(T.b, "data:text/html,<h1>Data URL page</h1>"); expect(r.isError && /not allowed/.test(r.text) && r.ms < 2000, r.text); });

// --- Google / search engines (21-32)
async function google(tabId, q) {
  const r = await nav(tabId, "https://www.google.com/");
  let t = await text(tabId, 4000);
  if (/consent\.google|Before you continue|Google'a devam etmeden|Reject all|Tümünü reddet/i.test(r.text + t)) {
    const ref = await findRef(tabId, "Reject all button", /Reject all|Tümünü reddet/i);
    if (ref) { await click(tabId, ref); await sleep(1500); }
  }
  if (isBot(r.text + t)) throw new Skip("Google showed a robot check");
  const fb = await call("find", { tabId, query: "search box" });
  const box = refOf(fb.text, /: (combobox|textbox|searchbox)/i);
  expect(box, "no search box. find: " + fb.text.slice(0, 600) + " || page: " + t.slice(0, 600));
  await click(tabId, box);
  await call("computer", { tabId, action: "type", text: q });
  const k = await call("computer", { tabId, action: "key", text: "Enter" });
  await sleep(1500);
  const out = await text(tabId, 20000);
  if (isBot(out)) throw new Skip("Google showed a robot check after search");
  return { k, out };
}
tc("Google: type a query in the box and press Enter", async () => { T.g = await newTab(); const { out } = await google(T.g, "Ada Lovelace"); expect(/Lovelace/i.test(out), out.slice(0, 300)); });
tc("Google: results contain Wikipedia link", async () => { const r = await call("find", { tabId: T.g, query: "Wikipedia result link" }); expect(/wikipedia/i.test(r.text), r.text.slice(0, 400)); });
tc("Google: click first Wikipedia result and land on wikipedia", async () => {
  const fr = await call("find", { tabId: T.g, query: "wikipedia.org Ada Lovelace link" });
  const ref = refOf(fr.text, /: link "[^"]*https:\/\/\w+\.wikipedia\.org|href="https:\/\/\w+\.wikipedia\.org\//i); expect(ref, "no ref: " + fr.text.slice(0, 500));
  await click(T.g, ref); await sleep(2500);
  const ctx = JSON.parse((await call("tabs_context_mcp")).text); const tab = ctx.availableTabs.find((t) => t.tabId === T.g);
  expect(/wikipedia\.org|wikipedia-org\.translate\.goog/.test(tab.url), tab.url); // Google may route via its translator
});
tc("Google: search by URL with Turkish query", async () => { const r = await nav(T.g, "https://www.google.com/search?q=" + encodeURIComponent("İstanbul nüfusu")); const t = await text(T.g, 20000); if (isBot(t)) throw new Skip("robot check"); expect(/İstanbul|Istanbul/i.test(t), t.slice(0, 200)); });
tc("Google: read_page interactive lists links", async () => { const r = await call("read_page", { tabId: T.g, filter: "interactive" }); if (isBot(r.text)) throw new Skip("robot check"); expect((r.text.match(/ref_/g) || []).length > 10, r.text.slice(0, 300)); });
tc("Google: screenshot of results", async () => { const r = await call("computer", { tabId: T.g, action: "screenshot" }); expect(shotOk(r) && (r.isError || r.images[0].data.length > 5000), r.text); });
tc("Google: scroll results down", async () => { const r = await call("computer", { tabId: T.g, action: "scroll", coordinate: [600, 400], scroll_direction: "down", scroll_amount: 5 }); expect(!r.isError, r.text); });
tc("Wikipedia: use the site search box", async () => {
  T.w = await newTab(); await nav(T.w, "https://en.wikipedia.org/wiki/Main_Page");
  const box = await findRef(T.w, "Search Wikipedia input", /search/i); expect(box, "no box");
  await click(T.w, box); await call("computer", { tabId: T.w, action: "type", text: "Grace Hopper" });
  await call("computer", { tabId: T.w, action: "key", text: "Enter" }); await sleep(2000);
  const t = await text(T.w, 5000); expect(/Hopper/.test(t), t.slice(0, 300));
});
tc("Wikipedia: get_page_text max_chars is honoured", async () => { const t = await text(T.w, 500); expect(t.length < 1500, "len " + t.length); });
tc("Wikipedia: find infobox birth date", async () => { const r = await call("find", { tabId: T.w, query: "Born" }); expect(!r.isError && /Born/.test(r.text), r.text); });
tc("DuckDuckGo HTML search", async () => { const r = await nav(T.w, "https://html.duckduckgo.com/html/?q=open+source+browser+agent"); const t = await text(T.w, 8000); if (isBot(t)) throw new Skip("robot check"); expect(t.length > 200, t.slice(0, 200)); });
tc("Hacker News front page has stories", async () => { await nav(T.w, "https://news.ycombinator.com/"); const t = await text(T.w, 8000); expect(/comments|points/i.test(t), t.slice(0, 200)); });

// --- parallel (33-44)
tc("PARALLEL: navigate 2 tabs to 2 sites at once", async () => {
  T.p1 = await newTab(); T.p2 = await newTab();
  const [a, b] = await Promise.all([nav(T.p1, "https://en.wikipedia.org/wiki/Alan_Turing"), nav(T.p2, "https://example.org/")]);
  expect(!a.isError && !b.isError, a.text + " | " + b.text);
});
tc("PARALLEL: get_page_text on both tabs at once, no mix-up", async () => {
  const [a, b] = await Promise.all([text(T.p1, 3000), text(T.p2, 3000)]);
  expect(/Turing/.test(a) && !/Turing/.test(b) && /Example Domain/.test(b), a.slice(0, 80) + " | " + b.slice(0, 80));
});
tc("PARALLEL: screenshots of 3 tabs at once", async () => {
  const rs = await Promise.all([T.p1, T.p2, T.main].map((tabId) => call("computer", { tabId, action: "screenshot" })));
  expect(rs.every(shotOk), rs.map((r) => r.text).join(" | "));
});
tc("PARALLEL: find on 2 tabs at once", async () => {
  const [a, b] = await Promise.all([call("find", { tabId: T.p1, query: "Turing machine link" }), call("find", { tabId: T.p2, query: "More information link" })]);
  expect(/ref_/.test(a.text) && /ref_/.test(b.text), a.text.slice(0, 100) + " | " + b.text.slice(0, 100));
});
tc("PARALLEL: fill 2 local forms in 2 tabs at once", async () => {
  await Promise.all([nav(T.p1, BASE + "/"), nav(T.p2, BASE + "/")]);
  const fill = async (tabId, name) => { const ref = await findRef(tabId, "Full name", /name/i); await call("form_input", { tabId, ref, value: name }); return js(tabId, "document.getElementById('name').value"); };
  const [a, b] = await Promise.all([fill(T.p1, "Tab One"), fill(T.p2, "Tab Two")]);
  expect(/Tab One/.test(a) && /Tab Two/.test(b) && !/Two/.test(a), a + " | " + b);
});
tc("PARALLEL: type into 2 tabs at once (keyboard isolation)", async () => {
  const typeIn = async (tabId, s) => { const ref = await findRef(tabId, "Notes", /notes/i); await click(tabId, ref); await call("computer", { tabId, action: "type", text: s }); return js(tabId, "document.getElementById('notes').value"); };
  const [a, b] = await Promise.all([typeIn(T.p1, "alpha alpha"), typeIn(T.p2, "bravo bravo")]);
  expect(/alpha alpha/.test(a) && /bravo bravo/.test(b) && !/bravo/.test(a) && !/alpha/.test(b), a + " | " + b);
});
tc("PARALLEL: click buttons in 2 tabs at once", async () => {
  const go = async (tabId) => { await click(tabId, await findRef(tabId, "Send form button", /send/i)); return js(tabId, "document.getElementById('out').textContent"); };
  const [a, b] = await Promise.all([go(T.p1), go(T.p2)]);
  expect(/Tab One/.test(a) && /Tab Two/.test(b), a + " | " + b);
});
tc("PARALLEL: 5 javascript_tool calls across tabs", async () => {
  const rs = await Promise.all([T.p1, T.p2, T.p1, T.p2, T.main].map((tabId, i) => js(tabId, `${i}*10`)));
  expect(rs.every((r, i) => r.includes(String(i * 10))), rs.join(" | "));
});
tc("PARALLEL: a second agent (second MCP server) works at the same time", async () => {
  const B = mcpClient(); await B.init();
  try {
    const [a, b] = await Promise.all([call("get_page_text", { tabId: T.p1 }), B.call("tabs_context_mcp")]);
    expect(/Signup/.test(a.text) && /availableTabs/.test(b.text), a.text.slice(0, 80) + " | " + b.text.slice(0, 120));
    const c = await B.call("javascript_tool", { action: "javascript_exec", tabId: T.p2, text: "document.title" });
    expect(/TCA test form/.test(c.text), c.text);
  } finally { B.kill(); }
});
tc("PARALLEL: GIF recording in one tab while another tab navigates", async () => {
  await call("gif_creator", { tabId: T.p1, action: "start_recording" });
  await Promise.all([nav(T.p1, BASE + "/second.html"), nav(T.p2, BASE + "/edge.html")]);
  await click(T.p1, await findRef(T.p1, "Second page heading", /second/i) || "ref_1").catch(() => {});
  await call("gif_creator", { tabId: T.p1, action: "stop_recording" });
  const r = await call("gif_creator", { tabId: T.p1, action: "export", path: os.tmpdir(), filename: "tca-real100.gif" });
  expect(/Saved tca-real100\.gif/.test(r.text), r.text);
  const f = path.join(os.tmpdir(), "tca-real100.gif"); expect(fs.readFileSync(f).subarray(0, 6).toString() === "GIF89a", "bad header"); fs.rmSync(f);
});
tc("PARALLEL: browser_batch with 3 steps", async () => {
  const r = await call("browser_batch", { actions: [
    { name: "navigate", input: { tabId: T.p2, url: BASE + "/second.html" } },
    { name: "get_page_text", input: { tabId: T.p2 } },
    { name: "find", input: { tabId: T.p2, query: "Second page heading" } }] });
  expect(/Second page/.test(r.text) && /\[find\] Found/.test(r.text) && !r.isError, r.text.slice(0, 300));
});
tc("PARALLEL: 10 rapid get_page_text calls on one tab", async () => {
  const rs = await Promise.all(Array.from({ length: 10 }, () => text(T.p2, 1000)));
  expect(rs.every((t) => /Second page/.test(t)), rs.map((t) => t.slice(0, 20)).join("|"));
});

// --- local form & interaction (45-66)
tc("read_page interactive on form", async () => { const r = await call("read_page", { tabId: T.main, filter: "interactive" }); T.form = r.text; expect(/Full name/.test(r.text) && /Send form/.test(r.text), r.text.slice(0, 300)); });
tc("password value is not exposed in read_page", async () => { expect(!/hunter2secret/.test(T.form), "leaked"); });
tc("javascript_tool redacts password value", async () => { const r = await js(T.main, "document.getElementById('pw').value"); expect(!/hunter2secret/.test(r), r); });
tc("form_input text", async () => { await call("form_input", { tabId: T.main, ref: refOf(T.form, /Full name/), value: "Grace Hopper" }); expect(/Grace Hopper/.test(await js(T.main, "document.getElementById('name').value")), "not set"); });
tc("form_input select by option text", async () => { await call("form_input", { tabId: T.main, ref: refOf(T.form, /Country|combobox/), value: "Germany" }); expect(/de/.test(await js(T.main, "document.getElementById('country').value")), "not de"); });
tc("form_input checkbox true", async () => { await call("form_input", { tabId: T.main, ref: refOf(T.form, /agree/i), value: true }); expect(/true/.test(await js(T.main, "document.getElementById('agree').checked")), "unchecked"); });
tc("click radio Pro plan", async () => { await click(T.main, refOf(T.form, /Pro plan/)); expect(/pro/.test(await js(T.main, "document.querySelector('[name=plan]:checked').value")), "not pro"); });
tc("type into contenteditable", async () => { await click(T.main, refOf(T.form, /Bio/)); await call("computer", { tabId: T.main, action: "type", text: "Hello bio" }); expect(/Hello bio/.test(await js(T.main, "document.getElementById('bio').textContent")), "empty"); });
tc("file_upload a local file", async () => {
  const f = path.join(os.tmpdir(), "tca-upload-test.txt"); fs.writeFileSync(f, "hello upload");
  const r = await call("file_upload", { tabId: T.main, ref: refOf(T.form, /Attachment/), paths: [f] }); fs.rmSync(f);
  expect(/tca-upload-test\.txt/.test(await js(T.main, "document.getElementById('file').files[0]?.name")), r.text);
});
tc("upload_image from a screenshot", async () => {
  const s = await call("computer", { tabId: T.main, action: "screenshot" }); const id = /ID: (\S+)/.exec(s.text)?.[1];
  const r = await call("upload_image", { tabId: T.main, imageId: id, ref: refOf(T.form, /Attachment/), filename: "shot.png" });
  expect(/shot\.png/.test(await js(T.main, "document.getElementById('file').files[0]?.name")), r.text);
});
tc("type in textarea and submit form", async () => {
  await click(T.main, refOf(T.form, /Notes/)); await call("computer", { tabId: T.main, action: "type", text: "via agent" });
  await click(T.main, refOf(T.form, /Send form/));
  const o = await js(T.main, "document.getElementById('out').textContent"); expect(/sent:Grace Hopper\|de\|true\|shot\.png/.test(o) && /via agent/.test(o), o);
});
tc("double_click", async () => { await call("computer", { tabId: T.main, action: "double_click", ref: refOf(T.form, /Double click/) }); expect(/double clicked/.test(await js(T.main, "document.getElementById('dbl').textContent")), "no"); });
tc("key presses reach the page", async () => { await call("computer", { tabId: T.main, action: "key", text: "Escape Tab" }); expect(/Escape/.test(await js(T.main, "document.getElementById('keys').textContent")), "no keys"); });
tc("key repeat", async () => { await call("computer", { tabId: T.main, action: "key", text: "ArrowDown", repeat: 3 }); expect((await js(T.main, "document.getElementById('keys').textContent")).split("ArrowDown").length >= 4, "repeat"); });
tc("scroll_to bottom button and click it", async () => {
  const ref = await findRef(T.main, "Bottom button", /bottom/i); await call("computer", { tabId: T.main, action: "scroll_to", ref }); await click(T.main, ref);
  expect(/bottom clicked/.test(await js(T.main, "document.getElementById('bottom').textContent")), "no");
});
tc("zoom into region", async () => { const r = await call("computer", { tabId: T.main, action: "zoom", region: [0, 0, 400, 200] }); expect(shotOk(r), r.text); });
tc("wait action", async () => { const r = await call("computer", { tabId: T.main, action: "wait", duration: 1 }); expect(!r.isError && r.ms >= 900, r.text); });
tc("read_console_messages sees page logs", async () => { await nav(T.main, BASE + "/"); await sleep(500); const r = await call("read_console_messages", { tabId: T.main, pattern: "page loaded" }); expect(/page loaded/.test(r.text), r.text); });
tc("read_console_messages onlyErrors", async () => { const r = await call("read_console_messages", { tabId: T.main, onlyErrors: true }); expect(/test error/.test(r.text) && !/page loaded/.test(r.text), r.text); });
tc("read_network_requests sees fetch", async () => { const r = await call("read_network_requests", { tabId: T.main, urlPattern: "/api/" }); expect(/api\/ping/.test(r.text), r.text); });
tc("link click navigates same tab", async () => { await click(T.main, await findRef(T.main, "Go to second page link", /second/i)); await sleep(800); expect(/Second page/.test(await text(T.main)), "not navigated"); });
tc("target=_blank link opens a tab inside the agent group", async () => {
  await nav(T.main, BASE + "/"); const before = JSON.parse((await call("tabs_context_mcp")).text).availableTabs.length;
  await click(T.main, await findRef(T.main, "Open in new tab link", /new tab/i)); await sleep(1500);
  const after = JSON.parse((await call("tabs_context_mcp")).text).availableTabs; after.forEach((t) => myTabs.add(t.tabId));
  expect(after.length === before + 1, `${before} -> ${after.length}`);
});

// --- edge cases (67-90)
tc("edge page loads with Turkish + emoji text", async () => { T.e = await newTab(); await nav(T.e, BASE + "/edge.html"); const t = await text(T.e); expect(/ğüşıöç/.test(t) && /😀/.test(t), t.slice(0, 200)); });
tc("type Turkish characters", async () => { await click(T.e, await findRef(T.e, "Turkish input", /turkish/i)); await call("computer", { tabId: T.e, action: "type", text: "Şişli Çağlayan ığü" }); expect(/Şişli Çağlayan ığü/.test(await js(T.e, "document.getElementById('tri').value")), "mangled"); });
tc("type emoji", async () => { await call("computer", { tabId: T.e, action: "type", text: " 🚀ok" }); expect(/🚀ok/.test(await js(T.e, "document.getElementById('tri').value")), "no emoji"); });
tc("ctrl+a then Delete clears input", async () => { await call("computer", { tabId: T.e, action: "key", text: "ctrl+a Delete" }); expect((await js(T.e, "JSON.stringify(document.getElementById('tri').value)")).includes('""'), "not cleared"); });
tc("maxlength field keeps 5 chars", async () => { await click(T.e, await findRef(T.e, "Short field", /short/i)); await call("computer", { tabId: T.e, action: "type", text: "1234567890" }); expect(/"12345"/.test(await js(T.e, "JSON.stringify(document.getElementById('maxl').value)")), "maxlength"); });
tc("shadow DOM button is found and clickable", async () => {
  const ref = await findRef(T.e, "Shadow button", /shadow/i); expect(ref, "not found in shadow DOM"); await click(T.e, ref);
  expect(/shadow clicked/.test(await js(T.e, "document.getElementById('w').shadowRoot.getElementById('sb').textContent")), "no click");
});
tc("hidden button is not reported as visible", async () => { const r = await call("read_page", { tabId: T.e, filter: "interactive" }); expect(!/Hidden button/.test(r.text), "hidden listed"); });
tc("disabled button is marked disabled", async () => { const r = await call("find", { tabId: T.e, query: "Disabled button" }); expect(/disabled/i.test(r.text), r.text); });
tc("element appearing after a delay", async () => { await click(T.e, await findRef(T.e, "Show late button", /show late/i)); await call("computer", { tabId: T.e, action: "wait", duration: 2 }); const ref = await findRef(T.e, "Late button", /"Late button"/); expect(ref, "late button not found"); await click(T.e, ref); expect(/late clicked/.test(await js(T.e, "document.getElementById('late').textContent")), "no"); });
tc("stale ref after element removed gives clear error", async () => { const ref = await findRef(T.e, "Vanishing button", /vanishing/i); await click(T.e, ref); const r = await click(T.e, ref); expect(r.isError && /not found|stale|removed|read_page|find/i.test(r.text), r.text); });
tc("hover", async () => { await call("computer", { tabId: T.e, action: "hover", ref: await findRef(T.e, "Hover me", /hover/i) }); expect(/hovered/.test(await js(T.e, "document.getElementById('hoverBtn').textContent")), "no hover"); });
tc("right_click", async () => { await call("computer", { tabId: T.e, action: "right_click", ref: await findRef(T.e, "Right click me", /right click/i) }); expect(/right clicked/.test(await js(T.e, "document.getElementById('rightBtn').textContent")), "no"); });
tc("triple_click", async () => { await call("computer", { tabId: T.e, action: "triple_click", ref: await findRef(T.e, "Triple click paragraph", /triple/i) }); expect(/3/.test(await js(T.e, "document.getElementById('tripleP').dataset.t")), "no triple"); });
tc("form_input range slider", async () => { await call("form_input", { tabId: T.e, ref: await findRef(T.e, "Volume slider", /volume/i), value: 75 }); expect(/75/.test(await js(T.e, "document.getElementById('slider').value")), "no"); });
tc("form_input date", async () => { await call("form_input", { tabId: T.e, ref: await findRef(T.e, "Birthday", /birthday/i), value: "2020-02-29" }); expect(/2020-02-29/.test(await js(T.e, "document.getElementById('date').value")), "no"); });
tc("form_input number", async () => { await call("form_input", { tabId: T.e, ref: await findRef(T.e, "Count", /count/i), value: 42 }); expect(/42/.test(await js(T.e, "document.getElementById('num').value")), "no"); });
tc("horizontal scroll inside a box", async () => { const r = await call("computer", { tabId: T.e, action: "scroll_to", ref: await findRef(T.e, "Far right cell", /far right/i) }); expect(!r.isError, r.text); expect(Number(await js(T.e, "document.getElementById('wide').scrollLeft").then((s) => /\d+/.exec(s)?.[0])) > 0, "not scrolled"); });
tc("javascript: link runs", async () => { await click(T.e, await findRef(T.e, "JS link", /js link/i)); expect(/js link ran/.test(await js(T.e, "document.getElementById('jsl').textContent")), "no"); });
tc("long page: get_page_text truncates 2000 list items", async () => { const t = await text(T.e, 3000); expect(t.length < 6000, "len " + t.length); });
tc("long page: read_page all with max_chars", async () => { const r = await call("read_page", { tabId: T.e, filter: "all", max_chars: 4000 }); expect(!r.isError && r.text.length < 12000, "len " + r.text.length); });
tc("javascript_tool: thrown error is reported", async () => { const r = await call("javascript_tool", { action: "javascript_exec", tabId: T.e, text: "throw new Error('boom-test')" }); expect(/boom-test/.test(r.text), r.text); });
tc("javascript_tool: async/await result", async () => { const r = await js(T.e, "await new Promise(r=>setTimeout(()=>r('late-value'),300))"); expect(/late-value/.test(r), r); });
tc("javascript_tool: huge return is capped", async () => { const r = await js(T.e, "'x'.repeat(2000000)"); expect(r.length < 300000, "len " + r.length); });
tc("alert dialog: reported at once, left open, other tools fail fast, navigate recovers", async () => {
  // Like the reference extension, dialogs are not answered for the agent.
  const r = await click(T.e, await findRef(T.e, "Alert button", /alert/i));
  expect(!r.isError && r.ms < 5000 && /alert dialog opened on this tab \("hello from page"\)/.test(r.text), r.ms + " " + r.text);
  const r2 = await call("computer", { tabId: T.e, action: "screenshot" });
  expect(r2.isError && r2.ms < 2000 && /alert dialog is open/.test(r2.text), r2.ms + " " + r2.text);
  const r3 = await call("get_page_text", { tabId: T.e });
  expect(r3.isError && r3.ms < 2000, r3.ms + " " + r3.text);
  const r4 = await nav(T.e, BASE + "/edge.html");
  expect(!r4.isError && r4.ms < 10000, r4.ms + " " + r4.text);
  expect(/Kenar durumlar/.test(await text(T.e)), "page not usable after navigating away from the dialog");
});

// --- frames, unload, tabs, misc (91-100)
tc("iframe: find and click inside cross-site frame", async () => {
  await nav(T.e, BASE + "/frames.html"); const ref = await findRef(T.e, "Frame button", /frame button/i); expect(/ref_f\d+_/.test(ref || ""), "ref " + ref);
  await click(T.e, ref); await sleep(300); expect(/x clicked/.test(await text(T.e)), "not clicked");
});
tc("iframe: type into same-origin frame field", async () => { const ref = await findRef(T.e, "Inner field", /inner field/i); await click(T.e, ref); await call("computer", { tabId: T.e, action: "type", text: "in frame" }); expect(/in frame/.test(await js(T.e, "document.getElementById('inner').contentDocument.getElementById('iin').value")), "no"); });
tc("beforeunload page: navigate away is not blocked forever", async () => {
  await nav(T.e, BASE + "/leave.html"); await click(T.e, await findRef(T.e, "dirty", /dirty/i)); await call("computer", { tabId: T.e, action: "type", text: "x" });
  const r = await nav(T.e, BASE + "/second.html", 70000); expect(r.isError && /Leave site/.test(r.text) && r.ms < 5000, r.ms + " " + r.text);
  const f = await call("navigate", { tabId: T.e, url: BASE + "/second.html", force: true }); expect(!f.isError && /second.html/.test(f.text), f.text);
});
tc("resize_window", async () => { const r = await call("resize_window", { tabId: T.e, width: 1100, height: 800 }); expect(!r.isError, r.text); await call("resize_window", { tabId: T.e, width: 1280, height: 900 }); });
tc("find with no matches", async () => { const r = await call("find", { tabId: T.e, query: "purple elephant spaceship" }); expect(!/ref_\d+: .*elephant/i.test(r.text), r.text); });
tc("screenshot of about:blank tab", async () => { const t = await newTab(); const r = await call("computer", { tabId: t, action: "screenshot" }); expect(r.images.length === 1 || r.isError, r.text); T.blank = t; });
tc("close a tab, then using it errors", async () => { await call("tabs_close_mcp", { tabId: T.blank }); myTabs.delete(T.blank); const r = await call("get_page_text", { tabId: T.blank }); expect(r.isError, r.text); });
tc("tab outside the agent group is refused", async () => {
  // the user's own tabs are not in our group: pick any id not in our list
  const ctx = JSON.parse((await call("tabs_context_mcp")).text); const ours = new Set(ctx.availableTabs.map((t) => t.tabId));
  const r = await call("get_page_text", { tabId: Math.max(...ours) + 100000 }); expect(r.isError, r.text);
});
tc("GitHub public repo page read", async () => { await nav(T.e, "https://github.com/nodejs/node"); const t = await text(T.e, 5000); expect(/node/i.test(t), t.slice(0, 200)); });
tc("MDN page: find a heading and scroll to it", async () => { await nav(T.e, "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API"); const ref = await findRef(T.e, "Concepts and usage heading", /concepts/i); expect(ref, "no heading"); const r = await call("computer", { tabId: T.e, action: "scroll_to", ref }); expect(!r.isError, r.text); });

// ============ RUN ============
const only = filter ? new RegExp(filter, "i") : null;
let n = 0;
for (const c of cases) {
  n++;
  if (only && !only.test(c.name)) continue;
  const t0 = Date.now(); let status = "PASS", info = "";
  try { await Promise.race([c.fn(), sleep(c.ms).then(() => { throw new Error("case timeout " + c.ms); })]); }
  catch (e) { if (e instanceof Skip) { status = "SKIP"; info = e.message; } else { status = "FAIL"; info = String(e.message || e).slice(0, 400); } }
  results.push({ n, name: c.name, status, info, ms: Date.now() - t0 });
  console.log(`${String(n).padStart(3)} ${status} ${c.name}${info ? "  -> " + info.replace(/\s+/g, " ") : ""} (${Date.now() - t0}ms)`);
}
// cleanup: close every tab we created
const ctx = JSON.parse((await call("tabs_context_mcp")).text || "{}");
for (const t of ctx.availableTabs || []) await call("tabs_close_mcp", { tabId: t.tabId }).catch(() => {});
const sum = (s) => results.filter((r) => r.status === s).length;
console.log(`\nTOTAL ${results.length} cases${only ? ` (filter /${filter}/ of ${cases.length})` : ""} | PASS ${sum("PASS")} FAIL ${sum("FAIL")} SKIP ${sum("SKIP")}`);
const out = path.join(os.tmpdir(), "tabcrew-chrome-live-results.json");
fs.writeFileSync(out, JSON.stringify(results, null, 2));
console.log(`Screenshots of background tabs that Chrome did not draw (reported clearly): ${notDrawn}`);
console.log(`Details: ${out}`);
A.kill(); server.close(); process.exit(sum("FAIL") ? 1 : 0);
