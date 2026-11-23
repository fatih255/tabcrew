"""Local receiver for images a chat generated, so they land in a folder without a browser download dialog.

  python -I tools/save_server.py --out <folder>          # run in the background; prints one JSON ready line

Why it works: the chat pages' CSP blocks fetch/XHR to localhost (connect-src), but not every way out:
- POST /save/<token>: a multipart form (field "file", field "back"). ChatGPT sets no form-action, so its page can
  post a form anywhere.
- GET /save/<token>?f=<file>&i=<part>&n=<parts>&back=<url>&d=<base64url>: Gemini restricts form-action, but CSP
  does not restrict top-level navigation, so its page navigates here with the data in the URL (Chrome allows about
  2 MB per URL; bigger images come in parts, which are joined in memory and saved after the last one).
Either way the server answers 303 back to the chat, so the tab reloads and stays on the chat.

Safety:
- binds 127.0.0.1 only; the upload path carries a random token printed in the ready line, so other pages and
  programs cannot write files without it
- saves only PNG, JPEG or WebP (checked by magic bytes, not by name), at most --max-mb each
- file names are [A-Za-z0-9._-], never a path; an existing file is kept and the new one gets -2, -3, ...
- redirects back only to the chat origins in --origin (default https://chatgpt.com and https://gemini.google.com)
- unfinished multi-part uploads live in memory only, at most 4 at a time, and are dropped after 10 minutes

Output, one JSON object per line on stdout:
  {"ready": true, "url": "http://127.0.0.1:<port>/save/<token>", "out": "<folder>"}
  {"saved": "<file>", "bytes": <n>}   or   {"part": <i>, "of": <n>, "file": "<file>"}   or   {"rejected": "<reason>"}
"""
import argparse
import base64
import binascii
import json
import os
import re
import secrets
import sys
import time
import urllib.parse
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
MAGIC = ((b"\x89PNG\r\n\x1a\n", ".png"), (b"\xff\xd8\xff", ".jpg"), (b"RIFF", ".webp"))
MAX_LINE = 8 * 1024 * 1024  # a GET part is up to ~2 MB (Chrome's URL limit); the stdlib allows only 64 KB
PARTS_MAX, PARTS_TTL, PARTS_N = 4, 600, 64


def image_ext(data: bytes):
    for magic, ext in MAGIC:
        if data.startswith(magic) and (ext != ".webp" or data[8:12] == b"WEBP"):
            return ext
    return None


def free_name(out: str, name: str, ext: str) -> str:
    stem = re.sub(r"\.(png|jpe?g|webp)$", "", name, flags=re.I)
    candidate, n = stem + ext, 1
    while os.path.exists(os.path.join(out, candidate)):
        n += 1
        candidate = f"{stem}-{n}{ext}"
    return candidate


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=True) + "\n")
    sys.stdout.flush()


def make_handler(out: str, token: str, origins: list, max_bytes: int):
    path_ok = "/save/" + token
    parts = {}  # file -> {"n": parts, "got": {i: bytes}, "at": time}

    def allowed_back(url: str) -> str:
        url = url.strip()
        return url if any(url == o or url.startswith(o + "/") for o in origins) else ""

    def store(name: str, data: bytes):
        ext = image_ext(data)
        if not NAME_RE.match(name):
            emit({"rejected": "bad file name"})
        elif ext is None:
            emit({"rejected": "not a PNG, JPEG or WebP image"})
        elif len(data) > max_bytes:
            emit({"rejected": "too large"})
        else:
            fn = free_name(out, name, ext)
            with open(os.path.join(out, fn), "xb") as f:
                f.write(data)
            emit({"saved": fn, "bytes": len(data)})

    class Handler(BaseHTTPRequestHandler):
        def handle_one_request(self):
            # the stdlib version, except that a request line may be as long as a ~2 MB URL
            try:
                self.raw_requestline = self.rfile.readline(MAX_LINE + 1)
                if len(self.raw_requestline) > MAX_LINE:
                    self.requestline = self.request_version = self.command = ""
                    self.send_error(414)
                    return
                if not self.raw_requestline:
                    self.close_connection = True
                    return
                if not self.parse_request():
                    return
                method = getattr(self, "do_" + self.command, None)
                if method is None:
                    self.send_error(501)
                    return
                method()
                self.wfile.flush()
            except TimeoutError:
                self.close_connection = True

        def _reply(self, code: int, back: str = ""):
            self.send_response(code)
            if back:
                self.send_header("Location", back)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None

        def do_GET(self):
            path, _, query = self.path.partition("?")
            if path != path_ok:
                emit({"rejected": "bad token"})
                return self._reply(403)
            q = urllib.parse.parse_qs(query, keep_blank_values=True)

            def one(k):
                return (q.get(k) or [""])[0]

            name, back, d = one("f"), allowed_back(one("back")), one("d")
            try:
                i, n = int(one("i") or 0), int(one("n") or 1)
                data = base64.urlsafe_b64decode(d + "=" * (-len(d) % 4))
            except (ValueError, binascii.Error):
                emit({"rejected": "bad request"})
                return self._reply(400)
            if not (0 <= i < n <= PARTS_N) or not NAME_RE.match(name):
                emit({"rejected": "bad request"})
                return self._reply(400)
            now = time.time()
            for k in [k for k, v in parts.items() if now - v["at"] > PARTS_TTL]:
                del parts[k]
            if n == 1:
                store(name, data)
            else:
                job = parts.get(name)
                if job is None or job["n"] != n or i == 0:
                    if len(parts) >= PARTS_MAX and name not in parts:
                        emit({"rejected": "too many unfinished uploads"})
                        return self._reply(429)
                    job = parts[name] = {"n": n, "got": {}, "at": now}
                job["got"][i], job["at"] = data, now
                if sum(len(b) for b in job["got"].values()) > max_bytes:
                    del parts[name]
                    emit({"rejected": "too large"})
                elif len(job["got"]) == n:
                    del parts[name]
                    store(name, b"".join(job["got"][k] for k in range(n)))
                else:
                    emit({"part": i + 1, "of": n, "file": name})
            return self._reply(303, back) if back else self._reply(204)

        def do_POST(self):
            if self.path != path_ok:
                emit({"rejected": "bad token"})
                return self._reply(403)
            n = int(self.headers.get("Content-Length") or 0)
            ctype = self.headers.get("Content-Type", "")
            if not 0 < n <= max_bytes + 65536 or not ctype.startswith("multipart/form-data"):
                emit({"rejected": "bad request"})
                return self._reply(400)
            body = self.rfile.read(n)
            msg = BytesParser(policy=default).parsebytes(
                b"Content-Type: " + ctype.encode("latin-1") + b"\r\n\r\n" + body)
            if not msg.is_multipart():
                emit({"rejected": "bad request"})
                return self._reply(400)
            back = ""
            files = []
            for part in msg.iter_parts():
                field = part.get_param("name", header="content-disposition")
                data = part.get_payload(decode=True) or b""
                if field == "back":
                    back = allowed_back(data.decode("utf-8", "replace"))
                elif field == "file":
                    files.append((part.get_filename() or "", data))
            for name, data in files:
                store(name, data)
            # 303 back to the chat so the tab stays usable; without a valid back URL just say 204
            return self._reply(303, back) if back else self._reply(204)

        def log_message(self, *args):
            pass

    return Handler


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--out", required=True, help="folder for the images (created if missing)")
    p.add_argument("--port", type=int, default=0, help="0 = any free port (default)")
    p.add_argument("--origin", action="append", help="chat origin allowed as redirect target (repeatable)")
    p.add_argument("--max-mb", type=int, default=40)
    a = p.parse_args()
    out = os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)
    token = secrets.token_urlsafe(24)
    origins = [o.rstrip("/") for o in (a.origin or ["https://chatgpt.com", "https://gemini.google.com"])]
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), make_handler(out, token, origins, a.max_mb * 1024 * 1024))
    emit({"ready": True, "url": f"http://127.0.0.1:{srv.server_address[1]}/save/{token}", "out": out})
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
