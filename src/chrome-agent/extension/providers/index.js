// AI chat sites the chat_* tools know. One folder per site holds its ops (see CONTRACT.md).
// To add a site: create providers/<id>/ with PROVIDER.md, status.js, send.js, wait_read.js
// (and optionally toggle.js, images.js + save_image.js), then add one line here.
export const PROVIDERS = [
  { id: "chatgpt", name: "ChatGPT", host: "chatgpt.com", urlNew: "https://chatgpt.com/", ops: ["status", "send", "wait_read", "images", "save_image"] },
  { id: "gemini", name: "Gemini", host: "gemini.google.com", urlNew: "https://gemini.google.com/app", ops: ["status", "send", "wait_read", "images", "save_image"] },
  { id: "deepseek", name: "DeepSeek", host: "chat.deepseek.com", urlNew: "https://chat.deepseek.com/", ops: ["status", "send", "wait_read", "toggle"] },
];

export function providerFor(url) {
  let host = "";
  try { host = new URL(url).host; } catch {}
  return PROVIDERS.find((p) => p.host === host) || null;
}
