# Pillar 4 — Turn (the exchange primitive)

Every workflow is built from **turns**. A turn = send one message to one seat → wait for its reply → route it.

## turn(seat, message) → ROUTE

0. **Context check (always think about it, add only when it helps).** A chat sees nothing but its own conversation: not the repo, not the other seats, not your memory files. Before every message, ask yourself:
   - What does this seat need to answer *well* that it does not have yet? Typical cases: the code it is asking about, an error or test output, a file's current state after your edits, another seat's finding, a decision from `.tabcrew/` memory, the user's answer.
   - What does it already have? Do not resend what is in its chat already, and do not paste whole files when 20 relevant lines do the job.
   - Did its last reply rest on a wrong assumption about the project? If yes, correct it with the facts.

   If something is needed, add a short `Context:` block to the message with exactly those parts (excerpts with file names and line numbers, trimmed logs). Say what you left out, so the chat can ask for it ("Full file available on request."). If nothing is needed, send the message as it is. Never include secrets (SAFETY rule 4). The seat agent's `context_request` line (see `pillars/3-routing`) is a strong hint for this step.
1. **Send.** Write the message to a temp file in your scratchpad. Build the call with `python -I tools/fill_op.py providers/<provider>/send.js --msg-file <file> --call` and run its output in `seat.tab` (if a call returns `not_installed`, run the provider's installer once and repeat the call; see `providers/CONTRACT.md`). Handle the result:
   - `ok:true`: go on.
   - `too_long` (the site's input limit is `max` characters): split the message (see below) into parts that each fit in `max` with room for the part header, and send them in order.
   - `still_generating`: run `wait_read` with `'last'` until it is done, then send again.
   - `site_error` (the site showed an error instead of taking the message, e.g. Gemini's "Something went wrong"): handle it like `site_error` in step 2.
   - `value_mismatch`, `send_disabled` or `send_not_confirmed`: take a screenshot. If the chat refuses the length (a "message too long" notice, or the send button stays disabled), split the message (see below). Otherwise retry once, then tell the user.
2. **Wait.** Run `wait_read` with `MODE = 'after_send'` (`fill_op.py … wait_read.js --mode after_send --call`). If it returns `no_send_in_this_page` (the tab was reloaded), use `'last'`. If it returns `rejected` or `site_error` (the site refused the message or failed to answer; `note` is the site's own text):
   - The `note` says the message is too long (in any language): split it (see below) into parts of about half the length and send them.
   - Anything else (rate limit, "Check network and retry", "Too many requests", no reply while the chat is idle): wait ~15 s, `navigate` the tab to the chat's own URL (a failed request can leave the chat unable to send until it reloads), run `status`, then `wait_read('last')`: if the chat did answer your message after all, use that reply. Otherwise send the same message once more. A second error: tell the user, with the `note`.

   Repeat while `status` is `generating` or `waiting` (each call waits ≤ 30 s). After 20 calls (~10 min), ask the user whether to keep waiting.
   - `warn` in a `done` result (the reply did not match the page: code blocks or tables missing, or text lost) means the adapter may be out of date. Use the text, but tell the user once per session: *"<display name>: the reply may be incomplete (<warn>); the <Provider> page may have changed, see providers/<id>/PROVIDER.md"*. If `warn` has `coverage`, the adapter already fell back to the page's plain text.
   - Save the `done` result (the JSON with `len`, `enc`, `chunks`) to `<scratchpad>/tc-<SESSION>-seat-<id>-round-<N>.json` (`SESSION` = the start time with seconds plus 4 random letters, chosen once per session, e.g. `160412-kqzv`; other tabcrew runs may share the folder and start in the same minute) and run `python -I tools/join_reply.py <that file> <scratchpad>/tc-<SESSION>-seat-<id>-round-<N>.md`. The `.md` file is the exact reply `text` (decoded, length-checked). Relays and memory read it from there, so nothing is retyped. Copy the result into the file exactly, with the Write tool (a shell heredoc or `echo` can drop backslashes); the helper checks its length and content hash. If it reports `[BLOCKED`, a length mismatch or a hash mismatch, run `wait_read('last')` again and save that result.
   - A very short reply that looks like a server error (`busy`, `try again`, `rate limit`, `something went wrong`, `reached your limit`, `usage limit`, or the same in the UI language, e.g. `meşgul`, `服务器繁忙`): wait ~15 s (`computer` → `wait`), then resend the same message once. Still failing: tell the user.
   - `canvas:true`: part of the reply (usually the code) went to a side panel such as Gemini Canvas, and `text` has only the prose around it. Send at once: *"The bridge that reads your replies cannot see Canvas. Do not use Canvas. Paste the complete content from the Canvas into this chat as code blocks."* Then use that reply instead.
   - The page says the chat is too long or the context limit is reached: tell the user and offer a new chat for that seat that starts with a handoff summary (`pillars/6-memory`).
3. **Route.** Send the saved reply file to the seat's agent (`pillars/3-routing`): the agent reads the file itself, so you never paste or shorten the reply. Return the `ROUTE`. For a question (`ASK_USER`), who answers is decided by `QUESTIONS.md` (next to this file): in auto mode Claude Code answers most of them itself.

## No size limits

Send content as it is, with no trimming. Read replies completely (chunks). Only when a chat site itself rejects a long message (`too_long`, or a "message too long" notice), split it into parts of about 8000 characters (or `max` minus 200, whichever is smaller), cutting at line breaks:

```
[Part 1/3] Do not answer yet; reply only "OK".
<part text>
```

The last part ends with `[Part 3/3] This was the last part. Now answer the whole message.` Wait for each "OK" with `wait_read` before sending the next part.

## Relaying between seats

Relay the **original chat text** from the saved file, not the router's copy. The router decides *what* goes (the whole reply, or which section). If it is a section, cut that section out of the saved file with a short script (python), then build `send` from the result with `fill_op.py`.

## Parallel turns (several seats at once)

Chats generate in parallel; only *your* tool calls are sequential.

1. Run `send` in every seat's tab first, one after another. Use one `mcp__claude-in-chrome__browser_batch` call if you can.
2. Then poll them round-robin. Run `wait_read('after_send')` on each seat that is not done yet, until all are done.
3. Send each finished reply to its own seat agent. They route in parallel.

Tested: a DeepSeek tab and a ChatGPT tab generated at the same time; both replies were read correctly. So did a DeepSeek, a ChatGPT and a Gemini tab together.

## Generated images (when the goal needs pictures)

Some goals ask a chat to *make* images (icons, backgrounds, mockups). Only providers with `images.js` and `save_image.js` can hand them over (today: ChatGPT; see `providers/CONTRACT.md` § Generated images). Saving needs no download dialog and no user click.

1. Once per session, start the receiver in the background (`run_in_background`) and read its first line for the url:
   `python -I -u tools/save_server.py --out <folder>` → `{"ready": true, "url": "http://127.0.0.1:<port>/save/<token>", …}`. The folder is where the user wants the images (ask if unclear; otherwise a new folder in the project). Each saved file is printed as `{"saved": "<file>", "bytes": n}`.
2. Send the image request with `send` as usual. Then, instead of `wait_read`, poll `images` (`fill_op.py … images.js --mode after_send --call`) until `status:'done'`. `count: 0` means the chat answered in text (for example a refusal or a question): read it with `wait_read('last')` and handle it like any reply.
3. For each image `i`, run `save_image` (`fill_op.py … save_image.js --url <url> --file <name> --index <i> --call`) and check the receiver's output for the `saved` line. The tab reloads once after each save. Wait about 5 s before the next call to that tab, and use mode `'last'` from then on (the reload forgets the last `send`).
4. Look at the saved files (open them) before you tell the user they are done. A chat that was asked for a transparent background does not always deliver one.
5. Stop the receiver when the session ends.

For a consistent style across many images, generate one style reference first and keep the rest in the same chat ("same style as the image above"). Several seats can generate in parallel (§ Parallel turns): give each the reference image as an attachment in its first message, and save from each tab as its images finish.

## Messages to chats

- Write them in English (templates in `pillars/5-workflows/templates/`), unless the user asks for another language.
- No secrets (SAFETY rule 4).

## Progress line to the user

One line per turn or per parallel round, in the user's language. Use the seats' display names. For example: *"Round 2/10 · 🟣🐋 Skeptic → 🔵🤖 Architect: objection relayed"* or *"Round 1 · 🟢🐋 Scout ✅ 🟠🤖 Scout ✅ findings received"*.
