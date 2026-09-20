import { h, fmt } from "../util.js";
import { SITES, siteById, policyRun, session, localName, GRAPHS, KG } from "../store.js";

const FINDINGS = ["Pneumonia", "Pulmonary tuberculosis", "Pleural effusion", "Cardiomegaly"];
const siteCell = (iri) => { const s = siteById(localName(iri)); return h("span", {}, h("span", { class: "dot", style: { background: s?.color || "#888" } }), s ? s.name : localName(iri)); };
const sq = (s) => s.replace(/["\\]/g, "");

export async function mount(root) {
  if (session.role === "researcher") {
    root.append(h("div", { class: "page-head" }, h("h1", {}, "Cohorts")),
      h("div", { class: "notice" }, h("b", {}, "Record-level browsing is not available to the external researcher role. "),
        "Researchers reach cohorts through aggregate queries. Try ", h("a", { href: "#/network" }, "Ask the network"), " or the ", h("a", { href: "#/sparql" }, "SPARQL"), " page with a COUNT query. Switch role in the sidebar to see the patient and study browsers."));
    return;
  }
  const st = { tab: "studies", page: 0, site: session.role === "clinician" ? session.site : "", modality: "", finding: "", quality: "", sex: "", text: "" };
  const PAGE = 14;
  const box = h("div"), tabsEl = h("div", { class: "tabs", role: "tablist" });
  const siteOpts = session.role === "clinician" ? SITES.filter((s) => s.id === session.site) : SITES;

  const sel = (key, label, opts, extra = {}) => h("label", { class: "f" }, label,
    h("select", { disabled: extra.disabled, onchange: (e) => { st[key] = e.target.value; st.page = 0; load(); } }, opts.map(([v, t]) => h("option", { value: v, selected: st[key] === v }, t))));

  function query() {
    const siteF = st.site ? `FILTER(?site = sitei:${st.site})` : "";
    const textF = st.text ? `FILTER(CONTAINS(LCASE(STR(?patient)), "${sq(st.text.toLowerCase())}") || CONTAINS(LCASE(STR(?study)), "${sq(st.text.toLowerCase())}"))` : "";
    if (st.tab === "patients") {
      return `SELECT ?patient ?sex ?born ?country ?site (COUNT(DISTINCT ?study) AS ?studies)
WHERE {
  ?patient a fhir:Patient ;
           fhir:gender ?sex ; fhir:birthDate ?born ;
           afri:countryOfOrigin ?country ; afri:enrolledAt ?site .
  OPTIONAL { ?study fhir:subject ?patient }
  ${siteF}${st.sex ? `\n  FILTER(?sex = "${st.sex}")` : ""}${st.text ? `\n  FILTER(CONTAINS(LCASE(STR(?patient)), "${sq(st.text.toLowerCase())}"))` : ""}
}
GROUP BY ?patient ?sex ?born ?country ?site
ORDER BY ?patient`;
    }
    return `SELECT ?study ?patient ?site ?modality ?body ?started ?quality ?score
WHERE {
  ?study a fhir:ImagingStudy ;
         fhir:subject ?patient ; fhir:started ?started ;
         fhir:modality/fhir:code ?modality ;
         afri:performedAt ?site ; afri:containsSeries ?series .
  ?series dicom:BodyPartExamined ?body ; afri:containsInstance ?image .
  ?image afri:imageQualityCategory ?q ; afri:imageQualityScore ?score .
  BIND(STRAFTER(STR(?q), "Quality/") AS ?quality)
  ${siteF}${st.modality ? `\n  FILTER(?modality = "${st.modality}")` : ""}${st.quality ? `\n  FILTER(?quality = "${st.quality}")` : ""}${st.text ? "\n  " + textF : ""}${st.finding ? `
  ?obs fhir:partOf ?study ;
       fhir:code/fhir:coding/fhir:display "${st.finding}" ;
       fhir:valueCodeableConcept/fhir:coding/fhir:display "Present" .` : ""}
}
ORDER BY DESC(?started)`;
  }

  function filters() {
    const common = [
      sel("site", "Site", [["", "All sites"], ...siteOpts.map((s) => [s.id, s.name])], { disabled: session.role === "clinician" }),
      h("label", { class: "f" }, "Search ID", h("input", { type: "search", value: st.text, placeholder: "e.g. P-KE-0012", onchange: (e) => { st.text = e.target.value.trim(); st.page = 0; load(); } })),
    ];
    return st.tab === "patients"
      ? [...common, sel("sex", "Sex", [["", "Any"], ["male", "Male"], ["female", "Female"]])]
      : [...common, sel("modality", "Modality", [["", "Any"], ["CR", "CR Computed radiography"], ["DX", "DX Digital radiography"], ["CT", "CT"], ["MR", "MR"], ["US", "Ultrasound"]]),
        sel("finding", "Finding present", [["", "Any"], ...FINDINGS.map((f) => [f, f])]),
        sel("quality", "Image quality", [["", "Any"], ["Adequate", "Adequate"], ["Degraded", "Degraded"], ["Rejected", "Rejected"]])];
  }

  function drawTabs() {
    tabsEl.replaceChildren(...[["studies", "Studies"], ["patients", "Patients"]].map(([k, t]) =>
      h("button", { role: "tab", "aria-selected": st.tab === k, onclick: () => { st.tab = k; st.page = 0; drawTabs(); load(); } }, t)));
  }

  function load() {
    const q = query(), r = policyRun(q, session, { label: "cohorts:" + st.tab });
    const fbar = h("div", { class: "row", style: { padding: "12px 14px", borderBottom: "1px solid var(--line)", alignItems: "flex-end" } }, filters());
    if (!r.ok) { box.replaceChildren(fbar, h("div", { class: "body" }, h("div", { class: "err" }, r.error))); return; }
    const pages = Math.max(1, Math.ceil(r.rows.length / PAGE)); st.page = Math.min(st.page, pages - 1);
    const slice = r.rows.slice(st.page * PAGE, (st.page + 1) * PAGE);
    const table = st.tab === "patients"
      ? h("table", { class: "t" }, h("thead", {}, h("tr", {}, ["Patient", "Sex", "Born", "Origin", "Enrolled at"].map((c) => h("th", {}, c)), h("th", { class: "num" }, "Studies"))),
        h("tbody", {}, slice.map((row) => h("tr", { class: "click", tabindex: 0, onclick: () => (location.hash = "#/graph/" + encodeURIComponent(row.patient.v)) },
          h("td", { class: "iri" }, localName(row.patient.v)), h("td", {}, row.sex.v), h("td", {}, row.born.v), h("td", {}, localName(row.country.v)), h("td", {}, siteCell(row.site.v)), h("td", { class: "num" }, row.studies.v)))))
      : h("table", { class: "t" }, h("thead", {}, h("tr", {}, ["Study", "Patient", "Site", "Modality", "Body part", "Date", "Image quality"].map((c) => h("th", {}, c)))),
        h("tbody", {}, slice.map((row) => {
          const open = () => (location.hash = "#/viewer/" + localName(row.study.v)), qv = row.quality.v;
          return h("tr", { class: "click", tabindex: 0, onclick: open, onkeydown: (e) => e.key === "Enter" && open() },
            h("td", { class: "iri" }, localName(row.study.v)), h("td", { class: "iri" }, localName(row.patient.v)), h("td", {}, siteCell(row.site.v)),
            h("td", {}, h("span", { class: "badge info" }, row.modality.v)), h("td", {}, row.body.v.toLowerCase()), h("td", {}, row.started.v.slice(0, 10)),
            h("td", {}, h("span", { class: "badge " + (qv === "Adequate" ? "ok" : qv === "Degraded" ? "warn" : "bad") }, qv), " ", h("span", { class: "muted small" }, Number(row.score.v).toFixed(2))));
        })));
    box.replaceChildren(fbar,
      h("div", { class: "scroll" }, slice.length ? table : h("p", { class: "body muted" }, "No records match these filters.")),
      h("div", { class: "row", style: { padding: "10px 14px", borderTop: "1px solid var(--line)", justifyContent: "space-between" } },
        h("span", { class: "muted small" }, `${fmt(r.rows.length)} ${st.tab} · dataset: ${r.graphs} named graphs · ${r.ms.toFixed(0)} ms`),
        h("span", { class: "row" }, h("button", { class: "btn sm", disabled: st.page === 0, onclick: () => { st.page--; load(); } }, "Previous"), h("span", { class: "small" }, `${st.page + 1} / ${pages}`),
          h("button", { class: "btn sm", disabled: st.page >= pages - 1, onclick: () => { st.page++; load(); } }, "Next"))),
      h("details", { style: { padding: "0 14px 12px" } }, h("summary", {}, "Show the SPARQL behind this table"),
        h("pre", { class: "code" }, q), h("p", { class: "small" }, h("a", { href: "#/sparql/" + encodeURIComponent(q) }, "Open this query in the SPARQL editor"))));
  }

  root.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Cohorts"),
    h("p", {}, session.role === "clinician" ? "Your home site only. Other sites are invisible to this role, not merely hidden." : "Browse patients and studies across all sites. Each filter rewrites the SPARQL query shown under the table."))),
    h("div", { class: "panel" }, tabsEl, box));
  drawTabs(); load();
}
