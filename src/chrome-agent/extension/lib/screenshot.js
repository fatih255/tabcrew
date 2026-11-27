// Screenshots sized to a vision-token budget, plus the per-tab coordinate frame
// that maps screenshot pixels back to CSS pixels for clicks.
import * as cdp from "./cdp.js";
import { ToolError } from "./router.js";

const PX_PER_TOKEN = 28;
const MAX_SIDE = 1568;
const MAX_TOKENS = 1568;
const MAX_B64 = 1_398_100;

const frames = new Map(); // tabId -> {sw, sh, vw, vh}
export const getFrame = (tabId) => frames.get(tabId) || null;
export const clearFrame = (tabId) => frames.delete(tabId);

/** Largest size with the same aspect ratio that fits both side and token limits. Pure. */
export function fitBudget(w, h) {
  const fits = (a, b) => a <= MAX_SIDE && b <= MAX_SIDE && Math.ceil(a / PX_PER_TOKEN) * Math.ceil(b / PX_PER_TOKEN) <= MAX_TOKENS;
  if (fits(w, h)) return { width: w, height: h };
  const long = Math.max(w, h), ratio = Math.min(w, h) / long;
  let lo = 1, hi = Math.min(long, MAX_SIDE);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const s = Math.max(1, Math.round(mid * ratio));
    if (fits(mid, s)) lo = mid; else hi = mid - 1;
  }
  const short = Math.max(1, Math.round(lo * ratio));
  return w >= h ? { width: lo, height: short } : { width: short, height: lo };
}

/** Map a coordinate given in screenshot pixels to CSS viewport pixels. */
export function toViewport(tabId, [x, y]) {
  x = Number(x); y = Number(y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new ToolError("coordinate must be [x, y] numbers", "input_invalid");
  const f = frames.get(tabId);
  if (!f) return [Math.round(x), Math.round(y)];
  if (x < 0 || y < 0 || x >= f.sw + 2 || y >= f.sh + 2) {
    throw new ToolError(`Coordinate (${x}, ${y}) is outside the coordinate frame (${f.sw}x${f.sh}) of the last screenshot.`, "coordinate_out_of_bounds");
  }
  return [Math.round((x * f.vw) / f.sw), Math.round((y * f.vh) / f.sh)];
}

async function probe(tabId) {
  const r = await cdp.send(tabId, "Runtime.evaluate", {
    expression: "({w:innerWidth,h:innerHeight,dpr:devicePixelRatio,sx:scrollX,sy:scrollY,vis:document.visibilityState})",
    returnByValue: true,
  });
  return r.result.value;
}

/**
 * A hidden (background) tab draws no frames; as the reference extension does, force one with a
 * throwaway low-quality capture before measuring. The tab and window are never brought to the
 * front, so the user's own browsing is not disturbed.
 */
async function ensureVisible(tabId) {
  const p = await probe(tabId);
  if (p.vis !== "hidden") return p;
  await cdp.send(tabId, "Page.captureScreenshot", { format: "jpeg", quality: 1 }, 5000).catch(() => {});
  return probe(tabId);
}

/**
 * Viewport PNG. Chrome draws background tabs only now and then, so a capture can stall; it is
 * retried once (measured: a stalled capture often succeeds on the next try). The tab is never
 * activated. If both stall, the error tells the agent why instead of a bare timeout.
 */
async function grab(tabId) {
  const params = { format: "png", captureBeyondViewport: false, fromSurface: true };
  try {
    return await cdp.send(tabId, "Page.captureScreenshot", params, 8000);
  } catch (e) {
    if (!/timed out/i.test(e.message)) throw e;
  }
  try {
    return await cdp.send(tabId, "Page.captureScreenshot", params, 12000);
  } catch (e) {
    if (!/timed out/i.test(e.message)) throw e;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    throw new ToolError(`Could not capture tab ${tabId}: Chrome is not drawing it${tab && !tab.active ? " because it is a background tab" : " (its window may be minimized or covered)"}. ` +
      "Other tools (read_page, find, get_page_text, clicks by ref) still work; for a screenshot, ask the user to switch to this tab.", "screenshot_not_drawn");
  }
}

async function overlay(tabId, type) {
  try { await chrome.tabs.sendMessage(tabId, { type }); } catch {}
}

async function encode(bitmap, w, h, format, quality) {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob = await canvas.convertToBlob({ type: `image/${format}`, quality });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}

async function b64ToBitmap(b64, mime) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return createImageBitmap(new Blob([bytes], { type: mime }));
}

/** Viewport screenshot, budget-scaled; records the coordinate frame. */
export async function capture(tabId, { scale = 1 } = {}) {
  await overlay(tabId, "TCA_HIDE_FOR_TOOL");
  try {
    await new Promise((r) => setTimeout(r, 50));
    const p = await ensureVisible(tabId);
    const shot = await grab(tabId);
    const bmp = await b64ToBitmap(shot.data, "image/png");
    const full = fitBudget(p.w, p.h); // CSS-pixel frame, budget-limited
    const s = Math.min(1, Math.max(0.1, Number(scale) || 1));
    const out = { width: Math.max(1, Math.round(full.width * s)), height: Math.max(1, Math.round(full.height * s)) };
    let q = 0.75, data;
    do { data = await encode(bmp, out.width, out.height, "jpeg", q); q -= 0.05; } while (data.length > MAX_B64 && q > 0.1);
    bmp.close?.();
    // Coordinates are always expressed in the full-scale frame, even for a scaled view.
    frames.set(tabId, { sw: full.width, sh: full.height, vw: p.w, vh: p.h });
    // full: the untouched PNG capture, kept for upload_image (the JPEG above may be scaled down).
    return { data, full: shot.data, width: out.width, height: out.height, frame: full, viewport: { width: p.w, height: p.h }, format: "jpeg" };
  } finally {
    await overlay(tabId, "TCA_SHOW_AFTER_TOOL");
  }
}

/** Zoomed PNG of a region given in screenshot coordinates. */
export async function zoom(tabId, region, { scale = 1 } = {}) {
  if (!Array.isArray(region) || region.length !== 4) throw new ToolError("region must be [x0, y0, x1, y1]", "input_invalid");
  const [x0, y0] = toViewport(tabId, [region[0], region[1]]);
  const [x1, y1] = toViewport(tabId, [region[2], region[3]]);
  if (x1 <= x0 || y1 <= y0) throw new ToolError("region must have x1 > x0 and y1 > y0", "input_invalid");
  const p = await ensureVisible(tabId);
  if (x1 > p.w + 2 || y1 > p.h + 2) throw new ToolError("region is outside the viewport", "coordinate_out_of_bounds");
  const w = x1 - x0, h = y1 - y0;
  const physical = fitBudget(Math.round(w * p.dpr), Math.round(h * p.dpr));
  const s = Math.min(1, Math.max(0.1, Number(scale) || 1));
  const outW = Math.max(1, Math.round(physical.width * s));
  await overlay(tabId, "TCA_HIDE_FOR_TOOL");
  try {
    // Crop a normal viewport capture (device pixels) instead of a clip+scale capture: the
    // latter asks the compositor for a fresh frame at a new scale, which never comes for a
    // window that is covered or in the background.
    const shot = await grab(tabId);
    const full = await b64ToBitmap(shot.data, "image/png");
    const k = full.width / p.w; // device pixels per CSS pixel in this capture
    const sx = Math.round(x0 * k), sy = Math.round(y0 * k);
    const sw = Math.max(1, Math.min(full.width - sx, Math.round(w * k))), sh = Math.max(1, Math.min(full.height - sy, Math.round(h * k)));
    const bmp = await createImageBitmap(full, sx, sy, sw, sh);
    full.close?.();
    const W = Math.min(sw, outW), H = Math.max(1, Math.round((W * h) / w));
    const data = await encode(bmp, W, H, "png");
    bmp.close?.();
    return { data, width: W, height: H, region: [x0, y0, x1, y1], format: "png" };
  } finally {
    await overlay(tabId, "TCA_SHOW_AFTER_TOOL");
  }
}
