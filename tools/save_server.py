"""Local receiver for images a chat generated, so they land in a folder without a browser download dialog.

  python -I tools/save_server.py --out <folder>          # run in the background; prints one JSON ready line

Why it works: the chat page's CSP blocks fetch/XHR to localhost (connect-src), but ChatGPT sets no form-action,
so a top-level multipart form post from the page may go anywhere. providers/<id>/save_image.js posts the image
here; the server writes it and answers 303 back to the chat, so the tab reloads once and stays on the chat.

Safety:
- binds 127.0.0.1 only; the upload path carries a random token printed in the ready line, so other pages and
  programs cannot write files without it
- saves only PNG, JPEG or WebP (checked by magic bytes, not by name), at most --max-mb each
- file names are [A-Za-z0-9._-], never a path; an existing file is kept and the new one gets -2, -3, ...
- redirects back only to the chat origins in --origin (default https://chatgpt.com)

Output, one JSON object per line on stdout:
  {"ready": true, "url": "http://127.0.0.1:<port>/save/<token>", "out": "<folder>"}
  {"saved": "<file>", "bytes": <n>}            or   {"rejected": "<reason>"}
"""
import argparse
import json
import os
import re
import secrets
import sys
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
MAGIC = ((b"\x89PNG\r\n\x1a\n", ".png"), (b"\xff\xd8\xff", ".jpg"), (b"RIFF", ".webp"))


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

    class Handler(BaseHTTPRequestHandler):
        def _reply(self, code: int, back: str = ""):
            self.send_response(code)
            if back:
                self.send_header("Location", back)
            self.send_header("Content-Length", "0")
            self.end_headers()

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
                    url = data.decode("utf-8", "replace").strip()
                    if any(url == o or url.startswith(o + "/") for o in origins):
                        back = url
                elif field == "file":
                    files.append((part.get_filename() or "", data))
            for name, data in files:
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
    origins = [o.rstrip("/") for o in (a.origin or ["https://chatgpt.com"])]
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), make_handler(out, token, origins, a.max_mb * 1024 * 1024))
    emit({"ready": True, "url": f"http://127.0.0.1:{srv.server_address[1]}/save/{token}", "out": out})
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
