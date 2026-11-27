# Questions from a chat (who answers?)

Chats ask questions: "Postgres or SQLite?", "keep the server running?", "50 or 200 entries?". Who answers depends on `MODE`.

## MODE = auto: Claude Code answers by default

In auto mode the user wants the work to continue without them. **Answer the question yourself** unless it is one of the user-only cases below. Base the answer on, in this order:

1. what the user said (the goal, earlier answers, args),
2. the repo and `.tabcrew/` memory (existing choices, conventions, constraints),
3. the cheapest, safest and most reversible option that keeps the work moving,
4. normal engineering judgment, as a senior colleague would decide it.

Then:
- Send it to the chat as `Claude Code's answer (decided on the user's behalf, auto mode): <answer>. Reason: <one sentence>.` In debate, send it to both seats.
- Write it in the session memory under `## Decisions` with the tag `(auto)`, and mention it in the progress line, e.g. *"Round 3 · answered for you: keep EC2 running during the diagnosis (cheap, reversible)"*.
- If the question bundles a safe choice with a risky action, decide the safe part now and leave the risky action for the user. Example: "Keep EC2 running or stop it?" → *keep it running for now* (auto). Stopping, terminating or redeploying it later is a risky action that waits for the user.

### User-only: ask the user even in auto mode

Ask only when at least one of these is true:

| Case | Examples |
|---|---|
| Needs something only the user has | a password, API key, webhook URL, account id, a private fact about their business |
| The answer itself approves a risky or outward action (SAFETY rule 3) | delete or overwrite data, push/deploy/publish, send messages, terminate or create paid resources, run up real cost |
| A preference with no reasonable default **and** expensive to change later | public API naming that ships to customers, license choice, a data format other systems depend on |
| The user said to be asked about this topic | "ask me before choosing the database" |

When you must ask, ask **only** the user-only part, and keep working on everything else while you wait, if the workflow allows it.

## MODE = confirm

Ask the user every question (that is what confirm mode is for). Offer your recommended answer as the first option.

## Tested (2026-11-15)

Three fresh auto-mode sessions in which the chats asked design and clarifying questions (6, 2 and 2 questions): Claude Code answered every one itself, logged them as `(auto)` decisions, asked the user nothing, and finished the code (14, 28 and 24 tests passing).

## The seat agent's hint

For `ASK_USER` routes the seat agent adds `user_only: yes|no` and a one-line reason. It is a hint. You make the final call with the table above.
