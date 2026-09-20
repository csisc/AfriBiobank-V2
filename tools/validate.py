#!/usr/bin/env python3
"""CI check: (1) the TriG parses, (2) every SHACL shape passes on the production graphs.

The `rejected` quarantine graphs are deliberately excluded: they hold records that FAILED
validation at ETL time (Data Model v2.0, section 11.2), so validating them would always fail.
Exit code != 0 on failure.
"""
import sys
from rdflib import Dataset, Graph
from pyshacl import validate

data_path = sys.argv[1] if len(sys.argv) > 1 else "data/afribiobank-demo.trig"
ds = Dataset(); ds.parse(data_path, format="trig")
merged, skipped, n_graphs = Graph(), 0, 0
for ctx in ds.contexts():
    name = str(ctx.identifier)
    if name.endswith("/rejected"):
        skipped += len(ctx); continue
    n_graphs += 1
    for t in ctx: merged.add(t)
print(f"parsed OK: {len(merged)} triples validated across {n_graphs} graphs "
      f"({skipped} quarantined triples in rejected graphs skipped)")
conforms, _, text = validate(merged, shacl_graph="tools/shapes.ttl", inference="none")
print("SHACL conforms:", conforms)
if not conforms:
    print(text); sys.exit(1)
