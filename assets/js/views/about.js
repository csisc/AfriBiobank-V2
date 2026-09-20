import { h } from "../util.js";

const ROWS = [
  ["Semantic layer", "Oxigraph (SPARQL 1.1 engine) compiled to WebAssembly, holding ~77k quads in 36 named graphs", "GraphDB (or another SPARQL 1.1 store) per node, with Neo4j as an optional analytics projection", "Real SPARQL, simulated scale"],
  ["Data", "Synthetic patients, encounters, orders, studies, series, images, findings, labs, provenance", "ETL from each site’s PACS/RIS/HIS through RML mappings and SHACL validation", "Synthetic"],
  ["Image layer", "Procedural pseudo-radiographs drawn from the RDF findings; real DICOM opened from your own disk", "Orthanc or dcm4chee behind DICOMweb, viewed with Cornerstone3D", "Simulated, plus a real local viewer"],
  ["Access control", "Policy proxy: role → named graphs → dataset; SERVICE/FROM blocked; aggregate-only mode with small-cell suppression", "Keycloak (OIDC) JWT claims enforced in the backend gateway, in front of the triplestore", "Same logic, no real identity provider"],
  ["Federation", "Coordinator fans a query out to five nodes; each node applies its own policy; only counts return", "Federation Gateway per node, mTLS between nodes, Flower for federated learning", "Simulated in one browser tab"],
  ["Audit", "SHA-256 hash chain in memory", "Append-only store per node with the head hash anchored outside the operator’s control", "Concept only"],
];

export async function mount(root) {
  root.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "About this prototype"),
    h("p", {}, "A working sketch of the AfriBiobank platform that runs entirely in your browser. It exists to make the architecture concrete and testable, not to be the product."))),
    h("div", { class: "grid", style: { maxWidth: "1100px" } },
      h("div", { class: "notice bad" }, h("b", {}, "Everything here is synthetic. "), "No real patient, image, institution or measurement is involved. The five “sites” are labels for demonstration. Disease frequencies were chosen to make the demo interesting and carry no epidemiological meaning. SNOMED CT, LOINC and ICD-11 codes are illustrative and must be validated against the licensed releases before real use. Pseudo-radiographs are not medical images and must never be used for any clinical or model-training purpose."),
      h("div", { class: "panel" }, h("header", {}, h("h2", {}, "What is real, what is simulated")), h("div", { class: "scroll", style: { maxHeight: "none" } }, h("table", { class: "t" },
        h("thead", {}, h("tr", {}, ["Layer", "In this prototype", "In production", "Fidelity"].map((c) => h("th", {}, c)))),
        h("tbody", {}, ROWS.map((r) => h("tr", {}, r.map((c, i) => h("td", i === 0 ? { style: { fontWeight: 500 } } : {}, c)))))))),
      h("div", { class: "panel" }, h("header", {}, h("h2", {}, "Things to try")), h("div", { class: "body" }, h("ol", { style: { margin: 0, paddingLeft: "18px", lineHeight: 1.8 } },
        h("li", {}, "On ", h("a", { href: "#/network" }, "Network"), ", ask about pneumonia findings. Raise k in the sidebar and watch small cells disappear at individual nodes."),
        h("li", {}, "Open a chest X-ray from ", h("a", { href: "#/cohorts" }, "Cohorts"), ", change its window/level, measure a distance, then add a finding. The picture redraws from the RDF record."),
        h("li", {}, "In ", h("a", { href: "#/ingest" }, "Ingest"), ", generate the sample DICOM with missing tags and see it quarantined. Then load a valid one and find it in the graph as data steward."),
        h("li", {}, "Switch to ", h("b", {}, "External researcher"), " and try the SPARQL page with a row-level query, then on ", h("a", { href: "#/governance" }, "Governance"), " run the attack buttons under each role.")))),
      h("div", { class: "panel" }, h("header", {}, h("h2", {}, "Limits worth knowing")), h("div", { class: "body" }, h("ul", { style: { margin: 0, paddingLeft: "18px", lineHeight: 1.7 } },
        h("li", {}, "The browser parser reads uncompressed DICOM only. JPEG, JPEG 2000 and RLE need the codecs that Cornerstone3D bundles."),
        h("li", {}, "Small-cell suppression stops naive re-identification but not differencing attacks across repeated queries. Production needs a privacy budget or query auditing on top."),
        h("li", {}, "The researcher-mode checks read the query text and the results. A production gateway should parse the SPARQL algebra instead of relying on patterns."),
        h("li", {}, "Reloading the page discards anything you loaded or annotated."))))));
}
