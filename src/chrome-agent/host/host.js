#!/usr/bin/env node
// tabcrew-chrome native messaging host.
//
// Chrome starts this process when the extension calls
// chrome.runtime.connectNative("com.tabcrew.chrome").
//
//   extension  <-- stdio, 4-byte LE length + JSON -->  host  <-- pipe, NDJSON -->  MCP server(s)
//
// The host is a dumb relay. It keeps a map of request id -> socket so that
// several MCP clients can share one browser. Each host has its own pipe and a
// registry file, so several browsers (or profiles) can be connected at once and
// MCP clients choose between them (list_connected_browsers / select_browser).
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PIPE_OVERRIDE, REGISTRY_DIR, hostPipePath } from "./pipe-path.js";

const MAX_TO_CHROME = 1024 * 1024; // Chrome refuses host->extension messages over 1 MB

const log = (...a) => process.stderr.write(`[tca-host] ${a.join(" ")}\n`);

// ---------- stdio framing (Chrome side) ----------
let inBuf = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  inBuf = Buffer.concat([inBuf, chunk]);
  while (inBuf.length >= 4) {
    const len = inBuf.readUInt32LE(0);
    if (inBuf.length < 4 + len) break;
    const body = inBuf.subarray(4, 4 + len).toString("utf8");
    inBuf = inBuf.subarray(4 + len);
    let msg;
    try { msg = JSON.parse(body); } catch (e) { log("bad json from extension", e.message); continue; }
    onExtensionMessage(msg);
  }
});
process.stdin.on("end", () => { log("chrome closed stdin, exiting"); shutdown(0); });

function sendToExtension(msg) {
  const body = Buffer.from(JSON.stringify(msg), "utf8");
  if (body.length > MAX_TO_CHROME - 1024) {
    // Split into chunks the extension reassembles (Chrome caps host->extension messages at 1 MB).
    const str = JSON.stringify(msg);
    const size = 256 * 1024; // characters; JSON-escaped size stays well under 1 MB
    const total = Math.ceil(str.length / size);
    if (total > 64) { log("message to extension too large, dropped", body.length); return false; }
    for (let seq = 0; seq < total; seq++) sendToExtension({ type: "chunk", id: msg.id, seq, total, data: str.slice(seq * size, (seq + 1) * size) });
    return true;
  }
  const hdr = Buffer.alloc(4);
  hdr.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([hdr, body]));
  return true;
}

// ---------- pipe server (MCP side) ----------
const pending = new Map(); // id -> socket
const clients = new Set();
let extensionInfo = null;

function onExtensionMessage(msg) {
  switch (msg.type) {
    case "hello":
      extensionInfo = {
        extId: msg.extId, version: msg.version, at: Date.now(),
        deviceId: typeof msg.deviceId === "string" ? msg.deviceId.slice(0, 64) : null,
        name: typeof msg.name === "string" ? msg.name.slice(0, 80) : null,
        browser: typeof msg.browser === "string" ? msg.browser.slice(0, 80) : null,
      };
      writeRegistry();
      log("extension connected", msg.extId, msg.version, extensionInfo.name || "");
      sendToExtension({ type: "hello_ack", host: "com.tabcrew.chrome", pid: process.pid });
      broadcast({ type: "status", extension: extensionInfo });
      break;
    case "ping":
      sendToExtension({ type: "pong", t: msg.t });
      break;
    case "tool_response": {
      const sock = pending.get(msg.id);
      pending.delete(msg.id);
      if (sock && !sock.destroyed) writeLine(sock, msg);
      break;
    }
    case "log":
      log("ext:", msg.text);
      break;
    default:
      log("unknown message from extension", msg.type);
  }
}

function writeLine(sock, obj) { sock.write(JSON.stringify(obj) + "\n"); }
function broadcast(obj) { for (const s of clients) writeLine(s, obj); }

function onClientMessage(sock, msg) {
  if (msg.type === "status") {
    writeLine(sock, { type: "status", id: msg.id, extension: extensionInfo });
    return;
  }
  if (msg.type === "tool_request") {
    if (!msg.id) return writeLine(sock, { type: "tool_response", id: null, error: "missing id" });
    pending.set(msg.id, sock);
    const ok = sendToExtension({ type: "tool_request", id: msg.id, tool: msg.tool, args: msg.args || {}, agent: msg.agent });
    if (!ok) {
      pending.delete(msg.id);
      writeLine(sock, { type: "tool_response", id: msg.id, error: "request too large for native messaging" });
    }
    return;
  }
  writeLine(sock, { type: "error", id: msg.id, error: `unknown type ${msg.type}` });
}

// ---------- pipe + registry ----------
const HOST_ID = crypto.randomBytes(5).toString("hex");
const PIPE = PIPE_OVERRIDE || hostPipePath(HOST_ID);
const REG_FILE = PIPE_OVERRIDE ? null : path.join(REGISTRY_DIR, `${HOST_ID}.json`);

const STARTED = Date.now();
let listening = false;

function writeRegistry() {
  if (!REG_FILE || !listening) return;
  try {
    fs.mkdirSync(REGISTRY_DIR, { recursive: true, mode: 0o700 });
    const entry = { hostId: HOST_ID, pid: process.pid, pipe: PIPE, startedAt: STARTED, extension: extensionInfo };
    fs.writeFileSync(REG_FILE + ".tmp", JSON.stringify(entry));
    fs.renameSync(REG_FILE + ".tmp", REG_FILE);
  } catch (e) { log("could not write registry", e.message); }
}

if (process.platform !== "win32") {
  try { fs.mkdirSync(path.dirname(PIPE), { recursive: true, mode: 0o700 }); } catch {}
  try { fs.unlinkSync(PIPE); } catch {}
}

const server = net.createServer((sock) => {
  clients.add(sock);
  sock.setEncoding("utf8");
  let buf = "";
  sock.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try { onClientMessage(sock, JSON.parse(line)); } catch (e) { log("bad line from client", e.message); }
    }
  });
  const drop = () => {
    clients.delete(sock);
    for (const [id, s] of pending) if (s === sock) pending.delete(id);
  };
  sock.on("close", drop);
  sock.on("error", drop);
  writeLine(sock, { type: "status", extension: extensionInfo });
});

server.on("error", (e) => {
  // Only possible in single-pipe mode (TCA_PIPE): another host owns the fixed pipe.
  // Keep trying so this browser takes over when the other one exits.
  log("pipe server error:", e.code || e.message, "- retrying in 3 s");
  setTimeout(() => server.listen(PIPE), 3000);
});
server.on("listening", () => { listening = true; log("listening on", PIPE); writeRegistry(); });
server.listen(PIPE);

function shutdown(code) {
  try { server.close(); } catch {}
  if (REG_FILE) { try { fs.unlinkSync(REG_FILE); } catch {} }
  if (process.platform !== "win32") { try { fs.unlinkSync(PIPE); } catch {} }
  process.exit(code);
}
process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
process.on("exit", () => { if (REG_FILE) { try { fs.unlinkSync(REG_FILE); } catch {} } });
