# Contributing to tabcrew

Thanks for helping. Most contributions are one of two things: an adapter for another chat site, or a new workflow.

## Layout

```text
tabcrew/
├── SKILL.md · README.md · CONTRIBUTING.md · LICENSE
├── src/
│   ├── pillars/                the crew: how Claude Code runs the chats, read in order
│   │   ├── 0-safety/           rules that override everything else
│   │   ├── 1-connection/       connects to tabcrew Chrome Agent, picks a Chrome profile
│   │   ├── 2-crew/             workflow, seats, logins
│   │   ├── 3-routing/          seat agents and their prompt
│   │   ├── 4-turn/             send, read, route; parallel turns; images; attachments
│   │   ├── 5-workflows/        solo, debate, fanout and message templates
│   │   └── 6-memory/           the .tabcrew/ project notes
│   ├── chrome-agent/           the browser: extension, native host, MCP server, installer, tests
│   │   └── extension/providers/  one adapter per chat site + CONTRACT.md
│   └── tools/                  fill_template.py · split_message.py · chrome_agent.py · e2e.sh (+ e2e_summary.py)
└── docs/                       website (tabcrew.fatihinci.com) and assets/
```

Pillars and workflows never contain site code. Everything site-specific lives in `src/chrome-agent/extension/providers/<id>/`, and agents reach it only through the `chat_*` tools.

## Adding a chat site

An adapter is a folder with a `PROVIDER.md` and a few small JavaScript files that the extension runs in the chat's page, plus one line in `src/chrome-agent/extension/providers/index.js`:

| File | Job |
|---|---|
| `status.js` | Is the page ready, logged in, generating? |
| `send.js` | Put a message into the input and send it. Placeholder `__MSG__`. |
| `wait_read.js` | Wait for the reply to the message just sent (or the latest reply) and return it as markdown. Placeholder `__MODE__`. |
| `toggle.js` | Optional. Switch a mode such as "deep think". |
| `images.js`, `save_image.js` | Optional. List the images a reply generated and return one as bytes (`CONTRACT.md` § Generated images). |

Read `src/chrome-agent/extension/providers/CONTRACT.md` first. It defines the return shapes and the rules that come from real failures:

- Never find a reply by counting messages. Long threads get virtualized and old messages leave the DOM. Mark what was there before sending and look for the reply after your own message.
- Never depend on focus, hover or a real mouse click. Seats run in background tabs at the same time.
- Return the reply as `chunks` with `len` and `h` (reuse the `ch()` helper from an existing `wait_read.js`), so `chat_read` can check it arrived intact.
- Do not use hashed class names or localized labels (aria-labels change with the UI language).

Then:

1. Open the site through tabcrew Chrome Agent and look for the signals listed in `src/chrome-agent/extension/providers/deepseek/PROVIDER.md` (input, send, generating state, reply body without reasoning, user vs assistant messages, logged-out state).
2. Write the JS files (check the syntax with `node --check`), add the site to `src/chrome-agent/extension/providers/index.js`, run the installer again and reload the extension. Try each op through the `chat_*` tools.
3. Test live: a multi-line message with quotes, backticks and non-ASCII text; a message over 5,000 characters; a reply with a code block and a table; attaching to an existing chat; sending identical text twice; two seats generating at once.
4. Fill in the DOM map and the tested cases in `PROVIDER.md`, and add the site to README § Supported chats.

## Adding a workflow

See `src/pillars/5-workflows/WORKFLOWS.md`. A workflow is one Markdown file (seats, kickoff, loop in terms of `turn()` and route actions, finish) plus its message templates. If the seat agents need a new rule, add it to `src/pillars/3-routing/router-prompt.md`, keyed on the workflow name.

## Testing the Chrome extension

Changes under `src/chrome-agent/` (extension, native host, MCP server) have their own tests, from unit tests without a browser to 100 live scenarios: see [src/chrome-agent/CONTRIBUTING.md](src/chrome-agent/CONTRIBUTING.md). Quick check: `cd src/chrome-agent && npm test`.

## Testing a change end to end

The quickest check runs a small matrix (one solo per chat, a debate and a three-chat fanout) as parallel fresh sessions and writes a summary:

```bash
bash src/tools/e2e.sh            # all tests, about 10 minutes; or: bash src/tools/e2e.sh /tmp/out solo-gemini fanout-all3
```

Read `SUMMARY.md` at the end. `none` in the "Adapter signals" column means no op reported an error, retry or `warn`. Run it after you change an adapter and whenever a chat site looks different.

To test how an adapter handles a site error, fail the site's chat request inside the page (find its URL with `performance.getEntriesByType('resource')` while sending), for example by wrapping `XMLHttpRequest.prototype.open` to point that request at a missing path (an HTTP error) or at `https://127.0.0.1:1/` (a network error), or by returning `new Response('{}', {status: 429})` from a wrapped `fetch`. Then check that `send` or `wait_read` returns `site_error` instead of waiting.

### A single test by hand

Run the skill in a fresh, non-interactive Claude Code session in a throwaway folder, so nothing from your current session helps it (tabcrew Chrome Agent must be added to Claude Code for all projects; its installer does that):

```bash
mkdir /tmp/tc-test && cd /tmp/tc-test && git init -q
claude -p --permission-mode bypassPermissions \
  '/tabcrew workflow=solo seats=deepseek rounds=3 goal="Create calc.py with add/sub and unittest tests, run them."'
```

Check the files it wrote, run the tests yourself, and read the transcript for retries or workarounds. A workaround in the transcript usually points to a bug in the skill.

## Style

Skill files are in English. Claude Code talks to the user in the user's language. Keep docs short and plain.
