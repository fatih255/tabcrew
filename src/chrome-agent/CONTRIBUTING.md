# Contributing

Thanks for helping. The code has no dependencies and no build step: edit, reload the extension, test.

## Develop

Run the installer once (see README), then load the repository's own `extension` folder with **Load unpacked** instead of the installed copy, so your edits show up after a reload. The native host and MCP server run from the install folder: run the installer again after you change `host/`, `mcp/` or `shared/`.

To test a change without installing anything, the end-to-end suite starts throwaway Chrome profiles with the repository's extension.

## Tests

```
npm test                                       # unit, relay and multi-browser routing tests (no browser)
npm run smoke                                  # read-only check that your browser is connected
npm run test:e2e -- <path to chrome.exe>       # every tool in throwaway Chrome for Testing profiles
npm run test:perms -- <path to chrome.exe>     # permission defaults (no prompt by default, "ask" when picked)
npm run test:live                              # 100 live scenarios in the browser you have connected
npm run test:live:cft -- <path to chrome.exe>  # the same 100 scenarios in a throwaway profile
npm run test:agent -- <path to chrome.exe>     # a real agent (claude -p) does a task; results checked over DevTools
```

`test/tools/gif2png.mjs` writes every frame of an exported GIF as a PNG.

The end-to-end test needs Chrome for Testing (`npx @puppeteer/browsers install chrome@stable`), because branded Chrome ignores `--load-extension`. It starts two throwaway profiles (for the multi-browser checks) and never touches your normal profile.

The live suite (`test/live/`) needs network access. It covers navigation (redirects, 404/500, slow pages, back/forward, refused URLs), searching on Google, Wikipedia and DuckDuckGo, parallel work (two sites at once, typing into two tabs, a second agent on the same browser, GIF recording while another tab navigates), forms and uploads, iframes, shadow DOM, JavaScript dialogs, "Leave site?" pages and other edge cases. It only uses tabs it creates and closes them at the end; on public sites it only reads and searches (writes go to local test pages), and a CAPTCHA page is never solved (the case is skipped). With several browsers connected, set `TCA_BROWSER` to the browserId to test.

