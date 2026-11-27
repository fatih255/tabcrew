// End-to-end relay test: fake extension <-stdio-> host <-pipe-> MCP server <-stdio-> fake MCP client.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pipe = process.platform === "win32" ? String.raw`\\.\pipe\tca-test-` + process.pid : `/tmp/tca-test-${process.pid}.sock`;
const env = { ...process.env, TCA_PIPE: pipe };

function frame(obj) { const b = Buffer.from(JSON.stringify(obj)); const h = Buffer.alloc(4); h.writeUInt32LE(b.length); return Buffer.concat([h, b]); }

test("tool call travels MCP -> host -> extension and back", async () => {
  const procs = [];
  const host = spawn(process.execPath, [path.join(root, "host/host.js")], { env });
  procs.push(host); host.stderr.on("data", (d) => process.stderr.write("H:" + d));
  // fake extension: answer every tool_request
  let hb = Buffer.alloc(0);
  host.stdout.on("data", (d) => {
    hb = Buffer.concat([hb, d]);
    while (hb.length >= 4) {
      const n = hb.readUInt32LE(0); if (hb.length < 4 + n) break;
      const m = JSON.parse(hb.subarray(4, 4 + n)); hb = hb.subarray(4 + n);
      if (m.type === "tool_request") host.stdin.write(frame({ type: "tool_response", id: m.id, result: { content: [{ type: "text", text: `echo:${m.tool}:${JSON.stringify(m.args)}` }] } }));
    }
  });
  host.stdin.write(frame({ type: "hello", extId: "test", version: "0" }));
  await new Promise((r) => setTimeout(r, 400));

  const mcp = spawn(process.execPath, [path.join(root, "mcp/server.js")], { env });
  procs.push(mcp); mcp.stderr.on("data", (d) => process.stderr.write("M:" + d));
  try {
  const lines = [];
  let mb = "";
  mcp.stdout.on("data", (d) => { mb += d; let i; while ((i = mb.indexOf("\n")) >= 0) { lines.push(JSON.parse(mb.slice(0, i))); mb = mb.slice(i + 1); } });
  const rpc = (o) => mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...o }) + "\n");
  const waitFor = async (id) => { for (let k = 0; k < 100; k++) { const m = lines.find((l) => l.id === id); if (m) return m; await new Promise((r) => setTimeout(r, 50)); } throw new Error("timeout " + id); };

  rpc({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
  assert.equal((await waitFor(1)).result.serverInfo.name, "tabcrew-chrome");
  rpc({ id: 2, method: "tools/list" });
  assert.ok((await waitFor(2)).result.tools.length >= 1);
  rpc({ id: 3, method: "tools/call", params: { name: "tabs_context_mcp", arguments: { createIfEmpty: true } } });
  const r3 = await waitFor(3);
  assert.equal(r3.result.content[0].text, 'echo:tabs_context_mcp:{"createIfEmpty":true}');

  } finally { procs.forEach((p) => p.kill()); }
});

