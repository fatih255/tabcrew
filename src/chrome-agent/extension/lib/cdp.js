// chrome.debugger (CDP) layer: attach on demand, commands with timeouts,
// console/network capture and JS-dialog tracking per tab.
import { ToolError } from "./router.js";

const attached = new Set();
const consoleLog = new Map(); // tabId -> entries
const netLog = new Map(); // tabId -> Map(requestId -> entry)
const tracking = new Map(); // tabId -> {console:bool, network:bool}
const dialogs = new Map(); // tabId -> {type, message}

const PROTECTED = /^(chrome|edge|brave|about|devtools|chrome-extension|view-source):/i;
export const isProtectedUrl = (url) => !url || PROTECTED.test(url) && !/^about:blank$/i.test(url);

function withTimeout(p, ms, what) {
  let t;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new ToolError(`${what} timed out after ${ms} ms`, "cdp_timeout")), ms); }),
  ]);
}

export async function attach(tabId) {
  if (attached.has(tabId)) return;
  const tab = await chrome.tabs.get(tabId);
  if (isProtectedUrl(tab.url) && !/^chrome:\/\/newtab/.test(tab.url)) {
    throw new ToolError(`Cannot control protected page ${tab.url}. Navigate to a normal web page first.`, "chrome_protected_page");
  }
  try {
    await withTimeout(chrome.debugger.attach({ tabId }, "1.3"), 5000, "debugger attach");
  } catch (e) {
    if (!/already attached/i.test(e.message)) {
      throw new ToolError(`Could not attach debugger to tab ${tabId}: ${e.message}. DevTools may be open on this tab.`, "debugger_attach_failed");
    }
  }
  attached.add(tabId);
  await raw(tabId, "Page.enable");
  await raw(tabId, "Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  const tr = tracking.get(tabId);
  if (tr?.console) await raw(tabId, "Runtime.enable").catch(() => {});
  if (tr?.network) await raw(tabId, "Network.enable", { maxPostDataSize: 65536 }).catch(() => {});
}

function raw(tabId, method, params = {}, timeoutMs = 15000) {
  return withTimeout(chrome.debugger.sendCommand({ tabId }, method, params), timeoutMs, method);
}

/** Send a CDP command, attaching first and re-attaching once if detached. */
export async function send(tabId, method, params = {}, timeoutMs = 15000) {
  await attach(tabId);
  const blocking = method.startsWith("Input.") || method === "Runtime.evaluate";
  try {
    return await (blocking ? raceDialog(tabId, raw(tabId, method, params, timeoutMs)) : raw(tabId, method, params, timeoutMs));
  } catch (e) {
    if (/not attached|detached/i.test(e.message)) {
      attached.delete(tabId);
      await attach(tabId);
      return raw(tabId, method, params, timeoutMs);
    }
    throw e;
  }
}

export function detach(tabId) {
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  chrome.debugger.detach({ tabId }).catch(() => {});
}

export const openDialog = (tabId) => dialogs.get(tabId) || null;

// JavaScript dialogs (alert/confirm/prompt) are not answered for the agent, as in the reference
// extension: a dialog the agent did not expect (e.g. "Delete everything?") must not be
// confirmed silently. While one is open the page takes no input and runs no script, so a
// pending Input.* / Runtime.evaluate command is answered at once with this message instead of
// waiting for its timeout, and every later tool except navigate fails fast (see background.js).
export const dialogText = (d, verb = "is open") =>
  `A JavaScript ${d.type} dialog ${verb} on this tab ("${String(d.message || "").slice(0, 300)}"). ` +
  "It blocks the page until it is closed: navigate the tab elsewhere, or ask the user to close it.";

const dialogWaiters = new Map(); // tabId -> Set(reject)
function raceDialog(tabId, p) {
  return new Promise((resolve, reject) => {
    const set = dialogWaiters.get(tabId) || new Set();
    const onDialog = (d) => reject(new ToolError(dialogText(d, "opened"), "js_dialog_opened"));
    set.add(onDialog);
    dialogWaiters.set(tabId, set);
    p.then(resolve, reject).finally(() => set.delete(onDialog));
  });
}

/** Back/forward through CDP history (chrome.tabs.goBack skips entries Chrome marks as skippable). */
export async function historyStep(tabId, delta) {
  const h = await send(tabId, "Page.getNavigationHistory");
  const target = h.entries[h.currentIndex + delta];
  if (!target) throw new ToolError(`There is no ${delta < 0 ? "previous" : "next"} page in this tab's history.`, "navigate_failed");
  await send(tabId, "Page.navigateToHistoryEntry", { entryId: target.id });
}

export async function enableConsole(tabId) {
  const tr = tracking.get(tabId) || {};
  if (!tr.console) {
    tracking.set(tabId, { ...tr, console: true });
    await send(tabId, "Runtime.enable");
  }
}

export async function enableNetwork(tabId) {
  const tr = tracking.get(tabId) || {};
  if (!tr.network) {
    tracking.set(tabId, { ...tr, network: true });
    await send(tabId, "Network.disable").catch(() => {});
    await send(tabId, "Network.enable", { maxPostDataSize: 65536 });
  }
}

export const getConsole = (tabId) => consoleLog.get(tabId) || [];
export const clearConsole = (tabId) => consoleLog.set(tabId, []);
export const getNetwork = (tabId) => [...(netLog.get(tabId)?.values() || [])];
export const clearNetwork = (tabId) => netLog.set(tabId, new Map());

function pushConsole(tabId, entry) {
  const arr = consoleLog.get(tabId) || [];
  arr.push(entry);
  if (arr.length > 10000) arr.splice(0, arr.length - 10000);
  consoleLog.set(tabId, arr);
}

const fmtArg = (a) => {
  if (a.type === "string") return a.value;
  if ("value" in a) return JSON.stringify(a.value);
  return a.description || a.type;
};

chrome.debugger.onEvent.addListener((src, method, p) => {
  const tabId = src.tabId;
  if (tabId == null) return;
  switch (method) {
    case "Runtime.consoleAPICalled": {
      const f = p.stackTrace?.callFrames?.[0];
      pushConsole(tabId, {
        type: p.type, text: (p.args || []).map(fmtArg).join(" ").slice(0, 16000),
        timestamp: p.timestamp, url: f?.url, lineNumber: f?.lineNumber, columnNumber: f?.columnNumber,
      });
      break;
    }
    case "Runtime.exceptionThrown": {
      const d = p.exceptionDetails || {};
      const stack = (d.stackTrace?.callFrames || []).map((c) => `    at ${c.functionName || "<anonymous>"} (${c.url}:${c.lineNumber}:${c.columnNumber})`).join("\n");
      pushConsole(tabId, {
        type: "exception", text: (d.exception?.description || d.text || "exception").slice(0, 16000),
        timestamp: p.timestamp, url: d.url, lineNumber: d.lineNumber, columnNumber: d.columnNumber, stackTrace: stack,
      });
      break;
    }
    case "Network.requestWillBeSent": {
      const m = netLog.get(tabId) || new Map();
      m.set(p.requestId, { requestId: p.requestId, url: p.request.url, method: p.request.method, type: p.type });
      if (m.size > 1000) m.delete(m.keys().next().value);
      netLog.set(tabId, m);
      break;
    }
    case "Network.responseReceived": {
      const e = netLog.get(tabId)?.get(p.requestId);
      if (e) { e.status = p.response.status; e.mimeType = p.response.mimeType; }
      break;
    }
    case "Network.loadingFailed": {
      const e = netLog.get(tabId)?.get(p.requestId);
      if (e) { e.status = e.status || 503; e.failed = p.errorText; }
      break;
    }
    case "Page.javascriptDialogOpening": {
      // "Leave site?" (beforeunload) is answered by navigate (force flag); others stay open.
      const d = { type: p.type, message: p.message };
      dialogs.set(tabId, d);
      if (p.type !== "beforeunload") for (const fn of dialogWaiters.get(tabId) || []) fn(d);
      break;
    }
    case "Page.javascriptDialogClosed":
      dialogs.delete(tabId);
      break;
    case "Page.frameNavigated":
      if (!p.frame.parentId) dialogs.delete(tabId);
      break;
  }
});

chrome.debugger.onDetach.addListener((src) => {
  attached.delete(src.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  attached.delete(tabId);
  consoleLog.delete(tabId);
  netLog.delete(tabId);
  tracking.delete(tabId);
  dialogs.delete(tabId);
  dialogWaiters.delete(tabId);
});

// Reset console/network stores when the top document changes domain.
const lastHost = new Map();
chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId !== 0) return;
  let host = "";
  try { host = new URL(d.url).host; } catch {}
  if (lastHost.get(d.tabId) !== host) {
    consoleLog.delete(d.tabId);
    netLog.delete(d.tabId);
  }
  lastHost.set(d.tabId, host);
});
