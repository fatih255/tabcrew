# Provider contract

Every provider is a folder `providers/<id>/`:

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

## How to run an op

**Install once, then call (use this).** A full op is 3–11 KB; sending it on every poll costs many tokens and invites copy mistakes. Instead, install all of a provider's ops in the tab once, then send short calls:

```
python -I tools/fill_op.py --install providers/<id>                          # only when a call says not_installed
python -I tools/fill_op.py providers/<id>/send.js --msg-file <file> --call    # ~130 characters + the message
python -I tools/fill_op.py providers/<id>/wait_read.js --mode after_send --call
python -I tools/fill_op.py providers/<id>/status.js --call
```

Run each output with `javascript_tool` unchanged. The installer defines `window.__tc` (with a version of the op files) and also caches it in that site's `localStorage` (key `__tc_src_<provider>_<version>`, 8–17 KB; older versions are removed). A call reinstalls from that cache by itself when the page lost `window.__tc` (a reload, a navigation, a new tab of the same site), so the installer is needed only the first time on a browser and after an adapter update. A call returns `{ok:false, status:'error', err:'not_installed'}` when there is neither: run the installer, then the same call again.

The chat pages block requests to `localhost` (CSP `connect-src`; checked on all three sites), so a local helper process cannot load the ops or receive replies through `fetch`; the `localStorage` cache is the layer that works. Top-level navigation is the way out, because `connect-src` does not cover it: ChatGPT sets no `form-action`, so its `save_image` posts a form, and Gemini (which does restrict `form-action`) navigates with the data in the URL. Both hand a generated image to `tools/save_server.py` (see § Generated images). Everything below about placeholders and results applies to both forms.

**Full op (fallback).**

1. Read the `.js` file.
2. Replace the placeholder on its **first line** only:
   - `__MSG__` → the message as a **JSON string literal**, quotes included. For example `"Merhaba\n\"x\""`. Escape `\`, `"` and newlines exactly as `JSON.stringify` does.
   - `__MODE__` → `'after_send'` (the reply to the message the last `send` in this page sent) or `'last'` (the newest reply already in the chat — use it when attaching to an existing chat).
   - `__NAME__` → a regex literal (`/Derin|DeepThink/i`). `__ON__` → `true` or `false`.
   - `__SAVE__` → a JSON object `{"url": "<save url>", "file": "<name>", "i": 0, "mode": "last"}` (`fill_op.py … save_image.js --url … --file … --index 0`).
3. Run it with `javascript_tool` (`action: javascript_exec`, `tabId: TAB`). Run the code exactly as written.

**Recommended for every `send`:** write the message to a temp file (in your scratchpad), then let the helper do the escaping. Always use it when the message is long, or contains backslashes, `\uXXXX` sequences, or text relayed from another chat:

```
python -I tools/fill_op.py providers/<id>/send.js --msg-file <file>      # prints ready-to-run JS
python -I tools/fill_op.py providers/<id>/wait_read.js --mode after_send
```

Pass its output to `javascript_tool` unchanged. It is pure ASCII (non-ASCII characters are `\uXXXX`-escaped), so copying it cannot corrupt anything. When relaying between seats, write the **chat's own text** from `wait_read` to the file (the router's forward text only tells you *which part*).

Rules every op must follow:
- The whole op is one `await (async()=>{...})()` expression. A non-awaited async IIFE returns `{}`.
- It finishes in **< 30 s**. The CDP limit is 45 s; longer calls fail with `Runtime.evaluate timed out`.
- It never opens dialogs or navigates away. The one exception is `save_image`, which posts a form and comes back to the same chat (see § Generated images).

## Return shapes (same for all providers)

| Op | Returns |
|---|---|
| `status` | `{url, title, loggedIn, ready, generating, assistantCount, messages, toggles:[{name,on}]}` |
| `send` | `{ok:true, len, url}` or `{ok:false, err:'no_textarea'│'still_generating'│'value_mismatch'│'send_disabled'│'send_not_confirmed'}`, or `{ok:false, err:'site_error', note}` when the site rejected the message with an error notice, or `{ok:false, err:'too_long', max}` when the site has a known input limit (`max` characters) and the message is longer |
| `wait_read` | `{status:'done', len, h, enc:'pct3', chunks:[…], source:'copy'│'markdown'│'innerText', secs}` (optionally `canvas:true` when part of the reply went to a side panel the adapter cannot read) or `{status:'generating'│'waiting', partialLen}` or `{status:'error', err:'no_send_in_this_page'}`, or `{status:'error', err:'rejected'│'site_error', note}` when the site refused the message or showed an error instead of a reply (`note` is the site's own text, e.g. "Content is too long", "Too many requests", or `no reply and the chat is idle`). A `done` result may carry `warn:[…]` (see below) |
| `toggle` | `{ok, name, on}` or `{ok:false, err:'toggle_not_found'}` |
| `images` | `{status:'done', count, images:[{i, w, h}], secs}` (`count: 0` for a text-only reply) or `{status:'generating'│'waiting'}` or `{status:'error', err:'no_send_in_this_page'│'no_user_message'}` |
| `save_image` | `{ok:true, file, bytes, type, w, h, note}` (the page then reloads once; Gemini adds `part`, `parts`, `more` and `source:'full'│'preview'`: call again while `more` is true) or `{ok:false, err:'bad_url'│'bad_file'│'still_generating'│'no_send_in_this_page'│'no_user_message'│'no_image'│'fetch_failed'│'not_an_image'}` |

**No size limit.** The browser tool truncates any single returned string at about 1000 characters, so `wait_read` returns the whole reply as `chunks` (strings of at most 900 characters). Chunks are cut by Unicode code points (never inside an emoji), and `len` counts code points.

The browser tool also hides any string that looks like cookie or query-string data (`x=1&y=2`, `a=b; c=d`) behind `[BLOCKED: Cookie/query string data]`, which code replies trigger often. So the chunks are `pct3`-encoded: `%`→`%25`, `&`→`%26`, `;`→`%3B`. **Decode with the helper**, never by hand: save the result JSON to a file and run

```
python -I tools/join_reply.py <result.json> <reply.md>
```

It joins, decodes, checks `len` and the content hash `h` (FNV-1a over the UTF-16 code units of the text, so a character changed while you copied the result is caught even when the length matches), and writes the exact reply text. The full text also stays in `window.__tabpair.lastText`.

`text` must be the assistant's **final answer only**, never its hidden reasoning or "thinking" section. Return markdown if possible. Use `copy` when the chat's own Copy button can be captured with a synthetic click, or `markdown` when the adapter converts the rendered DOM itself. Use `innerText` only as a fallback.

Ops run in background tabs too: several seats can generate at the same time, and the orchestrator polls them one by one. An op must never depend on its tab being focused, on hover, or on a trusted (real) mouse click.

**The sent message may render differently from the text sent** (ChatGPT turns a leading code fence into a code block, so the fence line is not in the bubble). `send` stores two heads, `head` (normalized text without fence lines and link targets) and `head2` (the raw normalized text), confirms the send when a new user message starts with either, and as a last resort adopts the text of the only new user message after ~2 s. `wait_read` matches either head.

**Check the reply against the page (`warn`).** Before returning `done`, `wait_read` compares its text with the reply on the page, without relying on the site's class names: the number of block code areas (elements with `white-space: pre`) against the number of fenced code blocks in the text, the number of `<table>`s against markdown table separators, and the share of the page's words that made it into the text (below 80 % → fall back to the page's plain text). Inline code does not count (anything with an `inline*` display, and non-`pre` elements without a line break). Any mismatch goes into `warn` (e.g. `["code_blocks 0/2"]`). Some content cannot be checked this way: ChatGPT's code viewer keeps only the visible lines in the page, so its adapter reads the editor state and reports `code_viewer` when it cannot. A site redesign then shows up as a warning instead of a silently wrong reply.

**Detect site errors instead of waiting forever.** When the sent message has no reply, `wait_read` looks for the site's own error UI and returns `site_error` with its text: an ARIA `role=alert` after the message (ChatGPT "Too many requests"), a notice under the message (DeepSeek "Check network and retry."), a Material snack bar (Gemini "Something went wrong"), or the chat sitting idle with no reply (ChatGPT 45 s with a status line or 120 s, Gemini 90 s, DeepSeek 20 s). These were found by failing the site's own chat request inside the page (a fake 429, a 404, and an unreachable address).

**Never find replies by counting messages.** Chat UIs virtualize long threads (DeepSeek removes old messages from the DOM), so counts stop growing. `send` must remember *which* message it sent (mark the existing messages, store the text head on `window`), and `wait_read('after_send')` must return the first reply that comes after that exact user message. Re-sending identical text must still return the new reply.

## Generated images (optional ops)

A provider whose chat can generate images may add `images.js` and `save_image.js`. ChatGPT and Gemini have them.

- `images(mode)` lists the generated images in one reply: `'after_send'` (the reply to this page's last `send`) or `'last'` (the newest user message and what follows it). An image counts when it is at least 256 px wide, is not inside a user message (attached reference images), and sits between that user message and the next one. Like `wait_read`, it waits at most 30 s: call it again while it says `generating`. While the site is still drawing, it reports no image, so a half-drawn preview is never saved.
- `save_image({url, file, i, mode})` saves image `i` of that reply into the folder of a running `tools/save_server.py`, with no browser download dialog. The pages' CSP blocks `fetch` to localhost, so the image leaves by top-level navigation, and the server answers `303` back to the chat. The tab therefore reloads: `window.__tc` comes back from the `localStorage` cache on the next call, `window.__tabpair` does not, so use mode `'last'` after a save. The file extension follows the image's real type (`png`, `jpg`, `webp`).
  - ChatGPT (no `form-action` in its CSP): one hidden multipart form post, any size.
  - Gemini (`form-action` excludes localhost): a GET navigation with the image as base64url in the URL. Chrome allows about 2 MB per URL, so the op sends parts of 1.4 MB, keeps the rest in this site's IndexedDB (`tabcrew_save`, deleted after the last part) and returns `more:true` until the last part is out. Gemini shows only a preview (about 1024 px) in the chat; the op takes the full-size file from Gemini's own download flow (it clicks the download button, takes the image bytes from that flow's `fetch` and makes that fetch fail for the page, so no download starts; Gemini then shows its own "Couldn't download image" notice, which the reload clears). If that ever fails it falls back to the copy button (preview size, `source:'preview'`), intercepting the clipboard write so the user's clipboard is not touched.
- `tools/save_server.py` binds `127.0.0.1` only, accepts uploads only on a random token path printed in its ready line, saves only real PNG/JPEG/WebP data under safe names (never overwriting: `name-2.png`, …), joins GET parts in memory (at most 4 unfinished files, dropped after 10 minutes), and redirects only back to the chat origins it was given (default ChatGPT and Gemini). Tests: `python -I tools/test_save_server.py -v`.

How a provider adds them: find where the site puts a finished generated image (and how it shows one that is still being drawn), check the site's CSP: without `form-action`, copy ChatGPT's form post; with it, copy Gemini's GET parts. Never click a button that saves a file unless the op intercepts the step that would start the download, and check the browser's download folder while testing.
