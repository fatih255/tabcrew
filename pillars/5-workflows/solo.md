# Workflow: solo

One chat leads, Claude Code executes in the repo and reports back.

**Seats:** A = `lead` (any ready provider).

## Kickoff

- **New chat:** `turn(A, kickoff-solo)` with `templates/kickoff-solo.md`. Fill in `{{GOAL}}` and `{{PROJECT}}` (repo name, stack, relevant files — short, no secrets).
- **Existing chat:** first the **handoff** (`pillars/6-memory`). Send `templates/handoff.md` to A, wait for the reply, save it to `.tabcrew/chats/…` and read it carefully: it is the chat's own summary of everything so far. Do not route the handoff reply (its `[[DONE]]` only ends the summary). Show the user a 3-line digest, then ask:
  - `Continue from the chat's next step (Recommended)`: send `templates/kickoff-solo.md` with its first line replaced by `Claude Code is now connected to this chat and has read your handoff.` and `{{GOAL}}` = the user's goal, or "continue with the next step from your handoff"
  - `Forward the last reply before the handoff`: route that earlier reply as the first instruction

## Loop (`round = 1 … MAX_ROUNDS`; `MAX_ROUNDS` may be ∞, see SAFETY rule 7)

Act on each ROUTE:

| ROUTE | Do |
|---|---|
| `FORWARD` with `risk: high`, or `MODE = confirm` | `AskUserQuestion` showing the forward text: `Run it` / `Skip, tell the chat` / `Stop`. On skip, the next message is `The user did not approve this step: <reason>. Suggest another way.` |
| `FORWARD` | Do the work in the repo exactly as forwarded, within `GOAL` (SAFETY rule 3). The next message is `templates/report.md`. |
| `ASK_USER` | Follow `pillars/4-turn/QUESTIONS.md`: in auto mode answer it yourself unless it is user-only; in confirm mode ask the user. The next message carries the answer. Pending content follows normal FORWARD rules after the answer. |
| `DONE` | → § Finish. |
| `NOTHING` | The next message is `Claude Code is waiting: give the next step under "Send to Claude Code:", or write [[DONE]] if the work is finished.` Do this at most once; on a second NOTHING in a row, ask the user. |
| `RELAY` | Not used in solo; treat it as `FORWARD`. |

Then `turn(A, next message)`, `round++`. If `round > MAX_ROUNDS`, ask: `5 more rounds` / `Until done` / `Stop`. With ∞, apply the stall guard after every round instead.

**The report on the last round's work is not a new round.** When the work of round `MAX_ROUNDS` is done, still send `templates/report.md` (so the chat sees the result), with this line added at the end: `This was the last round available. If the goal is met, write only [[DONE]]; otherwise say briefly what is left.` A `DONE` → § Finish. Anything else → ask the user `5 more rounds` / `Until done` / `Stop`.

## Finish

Write memory (`pillars/6-memory` § When to write → Finish). Then tell the user: number of rounds, files changed, test status, open items, the chat URL (from `status`), and the memory file. Leave the tab open: seat tabs are the user's chats, so this overrides any general advice to close tabs you opened.
