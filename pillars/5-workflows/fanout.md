# Workflow: fanout

Several chats research different subtopics **in parallel**. Claude Code synthesizes the findings and acts.

**Seats:** 2 or more, each `researcher: <subtopic>` (`TOPICS[i]` → seat i). Providers may be mixed or the same.

## Kickoff (parallel)

If a seat attaches to an existing chat, do its handoff first (`pillars/6-memory`).

For every seat, build `templates/fanout-kickoff.md` with `{{GOAL}}`, `{{SUBTOPIC}}`, `{{OTHER_SUBTOPICS}}` (so the seats do not overlap) and `{{OUTPUT_HINT}}` (what Claude Code needs: e.g. "a ranked list with one-line reasons", "code-ready API facts"). Then run a **parallel turn** (`pillars/4-turn` § Parallel turns).

## Collect

Send each reply to its own seat agent (they route in parallel). Flexible shortcut: when a reply is plainly all findings (it has "Findings for Claude Code:", ends with [[DONE]], and asks the user nothing), you may route it yourself as `FORWARD` and skip that agent for this round, which saves a large copy. The agent stays available for follow-ups. For each seat's ROUTE:

| ROUTE | Do |
|---|---|
| `FORWARD` / `DONE` | Store the forward text as `FINDINGS[seat]`. |
| `ASK_USER` | Follow `pillars/4-turn/QUESTIONS.md` (auto mode: answer it yourself unless it is user-only), then send the answer to that seat and wait again. Other seats keep going meanwhile. |
| `NOTHING` | Send `Please give your findings under "Findings for Claude Code:".` once. |

Progress line: *"Fan-out round 1 · A ✅ B ✅ C ⏳"*.

## Follow-up (optional, max `MAX_ROUNDS - 1` rounds; with ∞, until nothing important is missing)

If the findings are thin, conflicting or miss something the goal needs, send one targeted follow-up per seat that needs it (`templates/fanout-followup.md`). Seats that are fine get no message. Run again as a parallel turn. Stop following up when nothing important is missing.

A cross-check is useful when two seats disagree: send seat X's claim to seat Y and ask it to verify. This is the only time content moves between seats in fanout.

## Finish

1. **Synthesize** `FINDINGS` into one result: merge, de-duplicate, and mark conflicts and which seat said what.
2. **Act** within `GOAL`: write the file / implement / decide, as the goal says (SAFETY rules apply).
3. Write memory (`pillars/6-memory`, Finish). Then tell the user: the synthesis (short), what Claude Code did, conflicts or open points, every seat's chat URL, and the memory file. Leave the seat tabs open (they are the user's chats).
