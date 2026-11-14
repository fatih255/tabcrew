```
id: chatgpt
name: ChatGPT
status: planned
url_new: https://chatgpt.com/
url_pattern: ^https://chatgpt\.com/(c/[\w-]+)?/?$
tested: never
```

# ChatGPT adapter (planned)

Not implemented yet. To make it ready, follow `README.md` § Add a provider:
write `status.js`, `send.js`, `wait_read.js` (and optionally `toggle.js`) against `providers/CONTRACT.md`, test them live, fill a DOM map like `providers/deepseek/PROVIDER.md`, then set `status: ready`.

Until then, the session pillar shows this provider as "not ready yet".
