import { h, toast, sha256Hex, hexToB64, download } from "../util.js";
import { parseDicom, toDisplayImage, IDENTIFYING } from "../dicom.js";
import { addTurtle, graphOf, KG, session, ROLES, PREFIX_TTL } from "../store.js";
import { localImages } from "../local.js";
import { synthImage } from "../synth.js";
import * as audit from "../audit.js";

const MODS = { CR: "Computed Radiography", DX: "Digital Radiography", CT: "Computed Tomography", MR: "Magnetic Resonance", US: "Ultrasound", NM: "Nuclear Medicine", MG: "Mammography", RF: "Fluoroscopy" };
const b64u = (s) => s;

/* ---------- tiny DICOM writer (explicit VR little endian) for the sample buttons ---------- */
function makeSampleDicom({ complete }) {
  const u16 = (v) => [v & 255, v >> 8], u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  const A = (s) => [...s].map((c) => c.charCodeAt(0));
  const el = (g, e, vr, bytes) => {
    bytes = [...bytes]; if (bytes.length % 2) bytes.push(vr === "UI" ? 0 : 32);
    const long = ["OB", "OW", "SQ", "UN", "UT"].includes(vr);
    return [...u16(g), ...u16(e), ...A(vr), ...(long ? [0, 0, ...u32(bytes.length)] : u16(bytes.length)), ...bytes];
  };
  const rnd = () => Math.floor(Math.random() * 1e9);
  const uid = (n) => `1.2.826.0.1.3680043.8.498.${Date.now() % 1e7}.${rnd()}.${n}`;
  const img = synthImage({ modality: "CR", body: "CHEST", seed: "sample" + rnd(), findings: [{ key: "Pneumonia", value: "Present", lat: "Right" }], quality: 0.9 });
  const N = 256, px = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) px.push(...u16(Math.max(0, Math.min(4095, Math.round(img.pixels[(y * 2) * 512 + x * 2])))));
  const ts = el(0x0002, 0x0010, "UI", A("1.2.840.10008.1.2.1"));
  const meta = [...el(0x0002, 0x0000, "UL", u32(ts.length)), ...ts];
  const body = [
    ...el(0x0008, 0x0016, "UI", A("1.2.840.10008.5.1.4.1.1.1")), ...el(0x0008, 0x0018, "UI", A(uid(3))),
    ...el(0x0008, 0x0020, "DA", A("20240320")), ...el(0x0008, 0x0060, "CS", A("CR")),
    ...el(0x0008, 0x0080, "LO", A("Hospital Demo Nowhere")), ...el(0x0008, 0x1030, "LO", A("CHEST PA")),
    ...el(0x0010, 0x0010, "PN", A("DOE^JANE")), ...el(0x0010, 0x0020, "LO", A("MRN-884213")), ...el(0x0010, 0x0030, "DA", A("19780412")), ...el(0x0010, 0x0040, "CS", A("F")),
    ...el(0x0018, 0x0015, "CS", A("CHEST")), ...(complete ? el(0x0018, 0x5101, "CS", A("PA")) : []),
    ...el(0x0020, 0x000D, "UI", A(uid(1))), ...el(0x0020, 0x000E, "UI", A(uid(2))),
    ...el(0x0028, 0x0002, "US", u16(1)), ...el(0x0028, 0x0004, "CS", A("MONOCHROME2")),
    ...(complete ? [...el(0x0028, 0x0010, "US", u16(N)), ...el(0x0028, 0x0011, "US", u16(N))] : []),
    ...el(0x0028, 0x0030, "DS", A("0.286\\0.286")), ...el(0x0028, 0x0100, "US", u16(16)), ...el(0x0028, 0x0101, "US", u16(12)), ...el(0x0028, 0x0102, "US", u16(11)), ...el(0x0028, 0x0103, "US", u16(0)),
    ...el(0x0028, 0x1050, "DS", A("2100")), ...el(0x0028, 0x1051, "DS", A("3800")),
    ...el(0x7FE0, 0x0010, "OW", px),
  ];
  return new Uint8Array([...new Array(128).fill(0), ...A("DICM"), ...meta, ...body]);
}

const uid225 = () => { const b = crypto.getRandomValues(new Uint8Array(16)); return "2.25." + BigInt("0x" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("")).toString(); };

export async function mount(root) {
  let current = null;
  const out = h("div");
  const fileIn = h("input", { type: "file", class: "sr", id: "file", accept: ".dcm,.dicom,image/jpeg,image/png,application/dicom,*/*", onchange: (e) => e.target.files[0] && handle(e.target.files[0]) });
  const drop = h("label", { class: "drop", for: "file", tabindex: 0 }, h("b", {}, "Drop a DICOM, JPEG or PNG file here"), h("div", { class: "muted" }, "or click to choose. The file is read in your browser and never uploaded."));
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => e.dataTransfer.files[0] && handle(e.dataTransfer.files[0]));

  const sample = (complete, name) => async () => { const u8 = makeSampleDicom({ complete }); handle(new File([u8], name, { type: "application/dicom" })); };

  async function handle(file) {
    out.replaceChildren(h("p", { class: "muted" }, "Reading " + file.name + "…"));
    const buf = await file.arrayBuffer();
    const hex = await sha256Hex(buf), b64 = hexToB64(hex);
    const bytes = new Uint8Array(buf);
    const isDicom = bytes.length > 132 && String.fromCharCode(...bytes.slice(128, 132)) === "DICM";
    current = isDicom ? await fromDicom(file, buf, hex, b64) : await fromImage(file, buf, hex, b64);
    render();
  }

  /* ---------- DICOM route ---------- */
  async function fromDicom(file, buf, hex, b64) {
    const p = parseDicom(buf), g = (n) => p.get(n);
    const checks = [], fails = [];
    const add = (s, t, d) => { checks.push([s, t, d]); if (s === "fail") fails.push(t + (d ? ": " + d : "")); };
    add("pass", "DICOM header parsed", `${p.tags.length} elements · ${p.transferSyntaxName}`);
    for (const t of ["Rows", "Columns"]) g(t) ? add("pass", `Required tag ${t}`, String(g(t))) : add("fail", `Required tag ${t} is missing`, "Rows and Columns are required, so the image goes to the rejected graph (model §11.2)");
    for (const t of ["StudyInstanceUID", "SeriesInstanceUID", "SOPInstanceUID"]) g(t) ? add("pass", `Required identifier ${t}`, "") : add("fail", `${t} is missing`, "needed to link Media to its Study and Series");
    const mod = g("Modality");
    if (!mod) add("fail", "Modality is missing", "every study needs a DICOM modality code");
    else add(MODS[mod] ? "pass" : "warn", `Modality ${mod}`, MODS[mod] || "not in the modality list of the data model");
    if (mod === "CR" || mod === "DX") g("ViewPosition") ? add("pass", "ViewPosition present", g("ViewPosition")) : add("fail", "ViewPosition is missing", "mandatory for CR/DX (model §11.3)");
    if (mod === "CT") add("warn", "CT: contrast and protocol", "afri:contrastUsed and afri:acquisitionProtocol are mandatory for CT and cannot be read from this header alone; the RIS supplies them");
    p.numbers("PixelSpacing") ? add("pass", "PixelSpacing present", p.numbers("PixelSpacing").join(" × ") + " mm") : add("warn", "PixelSpacing absent", "optional tag, so no triple is generated (NULL rule)");
    p.pixel.data ? add("pass", "Pixel data decoded", `${p.pixel.cols}×${p.pixel.rows}, ${p.pixel.bitsAllocated}-bit`) : add("warn", "No image preview", p.pixel.reason || "");
    const idFound = IDENTIFYING.filter((n) => p.has(n));
    if (idFound.length) add("warn", "Identifying elements present", idFound.join(", ") + ". They are never mapped to RDF; the ETL de-identification step removes them and the patient is linked through a pseudonym.");
    add("info", "Image quality not yet assessed", "fhir:dataAbsentReason “not-performed” is added (model §11.2). The v2.0 shape also requires imageQualityCategory, so this prototype uses quality:Unassessed. See the project report.");
    const img = toDisplayImage(p);
    const key = (s) => hex.slice(0, 8);
    const pid = "P-LOCAL-" + (await sha256Hex(new TextEncoder().encode(g("PatientID") || file.name))).slice(0, 8);
    const sop = g("SOPInstanceUID") || uid225(), ser = g("SeriesInstanceUID") || uid225(), stu = g("StudyInstanceUID") || uid225();
    const ids = { patient: pid, study: "S-LOCAL-" + (await sha256Hex(new TextEncoder().encode(stu))).slice(0, 8), series: ser, image: "DCM-LOCAL-" + (await sha256Hex(new TextEncoder().encode(sop))).slice(0, 8) };
    const summary = [["File", file.name], ["Size", (file.size / 1024).toFixed(0) + " KB"], ["SHA-256", hex.slice(0, 20) + "…"], ["Transfer syntax", p.transferSyntaxName], ["Modality", mod], ["Matrix", g("Columns") && g("Rows") ? `${g("Columns")} × ${g("Rows")}` : ""], ["View", g("ViewPosition")], ["Body part", g("BodyPartExamined")]];
    return { file, hex, b64, checks, fails, img, ids, summary, mod, source: "dicom", p, view: g("ViewPosition"), rows: g("Rows"), cols: g("Columns"), spacing: p.numbers("PixelSpacing"), body: g("BodyPartExamined"), idFound };
  }

  /* ---------- JPEG / PNG route ---------- */
  async function fromImage(file, buf, hex, b64) {
    const checks = [], fails = [];
    let img = null, w = 0, hh = 0;
    try {
      const bmp = await createImageBitmap(new Blob([buf], { type: file.type }));
      w = bmp.width; hh = bmp.height;
      const c = document.createElement("canvas"); c.width = w; c.height = hh; const cx = c.getContext("2d"); cx.drawImage(bmp, 0, 0);
      const d = cx.getImageData(0, 0, w, hh).data, px = new Float32Array(w * hh);
      for (let i = 0; i < px.length; i++) px[i] = 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2];
      img = { rows: hh, cols: w, pixels: px, min: 0, max: 255, wc: 128, ww: 256, invert: false, spacing: null, source: "image", presets: [["Default", 128, 256]] };
      checks.push(["pass", "Image decoded", `${w}×${hh} pixels`]);
    } catch { checks.push(["fail", "Not a DICOM file and not a readable JPEG/PNG", ""]); fails.push("Unreadable file"); }
    checks.push(["warn", "No DICOM header", "modality, body part and study linkage are entered by hand and flagged as unverified (afri:sourceFormat, a proposed addition to v2.0)"]);
    checks.push(["warn", "No pixel spacing", "measurements are in pixels, not millimetres"]);
    checks.push(["info", "Synthetic identifiers", "Study, Series and SOP UIDs are generated under the 2.25 (UUID-derived) DICOM root"]);
    const ids = { patient: "P-LOCAL-" + hex.slice(0, 8), study: "S-LOCAL-" + hex.slice(8, 16), series: uid225(), image: "DCM-LOCAL-" + hex.slice(16, 24) };
    return { file, hex, b64, checks, fails, img, ids, summary: [["File", file.name], ["Size", (file.size / 1024).toFixed(0) + " KB"], ["SHA-256", hex.slice(0, 20) + "…"], ["Format", file.type || "unknown"]], mod: "CR", source: "image", rows: hh, cols: w, body: "CHEST", manualMeta: true, view: null, spacing: null };
  }

  function turtle(c, ok) {
    const site = graphOf("site-local", "clinical"), now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const parts = {};
    if (!ok) {
      parts.rejected = `image:${c.ids.image.replace("DCM", "REJ")} a fhir:Media ;\n  afri:rejectionReason ${JSON.stringify(c.fails.join("; "))} ;\n  afri:mappingStatus <${KG.replace("kg/", "ontology/core#")}Unresolved> .`;
      return parts;
    }
    parts.clinical = `<${KG}Site/site-local> a site:BiobankSite ; rdfs:label "This browser (local)" .
patient:${c.ids.patient} a fhir:Patient ;
  fhir:identifier [ a fhir:Identifier ; fhir:system <https://afribiobank.org/id/patient> ; fhir:value "${c.ids.patient}" ] ;
  afri:enrolledAt <${KG}Site/site-local> .`;
    parts.imaging = `study:${c.ids.study} a fhir:ImagingStudy ;
  fhir:subject patient:${c.ids.patient} ; fhir:started "${now}"^^xsd:dateTime ;
  fhir:modality [ fhir:system "http://dicom.nema.org/resources/ontology/DCM" ; fhir:code "${c.mod}" ; fhir:display "${MODS[c.mod] || c.mod}" ] ;
  fhir:numberOfSeries 1 ; fhir:numberOfInstances 1 ;
  afri:containsSeries <${KG}Series/${c.ids.series}> ; afri:performedAt <${KG}Site/site-local> .
<${KG}Series/${c.ids.series}> a afri:ImagingSeries ;
  afri:partOfStudy study:${c.ids.study} ; dicom:Modality "${c.mod}" ;${c.body ? `\n  dicom:BodyPartExamined "${c.body}" ;` : ""}
  afri:containsInstance image:${c.ids.image} .`;
    parts.images = `image:${c.ids.image} a fhir:Media ;
  fhir:basedOn study:${c.ids.study} ; afri:partOfSeries <${KG}Series/${c.ids.series}> ;
  dicom:Rows ${c.rows} ; dicom:Columns ${c.cols} ;${c.view ? `\n  dicom:ViewPosition "${c.view}" ;` : ""}${c.spacing ? `\n  dicom:PixelSpacing "${c.spacing.join(" ")}" ;` : ""}${c.manualMeta ? `\n  afri:sourceFormat "${c.file.type || "image"}" ;` : ""}
  fhir:dataAbsentReason [ fhir:code "not-performed" ] ;
  afri:imageQualityCategory <https://afribiobank.org/ontology/core#Quality/Unassessed> ;
  fhir:content [ fhir:url "browser-local://${c.file.name.replace(/[^\w.\-]/g, "_")}"^^xsd:anyURI ; fhir:hash "${c.b64}"^^xsd:base64Binary ] .`;
    return parts;
  }

  function render() {
    const c = current, ok = c.fails.length === 0, ttl = turtle(c, ok);
    const modSel = c.manualMeta ? h("label", { class: "f", style: { maxWidth: "260px", marginTop: "8px" } }, "Modality (entered by hand)", h("select", { onchange: (e) => { c.mod = e.target.value; render(); } }, Object.entries(MODS).map(([k, v]) => h("option", { value: k, selected: k === c.mod }, `${k} ${v}`)))) : null;
    const ico = { pass: ["ok", "Pass"], warn: ["warn", "Note"], fail: ["bad", "Reject"], info: ["info", "Info"] };
    const allTtl = Object.entries(ttl).map(([k, v]) => `# → ${graphOf("site-local", k).replace(KG, "")}\n${v}`).join("\n\n");
    out.replaceChildren(
      h("div", { class: "notice " + (ok ? "ok" : "bad"), style: { marginBottom: "14px" } }, ok ? h("span", {}, h("b", {}, "Accepted. "), "The record passes the required-tag rules and can be loaded into the graph.") : h("span", {}, h("b", {}, "Rejected. "), "The record breaks a required rule. It is quarantined in the rejected graph with a reason, never silently dropped.")),
      h("div", { class: "split", style: { gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1fr)" } },
        h("div", { class: "grid" },
          h("div", { class: "panel" }, h("header", {}, h("h3", {}, "Validation against the ETL rules")), h("div", { class: "body" }, modSel, c.checks.map(([s, t, d]) => h("div", { class: "check" }, h("span", { class: "badge " + ico[s][0] }, ico[s][1]), h("div", {}, h("b", {}, t), d ? h("div", { class: "muted small" }, d) : null))))),
          h("div", { class: "row" },
            h("button", { class: "btn primary", onclick: load }, ok ? "Load into browser graph" : "Quarantine in rejected graph"),
            c.img ? h("button", { class: "btn", onclick: () => { const id = c.ids.image; localImages.set(id, { img: c.img, name: c.file.name, summary: c.summary }); location.hash = "#/viewer/local/" + id; } }, "Open in viewer") : null,
            h("button", { class: "btn", onclick: () => download("afribiobank-local.ttl", PREFIX_TTL + "\n" + allTtl, "text/turtle") }, "Download Turtle"))),
        h("div", { class: "grid" },
          h("div", { class: "panel" }, h("header", {}, h("h3", {}, "RDF this file would produce")), h("div", { class: "body" }, h("pre", { class: "code" }, allTtl))),
          h("div", { class: "panel" }, h("header", {}, h("h3", {}, "File")), h("div", { class: "body" }, h("dl", { class: "kv" }, c.summary.filter((r) => r[1]).map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])))))));
  }

  function load() {
    if (session.role === "researcher") { toast("The external researcher role cannot write to the graph.", "bad"); return; }
    const c = current, ok = c.fails.length === 0, ttl = turtle(c, ok);
    try {
      for (const [kind, t] of Object.entries(ttl)) addTurtle(t, graphOf("site-local", kind));
      if (c.img) localImages.set(c.ids.image, { img: c.img, name: c.file.name, summary: c.summary });
      audit.record({ actor: ROLES[session.role].label, action: "ingest", detail: `${c.file.name} → ${Object.keys(ttl).join(", ")}`, decision: ok ? "allowed" : "quarantined", reason: ok ? "" : c.fails.join("; ") });
      toast(ok ? "Loaded into graph/site-local/*. Try the Graph explorer or SPARQL as data steward." : "Quarantined in graph/site-local/rejected.", ok ? "ok" : "bad");
    } catch (e) { toast("Could not load: " + e.message, "bad"); }
  }

  root.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Ingest"),
    h("p", {}, "See what the ETL pipeline does to a file: parse the header, apply the required-tag and null rules from the data model, preview the RDF, and load or quarantine it."))),
    h("div", { class: "grid", style: { maxWidth: "1180px" } }, fileIn, drop,
      h("div", { class: "row" }, h("span", { class: "muted" }, "No file handy?"),
        h("button", { class: "btn sm", onclick: sample(true, "sample-chest-complete.dcm") }, "Generate a valid sample DICOM"),
        h("button", { class: "btn sm", onclick: sample(false, "sample-chest-missing-tags.dcm") }, "Generate one with missing tags"),
        h("span", { class: "muted small" }, "Both carry fake identifying tags so you can see them flagged.")),
      session.role === "researcher" ? h("div", { class: "notice" }, "You can inspect files as an external researcher, but only stewards and site radiologists should load data into the graph.") : null,
      out));
}
