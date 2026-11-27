// Key name -> CDP key event description. Pure module (unit tested).

const named = {
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  return: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  esc: { key: "Escape", code: "Escape", keyCode: 27 },
  space: { key: " ", code: "Space", keyCode: 32, text: " " },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  insert: { key: "Insert", code: "Insert", keyCode: 45 },
  capslock: { key: "CapsLock", code: "CapsLock", keyCode: 20 },
  numlock: { key: "NumLock", code: "NumLock", keyCode: 144 },
  scrolllock: { key: "ScrollLock", code: "ScrollLock", keyCode: 145 },
  pause: { key: "Pause", code: "Pause", keyCode: 19 },
  printscreen: { key: "PrintScreen", code: "PrintScreen", keyCode: 44 },
  minus: { key: "-", code: "Minus", keyCode: 189, text: "-" },
  plus: { key: "+", code: "Equal", keyCode: 187, text: "+", shift: true },
  equal: { key: "=", code: "Equal", keyCode: 187, text: "=" },
  comma: { key: ",", code: "Comma", keyCode: 188, text: "," },
  period: { key: ".", code: "Period", keyCode: 190, text: "." },
  slash: { key: "/", code: "Slash", keyCode: 191, text: "/" },
  shift: { key: "Shift", code: "ShiftLeft", keyCode: 16 },
  ctrl: { key: "Control", code: "ControlLeft", keyCode: 17 },
  control: { key: "Control", code: "ControlLeft", keyCode: 17 },
  alt: { key: "Alt", code: "AltLeft", keyCode: 18 },
  meta: { key: "Meta", code: "MetaLeft", keyCode: 91 },
};
for (let i = 1; i <= 12; i++) named["f" + i] = { key: "F" + i, code: "F" + i, keyCode: 111 + i };
for (let i = 0; i <= 9; i++) {
  named["numpad" + i] = { key: String(i), code: "Numpad" + i, keyCode: 96 + i, text: String(i) };
  named["kp_" + i] = named["numpad" + i];
}
Object.assign(named, {
  numpadadd: { key: "+", code: "NumpadAdd", keyCode: 107, text: "+" },
  numpadsubtract: { key: "-", code: "NumpadSubtract", keyCode: 109, text: "-" },
  numpadmultiply: { key: "*", code: "NumpadMultiply", keyCode: 106, text: "*" },
  numpaddivide: { key: "/", code: "NumpadDivide", keyCode: 111, text: "/" },
  numpaddecimal: { key: ".", code: "NumpadDecimal", keyCode: 110, text: "." },
});

const punct = {
  "-": ["Minus", 189], "=": ["Equal", 187], "[": ["BracketLeft", 219], "]": ["BracketRight", 221], "\\": ["Backslash", 220],
  ";": ["Semicolon", 186], "'": ["Quote", 222], ",": ["Comma", 188], ".": ["Period", 190], "/": ["Slash", 191], "`": ["Backquote", 192],
};
const shifted = { "_": "-", "+": "=", "{": "[", "}": "]", "|": "\\", ":": ";", '"': "'", "<": ",", ">": ".", "?": "/", "~": "`",
  "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0" };

export const MOD = { alt: 1, option: 1, ctrl: 2, control: 2, cmd: 4, meta: 4, command: 4, super: 4, win: 4, windows: 4, shift: 8 };

/** Describe a single printable character, or null if it needs Input.insertText. */
export function charKey(ch) {
  if (ch === "\n" || ch === "\r") return named.enter;
  if (ch === " ") return named.space;
  if (/^[a-z]$/.test(ch)) return { key: ch, code: "Key" + ch.toUpperCase(), keyCode: ch.toUpperCase().charCodeAt(0), text: ch };
  if (/^[A-Z]$/.test(ch)) return { key: ch, code: "Key" + ch, keyCode: ch.charCodeAt(0), text: ch, shift: true };
  if (/^[0-9]$/.test(ch)) return { key: ch, code: "Digit" + ch, keyCode: ch.charCodeAt(0), text: ch };
  if (punct[ch]) return { key: ch, code: punct[ch][0], keyCode: punct[ch][1], text: ch };
  if (shifted[ch]) {
    const base = shifted[ch];
    const b = /[0-9]/.test(base) ? { code: "Digit" + base, keyCode: base.charCodeAt(0) } : { code: punct[base][0], keyCode: punct[base][1] };
    return { key: ch, ...b, text: ch, shift: true };
  }
  return null;
}

/** Parse "ctrl+shift+a" into {modifiers, key desc}. Throws on unknown key. */
export function parseCombo(token) {
  const parts = token.split("+").filter((p, i, a) => p !== "" || i === a.length - 1);
  // "ctrl++" -> ["ctrl", "", ""] edge case: treat trailing empty as "+"
  let keyPart = parts.pop();
  if (keyPart === "") keyPart = "+";
  let modifiers = 0;
  for (const p of parts) {
    const m = MOD[p.toLowerCase()];
    if (m == null) throw new Error(`Unknown modifier "${p}" in "${token}"`);
    modifiers |= m;
  }
  const lower = keyPart.toLowerCase();
  let desc = named[lower] || (keyPart.length === 1 ? charKey(keyPart) : null);
  if (!desc) throw new Error(`Unknown key "${keyPart}"`);
  if (desc.shift) modifiers |= 8;
  // shift+a types "A"
  if ((modifiers & 8) && /^[a-z]$/.test(desc.key)) desc = { ...desc, key: desc.key.toUpperCase(), text: desc.key.toUpperCase() };
  // With ctrl/alt/meta held, keys do not produce text (shortcuts).
  if (modifiers & (1 | 2 | 4)) desc = { ...desc, text: undefined };
  return { modifiers, desc };
}

export const isZoomCombo = ({ modifiers, desc }) => (modifiers & (2 | 4)) && ["+", "-", "=", "0"].includes(desc.key);
export const isReloadCombo = ({ modifiers, desc }) =>
  desc.key === "F5" || ((modifiers & (2 | 4)) && desc.key.toLowerCase() === "r");
