```
id: deepseek
name: DeepSeek
status: ready
url_new: https://chat.deepseek.com/
url_pattern: ^https://chat\.deepseek\.com/(a/chat/s/[\w-]+)?/?$
tested: 2026-11-15, Turkish UI, Chrome on Windows
```

# DeepSeek adapter

## DOM map (tested)

| Thing | Selector / signal |
|---|---|
| Input | the only `textarea` (placeholder "DeepSeek'e mesaj gönder") |
| Send / stop button | `.ds-button--primary.ds-button--filled.ds-button--circle` |
| Idle | textarea empty → the button has `ds-button--disabled` |
| Generating | textarea empty **and** the button is NOT disabled (it shows a stop square) |
| Reply body | `.ds-assistant-message-main-content` (one per assistant reply) |
| Thinking ("Derin Düşünme") | separate sibling inside `.ds-message`. It is never included in `text` |
| Copy button | first `[role=button]` in the last child of the `.ds-message` parent (the action bar). It gives the exact markdown. `wait_read` captures it by temporarily overriding `navigator.clipboard.writeText`, so the user's clipboard is not touched |
| Toggles | `.ds-toggle-button`, selected = `ds-toggle-button--selected`. Labels: TR `Derin Düşünme`, `Akıllı Arama`; EN `DeepThink`, `Search` |
| New chat | sending from `https://chat.deepseek.com/` changes the URL to `/a/chat/s/<uuid>` |
| Logged out | no textarea, or the URL contains `sign_in` / `login` |

Hashed class names (`_63c77b1`, `d29f3d7d`…) change between builds. Do not use them.

## Tested cases

- A multi-line message with `"` `'` `` ` `` `${x}` `\` and Turkish characters arrives exactly as typed.
- A 6.7k-character message is sent and answered.
- An answer with a heading, a code block, a table and a list comes back as exact markdown via Copy (2759 characters).
- DeepThink on: `text` contains only the final answer, without the reasoning.
- Attaching to an existing chat URL: the history loads, and the roles and the assistant count are correct.

## Quirks

- Settings for the toggles persist per account. Only change them when the user asks.
- Error replies such as "Server busy, please try again later" (and the Turkish equivalent) are handled by `RELAY.md` step 2.
- If DeepSeek changes the UI: take a screenshot, find the signals in the table above again, update the `.js` files and this table, and set `tested:` to the new date.
