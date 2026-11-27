// The "computer" tool: mouse, keyboard, scrolling, screenshots and zoom via CDP Input.*.
import * as cdp from "./cdp.js";
import * as shots from "./screenshot.js";
import { ToolError } from "./router.js";
import { MOD, charKey, parseCombo, isZoomCombo, isReloadCombo } from "./keys.js";
import { refCenter } from "./frames.js";

/** CSS-pixel position of the last pointer action per tab (used to mark clicks in GIF recordings). */
export const lastPoint = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function modBits(str) {
  if (!str) return 0;
  let m = 0;
  for (const p of String(str).toLowerCase().split("+").map((s) => s.trim()).filter(Boolean)) {
    if (MOD[p] == null) throw new ToolError(`Unknown modifier "${p}"`, "input_invalid");
    m |= MOD[p];
  }
  return m;
}

async function cursor(tabId, x, y, pressed) {
  try { return await chrome.tabs.sendMessage(tabId, { type: "TCA_CURSOR", x, y, pressed }); } catch { return null; }
}
/** Move the visible cursor and wait until it has glided there, so the click lands where you see it. */
async function glide(tabId, x, y) {
  const r = await cursor(tabId, x, y, false);
  if (r?.ms) await sleep(Math.min(r.ms, 450));
}

function assertNoDialog(tabId) {
  const d = cdp.openDialog(tabId);
  if (d) throw new ToolError(cdp.dialogText(d), "js_dialog_open");
}

// Works for elements inside iframes too (refs like ref_f12_3).
const refPoint = (tabId, ref) => refCenter(tabId, ref);

async function point(tabId, args) {
  if (args.ref && args.coordinate) throw new ToolError("Pass either ref or coordinate, not both.", "input_invalid");
  if (args.ref) return { css: await refPoint(tabId, args.ref), label: `element ${args.ref}` };
  if (!args.coordinate) throw new ToolError("coordinate [x, y] or ref is required for this action.", "input_invalid");
  const css = shots.toViewport(tabId, args.coordinate);
  return { css, label: `(${args.coordinate[0]}, ${args.coordinate[1]})` };
}

const mouse = (tabId, p) => cdp.send(tabId, "Input.dispatchMouseEvent", p, 6000);

async function click(tabId, [x, y], { button = "left", count = 1, modifiers = 0 }) {
  const buttons = button === "right" ? 2 : 1;
  lastPoint.set(tabId, [x, y]);
  await glide(tabId, x, y);
  await mouse(tabId, { type: "mouseMoved", x, y, button: "none", modifiers });
  for (let i = 1; i <= count; i++) {
    await cursor(tabId, x, y, true);
    await mouse(tabId, { type: "mousePressed", x, y, button, buttons, clickCount: i, modifiers });
    await sleep(12);
    await mouse(tabId, { type: "mouseReleased", x, y, button, buttons: 0, clickCount: i, modifiers });
    await cursor(tabId, x, y, false);
    if (i < count) await sleep(100);
  }
}

async function keyEvent(tabId, desc, modifiers) {
  const base = { key: desc.key, code: desc.code, windowsVirtualKeyCode: desc.keyCode, nativeVirtualKeyCode: desc.keyCode, modifiers };
  if (desc.text) await cdp.send(tabId, "Input.dispatchKeyEvent", { ...base, type: "keyDown", text: desc.text, unmodifiedText: desc.text });
  else await cdp.send(tabId, "Input.dispatchKeyEvent", { ...base, type: "rawKeyDown" });
  await cdp.send(tabId, "Input.dispatchKeyEvent", { ...base, type: "keyUp" });
}

async function typeText(tabId, text) {
  let buffer = "";
  const flush = async () => { if (buffer) { await cdp.send(tabId, "Input.insertText", { text: buffer }); buffer = ""; } };
  for (const ch of text) {
    const d = charKey(ch);
    if (!d) { buffer += ch; continue; }
    await flush();
    await keyEvent(tabId, d, d.shift ? 8 : 0);
  }
  await flush();
}

async function screenshotResult(tabId, scale, prefix = "") {
  const s = await shots.capture(tabId, { scale });
  const id = "ss_" + String(Date.now()).slice(-4) + Math.random().toString(36).slice(2, 7);
  let msg = `${prefix}Successfully captured screenshot (${s.width}x${s.height}, jpeg) - ID: ${id}`;
  if (s.width !== s.frame.width) msg += ` — ${scale}-scale view; coordinate frame: ${s.frame.width}x${s.frame.height}.`;
  return { content: [{ type: "text", text: msg }, { type: "image", mimeType: "image/jpeg", data: s.data }], imageId: id, imageData: s.full || s.data, imageMime: s.full ? "image/png" : "image/jpeg" };
}

/** Is the element under this CSS point a link or a submit control (a click likely navigates)? */
async function looksNavigational(tabId, [x, y]) {
  try {
    const r = await cdp.send(tabId, "Runtime.evaluate", {
      expression: `(() => { const e = document.elementFromPoint(${x}, ${y});
        return !!(e && (e.tagName === "IFRAME" || e.closest('a[href], button[type=submit], input[type=submit], form button:not([type])'))); })()`,
      returnByValue: true,
    });
    return r.result?.value === true;
  } catch { return false; }
}

/**
 * Give a click/Enter that may navigate time to do so, so the result (and the tab context
 * after it) reflects the new page. Single-page apps change the URL only after a fetch, so
 * watch for up to watchMs; once a change starts, wait for the load to finish (max 8 s).
 */
async function settleNavigation(tabId, startUrl, watchMs) {
  const get = () => chrome.tabs.get(tabId).catch(() => null);
  const t0 = Date.now();
  let moved = false;
  await sleep(100);
  while (Date.now() - t0 < watchMs) {
    const t = await get();
    if (!t) return;
    if (t.status === "loading" || t.url !== startUrl) { moved = true; break; }
    await sleep(100);
  }
  if (!moved) return;
  const t1 = Date.now();
  while (Date.now() - t1 < 8000) {
    const t = await get();
    if (!t || t.status === "complete") break;
    await sleep(100);
  }
  await sleep(150);
}

export async function computer(args) {
  try {
    return await run(args);
  } catch (e) {
    // The action itself went through and the page then opened a dialog (e.g. a click on a
    // button that calls alert()): report it as done, with the dialog, so the agent can react.
    if (e.code === "js_dialog_opened") {
      const what = { left_click: "Clicked", right_click: "Right-clicked", double_click: "Double-clicked", triple_click: "Triple-clicked", type: "Typed", key: "Pressed keys" }[args.action] || `Performed ${args.action}`;
      return `${what}${args.ref ? ` on element ${args.ref}` : ""}. ${e.message}`;
    }
    throw e;
  }
}

async function run(args) {
  const { action, tabId } = args;
  if (!action) throw new ToolError("action is required", "input_invalid");
  if (action !== "wait") assertNoDialog(tabId);
  const modifiers = modBits(args.modifiers);
  lastPoint.delete(tabId);

  switch (action) {
    case "screenshot":
      return screenshotResult(tabId, args.scale);

    case "zoom": {
      const z = await shots.zoom(tabId, args.region, { scale: args.scale });
      return { content: [
        { type: "text", text: `Successfully captured zoomed screenshot of region (${args.region[0]}, ${args.region[1]}) to (${args.region[2]}, ${args.region[3]}) - ${z.width}x${z.height} pixels` },
        { type: "image", mimeType: "image/png", data: z.data },
      ] };
    }

    case "left_click":
    case "right_click":
    case "double_click":
    case "triple_click": {
      const { css, label } = await point(tabId, args);
      const count = { left_click: 1, right_click: 1, double_click: 2, triple_click: 3 }[action];
      const before = new Set((await chrome.tabs.query({})).map((t) => t.id));
      const navish = action === "left_click" && await looksNavigational(tabId, css);
      const startUrl = navish ? (await chrome.tabs.get(tabId)).url : null;
      await click(tabId, css, { button: action === "right_click" ? "right" : "left", count, modifiers });
      const verb = { left_click: "Clicked", right_click: "Right-clicked", double_click: "Double-clicked", triple_click: "Triple-clicked" }[action];
      let out = args.ref ? `${verb} on ${label}` : `${verb} at ${label}`;
      if (action === "left_click") {
        if (navish) await settleNavigation(tabId, startUrl, 1500);
        else await sleep(300);
        const fresh = (await chrome.tabs.query({})).find((t) => !before.has(t.id) && t.openerTabId === tabId);
        if (fresh) out += ` [note: the link opened in a new tab (tab ID ${fresh.id}); it is outside the agent group until you move to it]`;
      }
      return out;
    }

    case "hover": {
      const { css, label } = await point(tabId, args);
      lastPoint.set(tabId, css);
      await glide(tabId, css[0], css[1]);
      await mouse(tabId, { type: "mouseMoved", x: css[0], y: css[1], button: "none", modifiers });
      return args.ref ? `Hovered over ${label}` : `Hovered at ${label}`;
    }

    case "left_click_drag": {
      if (!args.start_coordinate || !args.coordinate) throw new ToolError("start_coordinate and coordinate are required for left_click_drag", "input_invalid");
      const [sx, sy] = shots.toViewport(tabId, args.start_coordinate);
      const [ex, ey] = shots.toViewport(tabId, args.coordinate);
      try {
        await mouse(tabId, { type: "mouseMoved", x: sx, y: sy, button: "none" });
        await mouse(tabId, { type: "mousePressed", x: sx, y: sy, button: "left", buttons: 1, clickCount: 1 });
        for (let i = 1; i <= 5; i++) {
          const x = Math.round(sx + ((ex - sx) * i) / 5), y = Math.round(sy + ((ey - sy) * i) / 5);
          await cursor(tabId, x, y, true);
          await mouse(tabId, { type: "mouseMoved", x, y, button: "left", buttons: 1 });
          await sleep(16);
        }
        await mouse(tabId, { type: "mouseReleased", x: ex, y: ey, button: "left", buttons: 0, clickCount: 1 });
        lastPoint.set(tabId, [ex, ey]);
      } catch (e) {
        await cdp.send(tabId, "Input.cancelDragging").catch(() => {});
        throw e;
      }
      return `Dragged from (${args.start_coordinate[0]}, ${args.start_coordinate[1]}) to (${args.coordinate[0]}, ${args.coordinate[1]})`;
    }

    case "type": {
      if (typeof args.text !== "string") throw new ToolError("text is required for type", "input_invalid");
      await typeText(tabId, args.text);
      return `Typed "${args.text}"`;
    }

    case "key": {
      if (!args.text) throw new ToolError("text (key names) is required for key", "input_invalid");
      const repeat = Math.max(1, Math.min(100, Math.floor(Number(args.repeat) || 1)));
      const tokens = String(args.text).trim().split(/\s+/);
      let combos;
      try { combos = tokens.map(parseCombo); } catch (e) { throw new ToolError(e.message, "input_invalid"); }
      if (combos.some(isZoomCombo)) throw new ToolError("Page zoom shortcuts are not supported; use computer zoom to magnify a region.", "page_zoom_shortcut_unsupported");
      const hasEnter = combos.some((c) => c.desc?.key === "Enter");
      const startUrl = hasEnter ? (await chrome.tabs.get(tabId)).url : null;
      let n = 0;
      for (let r = 0; r < repeat; r++) {
        for (const c of combos) {
          if (isReloadCombo(c)) { await chrome.tabs.reload(tabId, { bypassCache: !!(c.modifiers & 8) }); n++; continue; }
          await keyEvent(tabId, c.desc, c.modifiers | modifiers);
          n++;
        }
      }
      if (hasEnter) await settleNavigation(tabId, startUrl, 1000);
      return `Pressed ${n} key${n === 1 ? "" : "s"}:${tokens.join(" ")}${repeat > 1 ? ` (x${repeat})` : ""}`;
    }

    case "scroll": {
      const dir = args.scroll_direction || "down";
      const amount = Math.max(1, Math.min(10, Number(args.scroll_amount) || 3));
      const { css, label } = args.coordinate || args.ref ? await point(tabId, args) : { css: [100, 100], label: "(page)" };
      const d = amount * 100;
      const deltaX = dir === "left" ? -d : dir === "right" ? d : 0;
      const deltaY = dir === "up" ? -d : dir === "down" ? d : 0;
      try {
        await mouse(tabId, { type: "mouseWheel", x: css[0], y: css[1], deltaX, deltaY });
      } catch {
        await chrome.scripting.executeScript({
          target: { tabId }, injectImmediately: true,
          func: (x, y, dx, dy) => {
            let el = document.elementFromPoint(x, y);
            while (el && el !== document.body) {
              const cs = getComputedStyle(el);
              if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)) { el.scrollBy(dx, dy); return; }
              el = el.parentElement;
            }
            scrollBy(dx, dy);
          },
          args: [css[0], css[1], deltaX, deltaY],
        });
      }
      await sleep(200);
      const done = `Scrolled ${dir} by ${amount} ticks at ${label}`;
      return screenshotResult(tabId, 1, `${done}\n`).catch((e) => {
        if (e.code === "screenshot_not_drawn") return `${done} (no screenshot: ${e.message})`;
        throw e;
      });
    }

    case "scroll_to": {
      if (!args.ref) throw new ToolError("ref is required for scroll_to", "input_invalid");
      await refPoint(tabId, args.ref);
      return `Scrolled to element with reference: ${args.ref}`;
    }

    case "wait": {
      const s = Number(args.duration);
      if (!(s > 0 && s <= 10)) throw new ToolError("duration must be > 0 and <= 10 seconds", "input_invalid");
      await sleep(s * 1000);
      return `Waited for ${s} second${s === 1 ? "" : "s"}`;
    }

    default:
      throw new ToolError(`Unknown action "${action}"`, "input_invalid");
  }
}
