# Provider contract

Every provider is a folder `providers/<id>/`:

```
providers/<id>/
├── PROVIDER.md     front block (id, name, status, url_new, url_pattern, tested) + quirks
├── status.js       op: status
├── send.js         op: send       placeholder __MSG__
├── wait_read.js    op: wait_read  placeholder __BEFORE__
└── toggle.js       op: toggle     placeholders __NAME__, __ON__   (optional)
```

## How to run an op

1. Read the `.js` file.
2. Replace the placeholder on its **first line** only:
   - `__MSG__` → the message as a **JSON string literal**, quotes included. For example `"Merhaba\n\"x\""`. Escape `\`, `"` and newlines exactly as `JSON.stringify` does.
   - `__BEFORE__` → a number.
   - `__NAME__` → a regex literal (`/Derin|DeepThink/i`). `__ON__` → `true` or `false`.
3. Run it with `javascript_tool` (`action: javascript_exec`, `tabId: TAB`). Run the code exactly as written.

Rules every op must follow:
- The whole op is one `await (async()=>{...})()` expression. A non-awaited async IIFE returns `{}`.
- It finishes in **< 30 s**. The CDP limit is 45 s; longer calls fail with `Runtime.evaluate timed out`.
- It never opens dialogs or navigates away.

## Return shapes (same for all providers)

| Op | Returns |
|---|---|
| `status` | `{url, title, loggedIn, ready, generating, assistantCount, messages, toggles:[{name,on}]}` |
| `send` | `{ok:true, before, len, url}` or `{ok:false, err:'no_textarea'│'still_generating'│'value_mismatch'│'send_disabled'│'send_not_confirmed'}` |
| `wait_read` | `{status:'done', text, source:'copy'│'innerText', count, secs}` or `{status:'generating'│'waiting', count, partialLen}` |
| `toggle` | `{ok, name, on}` or `{ok:false, err:'toggle_not_found'}` |

`text` must be the assistant's **final answer only**, never its hidden reasoning or "thinking" section. Use the exact markdown if possible.
