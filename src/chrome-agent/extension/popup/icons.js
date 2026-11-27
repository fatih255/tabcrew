// 24x24 line icons (stroke = currentColor), from the tabcrew UI kit. Static strings, safe for innerHTML.
export const ICONS = {
  "x": "<path d=\"M18 6 6 18\"/><path d=\"m6 6 12 12\"/>", // Lucide x (ISC)
  "eye": "<path d=\"M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>", // Lucide eye (ISC)
  "eye-off": "<path d=\"M10.73 5.08a10.74 10.74 0 0 1 11.2 6.57 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-1.44 2.49\"/><path d=\"M14.08 14.16a3 3 0 0 1-4.24-4.24\"/><path d=\"M17.48 17.5a10.75 10.75 0 0 1-15.42-5.15 1 1 0 0 1 0-.7 10.75 10.75 0 0 1 4.45-5.14\"/><path d=\"m2 2 20 20\"/>", // Lucide eye-off (ISC)
  "info": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 16v-4\"/><path d=\"M12 8h.01\"/>", // Lucide info (ISC)
  "activity": "<path d=\"M2 12h4l3-8 4 16 3-8h6\"/>",
  "alert-circle": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v6m0 3h.01\"/>",
  "browser": "<rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M3 9h18\"/>",
  "check-circle": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"m8 12 3 3 5-6\"/>",
  "clock": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3 2\"/>",
  "edit": "<path d=\"m14 5 5 5M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15l-1 5Z\"/>",
  "external-link": "<path d=\"M13 3h8v8m0-8L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5\"/>",
  "globe": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><ellipse cx=\"12\" cy=\"12\" rx=\"4\" ry=\"9\"/><path d=\"M3 12h18\"/>",
  "image": "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><circle cx=\"8.5\" cy=\"8.5\" r=\"1.5\"/><path d=\"m3 17 5-5 4 4 4-6 5 6\"/>",
  "layers": "<path d=\"m12 2 10 5-10 5L2 7l10-5Zm-10 10 10 5 10-5M2 17l10 5 10-5\"/>",
  "link": "<path d=\"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71\"/><path d=\"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71\"/>", // Lucide link (ISC)
  "loader": "<path d=\"M12 3a9 9 0 1 1-9 9\"/>",
  "message": "<path d=\"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z\"/>", // Lucide message-square (ISC)
  "monitor": "<rect x=\"3\" y=\"3\" width=\"18\" height=\"13\" rx=\"2\"/><path d=\"M12 16v5m-4 0h8\"/>",
  "search": "<circle cx=\"10.5\" cy=\"10.5\" r=\"6.5\"/><path d=\"m16 16 5 5\"/>",
  "send": "<path d=\"m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13\"/>",
  "settings": "<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"m10 2 4 0 1 3 2 1 3-1 2 4-2 2v2l2 2-2 4-3-1-2 1-1 3h-4l-1-3-2-1-3 1-2-4 2-2v-2L2 9l2-4 3 1 2-1 1-3Z\"/>",
  "terminal": "<rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"m7 8 4 4-4 4m6 0h4\"/>",
  "x-circle": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"m9 9 6 6m0-6-6 6\"/>",
  "sparkle": "<path d=\"M12 2c0 6-4 10-10 10 6 0 10 4 10 10 0-6 4-10 10-10C16 12 12 8 12 2Z\"/>",
};

export function icon(name, cls = "") {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "1.75");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("class", `i ${cls}`.trim());
  s.innerHTML = ICONS[name] || ICONS.terminal;
  return s;
}
