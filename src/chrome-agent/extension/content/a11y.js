// tabcrew-chrome content script (isolated world, every frame; refs are frame-local).
// Builds a compact accessibility-style outline of the page and hands out stable
// element references ("ref_N") that other tools resolve later.
(() => {
  if (window.__tca) return;

  const refToEl = new Map(); // ref -> WeakRef<Element>
  const elToRef = new WeakMap();
  let counter = 0;

  function refFor(el) {
    let r = elToRef.get(el);
    if (r && refToEl.get(r)?.deref() === el) return r;
    r = `ref_${++counter}`;
    elToRef.set(el, r);
    refToEl.set(r, new WeakRef(el));
    return r;
  }

  function resolve(ref) {
    const el = refToEl.get(ref)?.deref();
    if (!el || !el.isConnected) { refToEl.delete(ref); return null; }
    return el;
  }

  function prune() {
    for (const [r, w] of refToEl) { const el = w.deref(); if (!el || !el.isConnected) refToEl.delete(r); }
  }

  const SKIP = new Set(["SCRIPT", "STYLE", "META", "LINK", "TITLE", "NOSCRIPT", "NOFRAMES", "TEMPLATE"]);
  const INTERACTIVE_TAGS = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "DETAILS", "SUMMARY"]);
  const LANDMARKS = new Set(["navigation", "main", "banner", "contentinfo", "region", "article", "complementary", "form", "heading", "dialog", "table", "list"]);

  function roleOf(el) {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit.split(/\s+/)[0];
    const tag = el.tagName;
    switch (tag) {
      case "A": return el.hasAttribute("href") ? "link" : "generic";
      case "BUTTON": return "button";
      case "INPUT": {
        const t = (el.type || "text").toLowerCase();
        if (["button", "submit", "reset", "image", "file"].includes(t)) return "button";
        if (t === "checkbox") return "checkbox";
        if (t === "radio") return "radio";
        if (t === "range") return "slider";
        return "textbox";
      }
      case "SELECT": return "combobox";
      case "TEXTAREA": return "textbox";
      case "H1": case "H2": case "H3": case "H4": case "H5": case "H6": return "heading";
      case "IMG": return "image";
      case "NAV": return "navigation";
      case "MAIN": return "main";
      case "HEADER": return "banner";
      case "FOOTER": return "contentinfo";
      case "SECTION": return "region";
      case "ARTICLE": return "article";
      case "ASIDE": return "complementary";
      case "FORM": return "form";
      case "TABLE": return "table";
      case "UL": case "OL": return "list";
      case "LI": return "listitem";
      case "LABEL": return "label";
      case "DIALOG": return "dialog";
      case "IFRAME": return "iframe";
      default: return "generic";
    }
  }

  function isSensitive(el) {
    if (el.tagName !== "INPUT") return false;
    const t = (el.type || "").toLowerCase();
    if (t === "password" || t === "hidden") return true;
    const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
    return /current-password|new-password|one-time-code|^cc-|\bcc-/.test(ac);
  }

  const clip = (s, n = 100) => { s = (s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ");

  function nameOf(el) {
    // Accessible-name order: aria-label, aria-labelledby, <label>, then title/placeholder/alt.
    const aria = el.getAttribute("aria-label"); if (aria?.trim()) return clip(aria);
    const lb = el.getAttribute("aria-labelledby");
    if (lb) { const t = lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" "); if (t.trim()) return clip(t); }
    if (["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) {
      if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l?.textContent.trim()) return clip(l.textContent); }
      const wrap = el.closest("label");
      if (wrap?.textContent.trim()) return clip(wrap.textContent);
    }
    const ti = el.getAttribute("title"); if (ti?.trim()) return clip(ti);
    const ph = el.getAttribute("placeholder"); if (ph?.trim()) return clip(ph);
    const alt = el.getAttribute("alt"); if (alt?.trim()) return clip(alt);
    if (el.tagName === "SELECT") { const o = el.selectedOptions?.[0]; if (o) return clip(o.textContent); }
    if (el.tagName === "INPUT") {
      const t = (el.type || "").toLowerCase();
      if (t === "checkbox" || t === "radio") return "";
      if (t === "submit" && el.value) return clip(el.value);
      if (el.value && el.value.length < 50) return isSensitive(el) ? "[value redacted]" : clip(el.value);
    }
    if (["BUTTON", "A", "SUMMARY"].includes(el.tagName)) { const t = el.innerText || el.textContent; if (t?.trim()) return clip(t); }
    if (/^H[1-6]$/.test(el.tagName)) return clip(el.textContent);
    const own = ownText(el); if (own.trim().length >= 3) return clip(own);
    return "";
  }

  function isInteractive(el) {
    if (INTERACTIVE_TAGS.has(el.tagName)) return !(el.tagName === "A" && !el.hasAttribute("href"));
    if (el.hasAttribute("onclick") || el.hasAttribute("tabindex") || el.isContentEditable) return true;
    const r = el.getAttribute("role");
    return ["button", "link", "checkbox", "radio", "tab", "menuitem", "option", "switch", "textbox", "combobox", "slider"].includes(r);
  }

  function isVisible(el) {
    if (el.getAttribute("aria-hidden") === "true") return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0 || el.tagName === "OPTION";
  }

  function inViewport(el) {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  }

  const q = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  function tree(filter = "all", maxDepth = 15, maxChars = 50000, refId = null) {
    prune();
    let root = document.body || document.documentElement;
    if (refId) {
      root = resolve(refId);
      if (!root) return { error: `Element ${refId} not found; it may have been removed from the page. Call read_page again.`, errorCode: "ref_stale" };
    }
    const all = filter === "all";
    const lines = [];
    let count = 0, truncated = false;

    function walk(el, depth) {
      if (count >= 10000) { truncated = true; return; }
      if (depth > maxDepth || SKIP.has(el.tagName)) return;
      // A <slot> with assigned content shows that content (walked as the host's light DOM), not its fallback.
      if (el.tagName === "SLOT" && el.assignedNodes().length) return;
      if (!all && el !== root) {
        if (!isVisible(el)) return;
      }
      const role = roleOf(el);
      const interactive = isInteractive(el);
      const name = nameOf(el);
      let include;
      if (filter === "interactive") include = interactive;
      else include = interactive || LANDMARKS.has(role) || !!name || (role !== "generic" && role !== "image") || (role === "image" && !!name);
      if (include && !all && !refId && !inViewport(el) && !(el.tagName === "OPTION")) include = false;
      let childDepth = depth;
      if (include) {
        count++;
        let line = " ".repeat(depth) + role;
        if (name) line += ` "${q(name)}"`;
        line += ` [${refFor(el)}]`;
        if (el.tagName === "A" && el.getAttribute("href")) line += ` href="${clip(el.href, 200)}"`;
        if (el.tagName === "INPUT") line += ` type="${el.type}"`;
        if (el.getAttribute("placeholder") && name !== clip(el.getAttribute("placeholder"))) line += ` placeholder="${q(clip(el.getAttribute("placeholder")))}"`;
        if (el.disabled) line += " (disabled)";
        if (el.type === "checkbox" || el.type === "radio") line += el.checked ? " (checked)" : " (unchecked)";
        lines.push(line);
        childDepth = depth + 1;
        if (el.tagName === "SELECT") {
          for (const o of el.options) lines.push(" ".repeat(depth + 1) + `option "${q(clip(o.textContent))}"${o.selected ? " (selected)" : ""} value="${q(o.value)}"`);
          return;
        }
      }
      if (el.tagName === "IFRAME" || el.tagName === "FRAME") {
        // Placeholder (the frame's index in window.frames) that the service worker
        // replaces with the frame's own outline.
        const idx = frameIndexOf(el);
        const shown = all || refId || (isVisible(el) && inViewport(el));
        if (idx >= 0 && shown) lines.push(" ".repeat(childDepth) + `@@frame ${idx}@@`);
        return;
      }
      const kids = el.shadowRoot ? [...el.shadowRoot.children, ...el.children] : el.children;
      for (const c of kids) walk(c, childDepth);
    }
    walk(root, 0);

    let out = lines.join("\n");
    if (truncated) out += "\n[truncated at 10000 elements — use ref_id or a smaller depth to focus]";
    if (out.length > maxChars) {
      const cut = out.lastIndexOf("\n", maxChars);
      out = out.slice(0, cut > 0 ? cut : maxChars) + `\n[output truncated at ${maxChars} of ${out.length} characters. Pass a larger max_chars, or use ref_id or a smaller depth to focus.]`;
    }
    return { pageContent: out, viewport: { width: innerWidth, height: innerHeight } };
  }

  // ---- local "find": keyword scoring over the same outline ----
  function find(query, limit = 20) {
    prune();
    const toks = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1);
    const roleWords = { button: "button", link: "link", field: "textbox", input: "textbox", textbox: "textbox", box: "textbox", dropdown: "combobox", select: "combobox", checkbox: "checkbox", radio: "radio", heading: "heading", image: "image", tab: "tab" };
    const FORM_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA"]);
    const wantRoles = new Set(toks.map((t) => roleWords[t]).filter(Boolean));
    const wantsInput = toks.includes("input") || toks.includes("field");
    const words = toks.filter((t) => !roleWords[t]);
    // "box"/"field" also mean comboboxes and search boxes (e.g. Google's search box is a combobox).
    const textEntry = (el, role) => role === "combobox" || role === "searchbox" || el.tagName === "TEXTAREA" || el.isContentEditable
      || (el.tagName === "INPUT" && /^(text|search|email|url|tel|number|password|)$/.test((el.type || "").toLowerCase()));
    const roleMatch = (el, role) => wantRoles.has(role) || (wantsInput && FORM_TAGS.has(el.tagName)) || (wantRoles.has("textbox") && textEntry(el, role));
    const res = [];
    // Every element, including those inside open shadow roots (web components).
    const els = [];
    const collect = (rootNode) => { for (const el of rootNode.querySelectorAll("*")) { els.push(el); if (el.shadowRoot) collect(el.shadowRoot); } };
    if (document.body) collect(document.body);
    for (const el of els) {
      if (SKIP.has(el.tagName)) continue;
      const role = roleOf(el);
      const interactive = isInteractive(el);
      // Plain text holders (span, td, p …) count only by their own text, and rank below controls.
      const textOnly = !interactive && role === "generic";
      if (textOnly && (!words.length || ownText(el).trim().length < 2)) continue;
      // Role words filter only when the query has nothing else; otherwise they just rank.
      const rm = !wantRoles.size || roleMatch(el, role);
      if (!words.length && !rm) continue;
      const name = textOnly ? clip(ownText(el)) : nameOf(el);
      const hay1 = [name, el.getAttribute("aria-label"), el.getAttribute("placeholder"), el.getAttribute("title"), el.getAttribute("alt"), el.getAttribute("value"), el.getAttribute("name")].filter(Boolean).join(" ").toLowerCase();
      // Language-neutral hints: the input type, the role, and whether it sits in a search form.
      const inSearch = FORM_TAGS.has(el.tagName) || role === "combobox" || role === "searchbox"
        ? (el.closest("[role=search], search") || /\/search\b/i.test(el.closest("form")?.getAttribute("action") || "") || el.type === "search" || role === "searchbox" ? "search" : "") : "";
      const hay2 = [el.id, el.getAttribute("href"), el.className && String(el.className), el.tagName === "INPUT" && el.type, role !== "generic" && role, inSearch].filter(Boolean).join(" ").toLowerCase();
      let score = 0;
      for (const w of words) {
        if (hay1.includes(w)) score += 1;
        else if (hay2.includes(w)) score += 0.5;
        else if (w.length > 4 && hay1.includes(w.slice(0, -2))) score += 0.5;
      }
      if (!words.length && wantRoles.size) score = 0.5;
      if (score <= 0) continue;
      if (textOnly) score *= 0.6;
      if (words.length && wantRoles.size && rm) score += 0.5;
      const vis = isVisible(el);
      if (vis) score += 0.2;
      if (interactive) score += 0.2;
      res.push({ el, role, name, score, vis, inView: vis && inViewport(el) });
    }
    res.sort((a, b) => b.score - a.score);
    const items = res.slice(0, limit).map((r) => ({
      ref: refFor(r.el),
      score: r.score,
      desc: `${r.role === "generic" ? "text" : r.role}${r.name ? ` "${r.name}"` : ""}${r.el.tagName === "INPUT" && !["text", "button", "submit"].includes(r.el.type) ? ` type="${r.el.type}"` : ""}${r.el.tagName === "A" && r.el.href ? ` href="${clip(r.el.href, 120)}"` : ""}${!r.vis ? " (hidden)" : !r.inView ? " (off-screen)" : ""}${r.el.disabled ? " (disabled)" : ""}`,
    }));
    return { total: res.length, items };
  }

  function center(ref) {
    const el = resolve(ref);
    if (!el) return null;
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: innerWidth, h: innerHeight };
  }

  // ---- frame matching ----
  // An iframe element and the frame it hosts are matched through window.frames order:
  // WindowProxy comparisons work across origins, unlike reading the frame's document.
  function frameIndexOf(el) {
    const w = el.contentWindow;
    if (!w) return -1;
    for (let i = 0; i < window.frames.length; i++) if (window.frames[i] === w) return i;
    return -1;
  }

  /** This frame's index in its parent's window.frames, or -1 for the top frame. */
  function indexInParent() {
    const p = window.parent;
    if (!p || p === window) return -1;
    for (let i = 0; i < p.length; i++) if (p[i] === window) return i;
    return -1;
  }

  /** Content-box position of the iframe at window.frames[idx], optionally scrolling it into view. */
  function frameBox(idx, scroll) {
    const w = window.frames[idx];
    for (const el of document.querySelectorAll("iframe, frame")) {
      if (el.contentWindow !== w) continue;
      if (scroll) el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { x: r.left + el.clientLeft + parseFloat(cs.paddingLeft || 0), y: r.top + el.clientTop + parseFloat(cs.paddingTop || 0) };
    }
    return null;
  }

  window.__tca = { tree, find, resolve, refFor, center, isSensitive, indexInParent, frameBox };
})();
