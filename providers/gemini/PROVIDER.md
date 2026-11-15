```
id: gemini
name: Gemini
emoji: ✨
status: ready
url_new: https://gemini.google.com/app
url_pattern: ^https://gemini\.google\.com/(u/\d+/)?app(/[\w-]+)?/?$
tested: 2026-11-15, English UI, logged-in Google account, Chrome on Windows
```

# Gemini adapter

## DOM map (tested)

| Thing | Selector / signal |
|---|---|
| Input | `rich-textarea [contenteditable=true]` (a Quill editor, `.ql-editor`) |
| Typing | the Quill instance on the editor: `ed.__quill.setText(MSG, 'user')` (32k characters in 0.1 s; indentation, tabs and blank lines are kept exactly). Fallback: select the whole editor and `document.execCommand('insertText', false, MSG)`, which is correct too but takes tens of seconds near the limit. A synthetic `paste` event does **not** work here (Quill ignores it) |
| Input limit | the editor keeps at most 32,000 characters and silently drops the rest. `send` returns `too_long` (`max: 32000`) for longer messages |
| Send | `gem-icon-button.send-button button` |
| Generating | the same `gem-icon-button.send-button` gets the class `stop`; or the newest `model-response` has no `.response-footer.complete`; or a `dual-model-response` is on screen. Right after sending, the new `model-response` does not exist yet, so the `stop` class is the only signal for a moment |
| Message units | `user-query` and `model-response` (custom elements; one pair per `.conversation-container`) |
| User text | `.query-text-line` paragraphs inside `user-query`. Its `innerText` starts with a hidden, localized "You said" label (`.cdk-visually-hidden`), so never use the whole `innerText` |
| Reply body | `message-content .markdown` inside `model-response`. Thinking is a separate `thinking-overlay` and is never in the body |
| Done | `.response-footer.complete` inside the `model-response` |
| Copy button | `copy-button button` inside the `model-response` (the code block copy buttons are `gem-copy-button`, a different element). A synthetic click calls `navigator.clipboard.write` with `text/plain` + `text/html`. `wait_read` captures it by temporarily overriding `write` and `writeText`, so the user's clipboard is not touched |
| A/B comparison | sometimes Gemini answers with a `dual-model-response` ("Which response is more helpful?", Choice A / Choice B) instead of a `model-response`. `wait_read` waits until both choices are done (`button.select-button` present, no `stop`), then clicks `button.close-button`. That keeps Choice A as a normal `model-response` and sends no preference. The result then has `dual: true` |
| Sent-message marker | `send` sets `data-tp-old` on all existing `user-query` and `model-response` elements and stores `window.__tabpair = {head}` |
| New chat | sending from `https://gemini.google.com/app` changes the URL to `/app/<hex id>` |
| Logged out | no editor, or a link to `accounts.google.com` sign-in |

Angular adds hashed attributes (`_ngcontent-…`, `ng-tns-c…`). Do not use them. ARIA labels are localized ("Send message", "Stop response", "Copy"). Do not use them either.

## Tested cases

- A multi-line message with `"` `'` `` ` `` `${x}` `\n` (literal) `\`, Turkish characters and an emoji is inserted exactly (checked through Quill's `getText()` and the sent bubble).
- A 5,630-character message from a new chat: sent in one call (insert took 0.4 s), URL changed to `/app/<id>`, answered.
- A reply with an H2, a `python` and a `bash` code block, a table and a link containing `?q=1&page=2` and `; y`: comes back as exact markdown via Copy; the `pct3` chunks arrive intact.
- An A/B comparison appeared on the second message of a chat: closed automatically, Choice A was read.
- Sending identical text twice returned the two different new replies (no stale read).
- Attaching to an existing chat URL after a full page load: `status` waits for the history, `wait_read('last')` returns the newest reply.
- Parallel: two Gemini tabs generated at the same time; both replies (1.6k and 1.9k characters, 2–3 chunks) were read correctly.
- **Logged out** (incognito, Turkish UI): Gemini still shows the editor (it allows chats without an account), so `ready:true`, but the `accounts.google.com/ServiceLogin` link makes `loggedIn:false`.
- **Long chat:** 11 exchanges in a row, then a full reload. Gemini put only the newest 10 pairs back in the DOM (older ones load on scroll), `wait_read('last')` still returned the newest reply, and sending identical text twice in that chat returned the two new replies.
- **Long replies:** 9.4k characters (11 chunks) in one call; 17k characters (19 chunks) took two `wait_read` calls (`generating`, then `done`). Joined chunks equal `lastText` exactly.
- **Input limit:** 30k and 31.9k characters sent and answered (312 lines intact, via `setText` in 1.1 s); 120k returns `too_long` at once. Before the limit check, a 120k `insertText` hung the tab past the 45 s CDP limit.
- **Indentation:** Python code with 4/8-space indents, a tab and two blank lines made the round trip unchanged.
- **Canvas:** asked for an app "with Canvas": the reply had an `immersive-entry-chip` and the copied text had no code. `wait_read` now returns `canvas:true`; the follow-up from `pillars/4-turn` made Gemini paste the full 10k-character file into the chat.
- **A/B comparison:** both paths checked with a synthetic `dual-model-response` placed after a real message: with a close button it waited for the reply to finish, closed the panel once and read the real reply; without one it read Choice A. Both returned `dual:true`. (A real comparison appeared once in earlier testing and was closed correctly.)
- End to end (fresh sessions, three run at the same time in one Chrome): solo Gemini, debate Gemini vs ChatGPT, debate DeepSeek vs Gemini, fanout DeepSeek + ChatGPT + Gemini, and a 6-round Gemini solo (4 rounds used, 51 tests). No adapter retries or workarounds in any transcript.

## Quirks

- Gemini's own Copy sometimes flattens nested bullet lists (sub-items lose their indent) and adds a blank line before a closing code fence. `wait_read` removes that blank line (only before closing fences); the list nesting can be lost.
- Gemini's Canvas (and other side panels) are not readable. The templates ask every chat to write in the chat itself; `canvas:true` covers the cases where Gemini uses it anyway.
- The mode picker ("Gemini Auto", "Fast", "Thinking"…) is in the composer. Leave it as the user set it. There is no `toggle.js`.
- If Gemini changes the UI: take a screenshot, find the signals in the table above again, update the `.js` files and this table, and set `tested:` to the new date.
