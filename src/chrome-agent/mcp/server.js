#!/usr/bin/env node
// tabcrew-chrome MCP server (stdio, zero dependencies).
// MCP client  <-- stdio JSON-RPC -->  this  <-- pipe NDJSON -->  native host  <-->  extension
//
// Every running browser profile with the extension has its own native host, pipe and
// registry file. This server lists them (list_connected_browsers), lets the client pick
// one (select_browser) and sends tool calls to the selected browser.
import net from "node:net";
import os from "node:os";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { PIPE_OVERRIDE, REGISTRY_DIR } from "../host/pipe-path.js";
import { TOOLS, SERVER_TOOLS } from "../shared/tools.js";

const SERVER_INFO = { name: "tabcrew-chrome", version: "0.2.5" };

// Who is calling: one id per MCP server process (one per agent session), and a name for the popup,
// e.g. "Claude Code · my-repo". TCA_AGENT_ID / TCA_AGENT_NAME override them.
const PRETTY = { "claude-code": "Claude Code", "codex-mcp-client": "Codex", "gemini-cli-mcp-client": "Gemini CLI", cursor: "Cursor", "Visual Studio Code": "VS Code" };
const agent = { id: /^[\w-]{1,32}$/.test(process.env.TCA_AGENT_ID || "") ? process.env.TCA_AGENT_ID : crypto.randomBytes(4).toString("hex"), name: process.env.TCA_AGENT_NAME || `MCP client · ${path.basename(process.cwd())}` };
function nameAgent(clientInfo) {
  if (process.env.TCA_AGENT_NAME) return;
  const c = clientInfo?.name ? PRETTY[clientInfo.name] || clientInfo.name : "MCP client";
  agent.name = `${c} · ${path.basename(process.cwd())}`.slice(0, 80);
}
const DEFAULT_TIMEOUT_MS = Number(process.env.TCA_TOOL_TIMEOUT_MS || 120000);
const log = (...a) => process.stderr.write(`[tca-mcp] ${a.join(" ")}\n`);

// ---------- browser registry ----------
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

/** Connected browsers, newest first. Removes entries of hosts that are gone. */
export async function listBrowsers() {
  if (PIPE_OVERRIDE) return [{ browserId: "default", name: "default", browser: null, pipe: PIPE_OVERRIDE, pid: null }];
  let files = [];
  try { files = (await fs.readdir(REGISTRY_DIR)).filter((f) => f.endsWith(".json")); } catch { return []; }
  const out = [];
  for (const f of files) {
    const p = path.join(REGISTRY_DIR, f);
    let e;
    try { e = JSON.parse(await fs.readFile(p, "utf8")); } catch { continue; }
    if (!e?.pid || !alive(e.pid)) { await fs.unlink(p).catch(() => {}); continue; }
    if (!e.extension?.deviceId) continue; // host started but the extension has not said hello yet
    out.push({
      browserId: e.extension.deviceId,
      name: e.extension.name || e.extension.browser || "browser",
      browser: e.extension.browser || null,
      version: e.extension.version || null,
      pipe: e.pipe,
      pid: e.pid,
      connectedAt: e.extension.at || e.startedAt,
    });
  }
  out.sort((a, b) => b.connectedAt - a.connectedAt);
  // The same profile may briefly have two hosts (service worker restart); keep the newest.
  const seen = new Set();
  return out.filter((b) => !seen.has(b.browserId) && seen.add(b.browserId));
}

let selectedId = process.env.TCA_BROWSER || null; // browserId or name

function matchBrowser(list, key) {
  if (!key) return null;
  const k = String(key).toLowerCase();
  return list.find((b) => b.browserId === key) || list.find((b) => b.name.toLowerCase() === k) || null;
}

const describe = (b) => `- ${b.name}${b.browser && b.browser !== b.name ? ` (${b.browser})` : ""} — browserId: ${b.browserId}`;

/** The browser tool calls go to, or an error message. */
async function currentBrowser() {
  const list = await listBrowsers();
  if (!list.length) {
    return { error: "No browser is connected. Open Chrome with the tabcrew-chrome extension installed (click its toolbar icon once to check the green dot), and make sure the install script was run." };
  }
  if (selectedId) {
    const b = matchBrowser(list, selectedId);
    if (b) return { browser: b };
    return { error: `The selected browser (${selectedId}) is not connected any more. Connected browsers:\n${list.map(describe).join("\n")}\nCall select_browser to pick one.` };
  }
  if (list.length === 1) return { browser: list[0] };
  return { error: `${list.length} browsers are connected. Call select_browser with one of these browserIds first:\n${list.map(describe).join("\n")}` };
}

// ---------- pipe client (one connection per browser pipe) ----------
const conns = new Map(); // pipe -> {sock, waiters}

function connect(pipe) {
  const have = conns.get(pipe);
  if (have?.ready) return have.ready;
  const c = { waiters: new Map(), sock: null };
  c.ready = new Promise((resolve, reject) => {
    const s = net.createConnection(pipe);
    let buf = "";
    s.setEncoding("utf8");
    s.once("connect", () => { c.sock = s; resolve(c); });
    s.once("error", (e) => { conns.delete(pipe); reject(e); });
    s.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        const w = msg.id && c.waiters.get(msg.id);
        if (w) { c.waiters.delete(msg.id); clearTimeout(w.timer); w.resolve(msg); }
      }
    });
    s.on("close", () => {
      conns.delete(pipe);
      for (const [id, w] of c.waiters) { clearTimeout(w.timer); w.resolve({ id, error: "connection to browser closed" }); }
      c.waiters.clear();
    });
  });
  conns.set(pipe, c);
  return c.ready;
}

async function request(obj, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const cur = await currentBrowser();
  if (cur.error) return { error: cur.error };
  let c;
  try { c = await connect(cur.browser.pipe); }
  catch { return { error: `Could not reach browser "${cur.browser.name}". It may have just closed; call list_connected_browsers.` }; }
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => { c.waiters.delete(id); resolve({ id, error: `tool timed out after ${timeoutMs} ms` }); }, timeoutMs);
    c.waiters.set(id, { resolve, timer });
    c.sock.write(JSON.stringify({ ...obj, id }) + "\n");
  });
}

// ---------- server-side tools ----------
async function serverTool(name, args) {
  if (name === "list_connected_browsers") {
    const list = await listBrowsers();
    if (!list.length) return text("No browsers are connected. Open Chrome with the tabcrew-chrome extension installed.");
    const cur = selectedId ? matchBrowser(list, selectedId) : list.length === 1 ? list[0] : null;
    return text(JSON.stringify({
      browsers: list.map((b) => ({ browserId: b.browserId, name: b.name, browser: b.browser, extensionVersion: b.version, selected: cur?.browserId === b.browserId })),
      note: cur ? undefined : "Several browsers are connected; call select_browser before using other tools.",
    }, null, 2));
  }
  if (name === "select_browser") {
    const list = await listBrowsers();
    const b = matchBrowser(list, args.browserId);
    if (!b) return { content: [{ type: "text", text: `No connected browser matches "${args.browserId}". Connected:\n${list.map(describe).join("\n") || "(none)"}` }], isError: true };
    selectedId = b.browserId;
    return text(`Selected browser "${b.name}" (browserId ${b.browserId}). Tool calls now go to this browser. Call tabs_context_mcp to see its tabs.`);
  }
  return null;
}

const text = (t) => ({ content: [{ type: "text", text: t }] });

// ---------- argument preparation ----------
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", pdf: "application/pdf", txt: "text/plain", csv: "text/csv", json: "application/json", zip: "application/zip" };

async function readFiles(paths) {
  if (!Array.isArray(paths) || !paths.length) throw new Error("paths must be a non-empty array of absolute file paths");
  let total = 0;
  const files = [];
  for (const p of paths) {
    if (!path.isAbsolute(p)) throw new Error(`Not an absolute path: ${p}`);
    const buf = await fs.readFile(p);
    total += buf.length;
    if (total > 10 * 1024 * 1024) throw new Error("total upload size is limited to 10 MB");
    const ext = path.extname(p).slice(1).toLowerCase();
    files.push({ name: path.basename(p), mimeType: MIME[ext] || "application/octet-stream", data: buf.toString("base64") });
  }
  return files;
}

async function prepareArgs(name, args) {
  if (name === "file_upload" && args.paths) {
    const { paths, ...rest } = args;
    return { ...rest, files: await readFiles(paths) };
  }
  if (name === "gif_creator" || name === "chat_save_image") {
    // The output path is handled here; the extension never sees local paths.
    const { path: _p, ...rest } = args;
    return rest;
  }
  if (name === "chat_send" && args.path) {
    // Read the message from a local file, so long or relayed text arrives exactly.
    const { path: p, ...rest } = args;
    if (!path.isAbsolute(p)) throw new Error(`path must be absolute: ${p}`);
    return { ...rest, text: (await fs.readFile(p, "utf8")).replace(/\r?\n$/, "") };
  }
  if (name === "chat_read") {
    const { path: p, ...rest } = args;
    return { ...rest, save: !!p };
  }
  if (name === "browser_batch" && Array.isArray(args.actions)) {
    const actions = [];
    for (const a of args.actions) actions.push(a && a.name ? { ...a, input: await prepareArgs(a.name, a.input || {}) } : a);
    return { ...args, actions };
  }
  return args;
}

/** Where files a call may return go (gif_creator export, chat_read path, chat_save_image), in call order. */
const FILE_TOOLS = new Set(["gif_creator", "chat_read", "chat_save_image"]);
function outputPaths(name, args) {
  if (FILE_TOOLS.has(name)) return [{ path: args.path || null, image: name === "chat_save_image" }];
  if (name === "browser_batch" && Array.isArray(args.actions)) return args.actions.filter((a) => FILE_TOOLS.has(a?.name)).map((a) => ({ path: a.input?.path || null, image: a.name === "chat_save_image" }));
  return [];
}

function defaultDir() {
  const dl = path.join(os.homedir(), "Downloads");
  return fsSync.existsSync(dl) ? dl : os.tmpdir();
}

async function saveFile(file, out = {}) {
  let target = out.path;
  if (target) {
    if (!path.isAbsolute(target)) throw new Error(`path must be absolute: ${target}`);
    const st = await fs.stat(target).catch(() => null);
    // chat_save_image takes a folder (created when missing) unless the path names an image file.
    if (st?.isDirectory() || (out.image && !/\.(png|jpe?g|webp)$/i.test(target))) target = path.join(target, file.name);
  } else {
    target = path.join(defaultDir(), file.name);
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (out.image) {
    // Never overwrite a saved image: name.png, name-2.png, name-3.png, …
    const ext = path.extname(target), stem = target.slice(0, target.length - ext.length);
    for (let n = 2; fsSync.existsSync(target); n++) target = `${stem}-${n}${ext}`;
  }
  const buf = Buffer.from(file.data, "base64");
  await fs.writeFile(target, buf);
  return { target, size: buf.length };
}

// ---------- result mapping ----------
async function toMcpContent(resp, paths = []) {
  if (resp.error) {
    const msg = typeof resp.error === "string" ? resp.error : resp.error.message || JSON.stringify(resp.error);
    return { content: [{ type: "text", text: msg }], isError: true };
  }
  const r = resp.result;
  if (r == null) return { content: [{ type: "text", text: "ok" }] };
  if (typeof r === "string") return { content: [{ type: "text", text: r }] };
  const content = [];
  let fileIdx = 0;
  if (Array.isArray(r.content)) {
    for (const c of r.content) {
      if (c.type === "image") content.push({ type: "image", data: c.data, mimeType: c.mimeType || "image/png" });
      else if (c.type === "file") {
        try {
          const { target, size } = await saveFile(c, paths[fileIdx++] || {});
          content.push({ type: "text", text: `Saved ${path.basename(target)} (${(size / 1024).toFixed(1)} KB) to ${target}` });
        } catch (e) {
          content.push({ type: "text", text: `Could not save ${c.name}: ${e.message}` });
        }
      } else content.push({ type: "text", text: String(c.text ?? "") });
    }
  } else {
    content.push({ type: "text", text: JSON.stringify(r, null, 2) });
  }
  return { content, isError: !!r.isError };
}

// ---------- JSON-RPC over stdio ----------
function send(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }
function reply(id, result) { send({ jsonrpc: "2.0", id, result }); }
function fail(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }

const ALL_TOOLS = [...TOOLS, ...SERVER_TOOLS];

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  try {
    switch (method) {
      case "initialize":
        nameAgent(params?.clientInfo);
        return reply(id, {
          protocolVersion: params?.protocolVersion || "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: "Tools that control the user's real Chrome browser through the tabcrew-chrome extension. Start with tabs_context_mcp to get tab ids. If several browsers are connected, call list_connected_browsers and select_browser first.",
        });
      case "notifications/initialized":
      case "notifications/cancelled":
        return;
      case "ping":
        return reply(id, {});
      case "tools/list":
        return reply(id, { tools: ALL_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case "tools/call": {
        const name = params?.name;
        let args = params?.arguments || {};
        if (SERVER_TOOLS.some((t) => t.name === name)) return reply(id, await serverTool(name, args));
        if (!TOOLS.some((t) => t.name === name)) return reply(id, { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true });
        const paths = outputPaths(name, args);
        try { args = await prepareArgs(name, args); }
        catch (e) { return reply(id, { content: [{ type: "text", text: e.message }], isError: true }); }
        const resp = await request({ type: "tool_request", tool: name, args, agent });
        return reply(id, await toMcpContent(resp, paths));
      }
      default:
        if (isRequest) fail(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    if (isRequest) fail(id, -32603, e.message);
  }
}

let inBuf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  inBuf += d;
  let i;
  while ((i = inBuf.indexOf("\n")) >= 0) {
    const line = inBuf.slice(0, i).trim();
    inBuf = inBuf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { fail(null, -32700, "Parse error"); continue; }
    if (Array.isArray(msg)) msg.forEach(handle); else handle(msg);
  }
});
process.stdin.on("end", () => process.exit(0));
