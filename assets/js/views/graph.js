import { h, toast } from "../util.js";
import { KG, NS, match, shorten, localName, policyRun, session, siteById } from "../store.js";

const CLASSES = [
  ["Patient", "fhir:Patient", "#2A3B93"], ["Encounter", "fhir:Encounter", "#5B6DC4"], ["Order", "afri:ImagingOrder", "#8792D6"],
  ["Study", "fhir:ImagingStudy", "#D89A0F"], ["Series", "afri:ImagingSeries", "#E7BC55"], ["Image", "fhir:Media", "#2F7D5B"],
  ["ImgObs", "Imaging finding", "#B23A2C"], ["LabObs", "Lab result", "#C7776A"], ["Concept", "Concept", "#7A4E9E"], ["Site", "site:BiobankSite", "#16202A"],
];
const COLOR = Object.fromEntries(CLASSES.map(([k, , c]) => [k, c]));
const classOf = (iri) => { const m = iri.match(/\/kg\/([A-Za-z]+)\//); return m && COLOR[m[1]] ? m[1] : "Other"; };
const MAX_NEIGHBOURS = 24;

/** Flatten a node's outgoing triples: IRI edges + literal properties (blank nodes are walked and flattened into dotted paths). */
function describe(iri) {
  const props = [], edges = [];
  const walk = (subj, path, depth) => {
    for (const q of match(subj, null, null)) {
      const p = shorten(q.predicate.value), o = q.object;
      if (o.termType === "BlankNode") { if (depth < 4) walk(o, [...path, p], depth + 1); }
      else if (o.termType === "Literal") props.push([[...path, p].join(" › "), o.value]);
      else if (!path.length) { if (q.predicate.value.endsWith("#type")) props.push(["a", shorten(o.value)]); else edges.push([q.predicate.value, o.value, "out"]); }
      else props.push([[...path, p].join(" › "), shorten(o.value)]);
    }
  };
  walk(iri, [], 0);
  for (const q of match(null, null, iri)) if (q.subject.termType === "NamedNode") edges.push([q.predicate.value, q.subject.value, "in"]);
  return { props, edges };
}
function labelFor(iri, props, edges = []) {
  const c = classOf(iri), get = (k) => props.find(([p]) => p === k)?.[1];
  if (c === "ImgObs") return `${get("fhir:code › fhir:coding › fhir:display") || "finding"}: ${get("fhir:valueCodeableConcept › fhir:coding › fhir:display") || ""}`;
  if (c === "LabObs") { const t = edges.find(([p]) => p.endsWith("/code"))?.[1]; return `${t ? localName(t).toUpperCase() : "lab"} ${get("fhir:valueQuantity › fhir:value") ?? ""}`; }
  if (c === "Concept" || c === "Site") return get("rdfs:label") || localName(iri);
  return localName(iri);
}

export async function mount(root, params) {
  if (session.role === "researcher") {
    root.append(h("div", { class: "page-head" }, h("h1", {}, "Graph explorer")),
      h("div", { class: "notice" }, "The graph explorer shows individual records, so it is not available to the external researcher role. Use aggregate queries in ", h("a", { href: "#/network" }, "the network view"), " or ", h("a", { href: "#/sparql" }, "SPARQL"), "."));
    return;
  }
  let cy;
  const info = h("div", { class: "body" }, h("p", { class: "muted small" }, "Click a node to select it and load its neighbours."));
  const details = h("div", { class: "scroll", style: { maxHeight: "300px" } });
  const sug = h("ul", { class: "sug", hidden: true });
  const input = h("input", { type: "search", placeholder: "Patient, study or image ID", "aria-label": "Search entity" });
  const cyEl = h("div", { id: "cy" });

  function ensure(iri) {
    if (cy.getElementById(iri).length) return cy.getElementById(iri);
    const { props, edges } = describe(iri);
    return cy.add({ group: "nodes", data: { id: iri, label: labelFor(iri, props, edges), cls: classOf(iri) } });
  }
  function expand(iri) {
    const n = ensure(iri), { edges } = describe(iri);
    const seen = new Set(); let added = 0, skipped = 0;
    for (const [p, other, dir] of edges) {
      const key = p + other + dir; if (seen.has(key)) continue; seen.add(key);
      if (!/^https?:/.test(other) || other.startsWith(KG + "graph/")) continue;
      // Observations point back at the patient too, but they are reached through study / encounter: hiding those edges keeps the hub readable.
      if (dir === "in" && p.endsWith("/subject") && ["ImgObs", "LabObs"].includes(classOf(other))) continue;
      if (cy.getElementById(other).length === 0) { if (added >= MAX_NEIGHBOURS) { skipped++; continue; } added++; ensure(other); }
      const [s, t] = dir === "out" ? [iri, other] : [other, iri], id = `${s}|${p}|${t}`;
      if (!cy.getElementById(id).length) cy.add({ group: "edges", data: { id, source: s, target: t, label: shorten(p) } });
    }
    n.data("expanded", true);
    if (skipped) toast(`${skipped} more neighbours not shown (limit ${MAX_NEIGHBOURS} per click).`);
    layout();
    return n;
  }
  function layout(fit = false) { cy.layout({ name: "cose", animate: false, fit, padding: 40, nodeRepulsion: () => 9000, idealEdgeLength: () => 95, randomize: false, numIter: 800 }).run(); }
  function select(iri) {
    const { props } = describe(iri), cls = classOf(iri);
    details.replaceChildren(h("div", { class: "body" }, h("div", { class: "row", style: { justifyContent: "space-between" } }, h("h3", {}, localName(iri)), h("span", { class: "badge info" }, cls)),
      h("p", { class: "iri muted" }, shorten(iri)),
      props.length ? h("table", { class: "t" }, h("tbody", {}, props.map(([k, v]) => h("tr", {}, h("td", { class: "iri", style: { whiteSpace: "nowrap" } }, k), h("td", { class: "iri" }, v))))) : h("p", { class: "muted small" }, "No properties visible to your role.")));
  }
  function start(iri) {
    cy.elements().remove();
    const seen = describe(iri);
    if (!seen.props.length && !seen.edges.length) {
      details.replaceChildren(h("div", { class: "body" }, h("div", { class: "notice bad" }, h("b", {}, localName(iri)), " has no triples in the named graphs your role can read. It may not exist, or it belongs to another site.")));
      return;
    }
    expand(iri); layout(true); cy.fit(undefined, 40);
    cy.getElementById(iri).select(); select(iri);
  }

  // search (via the policy proxy, like any other query)
  input.addEventListener("input", () => {
    const t = input.value.trim().toLowerCase().replace(/["\\]/g, ""); if (t.length < 2) { sug.hidden = true; return; }
    const r = policyRun(`SELECT DISTINCT ?x WHERE { { ?x a fhir:Patient } UNION { ?x a fhir:ImagingStudy } UNION { ?x a fhir:Media } FILTER(CONTAINS(LCASE(STR(?x)), "${t}")) } ORDER BY ?x LIMIT 12`, session, { label: "graph:search" });
    sug.replaceChildren(...(r.rows || []).map((x) => h("li", { onclick: () => { sug.hidden = true; input.value = localName(x.x.v); start(x.x.v); } }, localName(x.x.v))));
    sug.hidden = !(r.rows || []).length;
  });

  const legend = h("div", { class: "legend" }, CLASSES.map(([k, label, c]) => h("span", {}, h("span", { class: "dot", style: { background: c } }), label)));
  root.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Graph explorer"),
    h("p", {}, "Follow the links between a patient, their encounters, orders, studies, images and findings. Each click reads triples through your role’s named graphs."))),
    h("div", { class: "ggrid" },
      h("div", { class: "grid", style: { alignContent: "start" } },
        h("div", { class: "panel" }, h("header", {}, h("h3", {}, "Find an entity")), h("div", { class: "body" }, input, sug,
          h("p", { class: "small muted", style: { marginTop: "8px" } }, "Try P-KE-0003 or S-GH-0010."),
          h("div", { class: "row" }, h("button", { class: "btn sm", onclick: () => cy.fit(undefined, 40) }, "Fit"), h("button", { class: "btn sm", onclick: () => layout(true) }, "Re-layout"), h("button", { class: "btn sm", onclick: () => cy.elements().remove() }, "Clear")))),
        h("div", { class: "panel" }, h("header", {}, h("h3", {}, "Node types")), h("div", { class: "body" }, legend))),
      h("div", { class: "grid" }, cyEl, h("div", { class: "panel" }, h("header", {}, h("h3", {}, "Selected node")), details))));

  /* global cytoscape */
  cy = cytoscape({ container: cyEl, wheelSensitivity: 0.25, minZoom: 0.2, maxZoom: 1.25,
    style: [
      { selector: "node", style: { "background-color": (e) => COLOR[e.data("cls")] || "#888", label: "data(label)", "font-size": 10, "font-family": "IBM Plex Sans", color: "#16202A", "text-valign": "bottom", "text-margin-y": 4, width: 24, height: 24, "border-width": 2, "border-color": "#fff", "text-wrap": "ellipsis", "text-max-width": 110 } },
      { selector: "node[?expanded]", style: { "border-color": "#16202A" } },
      { selector: "node:selected", style: { "border-color": "#E3A21A", "border-width": 4 } },
      { selector: "edge", style: { width: 1.4, "line-color": "#9AA7A1", "target-arrow-color": "#9AA7A1", "target-arrow-shape": "triangle", "curve-style": "bezier", label: "data(label)", "font-size": 8, color: "#5A6872", "text-rotation": "autorotate", "text-background-color": "#F3F6F4", "text-background-opacity": 1, "text-background-padding": 1 } },
    ] });
  cy.on("tap", "node", (e) => { const iri = e.target.id(); select(iri); if (!e.target.data("expanded")) expand(iri); });

  const first = params[0] ? decodeURIComponent(params[0]) : null;
  if (first && /^https?:/.test(first)) start(first);
  else if (first) start(KG + (first.startsWith("P-") ? "Patient/" : first.startsWith("S-") ? "Study/" : "Image/") + first);
  else start(session.role === "clinician" ? KG + "Site/" + session.site : KG + "Site/site-nairobi");
  return () => cy.destroy();
}
