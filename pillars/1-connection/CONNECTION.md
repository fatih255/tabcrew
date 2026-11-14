# Pillar 1 — Connection (local Chrome only)

Goal: a Claude-in-Chrome browser **on this computer** is selected, and you own a tab `TAB`. This runs automatically; involve the user only when something is wrong.

## Steps

1. `list_connected_browsers`. Keep only **local** entries: `onThisComputer: true`, or `isLocal: true` if `onThisComputer` is absent.
2. Decide:

| Local browsers | Action |
|---|---|
| 0 (empty list, or only other computers) | **Stop and warn** (message below). Never fall back to a remote browser. |
| 1, `inUse: true` | Continue. |
| 1, not in use | `select_browser {deviceId}`. |
| 2+ | `AskUserQuestion` with one option per **local** browser (label = name, `(deviceId)` in the description), then `select_browser`. |

3. `tabs_context_mcp {createIfEmpty:true}`, then `tabs_create_mcp`. Save the new tab id as `TAB`.
4. If any browser tool says `Browser extension is not connected`, treat it as the "0" row.

## Warning message

Say this in the user's language:

> No Chrome is connected on this computer (I never use Chrome sessions on other computers).
> 1) Open the Claude extension in Chrome: https://claude.ai/chrome
> 2) Sign in with the **same account** as Claude Code
> 3) If you just installed it, restart Chrome
> Write **"connected"** when ready and I will check again.

When the user answers, run the steps again from step 1.

## Status line to the user

`Chrome connection ✅ (this computer: <name>)`
