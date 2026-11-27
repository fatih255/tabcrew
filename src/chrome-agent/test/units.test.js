import "./chrome-stub.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Router, ToolError } from "../extension/lib/router.js";
import { parseCombo, charKey, isZoomCombo, isReloadCombo } from "../extension/lib/keys.js";
import { fitBudget } from "../extension/lib/screenshot.js";
import { sanitize, imageFilename } from "../extension/lib/page-tools.js";
import { TOOLS, SERVER_TOOLS } from "../shared/tools.js";
import { lzw, encodeGif, palette, quantize } from "../extension/lib/gif-encoder.js";
import { parseRef, globalRef, globalizeText } from "../extension/lib/frames.js";

test("router: unknown tool -> error envelope", async () => {
  const r = new Router();
  const env = await r.dispatch({ id: "1", tool: "nope", args: {} });
  assert.equal(env.type, "tool_response");
  assert.equal(env.error.code, "unknown_tool");
});

test("router: handler throws -> error envelope with code", async () => {
  const r = new Router();
  r.register("x", () => { throw new ToolError("boom", "custom"); });
  const env = await r.dispatch({ id: "2", tool: "x" });
  assert.deepEqual(env.error, { message: "boom", code: "custom" });
});

test("router: timeout", async () => {
  const r = new Router();
  r.register("slow", () => new Promise((res) => setTimeout(res, 500)), { timeoutMs: 50 });
  const env = await r.dispatch({ id: "3", tool: "slow" });
  assert.equal(env.error.code, "timeout");
});

test("router: cancel", async () => {
  const r = new Router();
  r.register("slow", () => new Promise((res) => setTimeout(res, 500)));
  const p = r.dispatch({ id: "4", tool: "slow" });
  setTimeout(() => r.cancel("4"), 20);
  assert.equal((await p).error.code, "cancelled");
});

test("router: happy path normalizes strings", async () => {
  const r = new Router();
  r.register("ok", (a) => `hi ${a.n}`);
  const env = await r.dispatch({ id: "5", tool: "ok", args: { n: 1 } });
  assert.deepEqual(env.result, { content: [{ type: "text", text: "hi 1" }] });
});

test("keys: combos and characters", () => {
  assert.deepEqual(parseCombo("ctrl+a").modifiers, 2);
  assert.equal(parseCombo("Enter").desc.key, "Enter");
  assert.equal(parseCombo("shift+Tab").modifiers, 8);
  assert.equal(parseCombo("shift+a").desc.text, "A");
  assert.equal(parseCombo("cmd+shift+z").modifiers, 12);
  assert.equal(parseCombo("ctrl+a").desc.text, undefined);
  assert.equal(charKey("A").shift, true);
  assert.equal(charKey("!").code, "Digit1");
  assert.equal(charKey("ş"), null);
  assert.ok(isZoomCombo(parseCombo("ctrl+0")));
  assert.ok(isReloadCombo(parseCombo("F5")));
  assert.ok(isReloadCombo(parseCombo("ctrl+r")));
  assert.throws(() => parseCombo("hyper+a"));
  assert.equal(parseCombo("ctrl++").desc.key, "+");
});

test("screenshot budget", () => {
  assert.deepEqual(fitBudget(800, 600), { width: 800, height: 600 });
  const b = fitBudget(1920, 1080);
  assert.ok(b.width <= 1568 && b.height <= 1568);
  assert.ok(Math.ceil(b.width / 28) * Math.ceil(b.height / 28) <= 1568);
  assert.ok(Math.abs(b.width / b.height - 1920 / 1080) < 0.02);
  const tall = fitBudget(800, 6000);
  assert.ok(tall.height <= 1568 && tall.width < tall.height);
});

test("sanitize redacts secrets", () => {
  const out = sanitize({ password: "x", user: "bob", jwt: "eyJhbGciOi.eyJzdWIiOjF9.abc", list: Array(150).fill(1), cookie: "a=1; b=2" });
  assert.equal(out.password, "[redacted]");
  assert.equal(out.cookie, "[redacted]");
  assert.equal(out.user, "bob");
  assert.equal(out.jwt, "[redacted]");
  assert.equal(out.list.length, 101);
});

test("sanitize keeps URLs readable but masks tokens in them", () => {
  // A URL with a query string looked like a cookie string and was redacted whole (location.href on Google).
  const plain = "https://www.google.com/search?q=Ada+Lovelace&sca_esv=1&source=hp";
  assert.equal(sanitize(plain), plain);
  const stats = { redacted: 0 };
  assert.equal(sanitize("https://x.test/cb?code=1&access_token=abc123&state=z", 0, new WeakSet(), stats), "https://x.test/cb?code=1&access_token=[redacted]&state=z");
  assert.equal(stats.redacted, 1);
  assert.equal(sanitize("a=1; b=2"), "[redacted]"); // cookie strings are still redacted
});

test("tool catalogue is well-formed", () => {
  const names = new Set();
  for (const t of TOOLS) {
    assert.ok(/^[a-z_]+$/.test(t.name));
    assert.ok(!names.has(t.name)); names.add(t.name);
    assert.equal(t.inputSchema.type, "object");
    assert.ok(t.description.length > 20);
  }
  for (const t of SERVER_TOOLS) { assert.ok(!names.has(t.name)); names.add(t.name); }
  assert.equal(names.size, 26);
});

// Reference GIF LZW decoder (written from the GIF89a spec) to check the encoder.
function unlzw(bytes, minCodeSize) {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let size = minCodeSize + 1, dict = [], prev = null, out = [];
  const reset = () => { dict = []; for (let i = 0; i < clear; i++) dict[i] = [i]; dict[clear] = null; dict[eoi] = null; size = minCodeSize + 1; prev = null; };
  reset();
  let acc = 0, n = 0, pos = 0;
  for (;;) {
    while (n < size) { if (pos >= bytes.length) return out; acc |= bytes[pos++] << n; n += 8; }
    const code = acc & ((1 << size) - 1); acc >>>= size; n -= size;
    if (code === clear) { reset(); continue; }
    if (code === eoi) return out;
    let entry;
    if (code < dict.length && dict[code]) entry = dict[code];
    else if (code === dict.length && prev) entry = [...prev, prev[0]];
    else throw new Error("bad code " + code);
    out.push(...entry);
    if (prev && dict.length < 4096) dict.push([...prev, entry[0]]);
    if (dict.length === (1 << size) && size < 12) size++;
    prev = entry;
  }
}

test("gif: LZW round-trips (incl. table resets)", () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (const input of [[], [5], Array(5000).fill(3), Array.from({ length: 60000 }, () => Math.floor(rnd() * 252)), Array.from({ length: 20000 }, (_, i) => (i >> 4) % 200)]) {
    assert.deepEqual(unlzw(lzw(input, 8), 8), input);
  }
});

test("gif: file structure", () => {
  const w = 3, h = 2;
  const rgba = new Uint8Array(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : i * 20));
  const gif = encodeGif([{ rgba, delayMs: 500 }, { rgba, delayMs: 1000 }], w, h);
  assert.equal(Buffer.from(gif.subarray(0, 6)).toString(), "GIF89a");
  assert.equal(gif[6] | (gif[7] << 8), 3);
  assert.equal(gif[gif.length - 1], 0x3b);
  assert.equal(palette().length, 768);
  const idx = quantize(rgba, w, h);
  assert.ok(idx.every((v) => v < 252));
  // count image descriptors by walking the blocks
  let p = 13 + 768, frames = 0;
  while (gif[p] !== 0x3b) {
    if (gif[p] === 0x21) { p += 2; while (gif[p]) p += gif[p] + 1; p++; }
    else if (gif[p] === 0x2c) { frames++; p += 10; p++; while (gif[p]) p += gif[p] + 1; p++; }
    else throw new Error("bad block " + gif[p]);
  }
  assert.equal(frames, 2);
});

test("frames: global refs", () => {
  assert.deepEqual(parseRef("ref_12"), { frameId: 0, local: "ref_12" });
  assert.deepEqual(parseRef("ref_f7_3"), { frameId: 7, local: "ref_3" });
  assert.equal(globalRef(7, "ref_3"), "ref_f7_3");
  assert.equal(globalRef(0, "ref_3"), "ref_3");
  assert.equal(globalizeText(9, 'button "x" [ref_4]'), 'button "x" [ref_f9_4]');
});

test("upload_image: file extension follows the image bytes", () => {
  assert.equal(imageFilename("image.png", "image/png"), "image.png");
  assert.equal(imageFilename("shot.jpg", "image/png"), "shot.png");
  assert.equal(imageFilename("ekran.png", "image/jpeg"), "ekran.jpg");
  assert.equal(imageFilename("photo.jpeg", "image/jpeg"), "photo.jpeg");
  assert.equal(imageFilename("ekran", "image/png"), "ekran.png");
  assert.equal(imageFilename("report.v2", "image/png"), "report.v2.png");
});

test("chat: site detection and reply decoding", async () => {
  const { providerFor, PROVIDERS } = await import("../extension/providers/index.js");
  assert.equal(providerFor("https://chatgpt.com/c/abc").id, "chatgpt");
  assert.equal(providerFor("https://gemini.google.com/app/1").id, "gemini");
  assert.equal(providerFor("https://chat.deepseek.com/").id, "deepseek");
  assert.equal(providerFor("https://example.com/"), null);
  for (const p of PROVIDERS) for (const op of p.ops) assert.ok(fs.existsSync(new URL(`../extension/providers/${p.id}/${op}.js`, import.meta.url)), `${p.id}/${op}.js`);
  const { decodeReply, fnv } = await import("../extension/lib/chat.js");
  const text = "a=1&b=2; 100% ok 🙂";
  const enc = text.replace(/%/g, "%25").replace(/&/g, "%26").replace(/;/g, "%3B");
  const r = { chunks: [enc.slice(0, 5), enc.slice(5)], enc: "pct3", len: [...text].length, h: fnv(text) };
  assert.equal(decodeReply(r), text);
  assert.throws(() => decodeReply({ ...r, h: "00000000" }));
  assert.throws(() => decodeReply({ ...r, len: 3 }));
});
