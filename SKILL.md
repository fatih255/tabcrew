---
name: tabcrew
description: Run the AI chats in the user's own local Chrome (DeepSeek, ChatGPT, Gemini; pluggable) as a crew of agents orchestrated by Claude Code via the tabcrew Chrome Agent extension — no copy-paste. Workflows - solo (one chat leads, Claude Code executes in the repo), debate (two chats discuss and converge, then hand the conclusion to Claude Code), fanout (several chats research subtopics in parallel, Claude Code synthesizes and acts). One named background agent per seat extracts, in any language, the part of each chat reply meant for Claude Code or for the other chat. Use when the user says "deepseek ile çalış", "chatgpt ile çalış", "gemini ile çalış", "chatgpt ile deepseek tartışsın", "iki chat açıp araştırsın", "tabcrew", "/tabcrew", "copy-paste between chat and Claude Code", or wants browser AI chats to work together with Claude Code.
---

# tabcrew

Browser AI chats become a crew of agents; Claude Code is the orchestrator.

```
                 ┌──── seat A: DeepSeek tab ────┐
Claude Code ◀──▶ │  (chat_send / chat_read)     │ ◀── each seat's agent decides: to Claude Code?
(orchestrator)   ├──── seat B: ChatGPT tab  ────┤      to the other seat? ask the user? done?
                 └──── seat N: …           ─────┘
```

Talk to the user **in the language they write in**, in short, plain sentences. All skill files are in English; translate the wording when you speak to the user.

## Tree

```
tabcrew/
├── SKILL.md                     ← orchestrator: flow + map (you are here)
├── README.md · CONTRIBUTING.md  ← for humans (users · contributors)
├── src/pillars/                 the crew: how Claude Code runs the chats
│   ├── 0-safety/SAFETY.md       hard rules (read first, always apply)
│   ├── 1-connection/            tabcrew Chrome Agent connection + local-Chrome-only preflight
│   ├── 2-crew/CREW.md           workflow + seats + mode questions; open tabs; verify logins
│   ├── 3-routing/               one named background agent per seat (+ router-prompt.md)
│   ├── 4-turn/                  TURN.md (one turn, parallel turns) · QUESTIONS.md (who answers a chat's question)
│   ├── 5-workflows/             solo.md · debate.md · fanout.md · templates/
│   └── 6-memory/MEMORY.md       dated project wiki in .tabcrew/ (read at start, write each round)
├── src/chrome-agent/            the browser: tabcrew Chrome Agent (extension + native host + MCP server; own README, installer, tests)
│   └── extension/providers/     one adapter per chat site (chatgpt, gemini, deepseek) + CONTRACT.md
└── src/tools/                   fill_template.py (fill templates) · split_message.py (split a too-long message) · chrome_agent.py (the MCP tools without the MCP loaded) · e2e.sh (smoke tests)
```

## Flow (read each file when you reach its step; paths are relative to this file's folder)

| Step | File | Output |
|---|---|---|
| 0 | `src/pillars/0-safety/SAFETY.md` | rules in mind |
| 1 | `src/pillars/1-connection/CONNECTION.md` | Chrome profile selected (or several profiles to probe) |
| 2 | `src/pillars/2-crew/CREW.md` | `WORKFLOW`, `SEATS[]` (each: id, provider, tab, url, role), `MODE`, `MAX_ROUNDS`, `GOAL`; tabs open, logins verified |
| 3 | `src/pillars/6-memory/MEMORY.md` § When to read | earlier sessions and chat handoffs as context; session file created |
| 4 | `src/pillars/3-routing/ROUTING.md` | one named seat agent per seat (emoji + color + persona) |
| 5 | `src/pillars/5-workflows/<WORKFLOW>.md` | the workflow; it uses `src/pillars/4-turn/TURN.md` for every exchange and appends to memory each round |
| 6 | the workflow's § Finish | memory written, summary to the user |

Chats are driven only through the `chat_*` tools (`chat_sites`, `chat_status`, `chat_send`, `chat_read`, `chat_images`, `chat_save_image`, `chat_toggle`). They detect the site from the tab's URL; pillars and workflows never contain site code or selectors. Pass long text by file (`chat_send {path}`, `chat_read {path}`), never by retyping it.

Load all tools in ONE ToolSearch call at the start (if they do not come back, `src/pillars/1-connection` uses `src/tools/chrome_agent.py`):

```
select:mcp__tabcrew-chrome__list_connected_browsers,mcp__tabcrew-chrome__select_browser,mcp__tabcrew-chrome__tabs_context_mcp,mcp__tabcrew-chrome__tabs_create_mcp,mcp__tabcrew-chrome__tabs_close_mcp,mcp__tabcrew-chrome__navigate,mcp__tabcrew-chrome__computer,mcp__tabcrew-chrome__find,mcp__tabcrew-chrome__file_upload,mcp__tabcrew-chrome__browser_batch,mcp__tabcrew-chrome__chat_sites,mcp__tabcrew-chrome__chat_status,mcp__tabcrew-chrome__chat_send,mcp__tabcrew-chrome__chat_read,mcp__tabcrew-chrome__chat_images,mcp__tabcrew-chrome__chat_save_image,mcp__tabcrew-chrome__chat_toggle,SendMessage
```

Browser tool names in the pillars have no prefix: `navigate` means `mcp__tabcrew-chrome__navigate`.

**Skill args** (optional; each one skips its question):

```
workflow=solo|debate|fanout
seats=deepseek,chatgpt            providers in seat order; "provider:<chat url>" attaches an existing chat
mode=auto|confirm   rounds=10 (0 or unlimited = until the task is done)   goal="..."   topics="subtopic 1|subtopic 2"   (fanout)
```

**Stop anytime** when the user asks to stop (in any language, e.g. "stop", "dur").
