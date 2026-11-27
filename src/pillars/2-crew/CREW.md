# Pillar 2 — Crew (workflow, seats, mode, logins)

Output: `WORKFLOW`, `SEATS[]`, `MODE` (`auto` | `confirm`), `MAX_ROUNDS`, `GOAL`, and for fanout `TOPICS[]`. Every seat has an open tab with a verified login.

A **seat** is one chat tab acting as one agent:

```
{ id: "A", provider: "deepseek", tab: <tabId>, url: "<chat url>", role: "<short role>",
  name: "🟣🐋 Skeptic (DeepSeek · critic)", agent: <seat agent id> }
```

Seat ids are `A`, `B`, `C`… in order. Two seats may use the same provider (two DeepSeek tabs are fine).

Write all questions and messages in the user's language. The English texts below are the source wording.

## 1. Discover providers

Call `chat_sites`: it lists the supported chat sites (`id`, `name`, `url` for a new chat, `images`, `toggles`). Only these can sit in a seat. Another site is offered as "not supported yet — pick it and we build the adapter together" (`CONTRIBUTING.md` § Adding a chat site). Detect the site of a pasted chat URL by its host.

## 2. Ask (skip anything given in skill args)

**Question set 1** (one `AskUserQuestion` call):

1. **"Which workflow?"** (header `Workflow`)
   - `Solo (Recommended)`: one chat leads, Claude Code does the work in the repo
   - `Debate`: two chats discuss and agree, then Claude Code gets the conclusion
   - `Fan-out`: several chats research different subtopics in parallel, then Claude Code combines the results
2. **"Mode?"** (header `Mode`)
   - `Automatic (Recommended)`: runs instructions and answers the chats' questions itself; asks you only for secrets and risky steps
   - `Confirm every step`: shows each instruction to the user before running it
3. **"Maximum rounds?"** (header `Rounds`): `10 (Recommended)`, `5`, `20`, `Until the task is done (no limit)`. Debate counts one round as A→B→A; fanout counts rounds of follow-ups. "No limit" sets `MAX_ROUNDS = ∞` (skill arg `rounds=0` or `rounds=unlimited`); it still stops on the signals in SAFETY rule 7.

**Question set 2** (seats; depends on the workflow):

| Workflow | Question (header `Seats`) | Options |
|---|---|---|
| solo | "Which chat?" | one option per ready provider. **Recommended** = the provider the user already mentioned or linked in this conversation (e.g. "my DeepSeek chat", a chat URL); only if there is none, the first ready one |
| debate | "Which two chats should debate?" | `ChatGPT ↔ DeepSeek (Recommended)`, `Gemini ↔ ChatGPT`, `Gemini ↔ DeepSeek`, `DeepSeek ↔ DeepSeek` |
| fanout | "Which chats should research?" | `DeepSeek + ChatGPT (Recommended)`, `3× mixed (DeepSeek, ChatGPT, Gemini)`, `2× DeepSeek` |

Do not ask a seat question at all when the user already named the chat (a pasted chat URL or "continue my DeepSeek chat"): use it and say so in the status line.

Add a second question in the same call: **"New chats or existing ones?"** (header `Chats`): `New chats (Recommended)` / `Existing chat` → "Paste the URL(s) into 'Other', one per seat, in seat order". Detect each URL's provider from `url_pattern`. If a URL does not match any pattern, say so and ask again.

**Goal and topics** (plain text, only if missing):
- solo: *"What should we work on? (goal + repo/files)"*
- debate: *"What should they debate? (question/decision + what Claude Code should do with the result)"*
- fanout: *"What is the research goal?"* Then propose a split into one subtopic per seat. Show it with `AskUserQuestion`: `Use this split (Recommended)` / `I will write the topics` (Other).

**Roles and names** (set them yourself; the display name rules are in `src/pillars/3-routing/ROUTING.md` § Identity):
- solo: A = `lead`.
- debate: A = `proposer`, B = `critic`.
- fanout: each seat = `researcher: <its subtopic>`.

## 3. Open and verify every seat

### 3a. Pick the Chrome profile (several profiles only)

Skip this when `src/pillars/1-connection` already selected a browser. Otherwise all seats go into **one** profile, the one where their chat sites are logged in. Probe each profile in `PROFILES[]`:

1. `select_browser {browserId}`, `tabs_context_mcp {createIfEmpty:true}`, then `tabs_create_mcp` → a probe tab (never a tab that was already in the group).
2. For each distinct seat provider: `navigate` the probe tab to its `url_new` (or the seat's existing chat URL), run `chat_status`, and note `loggedIn` (for an existing chat also `messages > 0`).
3. `tabs_close_mcp` the probe tab.

Then decide:

| Result | Action |
|---|---|
| exactly one profile is logged in to every seat provider | `select_browser` it. |
| several are | `AskUserQuestion` once ("Which Chrome profile should the chats run in?", header `Profile`), one option per such profile (label = name, `browserId` in the description). |
| none is | `select_browser` the profile with the most logins, and let § 3b step 3 ask the user to log in to the rest. |

Say it in the status line: *"Chrome profile: Google Chrome · b696 (ChatGPT logged in; 2 other profiles are not)"*. Probing opens one short-lived tab per profile; say so if the user asks why tabs flashed in other windows.

### 3b. Open the seats

For each seat:

1. Get a tab: `tabs_create_mcp` for every seat (the agent tab group is shared, see `src/pillars/1-connection`); only reuse the `createIfEmpty` tab when that call just created the group with that single empty tab. Remember the seat tab ids: they are the only tabs you may use. `navigate` the tab to the seat URL (`url_new` for a new chat).
2. Run `chat_status {tabId}`.
3. Check:
   - `loggedIn:false`: take a screenshot and tell the user: *"You are not logged in to <Provider> (seat <id>). Log in in the tab I opened, then write 'logged in'."* When they answer, run status again. Never type credentials.
   - Existing chat with `messages: 0`: wrong URL, or not the user's chat. Ask again.
   - `generating:true`: that chat is still writing. `src/pillars/4-turn` waits before sending.

Then give one status line per seat, for example:
*"🔵🐋 Architect (DeepSeek · proposer) · login ✅ · DeepThink: off"*
*"🟣🤖 Skeptic (ChatGPT · critic) · login ✅"*

Do not change the toggles unless the user asks (`chat_toggle`).
