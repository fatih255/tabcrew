// Shows that the agent is driving this tab: a black-and-white frame, a black cursor with a short
// caption of what it is doing, and a status in the tab title (⏳ while working, ✅ when done, until
// you look at the tab). Hidden while screenshots are taken so it never appears in them.
(() => {
  if (window.__tcaIndicator) return;
  let host, rootEl, frame, cursor, caption, hideTimer, doneTimer;
  let x = Math.round(innerWidth / 2), y = Math.round(innerHeight / 2);
  let mark = ""; // "", "⏳" or "✅"

  // ---------- tab title status ----------
  const MARK_RE = /^(⏳|✅) /;
  function applyTitle() {
    const bare = document.title.replace(MARK_RE, "");
    const want = mark ? `${mark} ${bare}` : bare;
    if (document.title !== want) document.title = want;
  }
  function setMark(m) {
    mark = m;
    applyTitle();
  }
  // Sites rewrite their title (a chat gets its name); keep the status in front.
  new MutationObserver(() => { if (mark && !document.title.startsWith(mark)) applyTitle(); })
    .observe(document.head || document.documentElement, { subtree: true, childList: true, characterData: true });
  // ✅ stays until the user looks at the tab.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && mark === "✅") setTimeout(() => { if (mark === "✅") setMark(""); }, 2500); });

  // ---------- overlay ----------
  function ensure() {
    if (host) return;
    host = document.createElement("div");
    host.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;user-select:none;-webkit-user-select:none;z-index:2147483647";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>
      *{user-select:none;-webkit-user-select:none}
      .r{position:fixed;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;border:2px solid #0a0a0a;box-shadow:0 0 0 1.5px rgba(255,255,255,.8);animation:r .45s ease-out forwards}
      @keyframes r{from{transform:scale(.3);opacity:.9}to{transform:scale(1.4);opacity:0}}
      .f{position:fixed;inset:0;box-shadow:inset 0 0 0 1.5px rgba(10,10,10,.9),inset 0 0 0 3px rgba(255,255,255,.6),inset 0 0 40px 6px rgba(10,10,10,.28);animation:b 2.4s ease-in-out infinite}
      @keyframes b{50%{opacity:.6}}
      @media (prefers-reduced-motion:reduce){.f{animation:none}}
      .c{position:fixed;left:0;top:0;transition-property:transform;transition-duration:0s;transition-timing-function:cubic-bezier(.22,1,.36,1);will-change:transform}
      .c svg{display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35));transition:transform .08s}
      .c.p svg{transform:scale(.85)}
      .t{position:absolute;left:18px;top:22px;max-width:260px;padding:3px 8px;border-radius:6px;background:#0a0a0a;color:#fff;
         font:500 12px/1.4 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
         box-shadow:0 0 0 1px rgba(255,255,255,.6),0 2px 6px rgba(0,0,0,.25)}
      .t:empty{display:none}
    </style>
    <div class="f"></div>
    <div class="c"><svg width="20" height="24" viewBox="0 0 20 24"><path d="M2 1.6 L17.2 14.2 L9.4 15.3 L5.6 22.2 Z" fill="#0a0a0a" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><div class="t"></div></div>`;
    rootEl = root;
    frame = root.querySelector(".f");
    cursor = root.querySelector(".c");
    caption = root.querySelector(".t");
    (document.documentElement || document).appendChild(host);
    move();
  }
  // Glide to the new point; a longer way takes a little longer (150-450 ms). Returns the time it takes.
  function move(from) {
    if (!cursor) return 0;
    const ms = from ? Math.round(Math.min(450, Math.max(150, Math.hypot(x - from[0], y - from[1]) * 0.6))) : 0;
    cursor.style.transitionDuration = `${ms}ms`;
    cursor.style.transform = `translate(${x - 2}px, ${y - 1}px)`;
    return ms;
  }

  function show(label) {
    ensure();
    host.style.display = "block";
    if (label != null) caption.textContent = label;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (host) host.style.display = "none"; }, 15000);
  }

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    switch (msg?.type) {
      case "TCA_ACTIVE":
        clearTimeout(doneTimer);
        show(msg.label || "");
        setMark("⏳");
        break;
      case "TCA_DONE":
        // A short pause first: agents often chain calls on the same tab.
        clearTimeout(doneTimer);
        doneTimer = setTimeout(() => { setMark("✅"); if (caption) caption.textContent = "Done"; }, 1500);
        break;
      case "TCA_HIDE_FOR_TOOL": if (host) host.style.visibility = "hidden"; break;
      case "TCA_SHOW_AFTER_TOOL": if (host) host.style.visibility = "visible"; break;
      case "TCA_CURSOR": {
        const visible = host && host.style.display !== "none";
        show();
        const from = visible ? [x, y] : null;
        x = msg.x; y = msg.y;
        const ms = move(from);
        cursor.classList.toggle("p", !!msg.pressed);
        if (msg.pressed) {
          // A light ring where the click lands, so you can see what was clicked.
          const ring = document.createElement("div");
          ring.className = "r";
          ring.style.left = `${x}px`;
          ring.style.top = `${y}px`;
          rootEl.appendChild(ring);
          setTimeout(() => ring.remove(), 500);
        }
        reply({ ok: true, ms });
        return;
      }
      default: return;
    }
    reply({ ok: true });
  });
  window.__tcaIndicator = true;
})();
