# Pillar 4 — Relay loop

Uses the provider ops (`send`, `wait_read`) and the ROUTER (`pillars/3-routing`). State: `round = 1`, `MAX_ROUNDS`, `MODE`.

Messages to the **chat** are in English (templates below), unless the user asks for another language. Messages to the **user** are in the user's language.

## Kickoff

- **New chat:** send `kickoff-template.md` (next to this file). Fill in `{{GOAL}}` and `{{PROJECT}}` (repo name, stack, relevant files — short, no secrets).
- **Existing chat:** run `wait_read` with `BEFORE = assistantCount - 1` (from status) to read the last reply. Then ask the user:
  - `Forward the last reply to Claude Code (Recommended)`: route that reply (step 3)
  - `Send the rules first`: send `kickoff-template.md` with its first line replaced by `Claude Code is now connected to this chat.`

## Loop

1. **Send.** Run the `send` op. Handle the result:
   - `ok:true`: keep `before`.
   - `still_generating`: run `wait_read` first, then send again.
   - `value_mismatch`, `send_disabled` or `send_not_confirmed`: take a screenshot, retry once, then tell the user.
2. **Wait.** Run `wait_read` with `BEFORE = before`. Repeat while `status` is `generating` or `waiting` (each call waits ≤ 30 s). After 20 calls (~10 min), ask the user whether to keep waiting.
   - A very short reply that looks like a server error (`busy`, `try again`, `rate limit`, or the same in the UI language, e.g. `meşgul`, `服务器繁忙`): wait ~15 s (`computer` → `wait`), then resend the same message once. Still failing: tell the user.
   - The page says the chat is too long or the context limit is reached: tell the user, and offer a new chat that starts with a short summary.
3. **Route.** Send the full `text` to ROUTER and get the `ROUTE`.
4. **Act.**

| ROUTE | Do |
|---|---|
| `FORWARD` with `risk: high`, or `MODE = confirm` | `AskUserQuestion` showing the forward text: `Run it` / `Skip, tell the chat` / `Stop`. On skip, send `The user did not approve this step: <reason>. Suggest another way.` |
| `FORWARD` | Do the work in the repo exactly as forwarded, within `GOAL` (SAFETY rule 3). Then write a report (step 5). |
| `ASK_USER` | Ask the user the question. Send their answer as `The user's answer: …`. If instructions are pending in the ROUTE, they follow normal FORWARD rules after the answer. |
| `DONE` | Go to § Finish. |
| `NOTHING` | Send `Claude Code is waiting: give the next step under "Send to Claude Code:", or write <<DONE>> if the work is finished.`. Do this once at most; on a second NOTHING in a row, ask the user. |

5. **Report.** Fill `report-template.md`. That report is the next message. Max ~6000 characters: trim long outputs and keep the end of logs. No secrets (SAFETY rule 4).
6. **Progress line** to the user, once per round, for example *"Round 3/10 · Chat: simplify utils → done, tests ✅"*. Then `round++`. If `round > MAX_ROUNDS`, ask: `5 more rounds` / `Stop`.

## Finish

- Summarize to the user: number of rounds, files changed, test status, open items, and the chat URL (from status `url`).
- Leave the chat tab open. The ROUTER stays idle; no cleanup is needed.
