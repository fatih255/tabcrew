# Workflow: solo

One chat leads, Claude Code executes in the repo and reports back.

**Seats:** A = `lead` (any ready provider).

## Kickoff

- **New chat:** `turn(A, kickoff-solo)` with `templates/kickoff-solo.md`. Fill in `{{GOAL}}` and `{{PROJECT}}` (repo name, stack, relevant files — short, no secrets).
- **Existing chat:** run `wait_read('last')` on A, then ask the user:
  - `Forward the last reply to Claude Code (Recommended)`: route that reply
  - `Send the rules first`: send `templates/kickoff-solo.md` with its first line replaced by `Claude Code is now connected to this chat.`

## Loop (`round = 1 … MAX_ROUNDS`)

Act on each ROUTE:

| ROUTE | Do |
|---|---|
| `FORWARD` with `risk: high`, or `MODE = confirm` | `AskUserQuestion` showing the forward text: `Run it` / `Skip, tell the chat` / `Stop`. On skip, the next message is `The user did not approve this step: <reason>. Suggest another way.` |
| `FORWARD` | Do the work in the repo exactly as forwarded, within `GOAL` (SAFETY rule 3). The next message is `templates/report.md`. |
| `ASK_USER` | Ask the user. The next message is `The user's answer: …`. Pending content follows normal FORWARD rules after the answer. |
| `DONE` | → § Finish. |
| `NOTHING` | The next message is `Claude Code is waiting: give the next step under "Send to Claude Code:", or write [[DONE]] if the work is finished.` Do this at most once; on a second NOTHING in a row, ask the user. |
| `RELAY` | Not used in solo; treat it as `FORWARD`. |

Then `turn(A, next message)`, `round++`. If `round > MAX_ROUNDS`, ask: `5 more rounds` / `Stop`.

## Finish

Tell the user: number of rounds, files changed, test status, open items, and the chat URL (from `status`). Leave the tab open.
