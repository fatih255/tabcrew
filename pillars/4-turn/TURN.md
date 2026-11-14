# Pillar 4 — Turn (the exchange primitive)

Every workflow is built from **turns**. A turn = send one message to one seat → wait for its reply → route it.

## turn(seat, message) → ROUTE

1. **Send.** Write the message to a temp file in your scratchpad. Build the op with `python -I tools/fill_op.py providers/<provider>/send.js --msg-file <file>`, and run its output in `seat.tab`. Handle the result:
   - `ok:true`: go on.
   - `still_generating`: run `wait_read` with `'last'` until it is done, then send again.
   - `value_mismatch`, `send_disabled` or `send_not_confirmed`: take a screenshot. If the chat refuses the length (a "message too long" notice, or the send button stays disabled), split the message (see below). Otherwise retry once, then tell the user.
2. **Wait.** Run `wait_read` with `MODE = 'after_send'`. If it returns `no_send_in_this_page` (the tab was reloaded), use `'last'`. Repeat while `status` is `generating` or `waiting` (each call waits ≤ 30 s). After 20 calls (~10 min), ask the user whether to keep waiting.
   - **Join `chunks` in order** → `text`. The joined length must equal `len`. Save `text` to a file (`<scratchpad>/seat-<id>-round-<N>.md`): relays and memory read it from there, so nothing is retyped.
   - A very short reply that looks like a server error (`busy`, `try again`, `rate limit`, `something went wrong`, or the same in the UI language, e.g. `meşgul`, `服务器繁忙`): wait ~15 s (`computer` → `wait`), then resend the same message once. Still failing: tell the user.
   - The page says the chat is too long or the context limit is reached: tell the user and offer a new chat for that seat that starts with a handoff summary (`pillars/6-memory`).
3. **Route.** Send `text` to the seat's agent (`pillars/3-routing`). Return the `ROUTE`.

## No size limits

Send content as it is, with no trimming. Read replies completely (chunks). Only when a chat site itself rejects a long message, split it into parts of about 8000 characters:

```
[Part 1/3] Do not answer yet; reply only "OK".
<part text>
```

The last part ends with `[Part 3/3] This was the last part. Now answer the whole message.` Wait for each "OK" with `wait_read` before sending the next part.

## Relaying between seats

Relay the **original chat text** from the saved file, not the router's copy. The router decides *what* goes (the whole reply, or which section). If it is a section, cut that section out of the saved file with a short script (python), then build `send` from the result with `fill_op.py`.

## Parallel turns (several seats at once)

Chats generate in parallel; only *your* tool calls are sequential.

1. Run `send` in every seat's tab first, one after another. Use one `browser_batch` if you can.
2. Then poll them round-robin. Run `wait_read('after_send')` on each seat that is not done yet, until all are done.
3. Send each finished reply to its own seat agent. They route in parallel.

Tested: a DeepSeek tab and a ChatGPT tab generated at the same time; both replies were read correctly.

## Messages to chats

- Write them in English (templates in `pillars/5-workflows/templates/`), unless the user asks for another language.
- No secrets (SAFETY rule 4).

## Progress line to the user

One line per turn or per parallel round, in the user's language. Use the seats' display names. For example: *"Round 2/10 · 🟣🐋 Skeptic → 🔵🤖 Architect: objection relayed"* or *"Round 1 · 🟢🐋 Scout ✅ 🟠🤖 Scout ✅ findings received"*.
