#!/usr/bin/env bash
# Run the tabcrew end-to-end smoke matrix: one fresh `claude -p` session per test,
# all at the same time in your Chrome (each session gets its own tab group).
#
# Usage:  bash tools/e2e.sh [OUT_DIR] [TEST ...]
#   OUT_DIR  where test folders, transcripts and the summary go (default: a new temp folder)
#   TEST     names to run (default: all). See the TESTS list below.
#
# Needs: the `claude` CLI, Claude in Chrome connected, and logins on the chat sites.
# Sends real messages to the chats. Each test takes about 3-8 minutes.
# When it ends, read SUMMARY.md: any adapter error, `warn` or retry is listed per test.

set -u
OUT="${1:-$(mktemp -d -t tabcrew-e2e-XXXX)}"
shift || true
mkdir -p "$OUT"
HERE="$(cd "$(dirname "$0")" && pwd)"

declare -A TESTS=(
  [solo-deepseek]='/tabcrew workflow=solo seats=deepseek mode=auto rounds=3 goal="Create wordfreq.py with top_words(text, n) that counts words case-insensitively (str.casefold, Unicode letters, no digits or punctuation), sorted by count desc then word asc. Add unittest tests and run them."'
  [solo-chatgpt]='/tabcrew workflow=solo seats=chatgpt mode=auto rounds=3 goal="Create slug.py with slugify(text) for URLs (Turkish and German letters transliterated, lowercase, hyphens). Ask the chat to answer with code blocks. Add unittest tests and run them."'
  [solo-gemini]='/tabcrew workflow=solo seats=gemini mode=auto rounds=3 goal="Create duration.py with parse_duration(s) -> int seconds for strings like 1h30m, 45s, 2d (errors for bad input). Add unittest tests and run them."'
  [debate-chatgpt-gemini]='/tabcrew workflow=debate seats=chatgpt,gemini mode=auto rounds=3 goal="Agree on the API and error handling of a small JSON-lines log reader (read_jsonl(path) -> iterator), with code blocks on both sides. Then implement jsonl.py with unittest tests and run them."'
  [fanout-all3]='/tabcrew workflow=fanout seats=deepseek,chatgpt,gemini mode=auto rounds=2 goal="Implement semver.py with compare(a, b) -> -1/0/1 per SemVer 2.0.0 and is_valid(v). Add unittest tests and run them." topics="pre-release precedence rules|build metadata and invalid version strings|a table of tricky test cases with expected results"'
)

NOTE=' (This is a test run of the tabcrew skill: do not edit the skill files. If an adapter or a step misbehaves, work around it only if you must, and describe the problem in your final answer under "Skill problems:".)'

NAMES=("$@")
[ ${#NAMES[@]} -eq 0 ] && NAMES=("${!TESTS[@]}")

REPO="$(cd "$HERE/.." && pwd)"
snap() { git -C "$REPO" status --porcelain; git -C "$REPO" diff; }
BEFORE="$(snap | sha1sum)"
echo "tabcrew e2e -> $OUT"
for name in "${NAMES[@]}"; do
  prompt="${TESTS[$name]:-}"
  if [ -z "$prompt" ]; then echo "unknown test: $name"; continue; fi
  (
    d="$OUT/$name"; rm -rf "$d"; mkdir -p "$d"; cd "$d" && git init -q
    echo "start $(date +%T) $name" >> "$OUT/progress.log"
    timeout 3000 claude -p --chrome --permission-mode bypassPermissions \
      --output-format stream-json --verbose "$prompt$NOTE" > "$OUT/$name.jsonl" 2> "$OUT/$name.err"
    echo "end   $(date +%T) $name exit=$?" >> "$OUT/progress.log"
  ) &
  sleep 20   # stagger the starts so the sessions do not open tabs at the same moment
done
wait
{
  python -I "$HERE/e2e_summary.py" "$OUT"
  if [ "$(snap | sha1sum)" != "$BEFORE" ]; then
    echo; echo "**The skill files changed during this run** (a session edited them). Review before you keep it:"
    echo; echo '```'; git -C "$REPO" status --short; echo '```'
  fi
} | tee "$OUT/SUMMARY.md"
