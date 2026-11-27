#!/usr/bin/env node
// tabcrew-chrome installer (Windows, macOS, Linux; current user, no admin).
//
//   node install/install.mjs              install or update
//   node install/install.mjs --uninstall  remove everything it installed
//   options: --no-claude (do not register the MCP server with Claude Code), --no-register (copy
//   files only, no browser registration; for tests), --dry-run
//
// It copies the extension, native host and MCP server to one fixed per-user folder, so the
// downloaded folder can be moved or deleted afterwards:
//   Windows  %LOCALAPPDATA%\tabcrew-chrome
//   macOS    ~/Library/Application Support/tabcrew-chrome
//   Linux    ${XDG_DATA_HOME:-~/.local/share}/tabcrew-chrome
// Then it registers the native host for Chrome, Chromium, Edge and Brave, and, when the
// `claude` CLI is installed, adds the MCP server to Claude Code for all projects (user scope).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOST_NAME = "com.tabcrew.chrome";
const MCP_NAME = "tabcrew-chrome";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry-run");
const WIN = process.platform === "win32";
const MAC = process.platform === "darwin";
const fwd = (p) => p.replace(/\\/g, "/");
const say = (s = "") => console.log(s);
const act = (what, fn) => { say(`${DRY ? "[dry-run] " : ""}${what}`); if (!DRY) return fn(); };

const DEST = WIN ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "tabcrew-chrome")
  : MAC ? path.join(os.homedir(), "Library", "Application Support", "tabcrew-chrome")
  : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "tabcrew-chrome");

const REG_KEYS = ["Google\\Chrome", "Chromium", "Microsoft\\Edge", "BraveSoftware\\Brave-Browser"]
  .map((b) => `HKCU\\Software\\${b}\\NativeMessagingHosts\\${HOST_NAME}`);
const UNIX_DIRS = MAC
  ? ["Google/Chrome", "Chromium", "Microsoft Edge", "BraveSoftware/Brave-Browser"].map((b) => path.join(os.homedir(), "Library", "Application Support", b, "NativeMessagingHosts"))
  : ["google-chrome", "chromium", "microsoft-edge", "BraveSoftware/Brave-Browser"].map((b) => path.join(os.homedir(), ".config", b, "NativeMessagingHosts"));

function run(cmd, argv, opts = {}) {
  // `claude` is a .cmd shim on some Windows installs, which needs a shell.
  const shell = WIN && opts.shell !== false;
  const line = shell ? [cmd, ...argv.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))].join(" ") : cmd;
  const r = spawnSync(line, shell ? [] : argv, { shell, encoding: "utf8" });
  return { ok: r.status === 0, out: `${r.stdout || ""}${r.stderr || ""}`.trim() };
}
const hasClaude = () => run(WIN ? "where" : "sh", WIN ? ["claude"] : ["-c", "command -v claude"], { shell: false }).ok;

function claudeRemove() {
  if (args.has("--no-claude") || !hasClaude()) return;
  act(`claude mcp remove -s user ${MCP_NAME}`, () => run("claude", ["mcp", "remove", "-s", "user", MCP_NAME]));
}

// ---------- uninstall ----------
if (args.has("--uninstall")) {
  if (WIN) for (const k of REG_KEYS) act(`remove ${k}`, () => run("reg", ["delete", k, "/f"], { shell: false }));
  else for (const d of UNIX_DIRS) act(`remove ${path.join(d, HOST_NAME + ".json")}`, () => fs.rmSync(path.join(d, HOST_NAME + ".json"), { force: true }));
  claudeRemove();
  if (path.resolve(DEST) !== ROOT) act(`delete ${DEST}`, () => fs.rmSync(DEST, { recursive: true, force: true }));
  say("\nDone. Also remove the extension in chrome://extensions, and the MCP server from any other client you added it to.");
  process.exit(0);
}

// ---------- install ----------
const major = Number(process.versions.node.split(".")[0]);
if (major < 18) { console.error(`Node.js 18+ is required (this is ${process.version}).`); process.exit(1); }

say(`Installing tabcrew-chrome to ${DEST}`);
const GENERATED = new Set(["host.bat", "host.sh", `${HOST_NAME}.json`]);
if (path.resolve(DEST) !== ROOT) {
  act("copy extension, host, MCP server", () => {
    for (const dir of ["extension", "host", "mcp", "shared"]) {
      // Overwrite in place: a running native host keeps its folder in use, so it cannot be deleted
      // while Chrome is open. Files that no longer exist in the source are removed one by one.
      const src = path.join(ROOT, dir), dst = path.join(DEST, dir);
      fs.cpSync(src, dst, { recursive: true, force: true, filter: (p) => !GENERATED.has(path.basename(p)) });
      const stale = (d) => {
        if (!fs.existsSync(d)) return;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const rel = path.relative(dst, path.join(d, e.name));
          if (GENERATED.has(e.name)) continue;
          if (!fs.existsSync(path.join(src, rel))) fs.rmSync(path.join(d, e.name), { recursive: true, force: true });
          else if (e.isDirectory()) stale(path.join(d, e.name));
        }
      };
      try { stale(dst); } catch {}
    }
    for (const f of ["package.json", "EXTENSION_ID.txt", "LICENSE", "install/install.mjs"]) {
      if (!fs.existsSync(path.join(ROOT, f))) continue;
      fs.mkdirSync(path.dirname(path.join(DEST, f)), { recursive: true });
      fs.copyFileSync(path.join(ROOT, f), path.join(DEST, f));
    }
  });
}

const extId = fs.readFileSync(path.join(ROOT, "EXTENSION_ID.txt"), "utf8").trim();
const hostJs = path.join(DEST, "host", "host.js");
const wrapper = path.join(DEST, "host", WIN ? "host.bat" : "host.sh");
const manifest = JSON.stringify({
  name: HOST_NAME, description: "tabcrew-chrome native host", path: wrapper, type: "stdio",
  allowed_origins: [`chrome-extension://${extId}/`],
}, null, 2);

act(`write native host ${wrapper}`, () => {
  // Chrome starts the host without your shell's PATH, so the wrapper names node by its full path.
  if (WIN) fs.writeFileSync(wrapper, `@echo off\r\n"${process.execPath}" "${hostJs}" %*\r\n`, "ascii");
  else { fs.writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${hostJs}" "$@"\n`); fs.chmodSync(wrapper, 0o755); }
});

const NOREG = args.has("--no-register");
if (NOREG) say("(--no-register: browsers not registered)");
else if (WIN) {
  const mf = path.join(DEST, "host", `${HOST_NAME}.json`);
  act(`write ${mf}`, () => fs.writeFileSync(mf, manifest));
  for (const k of REG_KEYS) {
    act(`register ${k}`, () => {
      const r = run("reg", ["add", k, "/ve", "/t", "REG_SZ", "/d", mf, "/f"], { shell: false });
      if (!r.ok) throw new Error(`reg add failed: ${r.out}`);
    });
  }
} else {
  for (const d of UNIX_DIRS) {
    if (!fs.existsSync(path.dirname(d))) continue; // that browser is not installed
    act(`register ${path.join(d, HOST_NAME + ".json")}`, () => { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, HOST_NAME + ".json"), manifest); });
  }
}

const server = fwd(path.join(DEST, "mcp", "server.js")); // forward slashes survive every shell
let claudeDone = false;
if (!args.has("--no-claude") && hasClaude()) {
  claudeRemove(); // re-adding updates an older entry
  act(`claude mcp add -s user ${MCP_NAME} -- node ${server}`, () => {
    const r = run("claude", ["mcp", "add", "-s", "user", MCP_NAME, "--", "node", server]);
    if (!r.ok) say(`  could not add it: ${r.out}`);
    claudeDone = r.ok;
  });
  if (DRY) claudeDone = true;
}

const extDir = path.join(DEST, "extension");
if (WIN && !DRY) spawnSync("clip", { input: extDir, shell: false });
say(`
Almost done. In Chrome:
  1. Open chrome://extensions and turn on "Developer mode" (top right).
  2. Click "Load unpacked" and choose:
       ${extDir}${WIN ? "\n     (this path is on your clipboard)" : ""}
     Do this in every Chrome profile the agent should use.
  3. Click the tabcrew-chrome icon in the toolbar: the popup should say "Connected".
`);
say(claudeDone
  ? "Claude Code: added for all projects. Start a new Claude Code session to use it."
  : `Claude Code: claude mcp add -s user ${MCP_NAME} -- node ${server}`);
say(`Other MCP clients: command "node", args ["${server}"]  (see README "Connect your agent")`);
say("To update later: run this installer again, then click the reload icon on the extension in chrome://extensions.");
