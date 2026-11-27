// gif_creator: records a frame after each browser action and exports an animated GIF.
import * as cdp from "./cdp.js";
import { GifWriter } from "./gif-encoder.js";
import { ToolError } from "./router.js";

const MAX_FRAMES = 100;
const MAX_WIDTH = 800;
const LABEL_H = 24;

const state = { recording: false, frames: [], dropped: 0, startedAt: null };

export const isRecording = () => state.recording;

async function overlay(tabId, type) {
  try { await chrome.tabs.sendMessage(tabId, { type }); } catch {}
}

/** Capture one frame of tabId. point is the action's CSS-pixel position (clicks), label its caption. */
export async function recordFrame(tabId, label, point = null) {
  if (!state.recording) return;
  if (state.frames.length >= MAX_FRAMES) { state.dropped++; return; }
  await overlay(tabId, "TCA_HIDE_FOR_TOOL");
  try {
    const v = (await cdp.send(tabId, "Runtime.evaluate", { expression: "({w:innerWidth,h:innerHeight})", returnByValue: true })).result.value;
    // Short timeout: a background tab may not be drawn; skipping one frame beats stalling the action.
    const shot = await cdp.send(tabId, "Page.captureScreenshot", { format: "jpeg", quality: 70, fromSurface: true }, 5000);
    state.frames.push({ data: shot.data, vw: v.w, vh: v.h, label: String(label || "").slice(0, 140), point, tabId, at: Date.now() });
  } catch {
    // A frame that cannot be captured (e.g. a protected page) is skipped.
  } finally {
    await overlay(tabId, "TCA_SHOW_AFTER_TOOL");
  }
}

async function decode(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
}

function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function exportGif({ showClickIndicators = true, showActionLabels = true, frameDelayMs = 800 } = {}) {
  const frames = state.frames;
  const W = Math.max(2, Math.min(MAX_WIDTH, frames[0].vw));
  const H = Math.max(2, Math.round((W * frames[0].vh) / frames[0].vw));
  const labelH = showActionLabels ? LABEL_H : 0;
  const canvas = new OffscreenCanvas(W, H + labelH);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const gif = new GifWriter(W, H + labelH);
  const delay = Math.max(100, Math.min(10000, Number(frameDelayMs) || 800));

  for (const [i, f] of frames.entries()) {
    const bmp = await decode(f.data);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H + labelH);
    // Fit the frame (it may have another size if the window was resized) into W x H.
    const s = Math.min(W / f.vw, H / f.vh);
    const dw = f.vw * s, dh = f.vh * s, dx = (W - dw) / 2, dy = (H - dh) / 2;
    ctx.drawImage(bmp, dx, dy, dw, dh);
    bmp.close?.();
    if (showClickIndicators && f.point) {
      const x = dx + f.point[0] * s, y = dy + f.point[1] * s;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(230,40,40,0.95)";
      ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "rgba(230,40,40,0.95)";
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    }
    if (labelH) {
      ctx.fillStyle = "#1b1b1b";
      ctx.fillRect(0, H, W, labelH);
      ctx.fillStyle = "#fff";
      ctx.font = "13px sans-serif";
      ctx.textBaseline = "middle";
      let text = `${i + 1}/${frames.length}  ${f.label}`;
      while (text.length > 4 && ctx.measureText(text).width > W - 12) text = text.slice(0, -2);
      ctx.fillText(text, 6, H + labelH / 2);
    }
    const img = ctx.getImageData(0, 0, W, H + labelH);
    gif.addFrame(img.data, i === frames.length - 1 ? Math.max(delay, 2000) : delay);
    if (i % 5 === 4) await new Promise((r) => setTimeout(r, 0)); // keep the worker responsive
  }
  return { bytes: gif.finish(), width: W, height: H + labelH };
}

/** The gif_creator tool. */
export async function gifCreator({ tabId, action, filename, options }) {
  switch (action) {
    case "start_recording": {
      state.recording = true;
      state.frames = [];
      state.dropped = 0;
      state.startedAt = Date.now();
      await recordFrame(tabId, "start");
      return `Started recording. A frame is captured after each computer/navigate action (max ${MAX_FRAMES}). Call gif_creator stop_recording, then export.`;
    }
    case "stop_recording": {
      if (!state.recording) return `Not recording. ${state.frames.length} frame(s) are kept for export.`;
      await recordFrame(tabId, "end");
      state.recording = false;
      return `Stopped recording: ${state.frames.length} frame(s)${state.dropped ? `, ${state.dropped} dropped over the ${MAX_FRAMES}-frame limit` : ""}. Call gif_creator export to save the GIF.`;
    }
    case "export": {
      if (!state.frames.length) throw new ToolError("No frames recorded. Call gif_creator start_recording, act on the page, then stop_recording.", "gif_no_frames");
      const { bytes, width, height } = await exportGif(options || {});
      let name = String(filename || `recording-${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}.gif`);
      name = name.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
      if (!/\.gif$/i.test(name)) name += ".gif";
      return { content: [
        { type: "text", text: `Encoded GIF: ${state.frames.length} frames, ${width}x${height}, ${(bytes.length / 1024).toFixed(1)} KB.` },
        { type: "file", name, mimeType: "image/gif", data: toBase64(bytes) },
      ] };
    }
    case "clear": {
      const n = state.frames.length;
      state.frames = [];
      state.recording = false;
      state.dropped = 0;
      return `Cleared ${n} frame(s); recording is off.`;
    }
    default:
      throw new ToolError('action must be one of "start_recording", "stop_recording", "export", "clear"', "input_invalid");
  }
}
