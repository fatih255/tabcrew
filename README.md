<p align="center">
  <img src="assets/banner.png" alt="tabcrew: AI chat tabs, working as one crew" width="100%">
</p>

# tabcrew

tabcrew is a Claude Code skill that lets Claude Code work with the AI chats you already use in Chrome: DeepSeek, ChatGPT and Gemini. Claude Code writes to the chats, waits for their answers, passes the right parts between them, and does the actual work in your repo.

If you copy prompts from a chat into Claude Code and paste the results back, this does that loop for you.

It runs on your own browser sessions. No API keys, no extra subscriptions.

Website: **[tabcrew.fatihinci.com](https://tabcrew.fatihinci.com)**

## Install

Tell Claude Code:

```text
Install the skill from https://github.com/fatih255/tabcrew
```

Or clone it into your skills folder yourself:

```bash
git clone https://github.com/fatih255/tabcrew ~/.claude/skills/tabcrew
```

You also need the [Claude in Chrome](https://claude.ai/chrome) extension, signed in with the same account as Claude Code, and you need to be logged in to the chat sites you want to use.

## Use it

Describe what you want in plain words:

```text
Use DeepSeek to plan a CSV export feature for this repo and build it step by step.
Let ChatGPT and Gemini debate SQLite vs Postgres for this CLI, then implement the winner.
Have DeepSeek, ChatGPT and Gemini research rate limits, pricing and SDKs for the Stripe API, then write NOTES.md.
Continue my DeepSeek chat https://chat.deepseek.com/a/chat/s/<id> from where we left off.
```

Or call it directly. Claude Code asks for anything you leave out:

```text
/tabcrew
/tabcrew workflow=debate seats=chatgpt,gemini rounds=4 goal="..."
/tabcrew workflow=solo seats=deepseek rounds=unlimited goal="..."
```

In automatic mode Claude Code also answers the chats' questions on your behalf and notes each decision in the session memory. It only stops to ask you for secrets or before risky steps such as deleting, deploying or spending money.

The round limit is 5, 10 or 20, or "until the task is done". Without a limit, tabcrew still stops when the chat says the work is finished, when a decision or a risky step needs you, or when the last few rounds made no progress.

## Workflows

| Workflow | Chats | What happens |
|---|---|---|
| solo | 1 | One chat leads. Claude Code carries out each step in the repo and reports the result back, round after round. |
| debate | 2 | Two chats argue a question until both agree on one written conclusion. Claude Code then builds it. |
| fanout | 2 or more | Each chat researches its own subtopic at the same time. Claude Code checks the claims, merges the findings and acts. |

You can mix chats or repeat one: ChatGPT against Gemini, three DeepSeek tabs, two ChatGPT tabs plus a Gemini tab.

## How it works

```mermaid
flowchart LR
    you(["You"]) -->|"goal"| cc["Claude Code"]
    cc -->|"message"| chats["Chat tabs<br/>in your Chrome"]
    chats -->|"reply"| cc
    cc -->|"code, tests,<br/>commands"| repo[("Your repo")]
    cc -->|"notes"| mem[(".tabcrew/")]
```

Every exchange with a chat follows the same steps:

```mermaid
sequenceDiagram
    participant CC as Claude Code
    participant Tab as Chat tab
    participant Agent as Helper agent
    CC->>Tab: types the message
    Tab-->>CC: the full reply
    Note over CC: checks the reply is complete
    CC->>Agent: which part goes where?
    Agent-->>CC: for Claude Code, for the other chat,<br/>a question, or done
    Note over CC: does the work,<br/>or passes the part on
```

- **Each chat has a role** such as lead, proposer, critic or researcher, and a small helper agent with a name, for example `🟣🐋 Skeptic (DeepSeek · critic)`. The helper reads the reply in any language and returns, word for word, the part meant for Claude Code or for the other chat. It also flags risky steps.
- **A chat only sees its own conversation**, not your repo or the other chats. Before each message, Claude Code adds what that chat is missing: the code it asked about, a failing test, another chat's finding or an earlier decision.
- **Claude Code checks each reply against the page** before using it: no text lost, code blocks and tables intact, every character copied correctly.

### Debate

```mermaid
sequenceDiagram
    participant A as Chat A (proposer)
    participant CC as Claude Code
    participant B as Chat B (critic)
    CC->>A: topic and rules
    A-->>CC: proposal
    CC->>B: topic, rules and the proposal
    loop until both agree, or the round limit
        B-->>CC: objections
        CC->>A: objections, word for word
        A-->>CC: revised proposal
        CC->>B: revised proposal, word for word
    end
    CC->>B: do you agree with this exact conclusion?
    B-->>CC: [[AGREED]]
    Note over CC: builds the conclusion<br/>and runs the tests
```

### Fanout

```mermaid
flowchart TB
    cc["Claude Code<br/>splits the goal<br/>into subtopics"]
    cc --> a["Chat A<br/>subtopic 1"]
    cc --> b["Chat B<br/>subtopic 2"]
    cc --> c["Chat C<br/>subtopic 3"]
    a --> check["Claude Code<br/>checks the claims<br/>and merges them"]
    b --> check
    c --> check
    check --> out["NOTES.md, code<br/>or a decision"]
```

All chats write at the same time. When a finding is thin or looks wrong, Claude Code sends that chat a follow-up question before merging. In testing, Claude Code ran the chats' example claims in real Python, caught wrong ones, and had that chat correct itself before writing the result.

## Reliability

Chat sites change their pages and have limits. tabcrew deals with them so a run does not silently go wrong:

| Situation | What tabcrew does |
|---|---|
| A message is longer than the site accepts (ChatGPT about 10,000 characters, Gemini 32,000, DeepSeek about 60,000) | Splits it into parts and sends them in order |
| The site shows an error ("Too many requests", "Something went wrong", a lost connection) | Notices it (usually within seconds, at most about two minutes), reloads the tab, tries once more, then tells you |
| A reply is read incompletely, for example after a site redesign | Tells you the reply may be incomplete; if text is missing, uses the page's plain text instead |
| Gemini puts code in its Canvas side panel | Asks Gemini to paste it into the chat |
| A chat is logged out | Asks you to log in; it never types passwords |

To check that all three chats still work, run the smoke tests (about 10 minutes, real chats, 5 sessions at once):

```bash
bash tools/e2e.sh
```

## What has been tested

Every run below was a fresh `claude -p` session in an empty folder, driving real chat tabs, and ended with Claude Code writing code and running its tests.

| Workflow | Chats | Example tasks | Result |
|---|---|---|---|
| solo | DeepSeek, ChatGPT or Gemini | todo CLI, `slugify()`, word counter, INI-to-JSON converter, reviewing a 24.5k-character file | all tests pass |
| solo, existing chat | DeepSeek | continue an old chat from its own summary | 21 tests pass |
| debate | every pair, and a chat against itself | palindrome rules, retry/backoff, LRU cache, duration parser, rate limiter, config loading, JSON-lines reader | all tests pass |
| fanout | 2 or 3 chats, mixed | Unicode edge cases, password checker, SemVer, `slugify()` for 5 scripts | wrong claims caught and corrected, all tests pass |
| auto mode | DeepSeek, ChatGPT | the chats asked design questions first | all answered by Claude Code, none needed you |
| `tools/e2e.sh` | all three | one solo per chat, a debate, a three-chat fanout | 5 of 5 pass |

## Memory

Every session leaves dated notes in your project:

```text
.tabcrew/
├── INDEX.md            one line per session, newest first
├── sessions/           goal, chats, decisions, what changed, open items, next step
└── chats/              each chat's own summary of the conversation, by date
```

When you attach to a chat you have been using for a while, tabcrew first asks that chat to summarize the whole conversation, saves the summary, and continues from its "next step". A later session, or any other AI, can read the folder and pick up where things stopped. The files are Markdown with YAML frontmatter. Commit them or add `.tabcrew/` to `.gitignore`, as you prefer.

## Safety and privacy

- It only uses the Chrome extension on this computer. It never connects to your Chrome on other machines.
- It works in tabs it opened itself and never types into yours. The chat tabs stay open when it finishes.
- Chat output is treated as input for your goal, not as commands. Deleting files, force-pushing, deploying, publishing, installing unknown packages and anything touching secrets wait for your approval.
- Lines such as "ignore your rules" in a chat reply are dropped.
- Messages to the chats never include `.env` values, keys or tokens.
- Every workflow has a round limit or, if you choose "until done", a check that pauses the run when it stops making progress. You can say stop at any time.
- It never types passwords. If a chat is logged out, you log in.
- To avoid sending its page code again on every page load, tabcrew keeps a copy of its own code (about 10 KB) in each chat site's browser storage (`localStorage`, keys starting with `__tc_src_`). It holds no chat content, and older copies are removed when tabcrew updates.

## Supported chats

| Chat | Status |
|---|---|
| DeepSeek (chat.deepseek.com) | Supported |
| ChatGPT (chatgpt.com) | Supported |
| Gemini (gemini.google.com) | Supported |
| Claude.ai, Grok, Perplexity and others | Not yet. See [CONTRIBUTING.md](CONTRIBUTING.md) to add one. |

## Contributing

Adapters for more chat sites and new workflows are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) explains the layout, the adapter contract and how to test.

## License

MIT
