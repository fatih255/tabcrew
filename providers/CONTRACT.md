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
| `send` | `{ok:true, len, url}` or `{ok:false, err:'no_textarea'│'still_generating'│'value_mismatch'│'send_disabled'│'send_not_confirmed'}`, or `{ok:false, err:'too_long', max}` when the site has a known input limit (`max` characters) and the message is longer |
| `wait_read` | `{status:'done', len, enc:'pct3', chunks:[…], source:'copy'│'markdown'│'innerText', secs}` (optionally `canvas:true` when part of the reply went to a side panel the adapter cannot read) or `{status:'generating'│'waiting', partialLen}` or `{status:'error', err:'no_send_in_this_page'}`, or `{status:'error', err:'rejected', note}` when the site refused the message (`note` is the site's notice, e.g. "Content is too long") |
| `toggle` | `{ok, name, on}` or `{ok:false, err:'toggle_not_found'}` |

**No size limit.** The browser tool truncates any single returned string at about 1000 characters, so `wait_read` returns the whole reply as `chunks` (strings of at most 900 characters). Chunks are cut by Unicode code points (never inside an emoji), and `len` counts code points.

The browser tool also hides any string that looks like cookie or query-string data (`x=1&y=2`, `a=b; c=d`) behind `[BLOCKED: Cookie/query string data]`, which code replies trigger often. So the chunks are `pct3`-encoded: `%`→`%25`, `&`→`%26`, `;`→`%3B`. **Decode with the helper**, never by hand: save the result JSON to a file and run

```
python -I tools/join_reply.py <result.json> <reply.md>
```

It joins, decodes, checks `len`, and writes the exact reply text. The full text also stays in `window.__tabpair.lastText`.

`text` must be the assistant's **final answer only**, never its hidden reasoning or "thinking" section. Return markdown if possible. Use `copy` when the chat's own Copy button can be captured with a synthetic click, or `markdown` when the adapter converts the rendered DOM itself. Use `innerText` only as a fallback.

Ops run in background tabs too: several seats can generate at the same time, and the orchestrator polls them one by one. An op must never depend on its tab being focused, on hover, or on a trusted (real) mouse click.

**The sent message may render differently from the text sent** (ChatGPT turns a leading code fence into a code block, so the fence line is not in the bubble). `send` stores two heads, `head` (normalized text without fence lines and link targets) and `head2` (the raw normalized text), confirms the send when a new user message starts with either, and as a last resort adopts the text of the only new user message after ~2 s. `wait_read` matches either head.

**Never find replies by counting messages.** Chat UIs virtualize long threads (DeepSeek removes old messages from the DOM), so counts stop growing. `send` must remember *which* message it sent (mark the existing messages, store the text head on `window`), and `wait_read('after_send')` must return the first reply that comes after that exact user message. Re-sending identical text must still return the new reply.
