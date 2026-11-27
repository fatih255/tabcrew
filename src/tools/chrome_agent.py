"""Call tabcrew-chrome tools without its MCP server being loaded in Claude Code.

Use it only when tabcrew-chrome is installed (extension + native host) but its MCP
tools (mcp__tabcrew-chrome__*) are not in the current session, for example because
`claude mcp add` registered it for another project. Each call starts the server
(`node <repo>/mcp/server.js`), sends initialize and one tools/call, prints the result
and exits. Needs only Python 3 and Node.js 18+.

  python -I src/tools/chrome_agent.py list_connected_browsers
  python -I src/tools/chrome_agent.py --browser <id|name> tabs_context_mcp '{"createIfEmpty": true}'
  python -I src/tools/chrome_agent.py --browser <id|name> navigate '{"tabId": 123, "url": "https://chatgpt.com/"}'
  python -I src/tools/chrome_agent.py --browser <id|name> chat_status '{"tabId": 123}'
  python -I src/tools/chrome_agent.py --browser <id|name> chat_send '{"tabId": 123, "path": "C:/tmp/msg.md"}'
  python -I src/tools/chrome_agent.py --browser <id|name> chat_read '{"tabId": 123, "path": "C:/tmp/reply.md"}'
  python -I src/tools/chrome_agent.py --browser <id|name> computer @args.json --out <dir>   # screenshots -> files

TOOL is any tabcrew Chrome Agent tool name, `js` (javascript_tool on --tab; the code comes
from stdin or --js-file), `tools` (list the tool names) or `server` (print the server path). ARGS is inline JSON or @file.
Every call is a new server process, so the browser choice does not carry over: pass
--browser (or set TCA_BROWSER) on every call when several Chrome profiles are connected.

The server path comes from --server, else TCA_SERVER, else the "tabcrew-chrome"
entry in ~/.claude.json (written by its installer or `claude mcp add`), else the copy
in this skill (src/chrome-agent/mcp/server.js).

Output: the text parts of the result (the "Tab Context:" trailer is dropped unless
--context), images saved to --out (default: the current folder) as `IMAGE: <path>`.
--save writes the text output to a UTF-8 file as well. Exit code 1 when the tool reported an error.
"""
import argparse
import base64
import io
import json
import os
import pathlib
import hashlib
import subprocess
import sys
import threading
import time

NAME = "tabcrew-chrome"


def find_server(explicit):
    if explicit:
        return explicit
    if os.environ.get("TCA_SERVER"):
        return os.environ["TCA_SERVER"]
    cfg = pathlib.Path.home() / ".claude.json"
    try:
        data = json.loads(cfg.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    scopes = [data.get("mcpServers") or {}]
    scopes += [(p or {}).get("mcpServers") or {} for p in (data.get("projects") or {}).values()]
    for servers in scopes:
        s = servers.get(NAME)
        if s and s.get("args"):
            for a in s["args"]:
                if str(a).replace("\\", "/").endswith("mcp/server.js"):
                    return a
    bundled = pathlib.Path(__file__).resolve().parent.parent / "chrome-agent" / "mcp" / "server.js"
    return str(bundled) if bundled.is_file() else None


class Client:
    def __init__(self, server, browser, timeout):
        env = dict(os.environ)
        if browser:
            env["TCA_BROWSER"] = browser
        # Every call starts a new server: keep one agent id per folder, so the popup sees one agent.
        env.setdefault("TCA_AGENT_ID", "cli-" + hashlib.sha1(os.getcwd().encode("utf-8")).hexdigest()[:8])
        self.p = subprocess.Popen(["node", server], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, env=env)
        self.timeout = timeout
        self.next_id = 0
        self.err = []
        threading.Thread(target=lambda: self.err.extend(self.p.stderr), daemon=True).start()

    def _write(self, obj):
        self.p.stdin.write((json.dumps(obj) + "\n").encode("utf-8"))
        self.p.stdin.flush()

    def call(self, method, params):
        self.next_id += 1
        want = self.next_id
        self._write({"jsonrpc": "2.0", "id": want, "method": method, "params": params})
        box = {}

        def read():
            for line in self.p.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line.decode("utf-8"))
                except ValueError:
                    continue
                if msg.get("id") == want:
                    box["msg"] = msg
                    return

        t = threading.Thread(target=read, daemon=True)
        t.start()
        t.join(self.timeout)
        if "msg" not in box:
            tail = b"".join(self.err[-5:]).decode("utf-8", "replace").strip()
            raise SystemExit(f"ERROR: no answer from {NAME} within {self.timeout} s. {tail}")
        return box["msg"]

    def close(self):
        try:
            self.p.stdin.close()
            self.p.wait(5)
        except Exception:
            self.p.kill()


def parse_args_json(raw):
    if not raw:
        return {}
    if raw.startswith("@"):
        raw = io.open(raw[1:], encoding="utf-8").read()
    return json.loads(raw)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("tool")
    ap.add_argument("args", nargs="?", default="")
    ap.add_argument("--server", help="path to tabcrew-chrome's mcp/server.js")
    ap.add_argument("--browser", help="browserId or name from list_connected_browsers (else TCA_BROWSER)")
    ap.add_argument("--tab", type=int, help="tab id for `js`")
    ap.add_argument("--js-file", help="code for `js` (default: stdin)")
    ap.add_argument("--out", default=".", help="folder for returned images")
    ap.add_argument("--save", help="also write the text output to this file (UTF-8)")
    ap.add_argument("--context", action="store_true", help="keep the 'Tab Context:' trailer")
    ap.add_argument("--timeout", type=float, default=150, help="seconds to wait for the result")
    a = ap.parse_args()

    server = find_server(a.server)
    if not server or not pathlib.Path(server).is_file():
        print(f"ERROR: {NAME} server not found ({server or 'no path'}). Pass --server <repo>/mcp/server.js "
              "or set TCA_SERVER.", file=sys.stderr)
        return 2

    if a.tool == "server":
        print(server)
        return 0
    if a.tool == "js":
        if a.tab is None:
            print("ERROR: `js` needs --tab", file=sys.stderr)
            return 2
        code = io.open(a.js_file, encoding="utf-8").read() if a.js_file else sys.stdin.read()
        tool, args = "javascript_tool", {"action": "javascript_exec", "tabId": a.tab, "text": code}
    else:
        tool, args = a.tool, parse_args_json(a.args)

    c = Client(server, a.browser, a.timeout)
    try:
        c.call("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                              "clientInfo": {"name": "tabcrew", "version": "1"}})
        c._write({"jsonrpc": "2.0", "method": "notifications/initialized"})
        if tool == "tools":
            r = c.call("tools/list", {})
            print("\n".join(t["name"] for t in r.get("result", {}).get("tools", [])))
            return 0
        r = c.call("tools/call", {"name": tool, "arguments": args})
    finally:
        c.close()

    if "error" in r:
        print("ERROR: " + json.dumps(r["error"], ensure_ascii=False), file=sys.stderr)
        return 1
    res = r.get("result") or {}
    texts, n = [], 0
    for part in res.get("content") or []:
        if part.get("type") == "text":
            t = part.get("text", "")
            if not a.context and t.lstrip().startswith("Tab Context:"):
                continue
            if not a.context and "\n\nTab Context:" in t:
                t = t.split("\n\nTab Context:")[0]
            texts.append(t)
        elif part.get("type") == "image":
            ext = (part.get("mimeType") or "image/png").split("/")[-1].replace("jpeg", "jpg")
            os.makedirs(a.out, exist_ok=True)
            f = os.path.join(a.out, f"tca-{time.strftime('%H%M%S')}-{n}.{ext}")
            n += 1
            with open(f, "wb") as fh:
                fh.write(base64.b64decode(part.get("data", "")))
            texts.append(f"IMAGE: {os.path.abspath(f)}")
    out = "\n".join(texts).strip()
    print(out)
    if a.save:
        io.open(a.save, "w", encoding="utf-8", newline="\n").write(out)
    return 1 if res.get("isError") else 0


if __name__ == "__main__":
    raise SystemExit(main())
