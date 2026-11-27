"""Split a message file into parts for a chat site that rejects long messages (TURN.md § No size limits).

Usage:
  python -I src/tools/split_message.py <message.md> [--max 8000] [-o <out dir>]

Cuts at line breaks (a single line longer than the limit is cut inside the line), adds the part
headers TURN.md uses, and writes part-1.md, part-2.md, ... into the out dir (default: next to the
message). Prints one line per part file, in send order. Send each with chat_send {path} and wait
for the chat's "OK" before the next one.
"""
import argparse
import io
import os
import sys

FIRST = '[Part {i}/{n}] Do not answer yet; reply only "OK".\n'
LAST_TAIL = "\n[Part {n}/{n}] This was the last part. Now answer the whole message."
ROOM = 200  # headers and tail


def split(text, size):
    parts, cur = [], ""
    for line in text.splitlines(keepends=True):
        while len(line) > size:  # one very long line
            if cur:
                parts.append(cur)
                cur = ""
            parts.append(line[:size])
            line = line[size:]
        if len(cur) + len(line) > size:
            parts.append(cur)
            cur = ""
        cur += line
    if cur:
        parts.append(cur)
    return parts


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser()
    p.add_argument("message")
    p.add_argument("--max", type=int, default=8000, help="the site's limit (chat_send's max), default 8000")
    p.add_argument("-o", "--out")
    a = p.parse_args()
    text = io.open(a.message, encoding="utf-8").read()
    size = max(500, min(8000, a.max - ROOM))
    chunks = split(text, size)
    n = len(chunks)
    out = a.out or os.path.dirname(os.path.abspath(a.message))
    os.makedirs(out, exist_ok=True)
    base = os.path.splitext(os.path.basename(a.message))[0]
    for i, chunk in enumerate(chunks, 1):
        body = FIRST.format(i=i, n=n) + chunk if i < n else f"[Part {i}/{n}]\n" + chunk + LAST_TAIL.format(n=n)
        if n == 1:
            body = chunk
        path = os.path.join(out, f"{base}-part-{i}.md")
        io.open(path, "w", encoding="utf-8", newline="\n").write(body)
        print(f"{path} ({len(body)} chars)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
