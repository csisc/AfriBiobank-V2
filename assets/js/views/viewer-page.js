import { h, toast, $ } from "../util.js";
import { KG, SITES, siteById, policyRun, session, localName, canWrite, addTurtle, graphOf, ROLES } from "../store.js";
import { Viewer } from "../viewer.js";
import { synthImage } from "../synth.js";
import { localImages } from "../local.js";
import * as audit from "../audit.js";

const CODES = { "Pneumonia": "233604007", "Pulmonary tuberculosis": "154283005", "Pleural effusion": "60046008", "Cardiomegaly": "8186001", "Atelectasis": "46621007", "Pneumothorax": "36118008" };
const LAT = { Left: "7771000", Right: "24028007", Bilateral: "51440002", Unspecified: "272741003" };
const VAL = { Present: "373066001", Absent: "373067005", Indeterminate: "82334004" };
const valBadge = (v) => (v === "Present" ? "bad" : v === "Absent" ? "ok" : "warn");

function stageUI(viewer0) {
  const canvas = h("canvas", { "aria-label": "Image viewport" });
  const stage = h("div", { class: "stage" }, canvas);
  const v = new Viewer(canvas);
  const tools = [["wl", "Window/level"], ["pan", "Pan"], ["zoom", "Zoom"], ["length", "Length"], ["roi", "Ellipse ROI"]];
  const btns = tools.map(([k, t]) => h("button", { class: "btn tool sm", "aria-pressed": k === "wl", onclick: () => { v.setTool(k); btns.forEach((b, i) => b.setAttribute("aria-pressed", tools[i][0] === k)); } }, t));
  v.setTool("wl");
  const presetSel = h("select", { "aria-label": "Window preset", onchange: (e) => { const p = v.img.presets?.[+e.target.value]; if (p) v.setWindow(p[1], p[2]); } });
  const bar = h("div", { class: "toolbar" }, btns, presetSel,
    h("button", { class: "btn sm", onclick: () => v.toggleInvert() }, "Invert"),
    h("button", { class: "btn sm", onclick: () => v.resetView() }, "Reset"),
    h("button", { class: "btn sm", onclick: () => v.clearAnnotations() }, "Clear measurements"));
  const setImage = (img, wm) => {
    v.watermark = wm || ""; v.setImage(img);
    presetSel.replaceChildren(...(img.presets || [["Default", img.wc, img.ww]]).map((p, i) => h("option", { value: i }, p[0])));
    presetSel.style.display = (img.presets || []).length > 1 ? "" : "none";
  };
  return { v, stage, bar, setImage };
}
const kv = (rows) => h("dl", { class: "kv" }, rows.filter((r) => r[1] != null && r[1] !== "").map(([k, val]) => [h("dt", {}, k), h("dd", {}, val)]));

export async function mount(root, params) {
  if (!params[0]) return picker(root);
  if (params[0] === "local") return localPage(root, params[1]);
  if (session.role === "researcher") {
    root.append(h("div", { class: "page-head" }, h("h1", {}, "Viewer")),
      h("div", { class: "notice" }, "Image viewing is not available to the external researcher role. Researchers work with aggregates, or request an approved extract through a data access committee."));
    return;
  }
  const id = params[0], S = "study:" + id;
  const q1 = `SELECT ?patient ?enc ?site ?modality ?mdisp ?started ?series ?body ?proto ?image ?rows ?cols ?spacing ?qscore ?qcat ?reason ?uri ?hash ?view ?sex ?born
WHERE {
  ${S} a fhir:ImagingStudy ; fhir:subject ?patient ; fhir:encounter ?enc ; fhir:started ?started ;
       fhir:modality [ fhir:code ?modality ; fhir:display ?mdisp ] ;
       afri:performedAt ?site ; afri:containsSeries ?series .
  ?series dicom:BodyPartExamined ?body ; afri:acquisitionProtocol ?proto ; afri:containsInstance ?image .
  ?image dicom:Rows ?rows ; dicom:Columns ?cols ; dicom:PixelSpacing ?spacing ;
         afri:imageQualityScore ?qscore ; afri:imageQualityCategory ?qcat ;
         fhir:content [ fhir:url ?uri ; fhir:hash ?hash ] .
  OPTIONAL { ?image afri:rejectionReason ?reason }
  OPTIONAL { ?image dicom:ViewPosition ?view }
  OPTIONAL { ?patient fhir:gender ?sex ; fhir:birthDate ?born }
}`;
  const r1 = policyRun(q1, session, { label: "viewer:study" });
  if (!r1.ok || !r1.rows.length) {
    root.append(h("div", { class: "page-head" }, h("h1", {}, "Viewer")),
      h("div", { class: "notice bad" }, r1.ok ? `Study ${id} was not found in the graphs your role can read.` : r1.error),
      h("p", {}, h("a", { href: "#/cohorts" }, "Back to cohorts")));
    return;
  }
  const d = Object.fromEntries(Object.entries(r1.rows[0]).map(([k, c]) => [k, c.v]));
  const siteId = localName(d.site), site = siteById(siteId);

  const ui = stageUI();
  const findEl = h("div"), labsEl = h("div"), formEl = h("div"), treeEl = h("div", { class: "tree" });

  function loadFindings() {
    const r = policyRun(`SELECT ?obs ?name ?value ?conf ?lat ?method ?who
WHERE {
  ?obs fhir:partOf ${S} ;
       fhir:code/fhir:coding/fhir:display ?name ;
       fhir:valueCodeableConcept/fhir:coding/fhir:display ?value ;
       afri:observationConfidence ?conf ;
       afri:findingLaterality/fhir:display ?lat ;
       afri:annotationMethod ?method ; afri:annotatedBy ?who .
} ORDER BY ?name`, session, { label: "viewer:findings" });
    const rows = r.ok ? r.rows.map((x) => ({ name: x.name.v, value: x.value.v, conf: +x.conf.v, lat: x.lat.v, method: localName(x.method.v), who: x.who.v })) : [];
    findEl.replaceChildren(...[].concat(rows.length ? rows.map((f) => h("div", { class: "finding" },
      h("div", {}, h("b", {}, f.name), h("div", { class: "muted small" }, `${f.lat} · ${f.method} · ${f.who}`)),
      h("div", { style: { textAlign: "right" } }, h("span", { class: "badge " + valBadge(f.value) }, f.value), h("div", { class: "muted small" }, "confidence " + f.conf.toFixed(2))))) :
      h("p", { class: "muted small" }, d.qcat === "Rejected" ? "No findings were recorded: the image was rejected at quality control." : "No image findings recorded for this modality.")));
    return rows;
  }
  function loadLabs() {
    const r = policyRun(`SELECT ?test ?v ?u ?flag ?fd
WHERE {
  ?lab afri:relatedImagingStudy ${S} ; fhir:code/rdfs:label ?test ;
       fhir:valueQuantity [ fhir:value ?v ; fhir:unit ?u ] ;
       fhir:interpretation [ fhir:code ?flag ; fhir:display ?fd ] .
}`, session, { label: "viewer:labs" });
    labsEl.replaceChildren(...[].concat(r.ok && r.rows.length ? r.rows.map((x) => h("div", { class: "finding" }, h("span", {}, x.test.v),
      h("span", {}, x.v.v + " " + x.u.v + " ", h("span", { class: "badge " + (x.flag.v === "N" ? "ok" : x.flag.v === "HH" ? "bad" : "warn") }, x.fd.v)))) : h("p", { class: "muted small" }, "No linked laboratory results.")));
  }
  function draw(rows) {
    const img = synthImage({ modality: d.modality, body: d.body, seed: d.image, quality: +d.qscore,
      findings: rows.map((f) => ({ key: f.name, value: f.value, lat: f.lat })) });
    ui.setImage(img, "SYNTHETIC ILLUSTRATION · not a real radiograph · findings drawn from the RDF record");
  }
  let rows = loadFindings(); loadLabs(); draw(rows);

  // sibling studies (tree)
  const sib = policyRun(`SELECT ?s ?m WHERE { ?s fhir:subject <${d.patient}> ; fhir:modality/fhir:code ?m } ORDER BY ?s`, session, { label: "viewer:tree" });
  treeEl.append(h("ul", {}, h("li", {}, h("a", { class: "iri", href: "#/graph/" + encodeURIComponent(d.patient) }, localName(d.patient)), " ", h("span", { class: "muted small" }, [d.sex, d.born].filter(Boolean).join(", ")),
    h("ul", {}, (sib.rows || []).map((x) => { const sid = localName(x.s.v), cur = sid === id;
      return h("li", {}, cur ? h("b", {}, sid) : h("a", { class: "iri", href: "#/viewer/" + sid }, sid), " ", h("span", { class: "badge info" }, x.m.v),
        cur ? h("ul", {}, h("li", { class: "muted small" }, "Series " + localName(d.series).split(".").slice(-2).join(".")), h("ul", {}, h("li", { class: "small" }, "Instance " + localName(d.image)))) : null); })))));

  // annotation form
  const fSel = h("select", {}, Object.keys(CODES).map((k) => h("option", {}, k)));
  const vSel = h("select", {}, ["Present", "Absent", "Indeterminate"].map((k) => h("option", {}, k)));
  const lSel = h("select", {}, ["Right", "Left", "Bilateral", "Unspecified"].map((k) => h("option", {}, k)));
  const conf = h("input", { type: "range", min: 0, max: 1, step: 0.01, value: 0.85 }), confV = h("b", {}, "0.85");
  conf.oninput = () => (confV.textContent = (+conf.value).toFixed(2));
  const allowed = canWrite(siteId);
  formEl.append(h("div", { class: "grid", style: { gap: "8px" } },
    h("label", { class: "f" }, "Finding (SNOMED CT)", fSel), h("div", { class: "row" }, h("label", { class: "f grow" }, "Value", vSel), h("label", { class: "f grow" }, "Laterality", lSel)),
    h("label", { class: "f" }, ["Confidence ", confV], conf),
    h("button", { class: "btn primary", disabled: !allowed, onclick: () => {
      const oid = `${id}-ann-${Date.now().toString(36)}`, name = fSel.value, val = vSel.value, lat = lSel.value;
      const ttl = `imgobs:${oid} a fhir:Observation ;
  fhir:status [ fhir:v "preliminary" ] ; fhir:subject <${d.patient}> ; fhir:partOf ${S} ; fhir:derivedFrom <${d.image}> ;
  fhir:code [ a fhir:CodeableConcept ; fhir:coding [ fhir:system "http://snomed.info/sct" ; fhir:code "${CODES[name]}" ; fhir:display "${name}" ] ] ;
  fhir:valueCodeableConcept [ fhir:coding [ fhir:system "http://snomed.info/sct" ; fhir:code "${VAL[val]}" ; fhir:display "${val}" ] ] ;
  afri:observationConfidence ${(+conf.value).toFixed(2)} ;
  afri:findingLaterality [ fhir:system "http://snomed.info/sct" ; fhir:code "${LAT[lat]}" ; fhir:display "${lat}" ] ;
  afri:annotationMethod <https://afribiobank.org/ontology/core#AnnotationMethod/Manual> ; afri:annotatedBy "demo-user" .`;
      addTurtle(ttl, graphOf(siteId, "findings"));
      audit.record({ actor: ROLES[session.role].label, action: "annotate", detail: `${name} = ${val} on ${id}`, decision: "allowed", reason: "written to " + graphOf(siteId, "findings").replace(KG, "") });
      rows = loadFindings(); draw(rows); toast("Annotation stored as RDF in " + graphOf(siteId, "findings").replace(KG, ""), "ok");
    } }, "Add finding to graph"),
    allowed ? h("p", { class: "small muted" }, "Writes an fhir:Observation into this site’s findings graph. The image redraws from the updated record.")
      : h("p", { class: "small muted" }, "Your role cannot write to ", h("b", {}, site?.name || siteId), ". Switch to data steward, or to site radiologist at this site.")));

  const panel = (title, body) => h("div", { class: "panel", style: { marginBottom: "12px" } }, h("header", {}, h("h3", {}, title)), h("div", { class: "body" }, body));
  root.append(...[
    h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Study " + id),
      h("p", {}, [site?.name, d.mdisp, d.body.toLowerCase(), d.started.slice(0, 10)].join(" · ")))),
    d.qcat === "Rejected" ? h("div", { class: "notice bad", style: { marginBottom: "12px" } }, h("b", {}, "Rejected at quality control: "), d.reason || "no reason recorded", ". The image is retained for audit, as the data model requires.") : null,
    h("div", { class: "vgrid" },
      h("div", { class: "panel" }, h("header", {}, h("h3", {}, "Hierarchy")), h("div", { class: "body" }, treeEl)),
      h("div", {}, ui.bar, ui.stage, h("p", { class: "small muted", style: { marginTop: "6px" } }, "Drag to change window/level (or pick another tool). Wheel to zoom, shift-drag to pan, double-click to reset.")),
      h("div", {}, panel("Findings in the graph", findEl), panel("Add annotation", formEl), panel("Linked laboratory results", labsEl))),
    h("div", { class: "grid", style: { gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", marginTop: "14px" } },
      panel("DICOM identity and storage", kv([["Patient", localName(d.patient)], ["Study", id], ["Series UID", localName(d.series)], ["Instance", localName(d.image)], ["Modality", d.modality], ["View", d.view], ["Matrix", `${d.rows} × ${d.cols}`], ["Pixel spacing", d.spacing + " mm"], ["Protocol", d.proto], ["Storage URI", d.uri], ["SHA-256 (b64)", d.hash]])),
      panel("Image quality", kv([["Score", (+d.qscore).toFixed(2)], ["Category", d.qcat.split("/").pop()], ["Reason", d.reason], ["Assessed by", "automated-QA-demo"]]))),
  ].filter(Boolean));
  return () => ui.v.destroy();
}

function picker(root) {
  const r = session.role === "researcher" ? null : policyRun(`SELECT ?study ?site ?m WHERE { ?study a fhir:ImagingStudy ; afri:performedAt ?site ; fhir:modality/fhir:code ?m .
  ?obs fhir:partOf ?study ; fhir:code/fhir:coding/fhir:display "Pneumonia" ; fhir:valueCodeableConcept/fhir:coding/fhir:display "Present" } ORDER BY ?study LIMIT 8`, session, { label: "viewer:picker" });
  root.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Viewer"), h("p", {}, "Open a study from the cohort browser, or start with one of these. You can also open a real DICOM file from your own computer; it stays in your browser."))),
    h("div", { class: "row", style: { marginBottom: "16px" } }, h("a", { class: "btn primary", href: "#/cohorts", style: { textDecoration: "none" } }, "Browse cohorts"), h("a", { class: "btn", href: "#/ingest", style: { textDecoration: "none" } }, "Open a local DICOM file")),
    r && r.ok ? h("div", { class: "panel" }, h("header", {}, h("h3", {}, "Studies with pneumonia recorded as present")), h("div", { class: "body" }, r.rows.map((x) => h("div", { class: "finding" }, h("a", { class: "iri", href: "#/viewer/" + localName(x.study.v) }, localName(x.study.v)), h("span", {}, siteById(localName(x.site.v))?.name, " ", h("span", { class: "badge info" }, x.m.v)))))) :
      h("div", { class: "notice" }, "Viewing is not available to this role."));
}

async function localPage(root, id) {
  const rec = localImages.get(id);
  if (!rec) { root.append(h("div", { class: "notice" }, "That local file is no longer in memory. Open it again from ", h("a", { href: "#/ingest" }, "Ingest"), ".")); return; }
  const ui = stageUI();
  root.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Local file: " + rec.name), h("p", {}, "Opened in this browser tab only. Nothing was uploaded."))),
    h("div", { class: "vgrid", style: { gridTemplateColumns: "minmax(0,1fr) 320px" } },
      h("div", {}, ui.bar, ui.stage), h("div", { class: "panel" }, h("header", {}, h("h3", {}, "Header")), h("div", { class: "body" }, kv(rec.summary)))));
  ui.setImage(rec.img, rec.img.source === "dicom" ? "" : "Non-DICOM image: no calibration, no modality");
  return () => ui.v.destroy();
}
