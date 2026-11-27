# Pillar 1 — Connection (local Chrome only)

Goal: tabcrew Chrome Agent reaches a Chrome **on this computer**, and one Chrome profile is selected (or, with several profiles, the candidates are known; `src/pillars/2-crew` § 3a picks one). This runs automatically; involve the user only when something is wrong or the choice is really theirs. The seat tabs are created later in `src/pillars/2-crew`.

tabcrew drives Chrome through **tabcrew Chrome Agent** (folder `src/chrome-agent/` of this skill): an open-source Chrome extension, a native host and a local stdio MCP server (tools `mcp__tabcrew-chrome__*`). Its `list_connected_browsers` lists only the Chrome profiles of this OS user on this computer: the server reaches browsers through local named pipes listed in a per-user registry. Browser tool names in this skill have no prefix: `navigate` means `mcp__tabcrew-chrome__navigate`.

## 1. Find the tools

| The ToolSearch call at the start | Action |
|---|---|
| returned the `mcp__tabcrew-chrome__*` tools | Use them (§ 2). |
| did not | Run `python -I src/tools/chrome_agent.py list_connected_browsers` (from this skill's folder). It lists browsers → use the fallback client (§ 3). It fails (server not found, or no browser) → § Not installed or not connected. |

## 2. Select a Chrome profile

`list_connected_browsers` returns `{browsers:[{browserId, name, browser, extensionVersion, selected}]}`.

| Profiles | Action |
|---|---|
| 0 ("No browsers are connected") | **Stop** → § Not installed or not connected. |
| an entry has `selected: true` (preset with `TCA_BROWSER`) | Use it; do not probe. |
| 1 | Already the target. Continue. |
| 2+ | Do not ask yet: which profile is right depends on where the seats' chat sites are logged in. Keep the list as `PROFILES[]`; `src/pillars/2-crew` § 3a probes them once the seats are known. |

Then (one profile known) `tabs_context_mcp {createIfEmpty:true}`.

**The agent tab group is shared.** A profile has one grey "tabcrew" tab group for every agent that uses tabcrew Chrome Agent there (other Claude Code sessions, other tools, earlier runs), and `createIfEmpty` adds no tab when the group already has tabs. So the group may hold tabs that are not yours: never use a tab you did not create in this session (`src/pillars/2-crew` § 3b says which tab each seat gets).

`select_browser {browserId}` only changes where this MCP server process sends its calls; it sends nothing to other browsers. Pass the `browserId`, not the name (two profiles can be renamed alike).

If any browser tool says `No browser is connected`, treat it as the "0" row.

## 3. Fallback client (`src/tools/chrome_agent.py`)

When tabcrew Chrome Agent is installed but its MCP tools are not loaded in this Claude Code session, run each browser tool through the client (from this skill's folder). It starts the MCP server for one call and exits, so the selection does not carry over: pass `--browser <browserId>` on **every** call once a profile is chosen.

| Tool call | Client form |
|---|---|
| any tool | `python -I src/tools/chrome_agent.py --browser <id> <tool> '<args JSON>'` (or `@args.json`) |
| `chat_send` with a message file | `python -I src/tools/chrome_agent.py --browser <id> chat_send '{"tabId": <tab>, "path": "<file>"}'` |
| `chat_read` into a file | `python -I src/tools/chrome_agent.py --browser <id> chat_read '{"tabId": <tab>, "path": "<file>"}'` |
| a screenshot | `computer '{"action":"screenshot","tabId":<tab>}' --out <scratchpad>`, then open the `IMAGE:` file with Read |

The server path comes from the `tabcrew-chrome` entry in `~/.claude.json` (written by its installer or `claude mcp add`), or `TCA_SERVER`, or `--server`. Tell the user once: *"tabcrew-chrome's MCP is not loaded in this session, so I use tabcrew's small client for it. Run its installer again (or `claude mcp add -s user …`) and start a new session to make it native."*

## Not installed or not connected

Tell the user in their language, then offer to set it up:

> tabcrew Chrome Agent (the Chrome extension tabcrew uses, included in this skill) is not connected to Chrome on this computer.

Ask with `AskUserQuestion` ("Set up tabcrew Chrome Agent now?", header `Setup`): `Set it up (Recommended)`: I run its installer, you load the extension in Chrome / `I will do it myself`.

- **Set it up:** run `node src/chrome-agent/install/install.mjs` from this skill's folder (no admin rights; it registers the native host and adds the MCP server to Claude Code for all projects; it touches nothing else). Show its output, then tell the user:
  > 1) Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the folder the installer printed (on Windows it is on your clipboard)
  > 2) Click the tabcrew Chrome Agent icon in the toolbar: its popup should say **Connected**
  > Write **"connected"** when ready.
- **Myself:** point to `README.md` § Install and wait for **"connected"**.

When the user answers, run the steps again from § 1. The MCP tools appear only in a new Claude Code session, so in this session continue with the fallback client (§ 3).

## Status line to the user

`Chrome connection ✅ (this computer: <profile name>)`, or with several profiles: `Chrome connection ✅ (<n> profiles; I pick the one where <provider> is logged in)`.
