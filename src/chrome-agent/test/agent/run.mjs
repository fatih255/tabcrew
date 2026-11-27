// Real-agent trial: a headless AI agent gets only this MCP server and a plain-language task,
// drives a throwaway Chrome for Testing profile, and the result is then checked independently
// over DevTools (form result, the click inside a cross-site iframe, the exported GIF).
//
//   node test/agent/run.mjs <chrome.exe>
//
// Uses Claude Code in print mode (`claude -p`, override the binary with CLAUDE_EXE). Any other
// MCP-capable CLI can be plugged in by changing runAgent() below. Costs model tokens.
import http from "node:http"; import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const [chromePath] = process.argv.slice(2);
if (!chromePath) { console.error("usage: node test/agent/run.mjs <chrome.exe>"); process.exit(2); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pages = path.join(root, "test/e2e/pages");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/api/")) { res.writeHead(200); return res.end("ok"); }
  const f = path.join(pages, u.pathname === "/" ? "index.html" : path.basename(u.pathname));
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(fs.readFileSync(f, "utf8").replaceAll("{{XO_BASE}}", `http://localhost:${server.address().port}`));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "tca-agent-"));
const port = 9800 + Math.floor(Math.random() * 100);
spawn(chromePath, [`--user-data-dir=${profile}`, `--load-extension=${path.join(root, "extension")}`, `--remote-debugging-port=${port}`,
  "--no-first-run", "--no-default-browser-check", "--disable-features=DisableLoadExtensionCommandLineSwitch", "--window-size=1280,900", "about:blank"], { stdio: "ignore" });
const targets = async () => { for (let i = 0; i < 50; i++) { try { return await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(200); } } return []; };
const evaluate = (ws, expression) => new Promise((res) => {
  const w = new WebSocket(ws); const t = setTimeout(() => res(null), 10000);
  w.onopen = () => w.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  w.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) { clearTimeout(t); w.close(); res(m.result?.result?.value); } };
  w.onerror = () => res(null);
});

function runAgent(task, cfg, cwd) {
  const exe = process.env.CLAUDE_EXE || "claude";
  const args = ["-p", task, "--mcp-config", cfg, "--strict-mcp-config", "--allowedTools", "mcp__browser", "--output-format", "json", "--max-turns", "40"];
  return new Promise((resolve) => {
    const c = spawn(exe, args, { cwd }); // no shell: the task must stay one argument
    let so = "", se = "";
    c.stdout.on("data", (d) => (so += d)); c.stderr.on("data", (d) => (se += d));
    c.on("error", (e) => resolve({ error: e.message }));
    c.on("close", () => { try { resolve(JSON.parse(so)); } catch { resolve({ error: (so + se).slice(0, 2000) }); } });
  });
}

let failed = 0;
const check = (name, ok, info = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + String(info).slice(0, 300)}`); if (!ok) failed++; };
const work = fs.mkdtempSync(path.join(os.tmpdir(), "tca-agent-work-"));
try {
  let sw; for (let i = 0; i < 60 && !sw; i++) { sw = (await targets()).find((t) => t.type === "service_worker" && t.url.includes("kpnajnknfhjhflpbppnfmikpjobaennd")); if (!sw) await sleep(300); }
  if (!sw) throw new Error("extension service worker not found");
  let dev; for (let i = 0; i < 50 && !dev; i++) { dev = await evaluate(sw.webSocketDebuggerUrl, `chrome.storage.local.get("tca_device_id").then((v)=>v.tca_device_id||null)`); if (!dev) await sleep(200); }
  if (!dev) throw new Error("extension did not connect (is the native host installed?)");
  await sleep(1500);

  const gifPath = path.join(work, "trial.gif");
  const cfg = path.join(work, "mcp.json");
  fs.writeFileSync(cfg, JSON.stringify({ mcpServers: { browser: { command: process.execPath, args: [path.join(root, "mcp/server.js")], env: { TCA_BROWSER: dev } } } }));
  const task = [
    `Use only the browser tools. Start a GIF recording, then open ${BASE}/ in the agent's tab group (create it if needed).`,
    `Fill the form: full name "Grace Hopper", country Germany, tick "I agree", type "via agent" into Notes, then press "Send form".`,
    `Then open ${BASE}/frames.html and press the button labelled "Frame button" inside the cross-origin iframe.`,
    `Stop the recording and export the GIF to ${gifPath}.`,
    `Finally reply with one line: the text shown next to the Send form button on the first page.`,
  ].join(" ");
  const t0 = Date.now();
  const out = await runAgent(task, cfg, work);
  console.log(`agent: ${Math.round((Date.now() - t0) / 1000)} s, ${out.num_turns ?? "?"} turns`);
  console.log("agent reply:", out.result || out.error);

  check("agent finished without error", !out.error && !out.is_error, out.error || out.result);
  check("agent reports the submitted form", /sent:Grace Hopper\|de\|true\|nofile\|via agent/.test(out.result || ""), out.result);
  const xo = (await targets()).find((t) => t.type === "iframe" && t.url.includes("frame.html"));
  const xoText = xo ? await evaluate(xo.webSocketDebuggerUrl, `document.getElementById("xbtn").textContent`) : null;
  check("button inside the cross-site iframe was clicked (checked over DevTools)", xoText === "x clicked", xoText);
  const gif = fs.existsSync(gifPath) ? fs.readFileSync(gifPath) : null;
  check("GIF exported", gif && gif.subarray(0, 6).toString() === "GIF89a" && gif.length > 1000, gif ? gif.length : "missing");
} catch (e) {
  check("setup", false, e.message);
} finally {
  try { const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); const w = new WebSocket(webSocketDebuggerUrl); w.onopen = () => w.send(JSON.stringify({ id: 1, method: "Browser.close" })); } catch {}
  await sleep(3000); server.close();
  for (const d of [profile, work]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
}
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
