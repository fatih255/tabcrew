// Dev tool: decode a GIF exported by gif_creator (global palette, full frames) and write
// every frame as a PNG, to look at what the recorder captured.
//   node test/tools/gif2png.mjs <file.gif> <output dir>
import fs from "node:fs"; import zlib from "node:zlib"; import path from "node:path";
const [file, outDir] = process.argv.slice(2);
const g = fs.readFileSync(file);
const W = g.readUInt16LE(6), H = g.readUInt16LE(8);
const pal = g.subarray(13, 13 + 768);
let p = 13 + 768; const frames = [];
function unlzw(bytes, min) {
  const clear = 1 << min, eoi = clear + 1; let size = min + 1, dict, prev = null; const out = [];
  const reset = () => { dict = []; for (let i = 0; i < clear; i++) dict[i] = [i]; dict.push(null, null); size = min + 1; prev = null; };
  reset(); let acc = 0, n = 0, pos = 0;
  for (;;) { while (n < size) { if (pos >= bytes.length) return out; acc |= bytes[pos++] << n; n += 8; }
    const code = acc & ((1 << size) - 1); acc >>>= size; n -= size;
    if (code === clear) { reset(); continue; } if (code === eoi) return out;
    const e = code < dict.length && dict[code] ? dict[code] : [...prev, prev[0]];
    for (const v of e) out.push(v); if (prev && dict.length < 4096) dict.push([...prev, e[0]]);
    if (dict.length === (1 << size) && size < 12) size++; prev = e; }
}
while (g[p] !== 0x3b) {
  if (g[p] === 0x21) { p += 2; while (g[p]) p += g[p] + 1; p++; }
  else { p += 10; const min = g[p++]; const parts = []; while (g[p]) { parts.push(g.subarray(p + 1, p + 1 + g[p])); p += g[p] + 1; } p++; frames.push(unlzw(Buffer.concat(parts), min)); }
}
const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
fs.mkdirSync(outDir, { recursive: true });
frames.forEach((idx, f) => {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; for (let x = 0; x < W; x++) { const i = idx[y * W + x] * 3, o = y * (W * 3 + 1) + 1 + x * 3; raw[o] = pal[i]; raw[o + 1] = pal[i + 1]; raw[o + 2] = pal[i + 2]; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(path.join(outDir, `f${String(f + 1).padStart(2, "0")}.png`), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
});
console.log(`${frames.length} frames ${W}x${H}`);
