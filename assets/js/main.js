import { $, $$, h, toast } from "./util.js";
import { loadStore, session, ROLES, SITES } from "./store.js";
import * as audit from "./audit.js";

const VIEWS = {
  network: () => import("./views/network.js"),
  cohorts: () => import("./views/cohorts.js"),
  viewer: () => import("./views/viewer-page.js"),
  graph: () => import("./views/graph.js"),
  sparql: () => import("./views/sparql.js"),
  ingest: () => import("./views/ingest.js"),
  governance: () => import("./views/governance.js"),
  about: () => import("./views/about.js"),
};

let cleanup = null, token = 0;

async function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  const name = VIEWS[parts[0]] ? parts[0] : "network";
  const params = parts.slice(1).map(decodeURIComponent);
  $$("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.route === name));
  const my = ++token;
  if (cleanup) { try { cleanup(); } catch (e) { console.warn(e); } cleanup = null; }
  const main = $("#main"); main.replaceChildren();
  try {
    const mod = await VIEWS[name]();
    if (my !== token) return;
    cleanup = (await mod.mount(main, params)) || null;
  } catch (e) {
    console.error(e);
    main.replaceChildren(h("div", { class: "notice bad" }, "This view failed to load: " + e.message));
  }
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function renderWho() {
  const who = $("#who");
  const roleSel = h("select", { id: "role", "aria-label": "Role", onchange: (e) => { session.role = e.target.value; changed(); } },
    Object.entries(ROLES).map(([k, r]) => h("option", { value: k, selected: k === session.role }, r.label)));
  const siteSel = h("select", { id: "site", "aria-label": "Home site", onchange: (e) => { session.site = e.target.value; changed(); } },
    SITES.map((s) => h("option", { value: s.id, selected: s.id === session.site }, s.name)));
  const k = h("input", { id: "k", type: "range", min: 2, max: 20, value: session.k, "aria-label": "Minimum cell size",
    oninput: (e) => { session.k = +e.target.value; $("#kval").textContent = session.k; }, onchange: () => window.dispatchEvent(new Event("session")) });
  who.replaceChildren(...[
    h("label", { for: "role" }, "Signed in as (demo)"), roleSel,
    session.role === "clinician" ? [h("label", { for: "site" }, "Home site"), siteSel] : null,
    h("label", { for: "k" }, ["Minimum cell size k = ", h("b", { id: "kval" }, session.k)]), k,
    h("div", { class: "blurb" }, ROLES[session.role].blurb)].flat().filter(Boolean));
}
function changed() { renderWho(); window.dispatchEvent(new Event("session")); route(); }

async function boot() {
  const msg = (t) => ($("#boot-msg").textContent = t);
  try {
    renderWho();
    await loadStore(msg);
    audit.record({ actor: "system", action: "startup", detail: "Dataset loaded into browser store", decision: "allowed", reason: "" });
    window.addEventListener("hashchange", route);
    await route();
    $("#boot").classList.add("done");
    setTimeout(() => $("#boot").remove(), 500);
  } catch (e) {
    console.error(e);
    msg("Could not start: " + e.message + ". If you opened index.html directly from disk, serve the folder instead (see README).");
    $(".boot-mark").style.animation = "none";
  }
}
boot();
