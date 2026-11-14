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
| Typing | put a DOM selection on the whole editor, wait 150 ms (ProseMirror syncs the selection), then dispatch a synthetic `paste` `ClipboardEvent` with a `DataTransfer` (`text/plain`). It replaces the content and keeps newlines, quotes, backticks and Unicode exactly. Without the wait, the paste is appended instead. |
| Send | `button[type=submit]` in the composer. It only exists while the editor has text. |
| Message unit | `[data-content-search-unit-key]`. The value ends in `:user` or `:assistant` (e.g. `fallback-turn-2:1:assistant`) |
| Turn + state | `[data-talvt-turn-state]` wraps one user + assistant pair. Its value is `complete` when the reply is finished; anything else means generating |
| Reply body | `[data-response-body]` inside the assistant unit (its `innerText` has no "ChatGPT said:" prefix) |
| Code blocks | `pre` **or** an element with `data-language` whose lines are `div`s. The language label is in the block header ("Python", "Bash") |
| Rendered markdown | mostly semantic HTML (`H2`, `UL/OL/LI`, `BLOCKQUOTE`, `A`, `STRONG`, `EM`, `CODE`, `TABLE`) with `data-d-component` (`text`, `title`, `divider`, `table`…) |
| Sent-message marker | `send` sets `data-tp-old` on all existing units and stores `window.__tabpair = {head}` |
| New chat | sending from `https://chatgpt.com/` changes the URL to `/c/local-chatgpt%3A<uuid>` first, then to `/c/<id>`. Read the final URL from `status` at the end |
| Logged out | no composer, or a visible "Log in" / "Sign up" button |

Class names are hashed or utility classes. Do not use them. ARIA labels are localized ("Gönder", "Durdur", "Kopyala"). Do not use them either.

## Why `source: 'markdown'`

ChatGPT's Copy button ignores synthetic clicks. It needs a trusted user gesture, which would require focusing the tab and breaks parallel seats. So `wait_read` converts the rendered reply to markdown itself. Code block text is read from the **live** DOM (`innerText`), because the lines are `div`s and a detached clone loses its newlines.

## Tested cases

- A multi-line message with `"` `'` `` ` `` `${x}` `\` and Turkish characters is inserted exactly (verified in the editor before sending).
- `status` on a new chat: `loggedIn:true`, `ready:true`.
- A reply with H2/H3, bold, italic, inline code, a link, a nested bullet list, a numbered list, a blockquote, a horizontal rule, a `bash` code block and a table converts to correct markdown.
- A reply with a `data-language="python"` code block and a table → a fenced `python` block and a markdown table.
- Sending identical text twice returned the two different new replies (no stale read).
- Parallel: a DeepSeek seat and a ChatGPT seat generated at the same time; both were read correctly.

## Quirks

- The reasoning-level / model picker is in the composer. Leave it as the user set it.
- If ChatGPT changes the UI: take a screenshot, find the signals in the table above again, update the `.js` files and this table, and set `tested:` to the new date.
