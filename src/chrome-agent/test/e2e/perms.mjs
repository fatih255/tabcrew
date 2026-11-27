// Permission defaults in a throwaway Chrome for Testing profile:
//  1. nothing stored                          -> no prompt (default "allow all")
//  2. legacy record {mode:"ask"} (v0.2.0 saved the default together with a site grant,
//     without modeSet)                         -> still no prompt, grant kept
//  3. {mode:"ask", modeSet:true} (picked in the popup) -> the permission popup opens
//   node test/e2e/perms.mjs <chrome.exe>
import http from "node:http"; import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const [chromePath] = process.argv.slice(2);
if (!chromePath) { console.error("usage: node test/e2e/perms.mjs <chrome.exe>"); process.exit(2); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(`<title>p</title><h1>Page ${req.url}</h1>`); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "tca-perms-"));
const port = 9500 + Math.floor(Math.random() * 100);
spawn(chromePath, [`--user-data-dir=${profile}`, `--load-extension=${path.join(root, "extension")}`, `--remote-debugging-port=${port}`,
  "--no-first-run", "--no-default-browser-check", "--disable-features=DisableLoadExtensionCommandLineSwitch", "--window-size=1280,900", "about:blank"], { stdio: "ignore" });
const targets = async () => { for (let i = 0; i < 50; i++) { try { return await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(200); } } return []; };
const evaluate = (ws, expression) => new Promise((res) => {
  const w = new WebSocket(ws); const t = setTimeout(() => res(null), 10000);
  w.onopen = () => w.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  w.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) { clearTimeout(t); w.close(); res(m.result?.result?.value); } };
  w.onerror = () => res(null);
});

let failed = 0;
const check = (name, ok, info = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + String(info).slice(0, 300)}`); if (!ok) failed++; };
let mcp;
try {
  let sw; for (let i = 0; i < 60 && !sw; i++) { sw = (await targets()).find((t) => t.type === "service_worker" && t.url.includes("kpnajnknfhjhflpbppnfmikpjobaennd")); if (!sw) await sleep(300); }
  if (!sw) throw new Error("extension service worker not found");
  const SW = sw.webSocketDebuggerUrl;
  let dev; for (let i = 0; i < 50 && !dev; i++) { dev = await evaluate(SW, `chrome.storage.local.get("tca_device_id").then((v)=>v.tca_device_id||null)`); if (!dev) await sleep(200); }
  if (!dev) throw new Error("extension did not connect (is the native host installed?)");
  await sleep(1500);

  mcp = spawn(process.execPath, [path.join(root, "mcp/server.js")], { env: { ...process.env, TCA_BROWSER: dev } });
  let buf = ""; const wait = new Map(); let nid = 1;
  mcp.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); wait.get(m.id)?.(m); } });
  const call = (name, args = {}, ms = 30000) => new Promise((r) => {
    const id = nid++; const t = setTimeout(() => r({ timeout: true, text: "" }), ms);
    wait.set(id, (m) => { clearTimeout(t); r({ text: (m.result?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n"), isError: !!m.result?.isError }); });
    mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) + "\n");
  });
  let ctx; for (let i = 0; i < 30; i++) { ctx = await call("tabs_context_mcp", { createIfEmpty: true }); if (ctx.text.startsWith("{")) break; await sleep(500); }
  const tabId = JSON.parse(ctx.text).selectedTabId;
  const popupOpen = async () => (await targets()).some((t) => t.url.includes("/permission/permission.html"));
  const setPerms = (v) => evaluate(SW, `chrome.storage.local.set({tca_perms:${JSON.stringify(v)}}).then(()=>"ok")`);

  check("1. nothing stored: stored value is empty", (await evaluate(SW, `chrome.storage.local.get("tca_perms").then((v)=>v.tca_perms??null)`)) === null);
  let r = await call("navigate", { tabId, url: `${BASE}/one` }, 10000);
  check("1. nothing stored: navigate runs without a prompt", !r.timeout && !r.isError && !(await popupOpen()), r.text);

  await setPerms({ blocked: [], mode: "ask", sites: { "www.wikipedia.org": { "*": "allow" } } });
  r = await call("navigate", { tabId, url: `${BASE}/two` }, 10000);
  check("2. legacy {mode:ask} without modeSet: no prompt", !r.timeout && !r.isError && !(await popupOpen()), r.text);
  const kept = await evaluate(SW, `chrome.storage.local.get("tca_perms").then((v)=>JSON.stringify(v.tca_perms))`);
  check("2. legacy record: site grant kept", /wikipedia/.test(kept || ""), kept);

  await setPerms({ blocked: [], mode: "ask", modeSet: true, sites: {} });
  const pending = call("navigate", { tabId, url: `${BASE}/three` }, 15000);
  let seen = false; for (let i = 0; i < 30 && !seen; i++) { seen = await popupOpen(); if (!seen) await sleep(200); }
  check("3. mode picked as ask: the permission popup opens", seen);
  const popup = (await targets()).find((t) => t.url.includes("/permission/permission.html"));
  if (popup) { for (let i = 0; i < 25 && !(await evaluate(popup.webSocketDebuggerUrl, "!!window.__tcaReady")); i++) await sleep(200); await evaluate(popup.webSocketDebuggerUrl, `document.getElementById("deny").click(), "ok"`); }
  r = await pending;
  check("3. denying in the popup refuses the call", r.isError && /denied/i.test(r.text), r.text);
} catch (e) {
  check("setup", false, e.message);
} finally {
  mcp?.kill();
  try { const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); const w = new WebSocket(webSocketDebuggerUrl); w.onopen = () => w.send(JSON.stringify({ id: 1, method: "Browser.close" })); } catch {}
  await sleep(2500); server.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
