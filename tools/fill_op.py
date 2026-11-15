"""Build a provider op for javascript_tool, so long or tricky messages never get hand-escaped.

Install once per tab, then call (recommended, small):
  python -I tools/fill_op.py --install providers/<id>                        # once per page load
  python -I tools/fill_op.py providers/<id>/send.js --msg-file <msg.txt> --call
  python -I tools/fill_op.py providers/<id>/wait_read.js --mode after_send --call
  python -I tools/fill_op.py providers/<id>/status.js --call

Full op (no install needed, large):
  python -I tools/fill_op.py providers/<id>/send.js --msg-file <message.txt>
  python -I tools/fill_op.py providers/<id>/wait_read.js --mode after_send|last
  python -I tools/fill_op.py providers/<id>/toggle.js --name "Derin|DeepThink" --on true

Prints the JavaScript to stdout. Pass it to javascript_tool unchanged. The output is pure
ASCII (non-ASCII is \\uXXXX-escaped), so copying it cannot corrupt anything.

The installer defines window.__tc = {v, p, status(), send(msg), wait(mode), toggle(re, on)}.
A --call checks that the installed version matches the op files on disk and otherwise
returns {ok:false, status:'error', err:'not_installed'}: install again (a reload or
navigation clears it; an adapter change makes the version differ).
"""
import argparse
import hashlib
import io
import json
import pathlib
import sys

OPS = {  # file -> (method name, placeholder -> parameter)
    "status.js": ("status", {}),
    "send.js": ("send", {"__MSG__": "__a"}),
    "wait_read.js": ("wait", {"__MODE__": "__a"}),
    "toggle.js": ("toggle", {"__NAME__": "__a", "__ON__": "__b"}),
}


def ascii_js(s: str) -> str:
    # keep the output pure ASCII; inside JS source \\uXXXX means the same character
    return "".join(c if ord(c) < 128 else "\\u%04x" % ord(c) if ord(c) < 0x10000
                   else "".join("\\u%04x" % u for u in (0xD800 + ((ord(c) - 0x10000) >> 10), 0xDC00 + ((ord(c) - 0x10000) & 0x3FF)))
                   for c in s)


def version(provider_dir: pathlib.Path) -> str:
    h = hashlib.sha1()
    for name in sorted(OPS):
        f = provider_dir / name
        if f.exists():
            h.update(name.encode() + b"\0" + f.read_bytes())
    return h.hexdigest()[:10]


def installer(provider_dir: pathlib.Path) -> str:
    parts = []
    for name, (method, params) in OPS.items():
        f = provider_dir / name
        if not f.exists():
            continue
        src = f.read_text(encoding="utf-8").strip()
        first, sep, rest = src.partition("\n")
        for ph, arg in params.items():
            first = first.replace(ph, arg, 1)
        args = ",".join(params.values())
        parts.append(f"{method}:async({args})=>{{return {first}{sep}{rest}}}")
    v = version(provider_dir)
    body = ",".join(parts)
    return ascii_js(f"window.__tc={{v:'{v}',p:'{provider_dir.name}',{body}}};({{installed:'{v}',provider:'{provider_dir.name}'}})")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("op", nargs="?")
    p.add_argument("--install", metavar="PROVIDER_DIR")
    p.add_argument("--call", action="store_true", help="print a short call to the installed op")
    p.add_argument("--msg-file")
    p.add_argument("--mode", choices=["after_send", "last"])
    p.add_argument("--name")
    p.add_argument("--on", choices=["true", "false"])
    a = p.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")

    if a.install:
        sys.stdout.write(installer(pathlib.Path(a.install)))
        return 0
    if not a.op:
        p.error("give an op file, or --install <provider dir>")

    op = pathlib.Path(a.op)
    src = io.open(op, encoding="utf-8").read()
    first, sep, rest = src.partition("\n")
    values = {}
    if "__MSG__" in first:
        if not a.msg_file:
            p.error("this op needs --msg-file")
        msg = io.open(a.msg_file, encoding="utf-8").read()
        if msg.endswith("\n"):
            msg = msg[:-1]
        # ensure_ascii keeps the output pure ASCII, so terminal encodings cannot corrupt it
        values["__MSG__"] = json.dumps(msg, ensure_ascii=True)
    if "__MODE__" in first:
        if not a.mode:
            p.error("this op needs --mode")
        values["__MODE__"] = "'" + a.mode + "'"
    if "__NAME__" in first:
        if not a.name:
            p.error("this op needs --name")
        values["__NAME__"] = "/" + a.name.replace("/", "\\/") + "/i"
    if "__ON__" in first:
        if not a.on:
            p.error("this op needs --on")
        values["__ON__"] = a.on

    if a.call:
        method, params = OPS[op.name]
        args = ",".join(values[ph] for ph in params)
        v = version(op.parent)
        sys.stdout.write(ascii_js(
            f"await (window.__tc&&window.__tc.v==='{v}'?window.__tc.{method}({args}):"
            f"{{ok:false,status:'error',err:'not_installed'}})"))
        return 0

    for ph, val in values.items():
        first = first.replace(ph, val)
    sys.stdout.write(ascii_js(first + sep + rest))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
