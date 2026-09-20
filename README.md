# AfriBiobank: interactive prototype

A working sketch of the AfriBiobank platform that runs **entirely in the browser** and deploys to
**GitHub Pages** with no server, no build step and no external CDN. It is built on a **synthetic**
dataset that follows *AfriBiobank Medical Imaging RDF Knowledge Graph Data Model v2.0*.

> **Everything is synthetic.** No real patient, image or institution is involved. The five "sites"
> are demo labels. Pseudo-radiographs are procedural drawings, not medical images. Terminology codes
> are illustrative. See *About this prototype* in the app.

## What it demonstrates

| Screen | What you can do | Maps to (production) |
|---|---|---|
| **Network** | Send one question to five nodes; each answers with aggregate counts only, small cells hidden (k-anonymity style) | Federation Gateway + coordinator |
| **Cohorts** | Patient and study browsers; every filter writes the SPARQL shown under the table | Backend REST API over GraphDB |
| **Viewer** | Window/level, zoom, pan, length, ellipse ROI; findings read from the graph; add an annotation that is written back as RDF | Cornerstone3D/OHIF + DICOMweb + Orthanc |
| **Graph explorer** | Walk patient → encounter → order → study → series → image → findings | Cytoscape.js + SPARQL/Cypher |
| **SPARQL** | Real SPARQL 1.1 (Oxigraph/WASM), templates, CSV export | GraphDB SPARQL endpoint behind the API gateway |
| **Ingest** | Drop a real DICOM/JPEG/PNG: parse, apply the ETL required-tag and null rules, preview the RDF, load or quarantine | ETL pipeline (RML + SHACL) |
| **Governance** | Role matrix, "try to break it" attack buttons, hash-chained audit log with tamper detection | Keycloak + policy gateway + audit store |

Use the role selector in the sidebar (data steward, site radiologist, external researcher). The role
picks the set of **named graphs** the query can see; query text cannot widen it.

## Deploy to GitHub Pages

1. Create a repository and push this folder to `main`.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. The included workflow (`.github/workflows/pages.yml`) validates the dataset (parse + SHACL) and
   publishes the site. Your URL will be `https://<user>.github.io/<repo>/`.

(Or choose *Deploy from a branch → main / root*; the site is plain static files and `.nojekyll` is included.)

## Run locally

Browsers block WebAssembly and ES modules from `file://`, so serve the folder:

```bash
python3 -m http.server 8000      # then open http://localhost:8000
```

## Regenerate or change the data

```bash
pip install -r tools/requirements.txt
python tools/generate_data.py     # deterministic (seeded); rewrites data/afribiobank-demo.trig
python tools/validate.py          # parse + SHACL (tools/shapes.ttl), exits non-zero on failure
```

Named graphs are `graph/{site}/{imaging|images|findings|labs|clinical|provenance|rejected}` plus `graph/core`.
`rejected` graphs hold quarantined records and are excluded from SHACL (they are meant to fail it).

## Layout

```
index.html                 app shell
assets/js/store.js         Oxigraph store, roles, POLICY PROXY (start here)
assets/js/dicom.js         DICOM header + pixel parser (uncompressed syntaxes)
assets/js/viewer.js        canvas viewer engine
assets/js/synth.js         procedural synthetic images driven by RDF findings
assets/js/audit.js         SHA-256 hash-chained audit log
assets/js/views/*.js       one module per screen
assets/vendor/             Oxigraph WASM, Cytoscape (vendored: works offline)
data/                      synthetic TriG dataset
tools/                     generator, SHACL shapes, validator
```

## Known limits

* Uncompressed DICOM only in the browser parser (JPEG/JPEG2000/RLE need Cornerstone3D codecs).
* Researcher-mode checks inspect query text and results; production should parse the SPARQL algebra.
* Small-cell suppression does not stop differencing attacks across many queries.
* Reloading discards anything loaded or annotated in the session.
* Vanilla JS on purpose (zero build). The frontend spec calls for React + Redux Toolkit; the module
  boundaries here (store/policy, viewer, views) are the seams for that port.
