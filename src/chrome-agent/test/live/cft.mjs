// Run the live suite (run.mjs) in a throwaway Chrome for Testing profile with the unpacked
// extension, so your own browser is never touched. The MCP server is pinned to that browser
// through TCA_BROWSER, so other connected browsers are ignored.
// usage: node test/live/cft.mjs <chrome.exe> [filter-regex]
// (Branded Chrome ignores --load-extension; get Chrome for Testing with
//  `npx @puppeteer/browsers install chrome@stable`.)
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const [chromePath, filter] = process.argv.slice(2);
if (!chromePath) { console.error("usage: node test/live/cft.mjs <chrome.exe> [filter-regex]"); process.exit(2); }
const HERE = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(HERE, "../..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "tca-live-"));
const port = 9600 + Math.floor(Math.random() * 100);
spawn(chromePath, [`--user-data-dir=${profile}`, `--load-extension=${path.join(root, "extension")}`, `--remote-debugging-port=${port}`,
  "--no-first-run", "--no-default-browser-check", "--disable-features=DisableLoadExtensionCommandLineSwitch", "--window-size=1280,900",
  // TCA_CFT_HIDDEN=1 puts the window off-screen, like a Chrome window covered by other apps.
  ...(process.env.TCA_CFT_HIDDEN ? ["--window-position=-4000,-4000"] : []), "about:blank"], { stdio: "ignore" });

const targets = async () => { for (let i = 0; i < 50; i++) { try { return await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(200); } } return []; };
const evaluate = (ws, expression) => new Promise((res) => {
  const w = new WebSocket(ws); const t = setTimeout(() => res(null), 10000);
  w.onopen = () => w.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  w.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) { clearTimeout(t); w.close(); res(m.result?.result?.value); } };
  w.onerror = () => res(null);
});

let code = 1;
try {
  let sw; for (let i = 0; i < 60 && !sw; i++) { sw = (await targets()).find((t) => t.type === "service_worker" && t.url.includes("kpnajnknfhjhflpbppnfmikpjobaennd")); if (!sw) await sleep(300); }
  if (!sw) throw new Error("extension service worker not found");
  let dev; for (let i = 0; i < 50 && !dev; i++) { dev = await evaluate(sw.webSocketDebuggerUrl, `chrome.storage.local.get("tca_device_id").then((v)=>v.tca_device_id||null)`); if (!dev) await sleep(200); }
  if (!dev) throw new Error("extension did not report a device id (is the native host installed?)");
  await sleep(1500); // let the native host publish its registry file
  const child = spawn(process.execPath, [path.join(HERE, "run.mjs"), ...(filter ? [filter] : [])], { stdio: "inherit", env: { ...process.env, TCA_BROWSER: dev } });
  code = await new Promise((r) => child.on("exit", r));
} catch (e) {
  console.error(e.message);
} finally {
  try { const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); const w = new WebSocket(webSocketDebuggerUrl); w.onopen = () => w.send(JSON.stringify({ id: 1, method: "Browser.close" })); } catch {}
  await sleep(2500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
process.exit(code ?? 1);
