# Pillar 6 — Memory (project wiki of crew sessions)

tabcrew keeps a small, dated wiki in the user's project, so any later session (or any other AI) can see what the chats and Claude Code already discussed, decided and built.

## Format and layout

Markdown with YAML frontmatter. It is the format LLMs read most reliably, people can read it too, and the frontmatter keeps the key facts structured. Newest entries come first.

```
<project root>/.tabcrew/
├── INDEX.md                                  one line per session, newest first
├── sessions/
│   └── 2026-11-15_2310_palindrome-unicode.md one file per tabcrew session
└── chats/
    └── deepseek_0904661a.md                  one file per chat: dated handoff summaries
```

The project root is the git root of the current directory (or the current directory if there is no git).

### INDEX.md

```markdown
# tabcrew memory

- 2026-11-15 23:10 · debate · done · Palindrome Unicode rule → [session](sessions/2026-11-15_2310_palindrome-unicode.md)
- 2026-11-14 18:02 · solo · stopped · CSV export → [session](sessions/2026-11-14_1802_csv-export.md)
```

### sessions/<date>_<time>_<slug>.md

```markdown
---
date: 2026-11-15T23:10
workflow: debate
status: in-progress        # in-progress | done | stopped
goal: "How should is_palindrome treat punctuation and the empty string?"
seats:
  - name: "🔵🤖 Architect (ChatGPT · proposer)"
    url: https://chatgpt.com/c/…
  - name: "🟣🐋 Skeptic (DeepSeek · critic)"
    url: https://chat.deepseek.com/a/chat/s/…
rounds: 2
files_changed: [textutils.py, test_textutils.py]
---

## Summary
Two to five sentences: what was asked, what came out.

## Decisions
- NFC + casefold + isalnum; empty string is a palindrome (both seats agreed, round 2).

## Done
- textutils.py: … · tests: 11 passed

## Open items
- Turkish dotted/dotless I is not locale-aware (documented, not fixed).

## Next step
One concrete sentence a new session can start from.

## Timeline
- R1 · 🔵🤖 Architect → proposal: isalnum filter
- R1 · 🟣🐋 Skeptic → objection: needs NFC for combining marks
- R2 · 🔵🤖 Architect → [[AGREED]] with NFC
```

### chats/<provider>_<first 8 chars of the chat id>.md

```markdown
---
provider: deepseek
url: https://chat.deepseek.com/a/chat/s/0904661a-…
title: "<chat title from status>"
updated: 2026-11-15T23:40
---

## 2026-11-15 23:40 · handoff
<the chat's own summary of the conversation (templates/handoff.md), verbatim>
```

Append a new dated section each time. Never rewrite old sections.

## When to read

At the start (after `pillars/2-crew`):

1. If `.tabcrew/INDEX.md` exists, read it, the newest session file, and the `chats/` file of every seat URL you attach to.
2. Tell the user in one line, for example *"Memory: last session 2026-11-15 (debate, done): Palindrome Unicode rule"*.
3. Use it as context: do not redo what is done, and continue from "Next step" if the goal is the same.

## When to write

| Moment | Write |
|---|---|
| Session start | Create the session file (`status: in-progress`, goal, seats) and add its line at the top of `INDEX.md`. Create `.tabcrew/` if needed. |
| Attaching to an existing chat | **Handoff:** send `pillars/5-workflows/templates/handoff.md` to that chat. Save its reply verbatim as a new dated section in `chats/<…>.md`, and use it as the context for this session. |
| After every round | Append one line to `## Timeline`. Do this right away, so a crash loses nothing. |
| Finish (or stop) | Fill Summary, Decisions, Done, Open items, Next step; set `status`, `rounds`, `files_changed`; update the line in `INDEX.md`. |
| A seat's chat gets too long | Send it `handoff.md`, save the reply in `chats/`, then start a new chat for that seat with the summary as its first message. |

Rules:
- Never write secrets (SAFETY rule 4). Chat summaries can contain code; keep it, but redact keys and tokens.
- Keep it short. Summaries are for orientation; the full chats stay in the chat sites (URLs in the files).
- Do not ask the user whether to keep memory. It is a plain folder; they can delete it or add `.tabcrew/` to `.gitignore`. Mention the folder once in the final summary.
