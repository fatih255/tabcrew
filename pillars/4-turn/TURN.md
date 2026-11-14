# Pillar 4 — Turn (the exchange primitive)

Every workflow is built from **turns**. A turn = send one message to one seat → wait for its reply → route it.

## turn(seat, message) → ROUTE

1. **Send.** Run the seat provider's `send` op in `seat.tab`. Handle the result:
   - `ok:true`: go on.
   - `still_generating`: run `wait_read` with `'last'` until it is done, then send again.
   - `value_mismatch`, `send_disabled` or `send_not_confirmed`: take a screenshot, retry once, then tell the user.
2. **Wait.** Run `wait_read` with `MODE = 'after_send'`. If it returns `no_send_in_this_page` (the tab was reloaded), use `'last'`. Repeat while `status` is `generating` or `waiting` (each call waits ≤ 30 s). After 20 calls (~10 min), ask the user whether to keep waiting.
   - A very short reply that looks like a server error (`busy`, `try again`, `rate limit`, `something went wrong`, or the same in the UI language, e.g. `meşgul`, `服务器繁忙`): wait ~15 s (`computer` → `wait`), then resend the same message once. Still failing: tell the user.
   - The page says the chat is too long or the context limit is reached: tell the user and offer a new chat for that seat that starts with a short summary.
3. **Route.** Send `text` to the ROUTER with the seat's context (`pillars/3-routing`). Return the `ROUTE`.

## Parallel turns (several seats at once)

Chats generate in parallel; only *your* tool calls are sequential.

1. Run `send` in every seat's tab first, one after another. Use one `browser_batch` if you can.
2. Then poll them round-robin. Run `wait_read('after_send')` on each seat that is not done yet, until all are done. A finished seat keeps its `text`.
3. Route all replies in **one** SendMessage (`pillars/3-routing` § Each reply).

Tested: a DeepSeek tab and a ChatGPT tab generated at the same time; both replies were read correctly.

## Messages to chats

- Write them in English (templates in `pillars/5-workflows/templates/`), unless the user asks for another language.
- Max ~6000 characters per message. Trim long outputs and keep the end of logs.
- No secrets (SAFETY rule 4). When relaying between seats, pass only the chat text the router returned.

## Progress line to the user

One line per turn or per parallel round, in the user's language. For example: *"Round 2/10 · A (DeepSeek) → B (ChatGPT): relayed the proposal"* or *"Round 1 · A ✅ B ✅ findings received"*.
