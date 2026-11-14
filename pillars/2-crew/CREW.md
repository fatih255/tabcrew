# Pillar 2 — Crew (workflow, seats, mode, logins)

Output: `WORKFLOW`, `SEATS[]`, `MODE` (`auto` | `confirm`), `MAX_ROUNDS`, `GOAL`, and for fanout `TOPICS[]`. Every seat has an open tab with a verified login.

A **seat** is one chat tab acting as one agent:

```
{ id: "A", provider: "deepseek", tab: <tabId>, url: "<chat url>", role: "<short role>" }
```

Seat ids are `A`, `B`, `C`… in order. Two seats may use the same provider (two DeepSeek tabs are fine).

Write all questions and messages in the user's language. The English texts below are the source wording.

## 1. Discover providers

Read the front block of every `providers/*/PROVIDER.md` (`id`, `name`, `status`, `url_new`, `url_pattern`). Only `status: ready` providers can sit in a seat. A `planned` provider is offered as "not ready yet — pick it and we build the adapter together" (`README.md` § Add a provider).

## 2. Ask (skip anything given in skill args)

**Question set 1** (one `AskUserQuestion` call):

1. **"Which workflow?"** (header `Workflow`)
   - `Solo (Recommended)`: one chat leads, Claude Code does the work in the repo
   - `Debate`: two chats discuss and agree, then Claude Code gets the conclusion
   - `Fan-out`: several chats research different subtopics in parallel, then Claude Code combines the results
2. **"Mode?"** (header `Mode`)
   - `Automatic (Recommended)`: runs instructions, asks only for risky steps
   - `Confirm every step`: shows each instruction to the user before running it
3. **"Maximum rounds?"** (header `Rounds`): `10 (Recommended)`, `5`, `20`. Debate counts one round as A→B→A; fanout counts rounds of follow-ups.

**Question set 2** (seats; depends on the workflow):

| Workflow | Question (header `Seats`) | Options |
|---|---|---|
| solo | "Which chat?" | one option per ready provider (first one Recommended) |
| debate | "Which two chats should debate?" | `ChatGPT ↔ DeepSeek (Recommended)`, `DeepSeek ↔ DeepSeek`, `ChatGPT ↔ ChatGPT` |
| fanout | "Which chats should research?" | `DeepSeek + ChatGPT (Recommended)`, `2× DeepSeek`, `3× mixed (DeepSeek, ChatGPT, DeepSeek)` |

Add a second question in the same call: **"New chats or existing ones?"** (header `Chats`): `New chats (Recommended)` / `Existing chat` → "Paste the URL(s) into 'Other', one per seat, in seat order". Detect each URL's provider from `url_pattern`. If a URL does not match any pattern, say so and ask again.

**Goal and topics** (plain text, only if missing):
- solo: *"What should we work on? (goal + repo/files)"*
- debate: *"What should they debate? (question/decision + what Claude Code should do with the result)"*
- fanout: *"What is the research goal?"* Then propose a split into one subtopic per seat. Show it with `AskUserQuestion`: `Use this split (Recommended)` / `I will write the topics` (Other).

**Roles** (set them yourself, then show them in the status line):
- solo: A = `lead`.
- debate: A = `proposer`, B = `critic`.
- fanout: each seat = `researcher: <its subtopic>`.

## 3. Open and verify every seat

For each seat:

1. `tabs_create_mcp` → `tab`. `navigate` it to the seat URL (`url_new` for a new chat).
2. Run the provider's **status** op (`providers/CONTRACT.md` says how to run an op).
3. Check:
   - `loggedIn:false`: take a screenshot and tell the user: *"You are not logged in to <Provider> (seat <id>). Log in in the tab I opened, then write 'logged in'."* When they answer, run status again. Never type credentials.
   - Existing chat with `messages: 0`: wrong URL, or not the user's chat. Ask again.
   - `generating:true`: that chat is still writing. `pillars/4-turn` waits before sending.

Then give one status line per seat, for example:
*"Seat A · DeepSeek · proposer · login ✅ · DeepThink: off"*
*"Seat B · ChatGPT · critic · login ✅"*

Do not change the toggles unless the user asks (provider **toggle** op).
