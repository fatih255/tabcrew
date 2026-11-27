#!/usr/bin/env bash
# Run the tabcrew end-to-end smoke matrix: one fresh `claude -p` session per test,
# all at the same time in your Chrome (each session works only in the tabs it opens).
#
# Usage:  bash src/tools/e2e.sh [OUT_DIR] [TEST ... | full]
#   OUT_DIR  where test folders, transcripts and the summary go (default: a new temp folder)
#   TEST     names to run (default: the 5 smoke tests; "full" = every test below).
#            solo-existing-deepseek needs DEEPSEEK_CHAT=<url of a DeepSeek chat with some history>.
#   CLAUDE_CMD   command that starts a session (default: claude)
#
# Needs: the `claude` CLI, tabcrew-chrome installed and connected (server path from TCA_SERVER or
# ~/.claude.json), and logins on the chat sites. With several Chrome profiles, set TCA_BROWSER=<browserId>
# so the sessions do not each probe every profile.
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
  [debate-chatgpt-deepseek]='/tabcrew workflow=debate seats=chatgpt,deepseek mode=auto rounds=3 goal="Agree on a retry helper retry(fn, attempts, base_delay) with exponential backoff and jitter: which exceptions to retry, and how to test it without sleeping. Then implement retry.py with unittest tests (mock the sleep) and run them."'
  [debate-gemini-deepseek]='/tabcrew workflow=debate seats=gemini,deepseek mode=auto rounds=3 goal="Agree on an LRU cache class LRU(capacity) with get/put and O(1) operations, and its edge cases (capacity 0, updating an existing key). Then implement lru.py with unittest tests and run them."'
  [debate-deepseek-deepseek]='/tabcrew workflow=debate seats=deepseek,deepseek mode=auto rounds=3 goal="Agree on the rules of is_palindrome(s): case, accents, punctuation and Turkish dotted/dotless i. Then implement palindrome.py with unittest tests and run them."'
  [solo-review-chatgpt]='/tabcrew workflow=solo seats=chatgpt mode=auto rounds=3 goal="Send the whole file big_module.py (about 25,000 characters) to the chat and ask for the most important bug in it. Fix that bug in the file and add a unittest test that fails before the fix and passes after. Run it."'
  [auto-questions-deepseek]='/tabcrew workflow=solo seats=deepseek mode=auto rounds=4 goal="Build a small CLI todo app todo.py (add, list, done) with a JSON file store and unittest tests. In the first message, tell the chat to ask you exactly two design questions before it suggests any code. Answer them yourself, as auto mode says, then build it and run the tests."'
  [images-chatgpt]='/tabcrew workflow=solo seats=chatgpt mode=auto rounds=2 goal="Ask the chat to generate one simple black-and-white icon of a key (square image). Save it into the folder art/ here, open it to check it is a real image, and report its file name and size."'
  [images-gemini]='/tabcrew workflow=solo seats=gemini mode=auto rounds=2 goal="Ask the chat to generate one simple black-and-white icon of a paper plane (square image). Save it into the folder art/ here at full size, open it to check it is a real image, and report its file name, size and whether it is full size."'
  [solo-existing-deepseek]='/tabcrew workflow=solo seats=deepseek:__DEEPSEEK_CHAT__ mode=auto rounds=2 goal="Continue this existing DeepSeek chat. Ask it to turn the add(a, b) function it wrote earlier into a small module calc.py with add and sub, then add unittest tests and run them."'
  [fanout-all3]='/tabcrew workflow=fanout seats=deepseek,chatgpt,gemini mode=auto rounds=2 goal="Implement semver.py with compare(a, b) -> -1/0/1 per SemVer 2.0.0 and is_valid(v). Add unittest tests and run them." topics="pre-release precedence rules|build metadata and invalid version strings|a table of tricky test cases with expected results"'
)

NOTE=' (This is a test run of the tabcrew skill: do not edit the skill files. If an adapter or a step misbehaves, work around it only if you must, and describe the problem in your final answer under "Skill problems:".)'

# Files some tests need in their empty folder.
setup() {
  case "$1" in
    solo-review-chatgpt) python -I - <<'PY'
lines = ['"""Inventory helpers (generated test file)."""', "", "import math", ""]
for i in range(1, 190):
    lines += [f"def scale_{i}(x):", f'    """Scale x by {i} and round to 2 decimals."""', f"    return round(x * {i} / 10, 2)", ""]
lines += ["def average_price(prices):", '    """Average of a list of prices; an empty list gives 0."""',
          "    total = sum(prices)", "    return total / len(prices)", ""]
for i in range(190, 280):
    lines += [f"def offset_{i}(x):", f'    """Add {i} to x."""', f"    return x + {i}", ""]
open("big_module.py", "w", encoding="utf-8", newline="\n").write("\n".join(lines))
PY
    ;;
  esac
}

read -ra CL <<< "${CLAUDE_CMD:-claude}"   # e.g. CLAUDE_CMD="clauder <account>" to run the sessions under another login
SMOKE=(solo-deepseek solo-chatgpt solo-gemini debate-chatgpt-gemini fanout-all3)
NAMES=("$@")
[ ${#NAMES[@]} -eq 0 ] && NAMES=("${SMOKE[@]}")
[ "${NAMES[0]}" = full ] && NAMES=("${!TESTS[@]}")

REPO="$(cd "$HERE/../.." && pwd)"
SERVER="$(python -I "$HERE/chrome_agent.py" server)" || { echo "tabcrew-chrome server not found (set TCA_SERVER)"; exit 1; }
MCP="$(python -I -c 'import json,sys; print(json.dumps({"mcpServers":{"tabcrew-chrome":{"command":"node","args":[sys.argv[1]]}}}))' "$SERVER")"
BFLAGS=(--mcp-config "$MCP")
snap() { git -C "$REPO" status --porcelain; git -C "$REPO" diff; }
BEFORE="$(snap | sha1sum)"
echo "tabcrew e2e -> $OUT"
for name in "${NAMES[@]}"; do
  prompt="${TESTS[$name]:-}"
  if [ -z "$prompt" ]; then echo "unknown test: $name"; continue; fi
  if [[ "$prompt" == *__DEEPSEEK_CHAT__* ]]; then
    if [ -z "${DEEPSEEK_CHAT:-}" ]; then echo "skip $name (set DEEPSEEK_CHAT)"; continue; fi
    prompt="${prompt//__DEEPSEEK_CHAT__/$DEEPSEEK_CHAT}"
  fi
  (
    d="$OUT/$name"; rm -rf "$d"; mkdir -p "$d"; cd "$d" && git init -q && setup "$name"
    echo "start $(date +%T) $name" >> "$OUT/progress.log"
    timeout 3000 "${CL[@]}" -p "${BFLAGS[@]}" --permission-mode bypassPermissions \
      --output-format stream-json --verbose "$prompt$NOTE" > "$OUT/$name.jsonl" 2> "$OUT/$name.err"
    echo "end   $(date +%T) $name exit=$?" >> "$OUT/progress.log"
  ) &
  sleep 20   # stagger the starts so the sessions do not open tabs at the same moment
done
wait
{
  python -I "$HERE/e2e_summary.py" "$OUT"
  if [ "$(snap | sha1sum)" != "$BEFORE" ]; then
    echo; echo "**The repo changed during this run** (a test session, or you). Review those changes before you keep them:"
    echo; echo '```'; git -C "$REPO" status --short; echo '```'
  fi
} | tee "$OUT/SUMMARY.md"
