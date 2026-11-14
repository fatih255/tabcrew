# Pillar 2 — Session (provider, URL, mode, login)

Output: `PROVIDER`, `URL`, `MODE` (`auto` | `confirm`), `MAX_ROUNDS`, `GOAL`, an open chat in `TAB`, and a verified login.

Write all questions and messages in the user's language. The English texts below are the source wording.

## 1. Discover providers

Read the front block of every `providers/*/PROVIDER.md` (`id`, `name`, `status`, `url_new`, `url_pattern`). Providers with `status: ready` can be used. Providers with `status: planned` are shown as "not ready yet".

## 2. Ask (one `AskUserQuestion` call; skip anything given in skill args)

1. **"Which AI chat should we work with?"** (header `Provider`): one option per provider. Put the ready ones first; the first ready one gets `(Recommended)`. A planned one gets the description "not ready yet — pick it and we build the adapter together".
2. **"Which chat?"** (header `Chat`):
   - `New chat`: opens the provider's `url_new`
   - `Existing chat`: "Paste the chat URL into 'Other'"
3. **"Mode?"** (header `Mode`):
   - `Automatic (Recommended)`: runs the chat's instructions, asks only for risky steps
   - `Confirm every round`: shows each instruction and asks before running it
4. **"Maximum rounds?"** (header `Rounds`): `10 (Recommended)`, `5`, `20`

If the user picks a **planned** provider: say it is not ready yet, then offer to build the adapter together (`README.md` § Add a provider) or to pick a ready provider.

If the user pastes a URL into "Other" for question 1 or 2, detect the provider from the `url_pattern` values.

**Validate the URL** against the provider's `url_pattern`. If it does not match, say so in one line and ask again.

**Goal.** For a new chat, if the user has not said what to work on, ask in plain text: *"What should we work on with the chat? (goal + repo/files)"*. For an existing chat, the goal may be "continue where the chat left off".

## 3. Open and verify

1. `navigate` TAB to `URL`.
2. Run the provider's **status** op (see `providers/CONTRACT.md` for how to run an op).
3. Check:
   - `loggedIn:false`: take a screenshot and tell the user: *"You are not logged in to <Provider>. Log in in the tab I opened, then write 'logged in'."* When they answer, run status again. Repeat until it is true. Never type credentials.
   - Existing chat with `messages: 0`: the URL is wrong or not the user's chat. Tell them and ask again.
   - `generating:true`: the chat is still writing. The relay pillar waits before sending.
4. Give the user a one-line status, for example: *"Connected ✅ Chrome (this computer) · DeepSeek login OK · DeepThink: on · Search: on"*. Do not change the toggles unless the user asks (provider **toggle** op).
