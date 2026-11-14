"""Fill a provider op's placeholder from a file, so long or tricky messages never get hand-escaped.

Usage:
  python -I tools/fill_op.py providers/<id>/send.js --msg-file <message.txt>
  python -I tools/fill_op.py providers/<id>/wait_read.js --mode after_send|last
  python -I tools/fill_op.py providers/<id>/toggle.js --name "Derin|DeepThink" --on true

Prints the ready-to-run JavaScript to stdout. Pass it to javascript_tool unchanged.
"""
import argparse
import io
import json
import sys


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("op")
    p.add_argument("--msg-file")
    p.add_argument("--mode", choices=["after_send", "last"])
    p.add_argument("--name")
    p.add_argument("--on", choices=["true", "false"])
    a = p.parse_args()

    src = io.open(a.op, encoding="utf-8").read()
    first, sep, rest = src.partition("\n")

    if "__MSG__" in first:
        if not a.msg_file:
            p.error("this op needs --msg-file")
        msg = io.open(a.msg_file, encoding="utf-8").read()
        if msg.endswith("\n"):
            msg = msg[:-1]
        # ensure_ascii keeps the output pure ASCII, so terminal encodings cannot corrupt it
        first = first.replace("__MSG__", json.dumps(msg, ensure_ascii=True))
    if "__MODE__" in first:
        if not a.mode:
            p.error("this op needs --mode")
        first = first.replace("__MODE__", "'" + a.mode + "'")
    if "__NAME__" in first:
        if not a.name:
            p.error("this op needs --name")
        first = first.replace("__NAME__", "/" + a.name.replace("/", "\\/") + "/i")
    if "__ON__" in first:
        if not a.on:
            p.error("this op needs --on")
        first = first.replace("__ON__", a.on)

    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    sys.stdout.write(first + sep + rest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
