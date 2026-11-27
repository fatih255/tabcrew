// iframe support. The content script (content/a11y.js) runs in every frame and hands out
// frame-local refs ("ref_N"). Tools see global refs:
//   ref_N           element in the top document
//   ref_f<F>_N      element ref_N inside frame F (Chrome frameId)
import { ToolError } from "./router.js";
import * as cdp from "./cdp.js";

export function parseRef(ref) {
  const m = /^ref_f(\d+)_(\d+)$/.exec(String(ref || ""));
  if (m) return { frameId: Number(m[1]), local: `ref_${m[2]}` };
  return { frameId: 0, local: String(ref) };
}

export const globalRef = (frameId, local) => (frameId ? local.replace(/^ref_(\d+)$/, `ref_f${frameId}_$1`) : local);

/** Rewrite the "[ref_N]" ids in text produced by frame F into global refs. */
export const globalizeText = (frameId, text) => (frameId ? text.replace(/\bref_(\d+)\b/g, `ref_f${frameId}_$1`) : text);

export async function runIn(tabId, frameId, func, args = []) {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func, args, injectImmediately: true });
    return res?.result;
  } catch (e) {
    throw new ToolError(`Could not run in ${frameId ? `frame ${frameId}` : "page"}: ${e.message}`, frameId && /No frame|frame/i.test(e.message) ? "ref_stale" : "injected_script_failed");
  }
}

/** Make sure the content script is present in the given frame (e.g. pages loaded before install). */
export async function ensureContent(tabId, frameId = 0) {
  const ok = await runIn(tabId, frameId, () => !!window.__tca).catch(() => false);
  if (!ok) await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ["content/a11y.js"], injectImmediately: true });
}

/** Run func in every frame of the tab where the content script can run. Returns [{frameId, result}]. */
const FRAME_MS = 5000;
export async function runInAll(tabId, func, args = []) {
  // Inject the content script where it is missing, then run the real function.
  // Frame by frame with a time limit: one frame that never answers (an ad or a frame still loading)
  // must not hang the whole call. Only the top frame's failure is an error.
  const frames = (await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null)) || [{ frameId: 0 }];
  const limit = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("frame did not answer within 5 s")), FRAME_MS))]);
  const results = await Promise.all(frames.map(async (f) => {
    try {
      await limit(ensureContent(tabId, f.frameId)).catch(() => {});
      const [r] = await limit(chrome.scripting.executeScript({ target: { tabId, frameIds: [f.frameId] }, func, args, injectImmediately: true }));
      return { frameId: f.frameId, result: r?.result };
    } catch (e) {
      if (f.frameId === 0) throw new ToolError(`Could not run in page: ${e.message}`, "injected_script_failed");
      return null;
    }
  }));
  return results.filter(Boolean);
}

/** Chain of frame ids from frameId up to (excluding) the top frame: [frameId, parent, ...]. */
async function ancestry(tabId, frameId) {
  const chain = [];
  let id = frameId;
  for (let guard = 0; id > 0 && guard < 10; guard++) {
    const f = await chrome.webNavigation.getFrame({ tabId, frameId: id });
    if (!f) throw new ToolError(`Frame ${frameId} no longer exists; call read_page again.`, "ref_stale");
    chain.push({ frameId: id, parentFrameId: f.parentFrameId });
    id = f.parentFrameId;
  }
  return chain;
}

/** A frame's index in its parent's window.frames (-1 if unknown). */
async function indexInParent(tabId, frameId) {
  await ensureContent(tabId, frameId);
  const i = await runIn(tabId, frameId, () => (window.__tca ? window.__tca.indexInParent() : -1));
  return typeof i === "number" ? i : -1;
}

/** Map window.frames index -> Chrome frameId for the direct children of parentId. */
export async function childFrames(tabId, parentId) {
  const all = (await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null)) || [];
  const map = new Map();
  await Promise.all(all.filter((f) => f.parentFrameId === parentId).map(async (f) => {
    const i = await indexInParent(tabId, f.frameId).catch(() => -1);
    if (i >= 0) map.set(i, f.frameId);
  }));
  return map;
}

/** In frame parentId: the content-box offset of the iframe element that hosts childId. */
async function iframeOffset(tabId, parentId, childId, scroll) {
  const idx = await indexInParent(tabId, childId);
  const r = idx < 0 ? null : await runIn(tabId, parentId, (i, s) => window.__tca?.frameBox(i, s) || null, [idx, scroll]);
  if (!r) throw new ToolError(`The iframe for frame ${childId} was not found; call read_page again.`, "ref_stale");
  return r;
}

/**
 * Scroll the element into view and return its centre in top-level CSS pixels.
 * Works for elements inside (nested, cross-origin) iframes.
 */
export async function refCenter(tabId, ref) {
  const { frameId, local } = parseRef(ref);
  const chain = frameId ? await ancestry(tabId, frameId) : [];
  // Bring each iframe into view, outermost first, before scrolling inside it.
  for (const link of [...chain].reverse()) await iframeOffset(tabId, link.parentFrameId, link.frameId, true);
  const c = await runIn(tabId, frameId, (r) => window.__tca?.center(r) || null, [local]);
  if (!c) throw new ToolError(`Element ${ref} not found; it may have been removed from the page. Call read_page or find again.`, "ref_stale");
  let x = c.x, y = c.y;
  for (const link of chain) {
    const o = await iframeOffset(tabId, link.parentFrameId, link.frameId, false);
    x += o.x; y += o.y;
  }
  // After scrolling, hit-testing for out-of-process (cross-site) frames is updated only when
  // the compositor draws a frame; an input event sent before that is dropped. Chrome draws
  // background tabs only now and then, so force a frame with a throwaway capture (the same
  // wake-up the screenshot uses; the tab is not brought to the front), then give it a moment.
  if (chain.length) {
    await cdp.send(tabId, "Page.captureScreenshot", { format: "jpeg", quality: 1 }, 3000).catch(() => {});
    await new Promise((r) => setTimeout(r, 150));
  }
  return [Math.round(x), Math.round(y)];
}
