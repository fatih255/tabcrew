# Contributing to tabcrew

Thanks for helping. Most contributions are one of two things: an adapter for another chat site, or a new workflow.

## Layout

```text
tabcrew/
├── SKILL.md                    entry point Claude Code reads; flow and map
├── pillars/                    one concern per folder, read in order
│   ├── 0-safety/               rules that override everything else
│   ├── 1-connection/           picks the Claude in Chrome browser on this computer
│   ├── 2-crew/                 workflow, seats, logins
│   ├── 3-routing/              seat agents and their prompt
│   ├── 4-turn/                 send, wait, read, route; parallel turns
│   ├── 5-workflows/            solo, debate, fanout and message templates
│   └── 6-memory/               the .tabcrew/ project notes
├── providers/
│   ├── CONTRACT.md             what every adapter must do
│   ├── deepseek/
│   ├── chatgpt/
│   └── gemini/
└── tools/                      fill_op.py builds a runnable op; join_reply.py decodes a reply
```

Pillars and workflows never contain site selectors. Everything site-specific lives in `providers/<id>/`.

## Adding a chat site

An adapter is a folder with a `PROVIDER.md` and three or four small JavaScript files that Claude Code runs in the tab:

| File | Job |
|---|---|
| `status.js` | Is the page ready, logged in, generating? |
| `send.js` | Put a message into the input and send it. Placeholder `__MSG__`. |
| `wait_read.js` | Wait for the reply to the message just sent (or the latest reply) and return it as markdown in chunks. Placeholder `__MODE__`. |
| `toggle.js` | Optional. Switch a mode such as "deep think". |

Read `providers/CONTRACT.md` first. It defines the return shapes and the rules that come from real failures:

- Never find a reply by counting messages. Long threads get virtualized and old messages leave the DOM. Mark what was there before sending and look for the reply after your own message.
- Never depend on focus, hover or a real mouse click. Seats run in background tabs at the same time.
- Return the reply in chunks of at most 900 code points, `pct3`-encoded (`%`, `&`, `;`). The browser tool truncates longer strings and blanks out anything that looks like cookie or query-string data. Reuse the `ch()` helper from an existing `wait_read.js`.
- Do not use hashed class names or localized labels (aria-labels change with the UI language).

Then:

1. Open the site with Claude in Chrome and look for the signals listed in `providers/deepseek/PROVIDER.md` (input, send, generating state, reply body without reasoning, user vs assistant messages, logged-out state).
2. Write the JS files. Check the syntax with `node` and fill placeholders with `tools/fill_op.py`.
3. Test live: a multi-line message with quotes, backticks and non-ASCII text; a message over 5,000 characters; a reply with a code block and a table; attaching to an existing chat; sending identical text twice; two seats generating at once.
4. Fill in the DOM map and the tested cases in `PROVIDER.md`, add an `emoji:` and set `status: ready`.

## Adding a workflow

See `pillars/5-workflows/WORKFLOWS.md`. A workflow is one Markdown file (seats, kickoff, loop in terms of `turn()` and route actions, finish) plus its message templates. If the seat agents need a new rule, add it to `pillars/3-routing/router-prompt.md`, keyed on the workflow name.

## Testing a change end to end

The quickest check runs a small matrix (one solo per chat, a debate and a three-chat fanout) as parallel fresh sessions and writes a summary:

```bash
bash tools/e2e.sh            # all tests, about 10 minutes; or: bash tools/e2e.sh /tmp/out solo-gemini fanout-all3
```

Read `SUMMARY.md` at the end. `none` in the "Adapter signals" column means no op reported an error, retry or `warn`. Run it after you change an adapter and whenever a chat site looks different.

To test how an adapter handles a site error, fail the site's chat request inside the page (find its URL with `performance.getEntriesByType('resource')` while sending), for example by wrapping `XMLHttpRequest.prototype.open` to point that request at a missing path (an HTTP error) or at `https://127.0.0.1:1/` (a network error), or by returning `new Response('{}', {status: 429})` from a wrapped `fetch`. Then check that `send` or `wait_read` returns `site_error` instead of waiting.

### A single test by hand

Run the skill in a fresh, non-interactive Claude Code session in a throwaway folder, so nothing from your current session helps it:

```bash
mkdir /tmp/tc-test && cd /tmp/tc-test && git init -q
claude -p --chrome --permission-mode bypassPermissions \
  '/tabcrew workflow=solo seats=deepseek rounds=3 goal="Create calc.py with add/sub and unittest tests, run them."'
```

Check the files it wrote, run the tests yourself, and read the transcript for retries or workarounds. A workaround in the transcript usually points to a bug in the skill.

## Style

Skill files are in English. Claude Code talks to the user in the user's language. Keep docs short and plain.
