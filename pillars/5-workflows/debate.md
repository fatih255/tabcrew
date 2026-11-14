# Workflow: debate

Two chats discuss a question and converge. Claude Code moderates (relays, enforces the round limit), then acts on the agreed conclusion.

**Seats:** A = `proposer`, B = `critic`. They may be different providers (ChatGPT ↔ DeepSeek) or the same one.

## Kickoff

If a seat attaches to an existing chat, do its handoff first (`pillars/6-memory`), and add the handoff summary to `{{CONTEXT}}`.

1. `turn(A, templates/debate-opener.md)` with `{{TOPIC}}`, `{{CONTEXT}}` (what Claude Code will do with the result; repo facts if relevant, no secrets), `{{ROUNDS}}` = `MAX_ROUNDS`.
2. Take A's ROUTE (expected: `RELAY`), then `turn(B, templates/debate-responder.md)` with the same fields, plus `{{OPPONENT_MESSAGE}}` = A's forward text.

## Loop (`round = 1 … MAX_ROUNDS`; one round = A → B)

After each turn, act on the ROUTE of the seat that just spoke (`S`; the other seat is `O`):

| ROUTE | Do |
|---|---|
| `RELAY` | `turn(O, "<forward text>")`. Send it unchanged, so the other chat sees the argument exactly. |
| `DONE` (contains `[[AGREED]]`) | Keep the forward text as `CONCLUSION`. Send `templates/debate-confirm.md` to `O` with `{{CONCLUSION}}`, so both agree on the same text. If `O` replies `[[AGREED]]` (router `DONE`), go to § Finish. If `O` objects (`RELAY`), continue the loop with that objection. |
| `FORWARD` | A seat addressed Claude Code directly mid-debate. Note it and keep it for § Finish. Continue by relaying the rest of the reply. |
| `ASK_USER` | Ask the user. Send the answer to **both** seats as `The user's answer: …`, then continue with the seat whose turn it is. |
| `NOTHING` | Send `Please continue the debate, or write [[AGREED]] with "Conclusion for Claude Code:" if you agree.` to that seat, once. On a second NOTHING, go to the wrap-up. |

Progress line per turn: *"Round 2/6 · B (ChatGPT) → A (DeepSeek): objection relayed"*.

**Wrap-up at `round > MAX_ROUNDS`.** Send `templates/debate-wrapup.md` to A. Its reply comes back as `DONE` or `FORWARD` and becomes `CONCLUSION`. If it contains unresolved disagreements, keep them as "open points".

## Finish

1. Show the user the `CONCLUSION` (short) and the open points.
2. Act on it within `GOAL`:
   - If the goal asks Claude Code to implement something, do it in the repo. The same SAFETY rules apply, and `risk: high` or `MODE = confirm` means ask first.
   - If the goal is a decision or research only, write the result where the user asked (or just report it).
3. Optional, only if the goal says so or the user wants it: one review turn. Send `templates/report.md` to A, and handle its reply like solo.
4. Write memory (`pillars/6-memory`, Finish). Then the final summary: rounds, conclusion, what Claude Code changed, open points, both chat URLs (from `status`), and the memory file.
