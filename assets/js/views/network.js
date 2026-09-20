import { h, svg, fmt, sleep, $ } from "../util.js";
import { SITES, internal, policyRun, nodeGraphs, session, siteById, graphOf, tripleCount, GRAPHS } from "../store.js";

// Coarse Africa outline (lon, lat). Deliberately low-poly: it is a locator, not a cartographic claim.
const AFRICA = [[10.2,37.3],[3,36.8],[-2,35.1],[-5.9,35.8],[-9.6,31.5],[-13,27.7],[-16.5,23.5],[-17,21],[-16.4,17.5],[-17.5,14.7],[-16.8,12.4],[-13.7,9.5],[-10.8,7.6],[-7.6,4.4],[-3.5,5.1],[1.2,6],[3.4,6.3],[6.2,4.3],[9.7,3.8],[9.4,0.4],[11.6,-4.6],[13.3,-9],[12.2,-16.5],[14.5,-22.8],[15.2,-27.5],[17.9,-32.6],[18.4,-34.3],[20,-34.8],[25.5,-34],[28.5,-32.4],[31,-29.9],[32.9,-26],[35.3,-23.5],[35,-19.8],[40.6,-15],[40.4,-10.5],[39.3,-6],[39.6,-3.5],[41.5,-1.5],[44,1.5],[47.7,4.5],[49.9,8.5],[51.3,11.8],[46,10.7],[43.3,11.8],[42.7,13],[39.5,15.6],[37.3,20.5],[34.5,26],[32.6,29.9],[31.3,31.5],[25,31.6],[20,32.4],[15.2,32.3],[11.5,33.1],[10.1,34.3]];
const MADAGASCAR = [[49.3,-12.1],[50.4,-15.5],[49.6,-17.6],[47.9,-23.5],[45.2,-25.3],[43.9,-23.3],[44.3,-20],[44,-17],[46.3,-15.8],[47.6,-14]];
const P = ([lon, lat]) => [20 + ((lon + 20) / 74) * 560, 20 + ((38 - lat) / 75) * 600];
const path = (pts) => "M" + pts.map((p) => P(p).map((n) => n.toFixed(1)).join(",")).join("L") + "Z";

const QUESTIONS = [
  { id: "pna", title: "Chest X-ray findings: pneumonia", key: "result", sparql: `SELECT ?result (COUNT(DISTINCT ?obs) AS ?n)
WHERE {
  ?obs fhir:code/fhir:coding/fhir:display "Pneumonia" ;
       fhir:valueCodeableConcept/fhir:coding/fhir:display ?result .
}
GROUP BY ?result` },
  { id: "mod", title: "Imaging studies by modality", key: "modality", sparql: `SELECT ?modality (COUNT(DISTINCT ?study) AS ?n)
WHERE {
  ?study a fhir:ImagingStudy ;
         fhir:modality/fhir:code ?modality .
}
GROUP BY ?modality` },
  { id: "q", title: "Image quality category", key: "category", sparql: `SELECT ?category (COUNT(?img) AS ?n)
WHERE {
  ?img a fhir:Media ; afri:imageQualityCategory ?q .
  BIND(STRAFTER(STR(?q), "Quality/") AS ?category)
}
GROUP BY ?category` },
  { id: "tb", title: "Tuberculosis-pattern findings by sex", key: "sex", sparql: `SELECT ?sex (COUNT(DISTINCT ?obs) AS ?n)
WHERE {
  ?obs fhir:code/fhir:coding/fhir:display "Pulmonary tuberculosis" ;
       fhir:valueCodeableConcept/fhir:coding/fhir:display "Present" ;
       fhir:subject/fhir:gender ?sex .
}
GROUP BY ?sex` },
  { id: "crp", title: "Pneumonia-positive studies by CRP interpretation", key: "crp_flag", sparql: `SELECT ?crp_flag (COUNT(DISTINCT ?study) AS ?n)
WHERE {
  ?obs fhir:partOf ?study ;
       fhir:code/fhir:coding/fhir:display "Pneumonia" ;
       fhir:valueCodeableConcept/fhir:coding/fhir:display "Present" .
  ?lab afri:relatedImagingStudy ?study ;
       fhir:code labtest:crp ;
       fhir:interpretation/fhir:display ?crp_flag .
}
GROUP BY ?crp_flag` },
];

const count1 = (q) => Number(internal(q).rows[0]?.n?.v || 0);

export async function mount(root) {
  let qi = 0, running = false;
  const counts = {};
  for (const s of SITES) {
    const g = (k) => `<${graphOf(s.id, k)}>`;
    counts[s.id] = {
      patients: count1(`SELECT (COUNT(*) AS ?n) WHERE { GRAPH ${g("clinical")} { ?p a fhir:Patient } }`),
      studies: count1(`SELECT (COUNT(*) AS ?n) WHERE { GRAPH ${g("imaging")} { ?p a fhir:ImagingStudy } }`),
      images: count1(`SELECT (COUNT(*) AS ?n) WHERE { GRAPH ${g("images")} { ?p a fhir:Media } }`),
      latency: 60 + Math.round(((s.lon * 7 + s.lat * 13) % 90 + 90) % 90) + 40,
    };
  }
  const tot = (k) => SITES.reduce((a, s) => a + counts[s.id][k], 0);

  // ---------------- map
  const S = svg("svg", { viewBox: "0 0 600 640", role: "img", "aria-label": "Map of Africa with five demo nodes connected to a query coordinator" });
  S.append(svg("path", { d: path(AFRICA), fill: "#D6DFDA", stroke: "#AEBBB5", "stroke-width": 1.2, "stroke-linejoin": "round" }),
    svg("path", { d: path(MADAGASCAR), fill: "#D6DFDA", stroke: "#AEBBB5", "stroke-width": 1.2 }));
  const hub = P([-13, -20]);
  const lines = {}, pulses = {}, tags = {};
  for (const s of SITES) {
    const [x, y] = P([s.lon, s.lat]), mx = (hub[0] + x) / 2 - 40, my = (hub[1] + y) / 2 + 10;
    lines[s.id] = svg("path", { d: `M${hub[0]},${hub[1]} Q${mx},${my} ${x},${y}`, fill: "none", stroke: s.color, "stroke-width": 1.6, opacity: .35 });
    S.append(lines[s.id]);
  }
  S.append(svg("g", {}, svg("rect", { x: hub[0] - 46, y: hub[1] - 15, width: 92, height: 30, rx: 4, fill: "#1B2666" }),
    svg("text", { x: hub[0], y: hub[1] + 4.5, "text-anchor": "middle", fill: "#fff", "font-size": 12, "font-family": "IBM Plex Sans" }, "Coordinator")));
  for (const s of SITES) {
    const [x, y] = P([s.lon, s.lat]);
    pulses[s.id] = svg("circle", { cx: x, cy: y, r: 7, fill: s.color, opacity: 0 });
    const left = s.id === "site-accra", dx = left ? -12 : 12, anchor = left ? "end" : "start";
    tags[s.id] = svg("text", { x: x + dx, y: y + (left ? 22 : 17), "text-anchor": anchor, "font-size": 11.5, fill: "#16202A", "font-family": "IBM Plex Sans" });
    const link = svg("a", { href: "#/cohorts", "aria-label": `${s.name} node` },
      pulses[s.id], svg("circle", { cx: x, cy: y, r: 7.5, fill: s.color, stroke: "#fff", "stroke-width": 2 }),
      svg("text", { x: x + dx, y: y + (left ? 9 : 4), "text-anchor": anchor, "font-size": 13.5, "font-weight": 600, fill: "#16202A", "font-family": "Bricolage Grotesque" }, s.name), tags[s.id]);
    S.append(link);
  }

  // ---------------- question panel
  const out = h("div", { id: "fed-out" });
  const qBtns = QUESTIONS.map((q, i) => h("button", { "aria-pressed": i === 0, onclick: () => { qi = i; qBtns.forEach((b, j) => b.setAttribute("aria-pressed", j === i)); sparqlBox.textContent = QUESTIONS[i].sparql; out.replaceChildren(); } }, q.title));
  const sparqlBox = h("pre", { class: "code" }, QUESTIONS[0].sparql);
  const runBtn = h("button", { class: "btn live", onclick: run }, "Ask all 5 nodes");

  async function run() {
    if (running) return; running = true; runBtn.disabled = true;
    const q = QUESTIONS[qi], k = session.k;
    out.replaceChildren(h("p", { class: "muted small" }, "Sending the query to each node. Every node runs it locally and answers with counts only…"));
    Object.values(tags).forEach((t) => (t.textContent = ""));
    const results = {};
    await Promise.all(SITES.map(async (s, i) => {
      await sleep(120 * i);
      lines[s.id].classList.add("flow"); lines[s.id].setAttribute("opacity", 1);
      await sleep(counts[s.id].latency * 3);
      // Node-side policy: aggregates only, small-cell suppression at k. Dataset = this node's production graphs.
      const r = policyRun(q.sparql, { role: "researcher", site: s.id, k }, { graphs: nodeGraphs(s.id), label: "federated@" + s.name });
      results[s.id] = r;
      pulses[s.id].classList.remove("node-pulse"); void pulses[s.id].getBoundingClientRect(); pulses[s.id].classList.add("node-pulse"); pulses[s.id].setAttribute("opacity", .9);
      tags[s.id].textContent = r.ok ? `${r.rows.length} group${r.rows.length === 1 ? "" : "s"} returned` : "refused";
      lines[s.id].classList.remove("flow"); lines[s.id].setAttribute("opacity", .35);
    }));
    render(q, results, k);
    running = false; runBtn.disabled = false;
  }

  function render(q, results, k) {
    const keys = new Map(); // key -> {site: n|null}
    let hidden = 0;
    for (const s of SITES) {
      const r = results[s.id]; if (!r.ok) continue;
      hidden += (r.notes?.length ? Number(r.notes[0].match(/^(\d+)/)?.[1] || 0) : 0);
      for (const row of r.rows) {
        const key = row[q.key]?.v ?? "(none)"; if (!keys.has(key)) keys.set(key, {});
        keys.get(key)[s.id] = Number(row.n.v);
      }
    }
    // Groups that a node hid because of small cells simply do not appear for that node.
    const sorted = [...keys.keys()].sort();
    const max = Math.max(1, ...sorted.map((key) => Object.values(keys.get(key)).reduce((a, b) => a + b, 0)));
    const failed = SITES.filter((s) => !results[s.id].ok);
    const rowsEl = sorted.map((key) => {
      const cells = keys.get(key); const disclosed = SITES.filter((s) => cells[s.id] != null);
      const total = disclosed.reduce((a, s) => a + cells[s.id], 0), partial = disclosed.length < SITES.length;
      return h("tr", {}, h("td", {}, key),
        SITES.map((s) => h("td", { class: "num" }, cells[s.id] != null ? cells[s.id] : h("span", { class: "supp", title: `Hidden by ${s.name}: fewer than ${k} records` }, `<${k}`))),
        h("td", { class: "num" }, (partial ? "≥ " : "") + total, " ", h("span", { class: "bar", style: { width: Math.round((total / max) * 70) + "px" } })));
    });
    out.replaceChildren(
      h("div", { class: "scroll" }, h("table", { class: "t compact" },
        h("thead", {}, h("tr", {}, h("th", {}, q.key), SITES.map((s) => h("th", { class: "num", title: s.name }, h("span", { class: "dot", style: { background: s.color } }), s.cc)), h("th", { class: "num" }, "All"))),
        h("tbody", {}, rowsEl.length ? rowsEl : h("tr", {}, h("td", { colspan: 7, class: "muted" }, "Every group was below the minimum cell size at every node. Lower k or ask a broader question."))))),
      h("p", { class: "small muted", style: { marginTop: "8px" } },
        `Each node returned only group counts. Counts under k = ${k} are hidden at the node, so “≥” marks a combined figure that omits hidden cells. `,
        failed.length ? `Refused by: ${failed.map((s) => s.name).join(", ")}. ` : "",
        hidden ? `${hidden} group(s) were suppressed across nodes.` : ""),
      h("details", {}, h("summary", {}, "How this maps to the federation spec"),
        h("p", { class: "small" }, "The Federation Layer Specification allows SPARQL 1.1 ", h("code", {}, "SERVICE"), " calls between nodes. This prototype uses the safer gateway pattern: the coordinator sends the same query to each registered node, each node applies its own access policy, and only aggregates travel back. No node ever sees another node’s rows, and the browser SPARQL box blocks ", h("code", {}, "SERVICE"), " entirely.")));
  }

  const nodeTable = h("table", { class: "t" }, h("thead", {}, h("tr", {}, h("th", {}, "Node"), h("th", { class: "num" }, "Patients"), h("th", { class: "num" }, "Studies"), h("th", { class: "num" }, "Images"), h("th", { class: "num" }, "Round trip"))),
    h("tbody", {}, SITES.map((s) => h("tr", {}, h("td", {}, h("span", { class: "dot", style: { background: s.color } }), s.name, " ", h("span", { class: "muted small" }, s.cc)),
      h("td", { class: "num" }, counts[s.id].patients), h("td", { class: "num" }, counts[s.id].studies), h("td", { class: "num" }, counts[s.id].images), h("td", { class: "num muted" }, counts[s.id].latency + " ms")))));

  root.append(
    h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Ask the network, keep the data home"),
      h("p", {}, "Five demo nodes, each holding its own synthetic imaging data. Pick a question and send it to every node. Only aggregate counts come back."))),
    h("div", { class: "stats" },
      h("div", {}, h("b", {}, SITES.length), h("span", {}, "nodes online (simulated)")), h("div", {}, h("b", {}, fmt(tot("patients"))), h("span", {}, "patients")),
      h("div", {}, h("b", {}, fmt(tot("studies"))), h("span", {}, "imaging studies")), h("div", {}, h("b", {}, fmt(tot("images"))), h("span", {}, "images")),
      h("div", {}, h("b", {}, fmt(tripleCount())), h("span", {}, `RDF quads in ${GRAPHS.length} named graphs`))),
    h("div", { class: "split" },
      h("div", { class: "grid" }, h("div", { class: "mapwrap" }, S), h("div", { class: "panel" }, h("header", {}, h("h3", {}, "Nodes")), h("div", { class: "scroll", style: { maxHeight: "none" } }, nodeTable))),
      h("div", { class: "panel" }, h("header", {}, h("h2", {}, "Ask the network"), runBtn),
        h("div", { class: "body" }, h("div", { class: "qlist" }, qBtns),
          h("p", { class: "small muted" }, "Nodes hide any group with fewer than ", h("b", {}, "k = " + session.k), " records (slider in the sidebar). Federated questions are answered as aggregates whatever your role."),
          h("details", {}, h("summary", {}, "What each node receives (SPARQL)"), sparqlBox), h("div", { style: { marginTop: "12px" } }, out)))));
  return () => {};
}
