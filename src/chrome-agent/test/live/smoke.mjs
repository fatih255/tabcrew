// Quick, read-only connection check against the browser you have connected: lists the tools
// and the connected browsers and reads the agent tab group. Opens no tabs, changes nothing.
//   node test/live/smoke.mjs
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const server = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../mcp/server.js");
const mcp = spawn(process.execPath, [server], { stdio: ["pipe", "pipe", "inherit"] });
let buf = ""; const wait = new Map(); let nid = 1;
mcp.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); wait.get(m.id)?.(m); } });
const rpc = (method, params) => new Promise((r) => { const id = nid++; wait.set(id, r); mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
const text = (m) => (m.error ? "ERROR " + m.error.message : (m.result?.content || []).map((c) => c.text).join("\n"));

await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
const tools = await rpc("tools/list", {});
console.log("tools:", tools.result.tools.length);
const browsers = await rpc("tools/call", { name: "list_connected_browsers", arguments: {} });
console.log("--- list_connected_browsers\n" + text(browsers));
console.log("--- tabs_context_mcp\n" + text(await rpc("tools/call", { name: "tabs_context_mcp", arguments: {} })));
let ok = false;
try { ok = JSON.parse(text(browsers)).browsers.length > 0; } catch {}
mcp.kill();
process.exit(ok ? 0 : 1);
