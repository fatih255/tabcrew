// Minimal animated-GIF (GIF89a) encoder. Pure module, no browser APIs, so it is unit-tested under Node.
//
// Colours are mapped to one fixed 252-colour palette (6 red x 7 green x 6 blue levels), which
// keeps encoding fast and is good enough for screenshots of web pages.

const R_LEVELS = 6, G_LEVELS = 7, B_LEVELS = 6;

/** The fixed global palette: 256 RGB triples (the last 4 entries are unused black). */
export function palette() {
  const p = new Uint8Array(256 * 3);
  let i = 0;
  for (let r = 0; r < R_LEVELS; r++)
    for (let g = 0; g < G_LEVELS; g++)
      for (let b = 0; b < B_LEVELS; b++) {
        p[i++] = Math.round((r * 255) / (R_LEVELS - 1));
        p[i++] = Math.round((g * 255) / (G_LEVELS - 1));
        p[i++] = Math.round((b * 255) / (B_LEVELS - 1));
      }
  return p;
}

/** RGBA pixels -> palette indices. */
export function quantize(rgba, width, height) {
  const n = width * height;
  const out = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = Math.round((rgba[j] * (R_LEVELS - 1)) / 255);
    const g = Math.round((rgba[j + 1] * (G_LEVELS - 1)) / 255);
    const b = Math.round((rgba[j + 2] * (B_LEVELS - 1)) / 255);
    out[i] = (r * G_LEVELS + g) * B_LEVELS + b;
  }
  return out;
}

/** GIF-flavoured LZW compression of 8-bit indices. Returns the raw code stream bytes. */
export function lzw(indices, minCodeSize = 8) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  let table = new Map();
  const out = [];
  let acc = 0, nbits = 0;
  const emit = (code) => {
    acc |= code << nbits;
    nbits += codeSize;
    while (nbits >= 8) { out.push(acc & 0xff); acc >>>= 8; nbits -= 8; }
  };
  emit(clearCode);
  if (!indices.length) { emit(eoiCode); if (nbits > 0) out.push(acc & 0xff); return out; }
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const hit = table.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (nextCode === 4096) {
      emit(clearCode);
      table = new Map();
      codeSize = minCodeSize + 1;
      nextCode = eoiCode + 1;
    } else {
      if (nextCode >= 1 << codeSize) codeSize++;
      table.set(key, nextCode++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoiCode);
  if (nbits > 0) out.push(acc & 0xff);
  return out;
}

class Bytes {
  constructor() { this.chunks = []; this.cur = []; }
  byte(b) { this.cur.push(b & 0xff); if (this.cur.length >= 65536) this.flush(); }
  u16(v) { this.byte(v); this.byte(v >> 8); }
  str(s) { for (const c of s) this.byte(c.charCodeAt(0)); }
  bytes(a) { for (let i = 0; i < a.length; i++) this.byte(a[i]); }
  flush() { if (this.cur.length) { this.chunks.push(Uint8Array.from(this.cur)); this.cur = []; } }
  result() {
    this.flush();
    const n = this.chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(n);
    let o = 0;
    for (const c of this.chunks) { out.set(c, o); o += c.length; }
    return out;
  }
}

/** Streaming writer: add frames one at a time so only compressed data is kept in memory. */
export class GifWriter {
  constructor(width, height) {
    if (!(width > 0 && height > 0 && width < 65536 && height < 65536)) throw new Error("bad size");
    this.width = width; this.height = height; this.frames = 0;
    const w = (this.w = new Bytes());
    w.str("GIF89a");
    w.u16(width); w.u16(height);
    w.byte(0xf7); // global colour table, 8 bits/colour, 256 entries
    w.byte(0); w.byte(0);
    w.bytes(palette());
    // Loop forever (NETSCAPE2.0 application extension).
    w.byte(0x21); w.byte(0xff); w.byte(11); w.str("NETSCAPE2.0"); w.byte(3); w.byte(1); w.u16(0); w.byte(0);
  }

  addFrame(rgba, delayMs = 800) {
    const { w, width, height } = this;
    if (rgba.length !== width * height * 4) throw new Error("frame size mismatch");
    // Graphic control extension: disposal "do not dispose", delay in 1/100 s.
    w.byte(0x21); w.byte(0xf9); w.byte(4); w.byte(0x04);
    w.u16(Math.max(2, Math.round(delayMs / 10))); w.byte(0); w.byte(0);
    // Image descriptor: full frame, no local colour table.
    w.byte(0x2c); w.u16(0); w.u16(0); w.u16(width); w.u16(height); w.byte(0);
    w.byte(8);
    const data = lzw(quantize(rgba, width, height), 8);
    for (let i = 0; i < data.length; i += 255) {
      const n = Math.min(255, data.length - i);
      w.byte(n);
      for (let k = 0; k < n; k++) w.byte(data[i + k]);
    }
    w.byte(0);
    this.frames++;
  }

  finish() {
    if (!this.frames) throw new Error("no frames");
    this.w.byte(0x3b);
    return this.w.result();
  }
}

/** Encode frames [{rgba, delayMs}] (all width x height) into an animated GIF that loops forever. */
export function encodeGif(frames, width, height) {
  const g = new GifWriter(width, height);
  for (const f of frames) g.addFrame(f.rgba, f.delayMs ?? 800);
  return g.finish();
}
