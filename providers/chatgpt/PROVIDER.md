```
id: chatgpt
name: ChatGPT
emoji: 🤖
status: ready
url_new: https://chatgpt.com/
url_pattern: ^https://chatgpt\.com/((g/[^/]+/)?c/[\w%:.-]+)?/?$
tested: 2026-11-15, Turkish UI, logged-in account, Chrome on Windows
```

# ChatGPT adapter

## DOM map (tested)

| Thing | Selector / signal |
|---|---|
| Composer | `form[data-chatgpt-composer]` |
| Input | `[contenteditable=true]` inside the composer (a ProseMirror editor, not a textarea) |
| Input limit | a paste longer than about 10,000 characters does not go into the editor: ChatGPT turns it into a "Pasted text" attachment and the editor stays empty. `send` returns `too_long` (`max: 9500`) for longer messages, and `pillars/4-turn` splits them |
| Typing | put a DOM selection on the whole editor, wait 150 ms (ProseMirror syncs the selection), then dispatch a synthetic `paste` `ClipboardEvent` with a `DataTransfer` (`text/plain`). It replaces the content and keeps newlines, quotes, backticks and Unicode exactly. Without the wait, the paste is appended instead. |
| Send | `button[type=submit]` in the composer. It only exists while the editor has text. |
| Message unit | `[data-content-search-unit-key]`. The value ends in `:user` or `:assistant` (e.g. `fallback-turn-2:1:assistant`) |
| Turn + state | `[data-talvt-turn-state]` wraps one user + assistant pair. Its value is `complete` when the reply is finished; anything else means generating |
| Reply body | `[data-response-body]` inside the assistant unit (its `innerText` has no "ChatGPT said:" prefix) |
| Code blocks | ChatGPT is rolling out a new renderer and uses both in one reply. New: a `[data-code-block]` root, the code in `[data-code-block-source]`, and the label in the header (`[data-markdown-copy=exclude]`; the first line, e.g. "Python", or a localized "Kod"/"Düz metin" for no language). Old (now often inside a `[data-code-block]` root): `pre` **or** an element with `data-language` whose lines are `div`s. The language label is in the block header ("Python", "Bash"). Blocks without a language get a localized label ("Düz metin" = plain text); anything that is not a plain identifier is dropped |
| Rendered markdown | mostly semantic HTML (`H2`, `UL/OL/LI`, `BLOCKQUOTE`, `A`, `STRONG`, `EM`, `CODE`, `TABLE`) with `data-d-component` (`text`, `title`, `divider`, `table`…) |
| Sent-message marker | `send` sets `data-tp-old` on all existing units and stores `window.__tabpair = {head}` |
| New chat | sending from `https://chatgpt.com/` changes the URL to `/c/local-chatgpt%3A<uuid>` first, then to `/c/<id>`. Read the final URL from `status` at the end |
| Logged out | no composer, or a visible "Log in" / "Sign up" button |

Class names are hashed or utility classes. Do not use them. ARIA labels are localized ("Gönder", "Durdur", "Kopyala"). Do not use them either.

## Why `source: 'markdown'`

ChatGPT's Copy button ignores synthetic clicks. It needs a trusted user gesture, which would require focusing the tab and breaks parallel seats. So `wait_read` converts the rendered reply to markdown itself. Code block text is read from the **live** DOM (`innerText`), because the lines are `div`s and a detached clone loses its newlines.

## Tested cases

- Site errors (2026-11-15, the chat request failed inside the page): a fake 429 shows a red `aside[role=alert]` "Too many requests" with a retry button after the user message → `wait_read` returns `site_error` in 3 s. A request that never reaches the server shows `[role=status]` "Bağlantı kesildi. Yanıtın tamamı bekleniyor" (connection lost) forever, with every turn `complete` → `site_error` after 45 s. Normal replies with code and tables: no false error, no `warn`.
- Consistency check: with the code block attributes removed from a reply (a stand-in for a redesign), `wait_read` returned `warn: ["code_blocks 0/2"]`.
- Logged out (incognito, Turkish UI): ChatGPT shows a different composer without `form[data-chatgpt-composer]` plus "Oturum aç" / "Ücretsiz kaydol" buttons; `status` returns `loggedIn:false`, `ready:false`.
- New renderer (2026-11-15): a reply with `python`, `bash`, `text` and `json` blocks (old and new styles mixed) and a block with no language converts to correct fenced blocks. Before the fix the no-language block came back as ``Düz metin`…` `` (found by an end-to-end run).
- Virtualized code viewer (2026-11-15): ChatGPT now renders code blocks in a scrollable CodeMirror editor (`[role=textbox][data-language]` inside `[data-code-block]`) that only keeps the visible lines in the DOM, so `innerText` returned the first ~20 lines and the reply looked cut off (three rounds in a row, found by an end-to-end run). `wait_read` now reads the whole document from the editor state (`<textbox>.cmTile.view.state.doc`, with `cmView` as a fallback) and uses `innerText` only when no editor is found. `qa` cannot see this (the page text is virtualized too), so `wait_read` adds `warn: ["code_viewer N"]` when it finds an editor (`[role=textbox]`) it cannot read. Checked live: an 80-line block had 36 lines in the DOM and all 80 came back; with the editor state hidden, the 36 lines came back with `code_viewer 1`.
- A message that starts with a code fence: ChatGPT renders it as a code block, so the bubble text does not start with the fence line. `send` now matches either the message without fence lines and link targets or the raw message, and falls back to the only new user message after 2 s. Before the fix `send` returned `send_not_confirmed` although the message was sent (found by an end-to-end run).

- A multi-line message with `"` `'` `` ` `` `${x}` `\` and Turkish characters is inserted exactly (verified in the editor before sending).
- `status` on a new chat: `loggedIn:true`, `ready:true`.
- A reply with H2/H3, bold, italic, inline code, a link, a nested bullet list, a numbered list, a blockquote, a horizontal rule, a `bash` code block and a table converts to correct markdown.
- A reply with a `data-language="python"` code block and a table → a fenced `python` block and a markdown table.
- Sending identical text twice returned the two different new replies (no stale read).
- Parallel: a DeepSeek seat and a ChatGPT seat generated at the same time; both were read correctly.
- A code reply containing `?q=1&page=2` and `sid=abc; path=/`: the raw string is blanked by the browser tool, the `pct3` chunks arrive intact.
- Input limit: pastes up to 9,813 characters stayed in the editor; 10,032 and more became a "Pasted text" attachment with an empty editor (binary search, 2026-11-15).
- End to end (fresh sessions): solo, debate vs DeepSeek, debate ChatGPT vs ChatGPT, fanout with two ChatGPT seats plus DeepSeek.

## Quirks

- The reasoning-level / model picker is in the composer. Leave it as the user set it.
- If ChatGPT changes the UI: take a screenshot, find the signals in the table above again, update the `.js` files and this table, and set `tested:` to the new date.
