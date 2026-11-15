# Pillar 5 — Workflows

A workflow decides **who talks to whom, in which order, and when it ends**. Every exchange is a turn (`pillars/4-turn`). Every reply is routed (`pillars/3-routing`).

| Workflow | Seats | Shape | Ends when |
|---|---|---|---|
| [`solo.md`](solo.md) | 1 | chat leads → Claude Code executes → reports back → … | router `DONE`, max rounds, or user stop |
| [`debate.md`](debate.md) | 2 | A ⇄ B discuss → agreed conclusion → Claude Code acts | `[[AGREED]]` (router `DONE`), or max rounds → forced wrap-up |
| [`fanout.md`](fanout.md) | 2+ | all seats research in parallel → Claude Code synthesizes and acts | every seat delivered findings, optional follow-up round |

Templates for the messages sent to the chats are in `templates/`. Fill `{{…}}` placeholders. Never put secrets in them.

## Add a workflow

1. Write `pillars/5-workflows/<name>.md` with these sections: **Seats**, **Kickoff**, **Loop** (in terms of `turn()` and ROUTE actions), **Finish**.
2. Put its message templates in `templates/`.
3. If the router needs new behaviour, add one numbered rule to `pillars/3-routing/router-prompt.md` keyed on `workflow=<name>`.
4. Add it to the table above, to the question in `pillars/2-crew/CREW.md`, and to `README.md`.

**Filling templates.** Never retype a template or a reply into it: `python -I tools/fill_template.py pillars/5-workflows/templates/<name>.md KEY=value KEY=@file … -o <scratch file>` fills every `{{KEY}}` (a value from a file with `@`), and fails on a missing or unknown key. Use the output file as the `--msg-file` of `fill_op.py`.
