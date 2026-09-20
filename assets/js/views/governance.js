import { h } from "../util.js";
import { policyRun, session, ROLES, allowedGraphs, KG } from "../store.js";
import * as audit from "../audit.js";

const ATTACKS = [
  ["List every patient", "SELECT ?p WHERE { ?p a fhir:Patient } LIMIT 5"],
  ["Federate through SERVICE", "SELECT * WHERE { SERVICE <http://169.254.169.254/latest/meta-data/> { ?s ?p ?o } }"],
  ["Widen the dataset with FROM", `SELECT (COUNT(*) AS ?n) FROM <${KG}graph/site-lagos/imaging> WHERE { ?s ?p ?o }`],
  ["Reach another site through GRAPH", `SELECT (COUNT(*) AS ?n) WHERE { GRAPH <${KG}graph/site-lagos/imaging> { ?s ?p ?o } }`, "A site radiologist outside Lagos gets 0: the graph is not in their dataset. Stewards and researchers may aggregate across sites by design."],
  ["Unmask one person with a tiny count", `SELECT ?sex (COUNT(DISTINCT ?p) AS ?n) WHERE { ?p a fhir:Patient ; fhir:gender ?sex . FILTER(?p = patient:P-KE-0001) } GROUP BY ?sex`, "Researchers get nothing back: a group of one is below the minimum cell size. Stewards and radiologists may see it."],
  ["Delete data", "DELETE WHERE { ?s ?p ?o }"],
];
const CAP = [
  ["Patient-level rows", ["yes", "own site", "no"]], ["Image pixels in the viewer", ["yes", "own site", "no"]], ["Aggregate counts across sites", ["yes", "yes", "yes, k-suppressed"]],
  ["Provenance and quarantine graphs", ["yes", "own site", "no"]], ["Write annotations", ["yes", "own site", "no"]], ["SERVICE / FROM in queries", ["FROM only", "no", "no"]],
];

export async function mount(root) {
  const attackOut = h("div"), auditEl = h("div"), verifyEl = h("div");
  const roleIdx = ["steward", "clinician", "researcher"].indexOf(session.role);

  const matrix = h("table", { class: "t" }, h("thead", {}, h("tr", {}, h("th", {}, "Capability"), Object.values(ROLES).map((r, i) => h("th", { style: i === roleIdx ? { background: "var(--saffron-l)" } : {} }, r.label)))),
    h("tbody", {}, CAP.map(([c, v]) => h("tr", {}, h("td", {}, c), v.map((x, i) => h("td", { style: i === roleIdx ? { background: "var(--saffron-l)", fontWeight: 500 } : {} }, x))))));

  const attacks = ATTACKS.map(([t, q, hint]) => h("button", { class: "btn sm", onclick: () => {
    const r = policyRun(q, session, { label: "governance:probe" });
    attackOut.replaceChildren(h("div", { class: "panel" }, h("div", { class: "body" },
      h("div", { class: "row", style: { justifyContent: "space-between" } }, h("b", {}, t), h("span", { class: "badge " + (r.ok ? "ok" : "bad") }, r.ok ? "Allowed" : "Blocked")),
      h("pre", { class: "code", style: { margin: "8px 0" } }, q),
      r.ok ? h("p", { class: "small" }, r.rows ? `${r.rows.length} row(s) returned` + (r.rows[0] ? ": " + Object.entries(r.rows[0]).map(([k, c]) => `?${k} = ${c.v.split("/").pop()}`).join(", ") : "") : "Executed.", (r.notes || []).map((n) => h("div", { class: "muted" }, n)))
        : h("p", { class: "small", style: { color: "#862B20" } }, r.error),
      hint ? h("p", { class: "small muted" }, hint) : null)));
  } }, t));

  function drawAudit() {
    const es = [...audit.entries].reverse().slice(0, 60);
    auditEl.replaceChildren(h("div", { class: "scroll", style: { maxHeight: "360px" } }, h("table", { class: "t" },
      h("thead", {}, h("tr", {}, ["#", "Time", "Actor", "Action", "Detail", "Decision", "Hash"].map((c) => h("th", {}, c)))),
      h("tbody", {}, es.map((e) => h("tr", {}, h("td", {}, e.seq), h("td", { class: "small" }, e.ts.slice(11, 19)), h("td", {}, e.actor), h("td", {}, e.action),
        h("td", { class: "iri", style: { maxWidth: "320px" } }, e.detail), h("td", {}, h("span", { class: "badge " + (e.decision === "allowed" ? "ok" : e.decision === "blocked" ? "bad" : "warn") }, e.decision)),
        h("td", { class: "iri muted" }, e.hash.slice(0, 10) + "…")))))));
  }
  const off = audit.onChange(drawAudit);
  drawAudit();

  const verify = async () => {
    const r = await audit.verify();
    verifyEl.replaceChildren(h("div", { class: "notice " + (r.ok ? "ok" : "bad") }, r.ok ? `Chain intact: ${r.count} entries, every hash matches.` : `Chain broken at entry #${r.brokenAt}: ${r.why}. Everything after it can no longer be trusted.`));
  };
  const tamper = () => {
    if (audit.entries.length < 2) return;
    const e = audit.entries[Math.max(0, audit.entries.length - 3)];
    e.decision = "allowed"; e.detail = "(edited after the fact)";
    drawAudit(); verify();
  };

  const g = allowedGraphs();
  root.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Governance"),
    h("p", {}, "How access is decided, what happens to queries that overreach, and how every decision is recorded. Switch role in the sidebar and try again."))),
    h("div", { class: "grid" },
      h("div", { class: "panel" }, h("header", {}, h("h2", {}, "Who can see what")), h("div", { class: "body" }, matrix,
        h("p", { class: "small muted", style: { marginTop: "10px" } }, `Your dataset right now: ${g.length} of the store’s named graphs. The server picks the dataset from your token’s role and site; nothing in the query text can widen it.`))),
      h("div", { class: "panel" }, h("header", {}, h("h2", {}, "Try to break it")), h("div", { class: "body" },
        h("p", { class: "small muted" }, "Each button sends a query that a curious or malicious user might try, as the role you are signed in as."),
        h("div", { class: "row", style: { marginBottom: "12px" } }, attacks), attackOut)),
      h("div", { class: "panel" }, h("header", {}, h("h2", {}, "Audit log"), h("span", { class: "row" },
        h("button", { class: "btn sm", onclick: verify }, "Verify chain"), h("button", { class: "btn sm", onclick: tamper }, "Simulate tampering"))),
        h("div", { class: "body" }, verifyEl, auditEl,
          h("p", { class: "small muted", style: { marginTop: "10px" } }, "Each entry’s hash covers its content and the previous hash. Editing any past entry breaks the chain from that point on. Reload the page to reset the demo."))))
  );
  return off;
}
