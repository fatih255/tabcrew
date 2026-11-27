// Several browsers: two fake extensions, each with its own native host, one MCP server choosing between them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const regDir = fs.mkdtempSync(path.join(os.tmpdir(), "tca-reg-"));
const env = { ...process.env, TCA_REGISTRY_DIR: regDir };
delete env.TCA_PIPE;
delete env.TCA_BROWSER;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function frame(obj) { const b = Buffer.from(JSON.stringify(obj)); const h = Buffer.alloc(4); h.writeUInt32LE(b.length); return Buffer.concat([h, b]); }

function fakeBrowser(deviceId, name) {
  const host = spawn(process.execPath, [path.join(root, "host/host.js")], { env });
  host.stderr.on("data", () => {});
  let hb = Buffer.alloc(0);
  host.stdout.on("data", (d) => {
    hb = Buffer.concat([hb, d]);
    while (hb.length >= 4) {
      const n = hb.readUInt32LE(0); if (hb.length < 4 + n) break;
      const m = JSON.parse(hb.subarray(4, 4 + n)); hb = hb.subarray(4 + n);
      if (m.type === "tool_request") host.stdin.write(frame({ type: "tool_response", id: m.id, result: { content: [{ type: "text", text: `${name} ran ${m.tool}` }] } }));
    }
  });
  host.stdin.write(frame({ type: "hello", extId: "test", version: "0", deviceId, name, browser: "Fake Chrome" }));
  return host;
}

test("MCP server lists, selects and routes between two browsers", async () => {
  const a = fakeBrowser("dev-aaaa", "Work");
  const b = fakeBrowser("dev-bbbb", "Personal");
  const mcp = spawn(process.execPath, [path.join(root, "mcp/server.js")], { env });
  mcp.stderr.on("data", () => {});
  try {
    const lines = [];
    let mb = "";
    mcp.stdout.on("data", (d) => { mb += d; let i; while ((i = mb.indexOf("\n")) >= 0) { lines.push(JSON.parse(mb.slice(0, i))); mb = mb.slice(i + 1); } });
    let next = 1;
    const call = async (name, args = {}) => {
      const id = next++;
      mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) + "\n");
      for (let k = 0; k < 200; k++) { const m = lines.find((l) => l.id === id); if (m) return { text: m.result.content.map((c) => c.text).join("\n"), isError: !!m.result.isError }; await sleep(25); }
      throw new Error("timeout");
    };
    // wait until both hosts have registered
    let list;
    for (let k = 0; k < 80; k++) { list = await call("list_connected_browsers"); if (/dev-aaaa/.test(list.text) && /dev-bbbb/.test(list.text)) break; await sleep(100); }
    const parsed = JSON.parse(list.text);
    assert.equal(parsed.browsers.length, 2);
    assert.ok(parsed.note);

    let r = await call("tabs_context_mcp");
    assert.ok(r.isError && /2 browsers are connected/.test(r.text), r.text);

    r = await call("select_browser", { browserId: "personal" }); // by name, case-insensitive
    assert.ok(!r.isError && /Personal/.test(r.text), r.text);
    r = await call("tabs_context_mcp");
    assert.equal(r.text, "Personal ran tabs_context_mcp");

    r = await call("select_browser", { browserId: "dev-aaaa" });
    r = await call("navigate", { tabId: 1, url: "x" });
    assert.equal(r.text, "Work ran navigate");

    r = await call("select_browser", { browserId: "nope" });
    assert.ok(r.isError);

    // closing the selected browser: its registry entry disappears and calls explain it
    a.kill();
    for (let k = 0; k < 40; k++) { const l = await call("list_connected_browsers"); if (!/dev-aaaa/.test(l.text)) break; await sleep(100); }
    r = await call("navigate", { tabId: 1, url: "x" });
    assert.ok(r.isError && /not connected any more/.test(r.text), r.text);
  } finally {
    [a, b, mcp].forEach((p) => p.kill());
    await sleep(200);
    fs.rmSync(regDir, { recursive: true, force: true });
  }
});
