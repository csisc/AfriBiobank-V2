import { h, download, fmt } from "../util.js";
import { policyRun, session, shorten, RECORD_LEVEL, allowedGraphs, ROLES, PREFIX_LINES, siteById } from "../store.js";

const TEMPLATES = [
  ["Studies and their patients (from the frontend spec)", `SELECT ?study ?patient
WHERE {
  ?study a fhir:ImagingStudy ;
         fhir:subject ?patient .
}
LIMIT 20`],
  ["Studies by modality and country (aggregate)", `SELECT ?country ?modality (COUNT(DISTINCT ?study) AS ?n)
WHERE {
  ?study a fhir:ImagingStudy ;
         fhir:modality/fhir:code ?modality ;
         afri:performedAt/site:country ?c .
  BIND(STRAFTER(STR(?c), "Country/") AS ?country)
}
GROUP BY ?country ?modality
ORDER BY ?country DESC(?n)`],
  ["Pneumonia present: count and mean observer confidence (aggregate)", `SELECT ?country (COUNT(DISTINCT ?obs) AS ?n) (AVG(?conf) AS ?mean_confidence)
WHERE {
  ?obs fhir:code/fhir:coding/fhir:display "Pneumonia" ;
       fhir:valueCodeableConcept/fhir:coding/fhir:display "Present" ;
       afri:observationConfidence ?conf ;
       fhir:partOf/afri:performedAt/site:country ?c .
  BIND(STRAFTER(STR(?c), "Country/") AS ?country)
}
GROUP BY ?country`],
  ["Cross-modal: pneumonia on X-ray with critical CRP (row level)", `SELECT ?patient ?study ?crp ?unit
WHERE {
  ?obs fhir:partOf ?study ; fhir:subject ?patient ;
       fhir:code/fhir:coding/fhir:display "Pneumonia" ;
       fhir:valueCodeableConcept/fhir:coding/fhir:display "Present" .
  ?lab afri:relatedImagingStudy ?study ;
       fhir:code labtest:crp ;
       fhir:valueQuantity [ fhir:value ?crp ; fhir:unit ?unit ] ;
       fhir:interpretation/fhir:code "HH" .
}
ORDER BY DESC(?crp)
LIMIT 25`],
  ["Images rejected: quality control vs ETL quarantine (steward or site radiologist)", `SELECT ?graph ?image ?reason
WHERE {
  GRAPH ?g { ?image afri:rejectionReason ?reason }
  BIND(REPLACE(STR(?g), "^.*/graph/", "") AS ?graph)
}
ORDER BY ?graph ?image
LIMIT 40`],
  ["ETL provenance per site (steward or site radiologist)", `SELECT ?agent ?graph ?processed ?rejected
WHERE {
  ?run a prov:Activity ;
       prov:wasAssociatedWith/rdfs:label ?agent ;
       prov:generated ?g ;
       afri:recordsProcessed ?processed ;
       afri:recordsRejected ?rejected .
  BIND(REPLACE(STR(?g), "^.*/graph/", "") AS ?graph)
}
ORDER BY ?agent ?graph`],
  ["Concepts with their SNOMED CT and ICD-11 mappings", `SELECT ?concept ?label ?mapping
WHERE {
  ?concept a owl:Class ; rdfs:label ?label ; owl:sameAs ?mapping .
}`],
  ["ASK: does any site record a right-sided pleural effusion?", `ASK {
  ?obs fhir:code/fhir:coding/fhir:display "Pleural effusion" ;
       fhir:valueCodeableConcept/fhir:coding/fhir:display "Present" ;
       afri:findingLaterality/fhir:display "Right" .
}`],
  ["DESCRIBE one study", `DESCRIBE study:S-KE-0001`],
  ["Federated SERVICE query (blocked here on purpose)", `# The Federation Layer Spec sketches queries like this one.
# The policy proxy refuses SERVICE from the UI: a user-supplied endpoint URL is a server-side
# request forgery route, and the user’s JWT would not be forwarded. Use Network > Ask the network.
SELECT ?study
WHERE {
  SERVICE <https://kenya.afribiobank.example/sparql> { ?study a fhir:ImagingStudy . }
  SERVICE <https://ghana.afribiobank.example/sparql> { ?study a fhir:ImagingStudy . }
}`],
];

export async function mount(root, params) {
  const preset = params[0] ? decodeURIComponent(params[0]) : null;
  const ed = h("textarea", { class: "editor", spellcheck: false, "aria-label": "SPARQL query", value: preset || TEMPLATES[0][1] });
  ed.value = preset || TEMPLATES[session.role === "researcher" ? 1 : 0][1];
  const out = h("div", {}, h("p", { class: "muted" }, "Run a query to see results.")), status = h("span", { class: "muted small" });
  let last = null;

  ed.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); run(); }
    if (e.key === "Tab") { e.preventDefault(); const s = ed.selectionStart; ed.setRangeText("  ", s, ed.selectionEnd, "end"); }
  });
  const tsel = h("select", { "aria-label": "Load template", onchange: (e) => { if (e.target.value !== "") { ed.value = TEMPLATES[+e.target.value][1]; e.target.value = ""; out.replaceChildren(); status.textContent = ""; } } },
    h("option", { value: "" }, "Load template…"), TEMPLATES.map((t, i) => h("option", { value: i }, t[0])));

  const cell = (c) => {
    if (c.t === "iri") return RECORD_LEVEL.test(c.v) ? h("a", { class: "iri", href: "#/graph/" + encodeURIComponent(c.v) }, shorten(c.v)) : h("span", { class: "iri" }, shorten(c.v));
    if (c.t === "bnode") return h("span", { class: "muted iri" }, "_:" + c.v);
    const dt = c.dt && !c.dt.endsWith("#string") ? shorten(c.dt) : "";
    return h("span", { title: dt }, c.v);
  };
  function run() {
    const t = ed.value.trim(); if (!t) return;
    const r = policyRun(t, session, { label: "sparql-editor" }); last = r;
    if (!r.ok) { status.textContent = ""; out.replaceChildren(h("div", { class: r.blocked ? "notice bad" : "err" }, r.error)); return; }
    status.textContent = `${r.type} · ${r.rows ? fmt(r.rows.length) + " rows · " : ""}${r.ms.toFixed(0)} ms · dataset ${r.graphs} named graphs`;
    const notes = (r.notes || []).map((n) => h("div", { class: "notice", style: { marginBottom: "8px" } }, n));
    if (r.type === "ASK") out.replaceChildren(...notes, h("div", { class: "panel" }, h("div", { class: "body" }, h("b", { style: { font: "600 26px var(--display)" } }, String(r.ask)))));
    else if (r.turtle != null) out.replaceChildren(...notes, h("pre", { class: "code" }, r.turtle || "(empty graph: nothing visible to your role)"));
    else out.replaceChildren(...notes, r.rows.length ? h("div", { class: "scroll" }, h("table", { class: "t" },
      h("thead", {}, h("tr", {}, r.vars.map((v) => h("th", { class: /^(n|count|total)/i.test(v) ? "num" : "" }, "?" + v)))),
      h("tbody", {}, r.rows.slice(0, 500).map((row) => h("tr", {}, r.vars.map((v) => h("td", { class: /^(n|count|total)/i.test(v) ? "num" : "" }, row[v] ? cell(row[v]) : ""))))))) : h("p", { class: "muted" }, "No rows."),
      r.rows && r.rows.length > 500 ? h("p", { class: "small muted" }, "Showing the first 500 rows.") : null);
  }
  function csv() {
    if (!last?.rows) return;
    const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
    download("afribiobank-query.csv", [last.vars.join(","), ...last.rows.map((r) => last.vars.map((v) => (r[v] ? esc(r[v].v) : "")).join(","))].join("\n"), "text/csv");
  }

  const g = allowedGraphs();
  root.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "SPARQL"),
    h("p", {}, "Query the knowledge graph directly. The endpoint is read-only and every query passes through the policy proxy for your role."))),
    h("div", { class: "notice info", style: { marginBottom: "14px" } }, h("b", {}, ROLES[session.role].label), session.role === "clinician" ? " at " + siteById(session.site).name : "",
      ` · dataset: ${g.length} named graphs · ${session.role === "researcher" ? "aggregate queries only, cells below k = " + session.k + " are hidden" : "row-level results allowed"}`),
    h("div", { class: "split", style: { gridTemplateColumns: "minmax(0,1fr) minmax(0,1.15fr)" } },
      h("div", { class: "panel" }, h("header", {}, h("h3", {}, "Query"), tsel),
        h("div", { class: "body" }, ed,
          h("div", { class: "row", style: { marginTop: "10px" } }, h("button", { class: "btn primary", onclick: run }, "Run query"), h("button", { class: "btn", onclick: () => { ed.value = ""; out.replaceChildren(); status.textContent = ""; } }, "Clear"), h("span", { class: "muted small" }, h("kbd", {}, "Ctrl"), " + ", h("kbd", {}, "Enter"))),
          h("details", { style: { marginTop: "10px" } }, h("summary", {}, "Prefixes added automatically"), h("pre", { class: "code" }, PREFIX_LINES)))),
      h("div", { class: "panel" }, h("header", {}, h("h3", {}, "Results"), h("span", { class: "row" }, status, h("button", { class: "btn sm", onclick: csv }, "Export CSV"))), h("div", { class: "body" }, out))));
  run();
}
