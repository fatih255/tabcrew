"""Summarize a tools/e2e.sh run: per test, did it finish, did its tests pass,
and did any adapter op report trouble (errors, retries, `warn`).

Usage: python -I tools/e2e_summary.py <OUT_DIR>
"""
import json
import pathlib
import re
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")


def op_results(path):
    """Yield (is_error, result_text) for adapter ops run through javascript_tool / browser_batch.

    A session's own diagnostic scripts are skipped: only calls that run an op (an installed
    __tc call, or a full op with its MSG/MODE header) count as adapter signals."""
    ids = {}
    for line in open(path, encoding="utf-8"):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        msg = e.get("message") or {}
        content = msg.get("content") if isinstance(msg.get("content"), list) else []
        if e.get("type") == "assistant":
            for c in content:
                if c.get("type") == "tool_use":
                    inp = json.dumps(c.get("input"), ensure_ascii=False)
                    is_op = bool(re.search(r"__tc|const (MSG|MODE|NAME)=|form\[data-chatgpt-composer\]|rich-textarea|ds-message", inp))
                    ids[c["id"]] = (c["name"], is_op)
        elif e.get("type") == "user":
            for c in content:
                name, is_op = ids.get(c.get("tool_use_id"), ("", False))
                if c.get("type") == "tool_result" and is_op and re.search(r"javascript_tool|browser_batch", name):
                    yield c.get("is_error", False), json.dumps(c.get("content"), ensure_ascii=False)


def result_of(path):
    res = None
    for line in open(path, encoding="utf-8"):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get("type") == "result":
            # background agents add more result records; keep the last one, but join all texts
            texts = (res or {}).get("all_text", "") + "\n" + str(e.get("result") or "")
            res = dict(e, all_text=texts)
    return res


def main():
    out = pathlib.Path(sys.argv[1])
    print(f"# tabcrew e2e summary\n\n{out}\n")
    print("| Test | Finished | Tests in folder | Adapter signals |")
    print("|---|---|---|---|")
    for jl in sorted(out.glob("*.jsonl")):
        name = jl.stem
        res = result_of(jl)
        finished = "yes" if res and res.get("subtype") == "success" else "NO"
        # a session cut off by the account's usage limit still ends with "success"
        if res and re.search(r"hit your .{0,20}limit|usage limit", res.get("all_text", ""), re.I):
            finished = "NO (usage limit)"
        signals = []
        for is_err, text in op_results(jl):
            if is_err:
                signals.append("tool error: " + text[:80])
                continue
            # only the op's own fields: "err": "<code>" and "warn": [...]; reply text is chunked and never matches
            for code in re.findall(r'err\\*"\s*:\s*\\*"(\w+)', text):
                if code != "not_installed":   # first use on a browser: the session installs and goes on
                    signals.append(code)
            if re.search(r'warn\\*"\s*:\s*\[', text):
                signals.append("warn")
            if "[BLOCKED" in text:
                signals.append("BLOCKED")
        folder = out / name
        tests = "-"
        found = [p for p in folder.rglob("test*.py") if ".tabcrew" not in p.parts] if folder.is_dir() else []
        if found:
            # run each folder that holds test files (tests/ without __init__.py is not discovered from the top)
            total, failed = 0, False
            for d in sorted({p.parent for p in found}):
                r = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", str(d), "-t", str(folder)],
                                   cwd=folder, capture_output=True, text=True, encoding="utf-8", errors="replace",
                                   env={"PYTHONIOENCODING": "utf-8", **__import__("os").environ})
                if r.returncode == 5 or "ImportError" in r.stderr:   # not a package: run it from inside
                    r = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", str(d)],
                                       cwd=d, capture_output=True, text=True, encoding="utf-8", errors="replace",
                                       env={"PYTHONIOENCODING": "utf-8", "PYTHONPATH": str(folder), **__import__("os").environ})
                m = re.search(r"Ran (\d+) tests?", r.stderr)
                total += int(m.group(1)) if m else 0
                failed |= r.returncode != 0
            tests = f"Ran {total} tests" + (" FAILED" if failed or total == 0 else " OK")
        # a session that edits the skill hides the bug it fixed: flag it
        for line in open(jl, encoding="utf-8"):
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if e.get("type") != "assistant":
                continue
            for c in (e.get("message") or {}).get("content", []):
                if c.get("type") != "tool_use":
                    continue
                path = str((c.get("input") or {}).get("file_path", ""))
                if c["name"] in ("Edit", "Write", "MultiEdit") and re.search(r"skills[/\\]+tabcrew|[/\\](providers|pillars|tools)[/\\]", path) and not re.search(re.escape(str(out)).replace(r"\\", r"[/\\]+"), path, re.I):
                    signals.append("EDITED SKILL FILES")
        if res and "Skill problems:" in res.get("all_text", ""):
            signals.append("reported skill problems")
        sig = ", ".join(sorted(set(signals))) or "none"
        print(f"| {name} | {finished} | {tests} | {sig} |")
    print("\nAny signal other than `none` deserves a look at that transcript (`<test>.jsonl`).")
    print("`warn` means a reply did not match the page (see providers/CONTRACT.md): the adapter may be out of date.")
    print("`EDITED SKILL FILES` means the session changed the skill to get past a problem: review that change before you keep it.")


if __name__ == "__main__":
    main()
