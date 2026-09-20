# Third-party components (all vendored, no CDN at runtime)

| Component | Version | Licence | Used for |
|---|---|---|---|
| [Oxigraph](https://github.com/oxigraph/oxigraph) (JS/WASM build) | 0.5.11 | MIT OR Apache-2.0 | In-browser SPARQL 1.1 engine |
| [Cytoscape.js](https://js.cytoscape.org) | see `assets/vendor/cytoscape.min.js` header | MIT (`assets/vendor/LICENSE-cytoscape.txt`) | Graph explorer |
| Bricolage Grotesque (variable) | fontsource build | SIL OFL 1.1 (`assets/fonts/LICENSE-Bricolage.txt`) | Headings |
| IBM Plex Sans, IBM Plex Mono | fontsource build | SIL OFL 1.1 (`assets/fonts/LICENSE-IBM-Plex.txt`) | Body and code text |

Build/test-only tools (not shipped): Python `rdflib`, `pyshacl` (data validation).
