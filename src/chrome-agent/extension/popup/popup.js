import { icon } from "./icons.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.filter((k) => k != null));
  return n;
};
const GROUP_KEY = "tca_group_id"; // written by lib/tabs.js
const FOLLOW_KEY = "tca_follow_agent", OWNERS_KEY = "tca_tab_agents"; // lib/tabs.js
const MARK = /^(⏳|✅) /;         // the page indicator's title status
let perms = null;
let lastLog = [];
let connected = false;
const openErrors = new Set();

// Static icons declared in the markup.
for (const n of document.querySelectorAll("[data-icon]")) n.append(icon(n.dataset.icon));
for (const n of document.querySelectorAll("[data-icon-before]")) n.prepend(icon(n.dataset.iconBefore));

$("installCmd").textContent = "node src/chrome-agent/install/install.mjs";
$("version").textContent = `Version ${chrome.runtime.getManifest().version}`;

function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 1400);
}

// ---------- header: connection + settings ----------
function renderConnection(state) {
  connected = !!state.connected;
  const wait = !connected && !state.lastError;
  $("chip").className = `chip ${connected ? "on" : wait ? "wait" : "off"}`;
  $("status").textContent = connected ? "Connected" : wait ? "Connecting" : "Not connected";
  $("problem").hidden = connected || wait;
  $("errorText").textContent = state.lastError || "";
  $("live").hidden = !connected;
}
$("reconnect").onclick = () => {
  renderConnection({ connected: false });
  chrome.runtime.sendMessage({ type: "TCA_RECONNECT" }).then(() => setTimeout(refresh, 800));
};
function showSettings(open) {
  const box = $("settings");
  box.classList.toggle("open", open);
  box.inert = !open;
  box.setAttribute("aria-hidden", String(!open));
  $("settingsBtn").setAttribute("aria-expanded", String(open));
}
$("settingsBtn").onclick = () => showSettings(!$("settings").classList.contains("open"));
$("settingsClose").onclick = () => showSettings(false);

// ---------- browser name ----------
let editing = false;
function renderIdentity(id) {
  if (!id) return;
  $("bname").title = `browserId ${id.deviceId}`;
  $("bname").dataset.id = id.deviceId;
  if (!editing) $("bname").value = id.name;
}
// Same row, same height: the name and the input swap places, and so do the buttons.
function setEditing(on) {
  editing = on;
  $("bname").readOnly = !on;
  $("nameEdit").classList.toggle("editing", on);
  $("renameBtn").hidden = on;
  $("saveName").hidden = !on;
  $("cancelName").hidden = !on;
  if (on) { $("bname").focus(); $("bname").select(); }
}
async function saveName(e) {
  e?.preventDefault();
  await chrome.runtime.sendMessage({ type: "TCA_SET_NAME", name: $("bname").value });
  setEditing(false);
  toast("Saved");
  refresh();
}
$("renameBtn").onclick = () => setEditing(true);
$("cancelName").onclick = () => { setEditing(false); refresh(); };
$("saveName").onclick = saveName;
$("nameEdit").onsubmit = saveName;
$("bname").onkeydown = (e) => { if (e.key === "Escape") $("cancelName").click(); };

// ---------- agent tabs ----------
// The state comes from the page indicator's title mark: ⏳ working, ✅ done, nothing = idle.
function stateIcon(title) {
  const m = (title || "").match(MARK)?.[1];
  if (m === "⏳") { const s = icon("loader", "state spin"); s.setAttribute("aria-label", "Working"); return s; }
  if (m === "✅") { const s = icon("check-circle", "state done"); s.setAttribute("aria-label", "Done"); return s; }
  return el("span", { className: "state idle", title: "Idle" });
}
function tabRow(t) {
  let host = "";
  try { host = new URL(t.url || t.pendingUrl || "").host; } catch {}
  const title = (t.title || "New tab").replace(MARK, "");
  const go = el("button", { className: "go", title: "Show this tab", ariaLabel: `Show ${title}` }, icon("external-link"));
  go.onclick = () => { chrome.tabs.update(t.id, { active: true }); chrome.windows.update(t.windowId, { focused: true }); };
  return el("li", {}, stateIcon(t.title), el("span", { className: "title", textContent: title, title }),
    el("span", { className: "where", title: host }, el("span", { className: "host", textContent: host })), go);
}
// One eye per agent: the window follows that agent's tabs. Several agents can share the group,
// so following is per agent, and only one at a time.
function agentRow(a, n, following) {
  const eye = el("button", { className: `eye${following ? " on" : ""}`, title: following ? "Stop following" : "Follow this agent: the window shows the tab it is working in",
    ariaLabel: `${following ? "Stop following" : "Follow"} ${a.name}` }, icon(following ? "eye" : "eye-off"));
  eye.setAttribute("aria-pressed", String(following));
  eye.onclick = async () => {
    if (following) await chrome.storage.session.remove(FOLLOW_KEY);
    else await chrome.storage.session.set({ [FOLLOW_KEY]: a.id });
    toast(following ? "Not following" : `Following ${a.name}`);
    renderGroup();
  };
  return el("li", { className: "agent" }, eye, el("span", { className: "title", textContent: a.name, title: a.name }),
    el("span", { className: "where", textContent: `${n} tab${n === 1 ? "" : "s"}` }));
}
async function renderGroup() {
  let tabs = [], owners = {}, follow = null;
  try {
    const s = await chrome.storage.session.get([GROUP_KEY, FOLLOW_KEY, OWNERS_KEY]);
    owners = s[OWNERS_KEY] || {};
    follow = s[FOLLOW_KEY] || null;
    if (s[GROUP_KEY] != null) tabs = await chrome.tabs.query({ groupId: s[GROUP_KEY] });
  } catch {}
  $("groupCount").hidden = !tabs.length;
  $("groupCount").textContent = tabs.length;
  $("groupEmpty").hidden = tabs.length > 0;
  $("groupTabs").hidden = !tabs.length;
  const agents = new Map(); // agent id -> {agent, tabs}, in tab order
  const loose = [];
  for (const t of tabs) {
    const a = owners[t.id];
    if (!a) { loose.push(t); continue; }
    if (!agents.has(a.id)) agents.set(a.id, { agent: a, tabs: [] });
    agents.get(a.id).tabs.push(t);
  }
  const rows = [];
  for (const { agent, tabs: ts } of agents.values()) rows.push(agentRow(agent, ts.length, agent.id === follow), ...ts.map(tabRow));
  if (loose.length && agents.size) rows.push(el("li", { className: "agent loose" }, el("span", { className: "title muted", textContent: "Not used by an agent yet" })));
  rows.push(...loose.map(tabRow));
  $("groupTabs").classList.toggle("grouped", agents.size > 0);
  $("groupTabs").replaceChildren(...rows);
}
for (const ev of ["onCreated", "onRemoved", "onUpdated", "onAttached", "onDetached"]) {
  chrome.tabs[ev]?.addListener(() => { clearTimeout(renderGroup.t); renderGroup.t = setTimeout(renderGroup, 150); });
}

// ---------- activity ----------
const OP_ICON = {
  chat_images: "image", chat_save_image: "image", chat_send: "send", chat_read: "message", chat_status: "message",
  chat_toggle: "settings", chat_sites: "globe", computer: "monitor", navigate: "link", find: "search",
  read_page: "browser", get_page_text: "browser", tabs_context_mcp: "layers", tabs_create_mcp: "layers", tabs_close_mcp: "layers",
};
function renderLog(log) {
  lastLog = log;
  const box = $("log");
  const keepTop = box.scrollTop > 4; // the user is looking at older rows: do not jump
  const prevH = box.scrollHeight, prevTop = box.scrollTop;
  $("logEmpty").hidden = log.length > 0;
  box.hidden = !log.length;
  box.replaceChildren(...log.slice(0, 100).map((e) => {
    const key = e.id || `${e.at}-${e.tool}`;
    const right = el("span", { className: "ms" });
    if (e.ok) right.textContent = `${e.ms} ms`;
    else right.append("error", icon("alert-circle"));
    const li = el("li", { className: e.ok ? "" : openErrors.has(key) ? "fail open" : "fail" },
      icon(e.ok ? OP_ICON[e.tool] || "terminal" : OP_ICON[e.tool] || "terminal", "op"),
      el("span", { className: "time", textContent: new Date(e.at).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) }),
      el("span", { className: "tool", textContent: e.tool }),
      right,
      !e.ok && openErrors.has(key) ? el("div", { className: "msg", textContent: e.error || "(no message)" }) : null);
    if (!e.ok) {
      li.title = "Show the error";
      li.onclick = () => { openErrors.has(key) ? openErrors.delete(key) : openErrors.add(key); renderLog(lastLog); };
    }
    return li;
  }));
  if (keepTop) box.scrollTop = prevTop + (box.scrollHeight - prevH);
}

// ---------- settings ----------
function renderPerms(p) {
  perms = p;
  for (const r of document.querySelectorAll("input[name=mode]")) r.checked = r.value === p.mode;
  const sites = Object.entries(p.sites);
  $("sitesBox").hidden = !sites.length;
  $("sites").replaceChildren(...sites.map(([host, rules]) => {
    const b = el("button", { className: "link", textContent: "Remove" });
    b.onclick = () => { delete perms.sites[host]; savePerms("Removed"); };
    return el("li", { className: "row" }, el("span", { className: "grow ell", textContent: host, title: Object.keys(rules).join(", ") }), b);
  }));
  if (document.activeElement !== $("blocked")) $("blocked").value = p.blocked.join("\n");
}
const savePerms = (msg) => chrome.runtime.sendMessage({ type: "TCA_SET_PERMS", perms }).then(() => { if (msg) toast(msg); refresh(); });
for (const r of document.querySelectorAll("input[name=mode]")) r.onchange = () => { perms.mode = r.value; perms.modeSet = true; savePerms("Saved"); };
$("saveBlocked").onclick = () => {
  perms.blocked = $("blocked").value.split(/\s+/).map((s) => s.trim()).filter(Boolean);
  savePerms("Saved").then(() => setTimeout(() => showSettings(false), 350)); // saved: fold the card away
};

for (const b of document.querySelectorAll("[data-copy]")) {
  b.onclick = () => navigator.clipboard.writeText($(b.dataset.copy).textContent).then(() => toast("Copied"), () => {});
}

// ---------- refresh ----------
const refresh = () => chrome.runtime.sendMessage({ type: "TCA_GET_STATE" }).then(({ state, log, perms: p, identity }) => {
  renderConnection(state);
  renderIdentity(identity);
  renderPerms(p);
  renderLog(log);
}).catch(() => renderConnection({ connected: false, lastError: "The extension did not answer. Reload it in chrome://extensions." }));
chrome.runtime.onMessage.addListener((m) => { if (m.type === "TCA_LOG" || m.type === "TCA_STATE") refresh(); });
refresh();
renderGroup();
setInterval(refresh, 2000);
setInterval(renderGroup, 1500);
