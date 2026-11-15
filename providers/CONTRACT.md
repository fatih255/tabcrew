# Provider contract

Every provider is a folder `providers/<id>/`:

```
providers/<id>/
├── PROVIDER.md     front block (id, name, status, url_new, url_pattern, tested) + quirks
├── status.js       op: status
├── send.js         op: send       placeholder __MSG__
├── wait_read.js    op: wait_read  placeholder __MODE__
└── toggle.js       op: toggle     placeholders __NAME__, __ON__   (optional)
```

## How to run an op

**Install once, then call (use this).** A full op is 3–11 KB; sending it on every poll costs many tokens and invites copy mistakes. Instead, install all of a provider's ops in the tab once, then send short calls:

```
python -I tools/fill_op.py --install providers/<id>                          # only when a call says not_installed
python -I tools/fill_op.py providers/<id>/send.js --msg-file <file> --call    # ~130 characters + the message
python -I tools/fill_op.py providers/<id>/wait_read.js --mode after_send --call
python -I tools/fill_op.py providers/<id>/status.js --call
```

Run each output with `javascript_tool` unchanged. The installer defines `window.__tc` (with a version of the op files) and also caches it in that site's `localStorage` (key `__tc_src_<provider>_<version>`, 8–12 KB; older versions are removed). A call reinstalls from that cache by itself when the page lost `window.__tc` (a reload, a navigation, a new tab of the same site), so the installer is needed only the first time on a browser and after an adapter update. A call returns `{ok:false, status:'error', err:'not_installed'}` when there is neither: run the installer, then the same call again.

The chat pages block requests to `localhost` (CSP; checked on all three sites), so a local helper process cannot load the ops or save replies; the `localStorage` cache is the layer that works. Everything below about placeholders and results applies to both forms.

**Full op (fallback).**

1. Read the `.js` file.
2. Replace the placeholder on its **first line** only:
   - `__MSG__` → the message as a **JSON string literal**, quotes included. For example `"Merhaba\n\"x\""`. Escape `\`, `"` and newlines exactly as `JSON.stringify` does.
   - `__MODE__` → `'after_send'` (the reply to the message the last `send` in this page sent) or `'last'` (the newest reply already in the chat — use it when attaching to an existing chat).
   - `__NAME__` → a regex literal (`/Derin|DeepThink/i`). `__ON__` → `true` or `false`.
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
- It never opens dialogs or navigates away.

## Return shapes (same for all providers)

| Op | Returns |
|---|---|
| `status` | `{url, title, loggedIn, ready, generating, assistantCount, messages, toggles:[{name,on}]}` |
| `send` | `{ok:true, len, url}` or `{ok:false, err:'no_textarea'│'still_generating'│'value_mismatch'│'send_disabled'│'send_not_confirmed'}`, or `{ok:false, err:'site_error', note}` when the site rejected the message with an error notice, or `{ok:false, err:'too_long', max}` when the site has a known input limit (`max` characters) and the message is longer |
| `wait_read` | `{status:'done', len, h, enc:'pct3', chunks:[…], source:'copy'│'markdown'│'innerText', secs}` (optionally `canvas:true` when part of the reply went to a side panel the adapter cannot read) or `{status:'generating'│'waiting', partialLen}` or `{status:'error', err:'no_send_in_this_page'}`, or `{status:'error', err:'rejected'│'site_error', note}` when the site refused the message or showed an error instead of a reply (`note` is the site's own text, e.g. "Content is too long", "Too many requests", or `no reply and the chat is idle`). A `done` result may carry `warn:[…]` (see below) |
| `toggle` | `{ok, name, on}` or `{ok:false, err:'toggle_not_found'}` |

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
