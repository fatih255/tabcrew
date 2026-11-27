// Agent tab group: the agent may only act on tabs inside its own Chrome tab group.
import { ToolError } from "./router.js";

const KEY = "tca_group_id";
export const FOLLOW_KEY = "tca_follow_agent"; // session: id of the agent the popup follows
const OWNERS_KEY = "tca_tab_agents";          // session: { tabId: {id, name} }, the last agent that acted there
const TITLE = "tabcrew";
const COLOR = "grey";

async function storedGroupId() {
  const v = await chrome.storage.session.get(KEY);
  return v[KEY] ?? null;
}

export async function getGroup() {
  let id = await storedGroupId();
  if (id == null) {
    // The stored id is lost when the extension reloads or updates; take back our own group by its name.
    const [g] = await chrome.tabGroups.query({ title: TITLE }).catch(() => []);
    if (!g) return null;
    id = g.id;
    await chrome.storage.session.set({ [KEY]: id });
  }
  try {
    const g = await chrome.tabGroups.get(id);
    if (g.title !== TITLE || g.color !== COLOR) await chrome.tabGroups.update(id, { title: TITLE, color: COLOR });
    return g;
  } catch {
    await chrome.storage.session.remove(KEY);
    return null;
  }
}

export async function groupTabs() {
  const g = await getGroup();
  if (!g) return [];
  return chrome.tabs.query({ groupId: g.id });
}

async function createGroup() {
  const win = await chrome.windows.create({ url: "chrome://newtab/", focused: true, type: "normal" });
  const tabId = win.tabs[0].id;
  const groupId = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId: win.id } });
  await chrome.tabGroups.update(groupId, { title: TITLE, color: COLOR });
  await chrome.storage.session.set({ [KEY]: groupId });
  return chrome.tabGroups.get(groupId);
}

// The page indicator puts ⏳ / ✅ in front of the title for the user; agents get the real title.
export const bareTitle = (t) => String(t || "").replace(/^(⏳|✅) /, "");

const ESC_RE = new RegExp("[<>" + String.fromCharCode(0x2028, 0x2029, 0x85) + "]", "g");
const esc = (s) => s.replace(ESC_RE, (c) => "\\u" +c.charCodeAt(0).toString(16).padStart(4, "0"));

export async function tabsContext({ createIfEmpty } = {}) {
  let g = await getGroup();
  if (!g && createIfEmpty) g = await createGroup();
  if (!g) return "No MCP tab group found. Use createIfEmpty: true to create one.";
  const tabs = await chrome.tabs.query({ groupId: g.id });
  const active = tabs.find((t) => t.active) || tabs[0];
  return esc(JSON.stringify({
    availableTabs: tabs.map((t) => ({ tabId: t.id, title: bareTitle(t.title), url: t.url })),
    selectedTabId: active?.id,
    tabGroupId: g.id,
  }));
}

/** Remember the agent that last acted on a tab (for the popup's per-agent view). */
export async function noteAgent(tabId, agent) {
  const owners = (await chrome.storage.session.get(OWNERS_KEY))[OWNERS_KEY] || {};
  const cur = owners[tabId];
  if (cur && cur.id === agent.id && cur.name === agent.name) return;
  owners[tabId] = { id: agent.id, name: agent.name };
  const live = new Set((await chrome.tabs.query({})).map((t) => String(t.id)));
  for (const k of Object.keys(owners)) if (!live.has(k)) delete owners[k];
  await chrome.storage.session.set({ [OWNERS_KEY]: owners });
}

export async function tabsCreate(agent) {
  const g = await getGroup();
  if (!g) throw new ToolError("No MCP tab group. Call tabs_context_mcp with createIfEmpty: true first.", "tab_create_no_group");
  const tab = await chrome.tabs.create({ windowId: g.windowId, url: "chrome://newtab/", active: false });
  await chrome.tabs.group({ tabIds: [tab.id], groupId: g.id });
  if (agent) await noteAgent(tab.id, agent).catch(() => {});
  return `Created new tab. Tab ID: ${tab.id}`;
}

export async function tabsClose({ tabId }) {
  if (typeof tabId !== "number") throw new ToolError("tabId (number) is required.", "tab_close_invalid_params");
  await assertInGroup(tabId);
  await chrome.tabs.remove(tabId);
  const left = await groupTabs();
  return left.length ? `Closed tab ${tabId}. ${left.length} tab(s) remain.` : `Closed tab ${tabId}. Group is now empty (auto-removed).`;
}

/** Throws unless tabId is a tab inside the agent group. Returns the tab. */
export async function assertInGroup(tabId) {
  if (typeof tabId !== "number") throw new ToolError("tabId (number) is required.", "input_invalid");
  const g = await getGroup();
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { throw new ToolError(`Tab ${tabId} does not exist.`, "tab_not_found"); }
  if (!g || tab.groupId !== g.id) {
    const valid = (await groupTabs()).map((t) => t.id);
    throw new ToolError(`Tab ${tabId} is not in the agent's tab group. Valid tab IDs: ${valid.join(", ") || "(none; call tabs_context_mcp)"}`, "tab_outside_group");
  }
  return tab;
}

/** Above this many tabs, tab-bound results name only the tab they ran on (tabs_context_mcp still lists all). */
const FULL_LIST_MAX = 8;

/** Text block appended to every tab-bound result, like the reference implementation. */
export async function tabContextText(executedOn) {
  const tabs = await groupTabs();
  const line = (t) => `  • tabId ${t.id}: "${bareTitle(t.title)}" ("${t.url}")`;
  const head = `\n\nTab Context:${executedOn != null ? `\n- Executed on tabId: ${executedOn}` : ""}`;
  if (executedOn == null || tabs.length <= FULL_LIST_MAX) return `${head}\n- Available tabs:\n${tabs.map(line).join("\n")}`;
  const own = tabs.filter((t) => t.id === executedOn);
  return `${head}\n- This tab:\n${own.map(line).join("\n") || "  (closed)"}\n- ${tabs.length} tabs in the agent group; call tabs_context_mcp to list them.`;
}
