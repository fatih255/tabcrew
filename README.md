# chat-pair

Connects Claude Code to a browser AI chat (DeepSeek now; ChatGPT etc. later), so you no longer copy-paste between them. Run it with `/chat-pair`, or just ask Claude Code to work together with your DeepSeek chat.

## Structure (pillars = domains)

```
chat-pair/
├── SKILL.md                      orchestrator: flow + map (entry point)
├── pillars/
│   ├── 1-connection/             local Chrome only; warns if not connected
│   ├── 2-session/                provider / URL / mode questions, login verify
│   ├── 3-routing/                parallel ROUTER agent + its prompt
│   ├── 4-relay/                  send → wait → route → act → report loop + templates
│   └── 5-safety/                 hard rules
└── providers/
    ├── CONTRACT.md               the interface every provider implements
    ├── deepseek/   (ready)       PROVIDER.md + status/send/wait_read/toggle .js
    └── chatgpt/    (planned)     PROVIDER.md stub
```

Each pillar owns one concern. Pillars talk to chats only through the provider ops in `CONTRACT.md`, so a new provider does not touch any pillar.

## Add a provider (example: ChatGPT)

1. Copy `providers/deepseek/` to `providers/<id>/`.
2. Open the chat in Chrome with Claude in Chrome. Find these again: input, send/stop button, generating signal, reply body (without the reasoning), copy button, toggles, logged-out signal.
3. Rewrite the 3–4 `.js` files. Keep the placeholders and the return shapes from `CONTRACT.md`.
4. Test live: a multi-line message with special characters, a long message (>5k characters), a reply with code and a table, attaching to an existing chat, and the reasoning/thinking mode.
5. Fill in the DOM map in `PROVIDER.md` and set `status: ready` and `tested: <date>`.
