"""Fill a template's {{KEY}} placeholders, so messages and the router prompt are never retyped.

Usage:
  python -I src/tools/fill_template.py <template.md> KEY=value KEY=@file ... [-o out.md]

KEY=value puts the value in; KEY=@file puts that file's text in (UTF-8, one trailing
newline removed). Writes to -o (UTF-8) or prints. Fails if a placeholder in the template
has no value, or a value names a placeholder the template does not have.

Examples:
  python -I src/tools/fill_template.py src/pillars/5-workflows/templates/debate-responder.md \
      TOPIC=@topic.txt CONTEXT=@context.txt ROUNDS=4 OPPONENT_MESSAGE=@seat-A-round-0.md -o msg.txt
  python -I src/tools/fill_template.py src/pillars/3-routing/router-prompt.md FIRST_MESSAGE=@warmup.txt -o router-A.md
"""
import argparse
import io
import re
import sys


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("template")
    p.add_argument("pairs", nargs="*", metavar="KEY=value|KEY=@file")
    p.add_argument("-o", "--out")
    a = p.parse_args()

    text = io.open(a.template, encoding="utf-8").read()
    wanted = set(re.findall(r"\{\{([A-Z_]+)\}\}", text))
    values = {}
    for pair in a.pairs:
        key, sep, val = pair.partition("=")
        if not sep:
            p.error(f"expected KEY=value, got {pair!r}")
        if val.startswith("@"):
            val = io.open(val[1:], encoding="utf-8").read()
            if val.endswith("\n"):
                val = val[:-1]
        values[key] = val
    extra = set(values) - wanted
    missing = wanted - set(values)
    if extra:
        p.error(f"{a.template} has no placeholder(s): {', '.join(sorted(extra))}")
    if missing:
        p.error(f"no value for: {', '.join(sorted(missing))}")
    # one pass, so a value that contains "{{X}}" is never filled again
    out = re.sub(r"\{\{([A-Z_]+)\}\}", lambda m: values[m.group(1)], text)
    if a.out:
        io.open(a.out, "w", encoding="utf-8", newline="\n").write(out)
        print(f"ok: {len(out)} chars -> {a.out}")
    else:
        sys.stdout.reconfigure(encoding="utf-8", newline="\n")
        sys.stdout.write(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
