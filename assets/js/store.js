/* RDF store (Oxigraph compiled to WebAssembly) + the "policy proxy" that every query passes through.
 *
 * In the production architecture the same logic lives in the Backend API, in front of GraphDB:
 *   JWT claims  ->  role + site  ->  set of named graphs  ->  dataset handed to the SPARQL engine.
 * The user's query text can never widen the dataset, because the dataset is chosen by the server.
 */
import init, * as ox from "../vendor/oxigraph/web.js";
import * as audit from "./audit.js";

export const KG = "https://afribiobank.org/kg/";
export const NS = {
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#", rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  owl: "http://www.w3.org/2002/07/owl#", xsd: "http://www.w3.org/2001/XMLSchema#", prov: "http://www.w3.org/ns/prov#",
  geo: "http://www.opengis.net/ont/geosparql#", fhir: "http://hl7.org/fhir/", sct: "http://snomed.info/id/",
  icd11: "http://id.who.int/icd/release/11/mms/", dicom: "http://dicom.nema.org/ontology#", omiab: "http://purl.org/omia/",
  rad: "https://afribiobank.org/ontology/radiology#", adm: "https://afribiobank.org/ontology/admission#",
  afri: "https://afribiobank.org/ontology/core#", site: "https://afribiobank.org/ontology/site#", ex: KG,
};
/** Instance-level prefixes (one per resource class, because a "/" is not legal inside a Turtle local name). */
const INSTANCE_PREFIXES = { country: "Country/", patient: "Patient/", enc: "Encounter/", order: "Order/", study: "Study/",
  series: "Series/", image: "Image/", imgobs: "ImgObs/", labobs: "LabObs/", labtest: "LabTest/", concept: "Concept/", sitei: "Site/" };
const EXTRA_TTL = { quality: NS.afri + "Quality/", orderstatus: NS.afri + "OrderStatus/", annmethod: NS.afri + "AnnotationMethod/", cstatus: NS.afri + "ConceptStatus/" };

export const SITES = [
  { id: "site-nairobi", name: "Nairobi", cc: "KE", color: "#2A3B93", lon: 36.82, lat: -1.29 },
  { id: "site-accra", name: "Accra", cc: "GH", color: "#D89A0F", lon: -0.19, lat: 5.60 },
  { id: "site-capetown", name: "Cape Town", cc: "ZA", color: "#2F7D5B", lon: 18.42, lat: -33.92 },
  { id: "site-lagos", name: "Lagos", cc: "NG", color: "#B23A2C", lon: 3.38, lat: 6.52 },
  { id: "site-dakar", name: "Dakar", cc: "SN", color: "#7A4E9E", lon: -17.44, lat: 14.69 },
];
export const siteById = (id) => SITES.find((s) => s.id === id);
const SITE_IDS = SITES.map((s) => s.id);
export const graphOf = (site, kind) => `${KG}graph/${site}/${kind}`;
export const CORE = KG + "graph/core";
export const RECORD_LEVEL = /^https:\/\/afribiobank\.org\/kg\/(Patient|Encounter|Order|Study|Series|Image|ImgObs|LabObs)\//;
const RECORD_ID_LITERAL = /^(P|E|S|DCM|ORD)-[A-Z]{2}-\d{3,}/;

export const ROLES = {
  steward: { label: "Data steward", blurb: "All named graphs of every site, including provenance and quarantine. Can annotate." },
  clinician: { label: "Site radiologist", blurb: "All graphs of one home site, plus shared concepts. Can annotate at that site." },
  researcher: { label: "External researcher", blurb: "Aggregate queries only, across sites. Row-level identifiers are never returned; small cells are suppressed." },
};

/** The current "JWT claims" of the demo user. */
export const session = { role: "steward", site: "site-nairobi", k: 5 };

export let store = null;
export let GRAPHS = [];

export async function loadStore(setStatus = () => {}) {
  setStatus("Starting SPARQL engine (WebAssembly)…");
  await init();
  store = new ox.Store();
  setStatus("Downloading synthetic dataset…");
  const res = await fetch("data/afribiobank-demo.trig");
  if (!res.ok) throw new Error("Could not fetch data/afribiobank-demo.trig (" + res.status + ")");
  const text = await res.text();
  setStatus("Loading named graphs into the store…");
  store.load(text, { format: "application/trig", base_iri: KG });
  refreshGraphs();
  return store;
}

export function refreshGraphs() {
  const j = JSON.parse(store.query("SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s ?p ?o } }", { results_format: "application/sparql-results+json" }));
  GRAPHS = j.results.bindings.map((b) => b.g.value).sort();
}

/* ------------------------------------------------------------------ prefixes & display */
export const SPARQL_PREFIXES = { ...NS, ...Object.fromEntries(Object.entries(INSTANCE_PREFIXES).map(([p, seg]) => [p, KG + seg])), ...EXTRA_TTL };
export const PREFIX_LINES = Object.entries(SPARQL_PREFIXES).map(([p, iri]) => `PREFIX ${p}: <${iri}>`).join("\n");
export const PREFIX_TTL = Object.entries(NS).map(([p, iri]) => `@prefix ${p}: <${iri}> .`).join("\n") + "\n" +
  Object.entries(INSTANCE_PREFIXES).map(([p, seg]) => `@prefix ${p}: <${KG}${seg}> .`).join("\n") + "\n" +
  Object.entries(EXTRA_TTL).map(([p, iri]) => `@prefix ${p}: <${iri}> .`).join("\n") + "\n";

/** Prepend any standard PREFIX lines the user did not declare. */
export function withPrefixes(q) {
  const missing = Object.entries(SPARQL_PREFIXES).filter(([p]) => !new RegExp(`PREFIX\\s+${p}\\s*:`, "i").test(q))
    .map(([p, iri]) => `PREFIX ${p}: <${iri}>`);
  return missing.join("\n") + "\n" + q;
}

/** Shorten an IRI for display: ex:Patient/P-KE-0001, fhir:subject, graph/site-nairobi/imaging ... */
export function shorten(iri) {
  if (iri.startsWith(KG + "graph/")) return "graph/" + iri.slice((KG + "graph/").length);
  if (iri.startsWith(KG)) return "ex:" + iri.slice(KG.length);
  if (iri === NS.rdf + "type") return "a";
  for (const [p, ns] of Object.entries(NS)) if (p !== "ex" && iri.startsWith(ns)) return p + ":" + iri.slice(ns.length);
  for (const [p, ns] of Object.entries(EXTRA_TTL)) if (iri.startsWith(ns)) return p + ":" + iri.slice(ns.length);
  return iri;
}
export const localName = (iri) => iri.split(/[/#]/).filter(Boolean).pop();

/* ------------------------------------------------------------------ graph scoping per role */
export function allowedGraphs(sess = session) {
  if (sess.role === "steward") return GRAPHS;
  if (sess.role === "clinician") return GRAPHS.filter((g) => g === CORE || g.startsWith(`${KG}graph/${sess.site}/`));
  return GRAPHS.filter((g) => g === CORE || (SITE_IDS.some((s) => g.startsWith(`${KG}graph/${s}/`)) && !/\/(rejected|provenance)$/.test(g)));
}
/** What a single node exposes to the federation: its own production graphs, never provenance or quarantine. */
export const nodeGraphs = (siteId) => GRAPHS.filter((g) => g === CORE || (g.startsWith(`${KG}graph/${siteId}/`) && !/\/(rejected|provenance)$/.test(g)));

export const canWrite = (siteId, sess = session) => sess.role === "steward" || (sess.role === "clinician" && sess.site === siteId);

/* ------------------------------------------------------------------ query execution */
function strip(q) {
  return q.replace(/<[^<>\s]*>/g, "<>").replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""').replace(/#[^\n]*/g, "");
}
export const queryType = (q) => (strip(q).match(/\b(SELECT|ASK|CONSTRUCT|DESCRIBE)\b/i) || [])[1]?.toUpperCase() || null;

const dsOptions = (graphs) => ({ default_graph: graphs.map((g) => ox.namedNode(g)), named_graphs: graphs.map((g) => ox.namedNode(g)) });
const nicerError = (e) => String(e?.message || e).replace(/expected one of[\s\S]*/, "unexpected token here").split("\n")[0].slice(0, 220);

/** Raw execution against an explicit dataset. No policy, no audit: only used by internal code paths. */
export function execute(text, graphs) {
  const type = queryType(text);
  const t0 = performance.now();
  const opts = graphs ? dsOptions(graphs) : { use_default_graph_as_union: true };
  const q = withPrefixes(text);
  if (type === "CONSTRUCT" || type === "DESCRIBE") {
    const ttl = store.query(q, { ...opts, results_format: "text/turtle" });
    return { type, turtle: ttl, ms: performance.now() - t0 };
  }
  const j = JSON.parse(store.query(q, { ...opts, results_format: "application/sparql-results+json" }));
  if (type === "ASK") return { type, ask: j.boolean, ms: performance.now() - t0 };
  const vars = j.head.vars;
  const rows = j.results.bindings.map((b) => Object.fromEntries(vars.filter((v) => b[v]).map((v) => [v, {
    t: b[v].type === "uri" ? "iri" : b[v].type === "bnode" ? "bnode" : "lit", v: b[v].value, dt: b[v].datatype, lang: b[v]["xml:lang"] }])));
  return { type, vars, rows, ms: performance.now() - t0 };
}

/** Catalogue-level helper for the UI (dashboard counters, dropdowns): unrestricted, not audited. */
export function internal(text) { return execute(text, null); }

/** The policy proxy: the only path user-authored SPARQL takes. */
export function policyRun(text, sess = session, opts = {}) {
  const bare = strip(text);
  const type = queryType(text);
  const log = (decision, reason, extra = {}) => audit.record({ actor: ROLES[sess.role].label + (sess.role === "clinician" ? " @ " + siteById(sess.site).name : ""),
    action: opts.label || "sparql", detail: text.replace(/\s+/g, " ").trim().slice(0, 90), decision, reason, ...extra });
  const block = (reason) => { log("blocked", reason); return { ok: false, blocked: true, error: reason }; };

  if (!type) return { ok: false, error: "Not a SELECT, ASK, CONSTRUCT or DESCRIBE query." };
  if (/\bSERVICE\b/i.test(bare)) return block("Blocked: SERVICE clauses are not allowed from the user interface. Cross-site questions go through the federation gateway, which only calls registered nodes.");
  if (/\b(INSERT|DELETE|LOAD|CLEAR|DROP|CREATE|COPY|MOVE|ADD)\b/i.test(bare) && !/\b(SELECT|ASK|CONSTRUCT|DESCRIBE)\b/i.test(bare)) return block("Blocked: the SPARQL endpoint is read-only.");
  if (sess.role !== "steward" && /\bFROM\b/i.test(bare)) return block("Blocked: FROM / FROM NAMED is reserved for data stewards. Your dataset is set by your role.");

  let countAliases = [];
  if (sess.role === "researcher") {
    if (type !== "SELECT") return block("Blocked: external researchers may only run SELECT queries with aggregates.");
    countAliases = [...bare.matchAll(/COUNT\s*\(.*?\)\s*AS\s*\?(\w+)/gi)].map((m) => m[1]);
    if (!countAliases.length) return block("Blocked: researcher queries must aggregate, e.g. (COUNT(DISTINCT ?study) AS ?n). Row-level results are not released.");
  }

  const graphs = opts.graphs || allowedGraphs(sess);
  let res;
  try { res = execute(text, graphs); }
  catch (e) { log("error", nicerError(e)); return { ok: false, error: nicerError(e) }; }

  const notes = [];
  if (sess.role === "researcher") {
    const leaks = res.rows.some((r) => Object.values(r).some((c) => (c.t === "iri" && RECORD_LEVEL.test(c.v)) || (c.t === "lit" && RECORD_ID_LITERAL.test(c.v))));
    if (leaks) return block("Blocked after execution: the result contained record-level identifiers (patient, study or image IDs). Group by a category instead.");
    const before = res.rows.length;
    res.rows = res.rows.filter((r) => countAliases.every((a) => !r[a] || Number(r[a].v) >= sess.k));
    if (before > res.rows.length) notes.push(`${before - res.rows.length} group(s) hidden because a count was below the minimum cell size (k = ${sess.k}).`);
  }
  log("allowed", notes[0] || "", { rows: res.rows ? res.rows.length : undefined });
  return { ok: true, ...res, notes, graphs: graphs.length };
}

/* ------------------------------------------------------------------ graph-level access for the explorer / viewer */
export function match(s, p, o, sess = session) {
  const allowed = new Set(allowedGraphs(sess));
  const t = (x) => (x == null ? null : typeof x === "string" ? ox.namedNode(x) : x);
  return store.match(t(s), t(p), t(o), null).filter((q) => allowed.has(q.graph.value));
}
export const iri = (s) => ox.namedNode(s);

/** Add Turtle to a named graph (used by annotation and ingest). */
export function addTurtle(ttl, graph) {
  store.load(PREFIX_TTL + ttl, { format: "text/turtle", base_iri: KG, to_graph_name: ox.namedNode(graph) });
  refreshGraphs();
}
export const tripleCount = () => store.size;

/** Where does a resource live? (which graph / site) */
export function siteOfGraph(g) { const m = g.match(/graph\/([^/]+)\//); return m ? m[1] : null; }
