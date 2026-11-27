// Per-site permission gate. Modes:
//   "allow_all" (default) no prompts: the user drives their own agent
//   "ask"      prompt once per site and action type; user may allow once / always / deny (popup)
// Blocked sites (user list) are always refused.
import { ToolError } from "./router.js";

const KEY = "tca_perms"; // {mode, modeSet, sites:{host:{[type]:"allow"|"deny"}}, blocked:[patterns]}
export const DEFAULT_MODE = "allow_all";
const pending = new Map(); // promptId -> resolve

// The stored mode counts only when the user picked it in the popup (modeSet). Saving a
// site grant or the blocked list must not pin the default of the day: v0.2.0 stored "ask"
// that way, which kept prompting after the default became "allow_all".
export async function load() {
  const v = (await chrome.storage.local.get(KEY))[KEY] || {};
  const modeSet = v.modeSet === true && (v.mode === "ask" || v.mode === "allow_all");
  return { mode: modeSet ? v.mode : DEFAULT_MODE, modeSet, sites: v.sites || {}, blocked: v.blocked || [] };
}
export async function save(p) {
  const out = { sites: p.sites || {}, blocked: p.blocked || [] };
  if (p.modeSet) Object.assign(out, { mode: p.mode, modeSet: true });
  await chrome.storage.local.set({ [KEY]: out });
}

const hostOf = (url) => { try { return new URL(url).host; } catch { return ""; } };

function matches(pattern, host) {
  pattern = pattern.trim().toLowerCase();
  if (!pattern) return false;
  if (pattern.startsWith("*.")) return host === pattern.slice(2) || host.endsWith(pattern.slice(1));
  return host === pattern || host.endsWith("." + pattern);
}

export async function isBlocked(url) {
  const p = await load();
  const h = hostOf(url).toLowerCase();
  return !!h && p.blocked.some((b) => matches(b, h));
}

/**
 * Ensure the agent may perform `type` (navigate | read_page_content | click | type |
 * execute_javascript | upload) on `url`. Resolves or throws ToolError("permission_denied").
 */
export async function check(type, url, detail = "") {
  if (!/^https?:|^file:/i.test(url || "")) return; // newtab, about:blank etc.
  if (await isBlocked(url)) throw new ToolError(`The user blocked the agent on ${hostOf(url)}.`, "domain_blocked");
  const p = await load();
  if (p.mode === "allow_all") return;
  const host = hostOf(url);
  const rule = p.sites[host]?.[type] ?? p.sites[host]?.["*"];
  if (rule === "allow") return;
  if (rule === "deny") throw new ToolError(`The user denied "${type}" on ${host}.`, "permission_denied");
  const answer = await prompt({ type, host, url, detail });
  if (answer === "always" || answer === "always_site") {
    const fresh = await load();
    fresh.sites[host] = { ...(fresh.sites[host] || {}), [answer === "always_site" ? "*" : type]: "allow" };
    await save(fresh);
    return;
  }
  if (answer === "once") return;
  throw new ToolError(`The user denied "${type}" on ${host}.`, "permission_denied");
}

async function prompt(req) {
  const id = crypto.randomUUID();
  const url = chrome.runtime.getURL(`permission/permission.html?${new URLSearchParams({ id, ...req })}`);
  const win = await chrome.windows.create({ url, type: "popup", width: 460, height: 360, focused: true });
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish("timeout"), 120000);
    const onClosed = (wid) => { if (wid === win.id) finish("deny"); };
    function finish(answer) {
      clearTimeout(timer);
      chrome.windows.onRemoved.removeListener(onClosed);
      pending.delete(id);
      chrome.windows.remove(win.id).catch(() => {});
      resolve(answer);
    }
    pending.set(id, finish);
    chrome.windows.onRemoved.addListener(onClosed);
  });
}

/** Called from the service worker's runtime.onMessage for {type:"TCA_PERMISSION_ANSWER"}. */
export function answer(id, choice) {
  const f = pending.get(id);
  if (f) f(choice);
}
