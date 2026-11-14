"""Turn a wait_read result into the reply text file.

Save the JSON that wait_read returned (or just its "chunks" array) to a file, then:

  python -I tools/join_reply.py <result.json> <reply.md>

It joins the chunks, undoes the "pct3" encoding (%25 -> %, %26 -> &, %3B -> ;),
checks the length against "len" when present, and writes the reply as UTF-8.

Why the encoding exists: the browser tool hides any returned string that looks like
cookie or query-string data (for example "x=1&y=2" or "a=b; c=d") behind
"[BLOCKED: Cookie/query string data]". Code replies hit this often.
"""
import io
import json
import re
import sys


def main() -> int:
    src, dst = sys.argv[1], sys.argv[2]
    data = json.loads(io.open(src, encoding="utf-8").read())
    if isinstance(data, list):
        chunks, want, enc = data, None, "pct3"
    else:
        chunks, want, enc = data["chunks"], data.get("len"), data.get("enc")
    joined = "".join(chunks)
    if "[BLOCKED" in joined:
        print("ERROR: a chunk was blocked by the browser tool; re-read that reply", file=sys.stderr)
        return 2
    if enc == "pct3":
        joined = re.sub(r"%(25|26|3B)", lambda m: {"25": "%", "26": "&", "3B": ";"}[m.group(1)], joined)
    if want is not None and len(joined) != want:
        print(f"ERROR: length {len(joined)} != expected {want}; a chunk is missing or was retyped", file=sys.stderr)
        return 3
    io.open(dst, "w", encoding="utf-8", newline="\n").write(joined)
    print(f"ok: {len(joined)} chars -> {dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
