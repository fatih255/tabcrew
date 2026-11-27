# Pillar 4 — Turn (the exchange primitive)

Every workflow is built from **turns**. A turn = send one message to one seat → wait for its reply → route it.

## turn(seat, message) → ROUTE

0. **Context check (always think about it, add only when it helps).** A chat sees nothing but its own conversation: not the repo, not the other seats, not your memory files. Before every message, ask yourself:
   - What does this seat need to answer *well* that it does not have yet? Typical cases: the code it is asking about, an error or test output, a file's current state after your edits, another seat's finding, a decision from `.tabcrew/` memory, the user's answer.
   - What does it already have? Do not resend what is in its chat already, and do not paste whole files when 20 relevant lines do the job.
   - Did its last reply rest on a wrong assumption about the project? If yes, correct it with the facts.

   If something is needed, add a short `Context:` block to the message with exactly those parts (excerpts with file names and line numbers, trimmed logs). Say what you left out, so the chat can ask for it ("Full file available on request."). If nothing is needed, send the message as it is. Never include secrets (SAFETY rule 4). The seat agent's `context_request` line (see `src/pillars/3-routing`) is a strong hint for this step.
1. **Send.** Write the message to a temp file in `SCRATCH` (see step 2) (the Write tool; any line endings work) and send it with `chat_send {tabId: seat.tab, path: "<that file>"}` (the server reads the file exactly; never retype long text into `text`). Handle the result:
   - `ok:true`: go on.
   - `too_long` (the site's input limit is `max` characters): split the message (see below) into parts that each fit in `max` with room for the part header, and send them in order.
   - `still_generating`: run `chat_read {mode: "last"}` until it is done, then send again.
   - `site_error` (the site showed an error instead of taking the message, e.g. Gemini's "Something went wrong"): handle it like `site_error` in step 2.
   - `value_mismatch`, `send_disabled` or `send_not_confirmed`: take a screenshot. If the chat refuses the length (a "message too long" notice, or the send button stays disabled), split the message (see below). Otherwise retry once, then tell the user.
2. **Wait and read.** `chat_read {tabId: seat.tab, path: `<SCRATCH>/seat-<id>-round-<N>.md`}`. `SCRATCH` is this session's own folder, `<scratchpad>/tc-<SESSION>/` (`SESSION` = the start time with seconds plus 4 random letters, chosen once per session, e.g. `160412-kqzv`). Other tabcrew runs may share the scratchpad, so **every** temp file of this session goes into `SCRATCH`: messages, replies, router prompts, topic and context files. It waits up to 90 s; with `path` the server writes the exact reply to that file and returns only its status (and the chat's current `url`, which a new Gemini chat gets only now). Relays, the seat agent and memory read the file, so nothing is retyped. Read the file yourself when you need the content. After a reload it reads the newest reply by itself. If it returns `rejected` or `site_error` (the site refused the message or failed to answer; `note` is the site's own text):
   - The `note` says the message is too long (in any language): split it (see below) into parts of about half the length and send them.
   - Anything else (rate limit, "Check network and retry", "Too many requests", no reply while the chat is idle): wait ~15 s, `navigate` the tab to the chat's own URL (a failed request can leave the chat unable to send until it reloads), run `chat_status`, then `chat_read {mode: "last"}`: if the chat did answer your message after all, use that reply. Otherwise send the same message once more. A second error: tell the user, with the `note`.

   - **The tab stops responding** (`chat_read`, `chat_status` or a screenshot fail with `Runtime.evaluate timed out`, and `navigate {force: true}` does not fix it): close that tab with `tabs_close_mcp`, open the seat's chat URL in a new tab (`tabs_create_mcp`, then `navigate`), set `seat.tab` to the new id, and run `chat_read {mode: "last"}`: the reply is usually there.

   Call it again while `status` is `generating` or `waiting`. After 7 calls (~10 min), ask the user whether to keep waiting.
   - `warn` in a `done` result (the reply did not match the page: code blocks or tables missing, or text lost) means the adapter may be out of date. Use the text, but tell the user once per session: *"<display name>: the reply may be incomplete (<warn>); the <Provider> page may have changed, see src/chrome-agent/extension/providers/<id>/PROVIDER.md"*. If `warn` has `coverage`, the adapter already fell back to the page's plain text.
   - A very short reply that looks like a server error (`busy`, `try again`, `rate limit`, `something went wrong`, `reached your limit`, `usage limit`, or the same in the UI language, e.g. `meşgul`, `服务器繁忙`): wait ~15 s (`computer` → `wait`), then resend the same message once. Still failing: tell the user.
   - `canvas:true`: part of the reply (usually the code) went to a side panel such as Gemini Canvas, and `text` has only the prose around it. Send at once: *"The bridge that reads your replies cannot see Canvas. Do not use Canvas. Paste the complete content from the Canvas into this chat as code blocks."* Then use that reply instead.
   - The page says the chat is too long or the context limit is reached: tell the user and offer a new chat for that seat that starts with a handoff summary (`src/pillars/6-memory`).
   - **Code, commands and file contents always come from the saved reply file**, never from the seat agent's copy: an agent may "clean up" escapes such as `\u0327` or quotes. Use the agent's route to know *which* part to act on, then cut that part out of the file (python) and use it as it is.
3. **Route.** A reply that is only `[[DONE]]` or `[[AGREED]]` (nothing else but whitespace) is routed by you: action `DONE`, empty forward. Every other reply: send the saved reply file to the seat's agent (`src/pillars/3-routing`): the agent reads the file itself, so you never paste or shorten the reply. Return the `ROUTE`. For a question (`ASK_USER`), who answers is decided by `QUESTIONS.md` (next to this file): in auto mode Claude Code answers most of them itself.

## No size limits

Send content as it is, with no trimming; replies come back complete. Only when a chat site itself rejects a long message (`too_long`, or a "message too long" notice), split it into parts of about 8000 characters (or `max` minus 200, whichever is smaller), cutting at line breaks:

```
[Part 1/3] Do not answer yet; reply only "OK".
<part text>
```

The last part ends with `[Part 3/3] This was the last part. Now answer the whole message.` Wait for each "OK" with `chat_read` before sending the next part. `python -I src/tools/split_message.py <message file> --max <max>` writes the parts with these headers and prints their paths in send order.

## Relaying between seats

Relay the **original chat text** from the saved file, not the router's copy. The router decides *what* goes (the whole reply, or which section). If it is a section, cut that section out of the saved file with a short script (python) into a new file, and `chat_send` that file with `path`.

## Parallel turns (several seats at once)

Chats generate in parallel; only *your* tool calls are sequential.

1. Run `chat_send` in every seat's tab first, one after another (one `browser_batch` call works too).
2. Then read them in turn: `chat_read {wait: 20}` on each seat that is not done yet, round-robin, until all are done.
3. Send each finished reply to its own seat agent. They route in parallel.

Tested: a DeepSeek tab and a ChatGPT tab generated at the same time; both replies were read correctly. So did a DeepSeek, a ChatGPT and a Gemini tab together.

## Generated images (when the goal needs pictures)

Some goals ask a chat to *make* images (icons, backgrounds, mockups). `chat_sites` says which sites can (`images: true`; today ChatGPT and Gemini). Saving needs no download dialog and no user click.

1. Send the image request with `chat_send` as usual. Then, instead of `chat_read`, call `chat_images` until `status: "done"`. `count: 0` means the chat answered in text (for example a refusal or a question): read it with `chat_read {mode: "last"}` and handle it like any reply.
2. For each image `i`: `chat_save_image {tabId, index: i, path: "<absolute folder>", name: "<file name>"}`. The folder is where the user wants the images (ask if unclear; otherwise a new folder in the project). The extension follows the image type, and an existing file is never overwritten. `source: "preview"` means only the preview size could be taken (Gemini); say so to the user.
3. Look at the saved files (open them) before you tell the user they are done. A chat that was asked for a transparent background does not always deliver one.

For a consistent style across many images, generate one style reference first and keep the rest in the same chat ("same style as the image above"). Several seats can generate in parallel (§ Parallel turns): give each the reference image as an attachment in its first message (§ Attach files), and save from each tab as its images finish.

## Attach files (images, documents)

When a message needs a file (a style reference image, a screenshot of a bug, a PDF), attach it before `chat_send`, in the seat's own tab:

1. `find {tabId, query: "hidden file input"}`. It lists the site's `type="file"` inputs, for example ChatGPT's `"Fotoğraf ekle" type="file" (hidden)` (labels follow the site's UI language). Take the one for images or files.
2. `file_upload {tabId, ref, paths: ["<absolute path>", …]}` (absolute paths on this computer; at most 10 MB per call).
3. Wait ~2 s for the site to show the attachment (a thumbnail in the input), then `chat_send` as usual.

Every attachment goes to the chat's website like the message itself: never attach secrets, `.env` files or private data (SAFETY rule 4).

## Messages to chats

- Write them in English (templates in `src/pillars/5-workflows/templates/`), unless the user asks for another language.
- No secrets (SAFETY rule 4).

## Progress line to the user

One line per turn or per parallel round, in the user's language. Use the seats' display names. For example: *"Round 2/10 · 🟣🐋 Skeptic → 🔵🤖 Architect: objection relayed"* or *"Round 1 · 🟢🐋 Scout ✅ 🟠🤖 Scout ✅ findings received"*.
