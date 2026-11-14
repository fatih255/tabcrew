---
name: chat-pair
description: Pair Claude Code with an AI web chat (DeepSeek now; ChatGPT etc. pluggable) running in the user's own local Chrome via Claude in Chrome — ends copy-paste between the chat and Claude Code. Asks for the provider and a chat URL (new or existing), verifies the local browser connection and login, then loops — Claude Code works in the repo and reports to the chat, a parallel router agent extracts the part of each chat reply meant for Claude Code (any language), Claude Code executes it. Use when the user says "deepseek ile çalış", "chatgpt ile çalış", "chat pair", "deepseek'e bağlan", "web chat ile beraber çalış", "kopyala yapıştır yapmayalım", "/chat-pair", or wants Claude Code to work together with a browser AI chat.
---

# Chat Pair

Claude Code ↔ browser AI chat bridge. The user stops copy-pasting.

```
Claude Code (works in repo) ──report──▶ Web chat tab (provider adapter)
        ▲                                        │ reply
        │ only the part meant for Claude Code    ▼
        └──────────── ROUTER agent (parallel, stays alive)
```

Talk to the user **in the language they write in**, in short, plain sentences. All skill files are in English; translate the wording when you speak to the user.

## Tree

```
chat-pair/
├── SKILL.md                 ← you are here: orchestrator (flow + pillar map)
├── README.md                ← for humans: structure, how to add a provider
├── pillars/
│   ├── 1-connection/CONNECTION.md   local-Chrome-only preflight
│   ├── 2-session/SESSION.md         provider + URL + mode questions, open tab, verify login
│   ├── 3-routing/ROUTING.md         parallel ROUTER agent (+ router-prompt.md)
│   ├── 4-relay/RELAY.md             the send → wait → route → act → report loop (+ templates)
│   └── 5-safety/SAFETY.md           hard rules (read first, always apply)
└── providers/
    ├── CONTRACT.md          adapter interface every provider implements
    ├── deepseek/            status: ready (tested)
    └── chatgpt/             status: planned (stub)
```

## Flow (read each pillar file when you reach its step — paths are relative to this file's folder)

| Step | Pillar | Output |
|---|---|---|
| 0 | `pillars/5-safety/SAFETY.md` — read first | rules in mind |
| 1 | `pillars/1-connection/CONNECTION.md` | local browser selected, own `TAB` |
| 2 | `pillars/2-session/SESSION.md` | `PROVIDER`, `URL`, `MODE`, `MAX_ROUNDS`, `GOAL`; chat open; login verified |
| 3 | `pillars/3-routing/ROUTING.md` | `ROUTER` agent id |
| 4 | `pillars/4-relay/RELAY.md` | the loop until DONE / max rounds / user stop |
| 5 | `RELAY.md` § Finish | summary to the user |

All browser actions go through the provider adapter: `providers/<PROVIDER>/PROVIDER.md` and its `.js` operations (`status`, `send`, `wait_read`, `toggle`), as defined in `providers/CONTRACT.md`. Pillars never hard-code provider selectors.

Load all tools in ONE ToolSearch call at the start:

```
select:mcp__claude-in-chrome__list_connected_browsers,mcp__claude-in-chrome__select_browser,mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__browser_batch,SendMessage
```

**Skill args** (optional, skip the matching questions): `provider=deepseek url=<chat url> mode=auto|confirm rounds=10 goal="..."`.

**Stop anytime** when the user asks to stop (in any language, e.g. "stop", "dur").
