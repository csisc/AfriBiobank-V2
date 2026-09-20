/* Small DOM + formatting helpers (no framework, no build step). */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** h('div', {class:'x', onclick: fn, 'aria-label':'y'}, 'text', childEl, ...) */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith("aria-") && v != null) { el.setAttribute(k, String(v)); continue; }   // aria booleans must be "true"/"false"
    if (v === false || v == null) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
};

export const fmt = (n) => Number(n).toLocaleString("en-US");
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function download(name, text, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toast(msg, kind = "info") {
  let box = $("#toasts");
  if (!box) { box = h("div", { id: "toasts", role: "status", "aria-live": "polite" }); document.body.append(box); }
  const t = h("div", { class: "toast " + kind }, msg);
  box.append(t);
  setTimeout(() => t.classList.add("out"), 3600);
  setTimeout(() => t.remove(), 4200);
}

export async function sha256Hex(buf) {
  if (globalThis.crypto?.subtle) {
    const d = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  // Fallback for non-secure contexts (opened via http:// on a LAN IP): FNV-1a, clearly not cryptographic.
  let hsh = 0x811c9dc5; const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i++) { hsh ^= u[i]; hsh = Math.imul(hsh, 0x01000193) >>> 0; }
  return "fnv1a-" + hsh.toString(16).padStart(8, "0");
}

export const hexToB64 = (hex) => {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2) return btoa(hex);
  const bytes = hex.match(/../g).map((x) => parseInt(x, 16));
  return btoa(String.fromCharCode(...bytes));
};

/** Deterministic PRNG (mulberry32) seeded from a string. */
export function rngFrom(str) {
  let h32 = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h32 = Math.imul(h32 ^ str.charCodeAt(i), 3432918353); h32 = (h32 << 13) | (h32 >>> 19); }
  let a = h32 >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
