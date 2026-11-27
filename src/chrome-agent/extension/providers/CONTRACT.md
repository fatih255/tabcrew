# Provider contract

Every chat site is a folder `providers/<id>/`, listed in `providers/index.js`:

```
providers/<id>/
├── PROVIDER.md     front block (id, name, status, url_new, url_pattern, tested) + quirks
├── status.js       op: status
├── send.js         op: send       placeholder __MSG__
├── wait_read.js    op: wait_read  placeholder __MODE__
├── toggle.js       op: toggle     placeholders __NAME__, __ON__   (optional)
├── images.js       op: images     placeholder __MODE__            (optional: chats that generate images)
└── save_image.js   op: save_image placeholder __SAVE__            (optional, together with images.js)
```

## How an op runs

Agents never run ops themselves: they call the `chat_*` tools (`chat_status`, `chat_send`, `chat_read`, `chat_images`, `chat_save_image`, `chat_toggle`). The extension (`lib/chat.js`) picks the site from the tab's URL (`index.js`), reads the op file, replaces the placeholder on its **first line** with a JSON value, and evaluates it in the page over the DevTools protocol:

| Placeholder | Value |
|---|---|
| `__MSG__` | the message, a JSON string |
| `__MODE__` | `"after_send"` (the reply to the message the last `send` in this page sent) or `"last"` (the newest reply already in the chat) |
| `__NAME__`, `__ON__` | a case-insensitive `RegExp` for the toggle label, and `true` / `false` |
| `__SAVE__` | `{"i": <image index>, "mode": "after_send" \| "last"}` |

`chat_read` and `chat_images` call their op again while it reports `generating` / `waiting`, for up to `wait` seconds (at most 100). `chat_read` joins and checks the reply (below) and returns plain text; with a `path` the MCP server writes it to that file. `chat_save_image` returns the op's base64 data as a file, which the MCP server writes. `chat_send` with a `path` reads the message from a local file on the MCP server side.

To try an op by hand, run it with `javascript_tool` after replacing its placeholder yourself.

Rules every op must follow:
- The whole op is one `await (async()=>{...})()` expression.
- It finishes in **< 30 s** (the evaluation limit is 45 s).
- It never opens dialogs, never navigates, and never starts a download.

## Return shapes (same for all providers)

| Op | Returns |
|---|---|
| `status` | `{url, title, loggedIn, ready, generating, assistantCount, messages, toggles:[{name,on}]}` |
| `send` | `{ok:true, len, url}` or `{ok:false, err:'no_textarea'│'still_generating'│'value_mismatch'│'send_disabled'│'send_not_confirmed'}`, or `{ok:false, err:'site_error', note}` when the site rejected the message with an error notice, or `{ok:false, err:'too_long', max}` when the site has a known input limit (`max` characters) and the message is longer |
| `wait_read` | `{status:'done', len, h, enc:'pct3', chunks:[…], source:'copy'│'markdown'│'innerText', secs}` (optionally `canvas:true` when part of the reply went to a side panel the adapter cannot read) or `{status:'generating'│'waiting', partialLen}` or `{status:'error', err:'no_send_in_this_page'}`, or `{status:'error', err:'rejected'│'site_error', note}` when the site refused the message or showed an error instead of a reply (`note` is the site's own text, e.g. "Content is too long", "Too many requests", or `no reply and the chat is idle`). A `done` result may carry `warn:[…]` (see below) |
| `toggle` | `{ok, name, on}` or `{ok:false, err:'toggle_not_found'}` |
| `images` | `{status:'done', count, images:[{i, w, h}], secs}` (`count: 0` for a text-only reply) or `{status:'generating'│'waiting'}` or `{status:'error', err:'no_send_in_this_page'│'no_user_message'}` |
| `save_image` | `{ok:true, type, bytes, w, h, source:'full'│'preview', data}` (base64) or `{ok:false, err:'still_generating'│'no_send_in_this_page'│'no_user_message'│'no_image'│'fetch_failed'│'not_an_image'}` |

**Exact replies.** `wait_read` returns the reply as `chunks` (at most 900 code points each, never cut inside an emoji), `pct3`-encoded (`%`→`%25`, `&`→`%26`, `;`→`%3B`), with `len` (code points) and `h` (FNV-1a over the UTF-16 code units). `chat_read` joins and decodes them and checks `len` and `h`, so a reply is never silently cut or changed. (The chunking began as a workaround for browser tools that cut long strings and hid cookie-like text; it is kept as an integrity check.)

The full text also stays in `window.__tabpair.lastText`.

`text` must be the assistant's **final answer only**, never its hidden reasoning or "thinking" section. Return markdown if possible. Use `copy` when the chat's own Copy button can be captured with a synthetic click, or `markdown` when the adapter converts the rendered DOM itself. Use `innerText` only as a fallback.

Ops run in background tabs too: several seats can generate at the same time, and the orchestrator polls them one by one. An op must never depend on its tab being focused, on hover, or on a trusted (real) mouse click.

**The sent message may render differently from the text sent** (ChatGPT turns a leading code fence into a code block, so the fence line is not in the bubble). `send` stores two heads, `head` (normalized text without fence lines and link targets) and `head2` (the raw normalized text), confirms the send when a new user message starts with either, and as a last resort adopts the text of the only new user message after ~2 s. `wait_read` matches either head.

**Check the reply against the page (`warn`).** Before returning `done`, `wait_read` compares its text with the reply on the page, without relying on the site's class names: the number of block code areas (elements with `white-space: pre`) against the number of fenced code blocks in the text, the number of `<table>`s against markdown table separators, and the share of the page's words that made it into the text (below 80 % → fall back to the page's plain text). Inline code does not count (anything with an `inline*` display, and non-`pre` elements without a line break). Any mismatch goes into `warn` (e.g. `["code_blocks 0/2"]`). Some content cannot be checked this way: ChatGPT's code viewer keeps only the visible lines in the page, so its adapter reads the editor state and reports `code_viewer` when it cannot. A site redesign then shows up as a warning instead of a silently wrong reply.

**Detect site errors instead of waiting forever.** When the sent message has no reply, `wait_read` looks for the site's own error UI and returns `site_error` with its text: an ARIA `role=alert` after the message (ChatGPT "Too many requests"), a notice under the message (DeepSeek "Check network and retry."), a Material snack bar (Gemini "Something went wrong"), or the chat sitting idle with no reply (ChatGPT 45 s with a status line or 120 s, Gemini 90 s, DeepSeek 20 s). These were found by failing the site's own chat request inside the page (a fake 429, a 404, and an unreachable address).

**Never find replies by counting messages.** Chat UIs virtualize long threads (DeepSeek removes old messages from the DOM), so counts stop growing. `send` must remember *which* message it sent (mark the existing messages, store the text head on `window`), and `wait_read('after_send')` must return the first reply that comes after that exact user message. Re-sending identical text must still return the new reply.

## Generated images (optional ops)

A site whose chat can generate images may add `images.js` and `save_image.js` (ChatGPT and Gemini have them) and list them in `index.js`.

- `images(mode)` lists the generated images in one reply: `'after_send'` or `'last'`. An image counts when it is at least 256 px wide, is not inside a user message (attached reference images), and sits between that user message and the next one. While the site is still drawing, it reports no image, so a half-drawn preview is never saved. An entry with `size:'preview'` gives the on-page preview's size (Gemini); `save_image` still tries the full-size file and says which it got in `source`.
- `save_image({i, mode})` returns image `i` of that reply as `{ok:true, type, bytes, w, h, source, data}` (`data` = base64). The bytes come from inside the page (with the user's session): ChatGPT fetches the image URL; Gemini shows only a preview in the chat, so its op clicks Gemini's own download button, takes the full-size bytes from that flow's `fetch` and makes the fetch fail for the page, so no download starts (Gemini then shows its own "Couldn't download image" notice). If that fails it falls back to the copy button (preview size, `source:'preview'`), intercepting the clipboard write so the user's clipboard is not touched.
- Errors: `still_generating`, `no_send_in_this_page`, `no_user_message`, `no_image`, `fetch_failed`, `not_an_image`.

How a site adds them: find where it puts a finished generated image (and how it shows one that is still being drawn), then get the bytes inside the page. Never click a button that saves a file unless the op intercepts the step that would start the download, and check the browser's download folder while testing.
