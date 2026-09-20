#!/usr/bin/env python3
"""
Generate the synthetic AfriBiobank demo dataset (TriG) that follows the
AfriBiobank Medical Imaging RDF Knowledge Graph Data Model v2.0.

* Everything here is SYNTHETIC. No real patients, images or institutions.
* Deterministic: same seed -> same file (so diffs in Git are meaningful).
* Named graphs follow  ex:graph/{site}/{imaging|images|findings|labs|clinical|provenance|rejected}
  plus a shared  ex:graph/core  (sites, concepts, lab tests, biobank structure).

Note on syntax: the v2.0 document writes resource IRIs as  ex:Patient/{id}.
A '/' is not legal in a Turtle prefixed name, so this file declares one prefix per
resource class instead (patient:, study:, image: ...). The IRIs are identical:
patient:P-KE-0001  ==  <https://afribiobank.org/kg/Patient/P-KE-0001>.

Usage:  python tools/generate_data.py  [--out data/afribiobank-demo.trig]
"""
import argparse, base64, hashlib, random, datetime as dt
from collections import defaultdict

SEED = 2026
KG = "https://afribiobank.org/kg/"

SITES = [
    # id,             label,                 cc,   iso3, city,        lon,    lat
    ("site-nairobi",  "Nairobi Demo Site",   "ke", "KE", "Nairobi",   36.82,  -1.29),
    ("site-accra",    "Accra Demo Site",     "gh", "GH", "Accra",     -0.19,   5.60),
    ("site-capetown", "Cape Town Demo Site", "za", "ZA", "Cape Town", 18.42, -33.92),
    ("site-lagos",    "Lagos Demo Site",     "ng", "NG", "Lagos",      3.38,   6.52),
    ("site-dakar",    "Dakar Demo Site",     "sn", "SN", "Dakar",    -17.44,  14.69),
]
PATIENTS_PER_SITE = 36

# Per-site "disease burden" knobs (illustrative only, NOT epidemiology)
PREV = {
    "site-nairobi":  dict(pna=.22, tb=.14, eff=.10, cmg=.08),
    "site-accra":    dict(pna=.20, tb=.09, eff=.08, cmg=.14),
    "site-capetown": dict(pna=.18, tb=.20, eff=.12, cmg=.09),
    "site-lagos":    dict(pna=.24, tb=.12, eff=.09, cmg=.16),
    "site-dakar":    dict(pna=.19, tb=.08, eff=.07, cmg=.10),
}

FINDINGS = [  # key, SNOMED CT code, display
    ("pna", "233604007", "Pneumonia"),
    ("tb",  "154283005", "Pulmonary tuberculosis"),
    ("eff", "60046008",  "Pleural effusion"),
    ("cmg", "8186001",   "Cardiomegaly"),
]
VALUE = {"Present": "373066001", "Absent": "373067005", "Indeterminate": "82334004"}
LATERALITY = {"Left": "7771000", "Right": "24028007", "Bilateral": "51440002", "Unspecified": "272741003"}

MODALITY = {
    "CR": "Computed Radiography", "DX": "Digital Radiography", "CT": "Computed Tomography",
    "MR": "Magnetic Resonance", "US": "Ultrasound",
}
INDICATIONS = [
    ("fever-cough", "Fever and productive cough"),
    ("chronic-cough", "Chronic cough, weight loss"),
    ("chest-pain", "Chest pain"),
    ("dyspnoea", "Shortness of breath"),
    ("screening", "Pre-employment screening"),
]

rng = random.Random(SEED)
out = defaultdict(list)                          # graph IRI -> list of turtle blocks
counts = defaultdict(lambda: defaultdict(int))   # site -> datatype -> entity count


def g(site, kind):
    return f"{KG}graph/{site}/{kind}"


CORE = f"{KG}graph/core"


def emit(graph, block):
    out[graph].append(block.strip("\n"))


def iso(d):
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


def q(s):
    return s.replace("\\", "\\\\").replace('"', '\\"')


def b64(n):
    return base64.b64encode(hashlib.sha256(str(n).encode()).digest()).decode()


PREFIXES = f"""@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix geo: <http://www.opengis.net/ont/geosparql#> .
@prefix fhir: <http://hl7.org/fhir/> .
@prefix sct: <http://snomed.info/id/> .
@prefix icd11: <http://id.who.int/icd/release/11/mms/> .
@prefix dicom: <http://dicom.nema.org/ontology#> .
@prefix omiab: <http://purl.org/omia/> .
@prefix rad: <https://afribiobank.org/ontology/radiology#> .
@prefix adm: <https://afribiobank.org/ontology/admission#> .
@prefix afri: <https://afribiobank.org/ontology/core#> .
@prefix site: <https://afribiobank.org/ontology/site#> .
@prefix ex: <{KG}> .
@prefix country: <{KG}Country/> .
@prefix patient: <{KG}Patient/> .
@prefix enc: <{KG}Encounter/> .
@prefix order: <{KG}Order/> .
@prefix study: <{KG}Study/> .
@prefix series: <{KG}Series/> .
@prefix image: <{KG}Image/> .
@prefix imgobs: <{KG}ImgObs/> .
@prefix labobs: <{KG}LabObs/> .
@prefix labtest: <{KG}LabTest/> .
@prefix concept: <{KG}Concept/> .
@prefix sitei: <{KG}Site/> .
@prefix quality: <https://afribiobank.org/ontology/core#Quality/> .
@prefix orderstatus: <https://afribiobank.org/ontology/core#OrderStatus/> .
@prefix annmethod: <https://afribiobank.org/ontology/core#AnnotationMethod/> .
@prefix cstatus: <https://afribiobank.org/ontology/core#ConceptStatus/> .
"""


# ------------------------------------------------------------------ core graph
def core():
    nodes = " ;\n  ".join(f"omiab:hasNetworkNode sitei:{s[0]}" for s in SITES)
    emit(CORE, f"""ex:AfriBiobank a omiab:Biobank ;
  rdfs:label "AfriBiobank (synthetic demo)" ;
  omiab:hasCollection ex:ImagingCollection, ex:ClinicalCollection ;
  {nodes} .
ex:ImagingCollection a omiab:BiobankCollection ; rdfs:label "Medical Imaging Data Collection" .
ex:ClinicalCollection a omiab:BiobankCollection ; rdfs:label "Clinical Context Data Collection" .""")
    for sid, label, cc, iso3, city, lon, lat in SITES:
        emit(CORE, f"""sitei:{sid} a site:BiobankSite ;
  rdfs:label "{label}" ;
  site:country country:{iso3} ;
  site:city "{city}" ;
  geo:hasGeometry [ a geo:Point ; geo:asWKT "POINT({lon} {lat})"^^geo:wktLiteral ] ;
  site:contactEmail "steward@{cc}.demo.invalid" ;
  omiab:isPartOf ex:AfriBiobank .""")
    concepts = [
        ("pneumonia", "Pneumonia", "233604007", "CA40"),
        ("tuberculosis", "Pulmonary tuberculosis", "154283005", None),
        ("effusion", "Pleural effusion", "60046008", None),
        ("cardiomegaly", "Cardiomegaly", "8186001", None),
        ("normal-chest", "No acute cardiopulmonary abnormality", None, None),
        ("amoxicillin", "Amoxicillin", None, None),
        ("rhze", "Rifampicin/Isoniazid/Pyrazinamide/Ethambutol", None, None),
    ] + [(k, t, None, None) for k, t in INDICATIONS]
    for cid, label, sct, icd in concepts:
        same = (f" ;\n  owl:sameAs sct:{sct}" if sct else "") + (f" ;\n  owl:sameAs icd11:{icd}" if icd else "")
        emit(CORE, f"""concept:{cid} a owl:Class, fhir:CodeableConcept ;
  rdfs:label "{label}" ;
  fhir:system <https://afribiobank.org/concepts/> ;
  owl:versionInfo "1.0" ;
  afri:conceptStatus cstatus:Active{same} .""")
    labs = [("crp", "C-reactive protein", "1988-5", "C reactive protein [Mass/volume] in Serum or Plasma", "mg/L", "Inflammation"),
            ("wbc", "White blood cell count", "6690-2", "Leukocytes [#/volume] in Blood by Automated count", "10*3/uL", "Haematology"),
            ("hb", "Haemoglobin", "718-7", "Hemoglobin [Mass/volume] in Blood", "g/dL", "Haematology")]
    for lid, label, code, long, unit, cat in labs:
        emit(CORE, f"""labtest:{lid} a fhir:CodeableConcept ;
  rdfs:label "{label}" ; ex:category "{cat}" ; ex:fluid "Blood" ;
  fhir:coding [ fhir:system "http://loinc.org" ; fhir:code "{code}" ; fhir:display "{long}" ] ;
  afri:expectedUnit "{unit}" .""")
    members = " ;\n  ".join(f"prov:hadMember <{g(s[0], 'imaging')}>" for s in SITES)
    emit(CORE, f"<{KG}graph/federated/imaging> a prov:Collection ;\n  {members} .")


# ------------------------------------------------------------------ per-site
def make_site(sid, label, cc, iso3, city, lon, lat, uid_base):
    C = cc.upper()
    prev = PREV[sid]
    n_rej_tags = rng.randint(1, 3)
    study_seq = 0
    for pi in range(1, PATIENTS_PER_SITE + 1):
        pid = f"P-{C}-{pi:04d}"
        sex = rng.choice(["male", "female"])
        by = int(max(1935, min(2019, rng.gauss(1984, 20))))
        country = iso3 if rng.random() < .93 else rng.choice([s[3] for s in SITES])
        emit(g(sid, "clinical"), f"""patient:{pid} a fhir:Patient ;
  fhir:identifier [ a fhir:Identifier ; fhir:system <https://afribiobank.org/id/patient> ; fhir:value "{pid}" ] ;
  fhir:gender "{sex}" ; fhir:birthDate "{by}"^^xsd:gYear ;
  afri:countryOfOrigin country:{country} ; afri:enrolledAt sitei:{sid} .""")
        counts[sid]["clinical"] += 1
        for ei in range(rng.choice([1, 1, 2, 2, 3])):
            eid = f"E-{C}-{pi:04d}-{ei + 1}"
            start = dt.datetime(2021, 1, 1) + dt.timedelta(days=rng.randint(0, 1780), hours=rng.randint(6, 20))
            klass = rng.choices([("IMP", "Inpatient"), ("AMB", "Ambulatory"), ("EMER", "Emergency")], [.4, .4, .2])[0]
            end = start + dt.timedelta(days=rng.randint(3, 9) if klass[0] == "IMP" else 0, hours=rng.randint(1, 5))
            disp = rng.choices(["home", "transfer", "expired"], [.9, .07, .03])[0]
            enc_block = [f"""enc:{eid} a fhir:Encounter ;
  fhir:subject patient:{pid} ; fhir:identifier [ a fhir:Identifier ; fhir:value "{eid}" ] ;
  fhir:period [ fhir:start "{iso(start)}"^^xsd:dateTime ; fhir:end "{iso(end)}"^^xsd:dateTime ] ;
  fhir:class [ fhir:system "http://terminology.hl7.org/CodeSystem/v3-ActCode" ; fhir:code "{klass[0]}" ; fhir:display "{klass[1]}" ] ;
  fhir:serviceProvider sitei:{sid} ;
  fhir:hospitalization [ fhir:dischargeDisposition [ fhir:code "{disp}" ; fhir:display "{disp.title()}" ] ] ."""]
            counts[sid]["clinical"] += 1
            crp_high_for = None
            impression = None
            for si in range(rng.choice([1, 1, 1, 2])):
                study_seq += 1
                sidn = f"S-{C}-{study_seq:04d}"
                oid = f"ORD-{C}-{study_seq:04d}"
                mod = rng.choices(["CR", "DX", "CT", "MR", "US"], [.52, .18, .14, .07, .09])[0]
                chest = mod in ("CR", "DX")
                body = "CHEST" if chest else rng.choice(
                    {"CT": ["CHEST", "HEAD", "ABDOMEN"], "MR": ["HEAD", "SPINE"], "US": ["ABDOMEN", "PELVIS"]}[mod])
                ind_id, ind_text = rng.choice(INDICATIONS) if chest else ("dyspnoea", "Clinical correlation")
                sdt = start + dt.timedelta(hours=rng.randint(1, 6))
                series_uid = f"{uid_base}.{study_seq}.1"
                img_id = f"DCM-{C}-{study_seq:04d}-1"
                contrast = mod == "CT" and rng.random() < .35
                view = "PA" if chest and rng.random() < .8 else "AP"
                proto = {"CR": "Standard PA Chest", "DX": "Digital chest PA/LAT", "CT": "Helical " + body.title(),
                         "MR": body.title() + " T1/T2", "US": body.title() + " survey"}[mod]
                enc_block.append(f"""order:{oid} a afri:ImagingOrder ;
  afri:orderedFor patient:{pid} ; afri:orderedBy enc:{eid} ;
  afri:orderDateTime "{iso(start + dt.timedelta(minutes=45))}"^^xsd:dateTime ;
  afri:requestedModality [ fhir:system "http://dicom.nema.org/resources/ontology/DCM" ; fhir:code "{mod}" ] ;
  afri:clinicalIndication "{q(ind_text)}" ;
  afri:orderStatus orderstatus:Completed ; afri:fulfilledBy study:{sidn} .""")
                counts[sid]["clinical"] += 1
                emit(g(sid, "imaging"), f"""study:{sidn} a fhir:ImagingStudy ;
  fhir:subject patient:{pid} ; fhir:encounter enc:{eid} ;
  fhir:started "{iso(sdt)}"^^xsd:dateTime ;
  fhir:modality [ fhir:system "http://dicom.nema.org/resources/ontology/DCM" ; fhir:code "{mod}" ; fhir:display "{MODALITY[mod]}" ] ;
  fhir:procedureCode [ a fhir:CodeableConcept ; fhir:text "{q(proto)}" ] ;
  dicom:StudyDescription "{q(proto)}" ;
  fhir:numberOfSeries 1 ; fhir:numberOfInstances 1 ;
  afri:containsSeries series:{series_uid} ; afri:performedAt sitei:{sid} ; afri:basedOnOrder order:{oid} ;
  omiab:isPartOf ex:ImagingCollection .
series:{series_uid} a afri:ImagingSeries ;
  afri:partOfStudy study:{sidn} ; dicom:SeriesNumber 1 ; dicom:SeriesDescription "{q(proto)}" ;
  dicom:Modality "{mod}" ; afri:acquisitionProtocol "{q(proto)}" ; afri:contrastUsed {str(contrast).lower()} ;
  dicom:BodyPartExamined "{body}" ; fhir:numberOfInstances 1 ; afri:containsInstance image:{img_id} .""")
                if mod == "CT" and contrast:
                    emit(g(sid, "imaging"), f'series:{series_uid} afri:contrastAgent "Iohexol" .')
                if mod == "MR":
                    emit(g(sid, "imaging"), f'series:{series_uid} afri:fieldStrength "{rng.choice(["1.5T", "3T"])}" .')
                if mod == "US":
                    emit(g(sid, "imaging"), f'series:{series_uid} afri:transducerType "{rng.choice(["Curvilinear", "Linear"])}" .')
                counts[sid]["imaging"] += 2
                # ---- image (quality-tracked)
                qs = round(min(1, max(.15, rng.gauss(.84, .13))), 2)
                cat = "Adequate" if qs >= .7 else ("Degraded" if qs >= .45 else "Rejected")
                rows = cols = 2048 if chest else 512
                spacing = "0.143 0.143" if chest else "0.7 0.7"
                view_ttl = f'\n  dicom:ViewPosition "{view}" ;' if chest else ""
                rej = ""
                if cat == "Rejected":
                    rej = f'\n  afri:rejectionReason "{rng.choice(["Motion blur", "Under-exposed", "Patient rotation", "Artefact overlying lung fields"])}" ;'
                emit(g(sid, "images"), f"""image:{img_id} a fhir:Media ;
  fhir:basedOn study:{sidn} ; afri:partOfSeries series:{series_uid} ;
  dicom:Rows {rows} ; dicom:Columns {cols} ;{view_ttl}
  dicom:PixelSpacing "{spacing}" ;
  afri:imageQualityScore {qs} ; afri:imageQualityCategory quality:{cat} ;{rej}
  afri:qualityAssessedBy "automated-QA-demo" ;
  fhir:content [ fhir:url "s3://afribiobank-{cc}/studies/{sidn}/{img_id}.dcm"^^xsd:anyURI ; fhir:hash "{b64(img_id)}"^^xsd:base64Binary ] .""")
                counts[sid]["images"] += 1
                # ---- findings (chest radiographs that were not rejected)
                present = []
                if chest and cat != "Rejected":
                    method = rng.choice(["Manual", "AI", "Consensus"])
                    annotator = "model-cxr-demo-0.3" if method == "AI" else f"rad-{cc}-01"
                    for key, code, disp_ in FINDINGS:
                        p = prev[key] * (1.6 if key in ("pna", "tb") and "cough" in ind_text.lower() else 1.0)
                        r = rng.random()
                        v = "Present" if r < p else ("Indeterminate" if r < p + .04 else "Absent")
                        lat = rng.choice(["Left", "Right", "Bilateral"]) if v == "Present" and key != "cmg" else "Unspecified"
                        conf = round(rng.uniform(.78, .99) if v != "Indeterminate" else rng.uniform(.4, .65), 2)
                        oidn = f"{sidn}-{key}"
                        emit(g(sid, "findings"), f"""imgobs:{oidn} a fhir:Observation ;
  fhir:status [ fhir:v "final" ] ; fhir:subject patient:{pid} ; fhir:partOf study:{sidn} ; fhir:derivedFrom image:{img_id} ;
  fhir:code [ a fhir:CodeableConcept ; fhir:coding [ fhir:system "http://snomed.info/sct" ; fhir:code "{code}" ; fhir:display "{disp_}" ] ] ;
  fhir:valueCodeableConcept [ fhir:coding [ fhir:system "http://snomed.info/sct" ; fhir:code "{VALUE[v]}" ; fhir:display "{v}" ] ] ;
  afri:observationConfidence {conf} ;
  afri:findingLaterality [ fhir:system "http://snomed.info/sct" ; fhir:code "{LATERALITY[lat]}" ; fhir:display "{lat}" ] ;
  afri:annotationMethod annmethod:{method} ; afri:annotatedBy "{annotator}" .""")
                        counts[sid]["findings"] += 1
                        if v == "Present":
                            present.append(key)
                    emit(g(sid, "imaging"), f"study:{sidn} rad:hasIndication concept:{ind_id} .")
                    top = ("pna" in present and "pneumonia") or ("tb" in present and "tuberculosis") or \
                          ("eff" in present and "effusion") or ("cmg" in present and "cardiomegaly") or "normal-chest"
                    emit(g(sid, "imaging"), f"study:{sidn} rad:hasImpression concept:{top} .")
                    if "pna" in present:
                        emit(g(sid, "imaging"), f"study:{sidn} rad:hasFinding concept:pneumonia .")
                    impression = top
                    if "pna" in present or "tb" in present:
                        crp_high_for = True
                # ---- labs (contextual) - one panel per encounter
                if si == 0:
                    high = crp_high_for or rng.random() < .12
                    crp = round(rng.uniform(45, 220), 0) if high else round(rng.uniform(1, 9), 1)
                    wbc = round(rng.uniform(11.5, 19) if high else rng.uniform(4.5, 10.5), 1)
                    hb = round(rng.uniform(9, 16), 1)
                    ct = sdt + dt.timedelta(minutes=30)
                    for lid, val, lo, hi, unit in (("crp", crp, 0, 10, "mg/L"), ("wbc", wbc, 4.0, 11.0, "10*3/uL"),
                                                   ("hb", hb, 13.0 if sex == "male" else 12.0, 17.0 if sex == "male" else 15.0, "g/dL")):
                        flag, fd = ("H", "High") if val > hi else (("L", "Low") if val < lo else ("N", "Normal"))
                        if lid == "crp" and val > 100:
                            flag, fd = "HH", "Critical high"
                        emit(g(sid, "labs"), f"""labobs:{sidn}-{lid} a fhir:Observation ;
  fhir:status [ fhir:v "final" ] ; fhir:subject patient:{pid} ; fhir:encounter enc:{eid} ; fhir:code labtest:{lid} ;
  fhir:effectiveDateTime "{iso(ct)}"^^xsd:dateTime ;
  fhir:valueQuantity [ fhir:value {val} ; fhir:unit "{unit}" ; fhir:system "http://unitsofmeasure.org" ] ;
  fhir:interpretation [ fhir:system "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation" ; fhir:code "{flag}" ; fhir:display "{fd}" ] ;
  fhir:referenceRange [ fhir:low [ fhir:value {lo} ; fhir:unit "{unit}" ] ; fhir:high [ fhir:value {hi} ; fhir:unit "{unit}" ] ] ;
  afri:relatedImagingStudy study:{sidn} .""")
                        counts[sid]["labs"] += 1
            # discharge annotations (inpatient stays)
            if klass[0] == "IMP" and impression and impression != "normal-chest":
                enc_block.append(f"enc:{eid} adm:hasPrimaryDiagnosis concept:{impression} .")
                if impression == "pneumonia":
                    enc_block.append(f"enc:{eid} adm:hasDischargeMedication concept:amoxicillin .")
                if impression == "tuberculosis":
                    enc_block.append(f"enc:{eid} adm:hasDischargeMedication concept:rhze .")
            emit(g(sid, "clinical"), "\n".join(enc_block))
    # images rejected at ETL (missing required DICOM tags) -> rejected graph, never silently dropped
    for k in range(n_rej_tags):
        emit(g(sid, "rejected"), f"""image:DCM-{C}-REJ-{k + 1} a fhir:Media ;
  afri:rejectionReason "Missing required DICOM tag: {rng.choice(['Rows', 'Columns', 'SOPInstanceUID'])}" ;
  afri:mappingStatus afri:Unresolved .""")
    # provenance: one ETL run per datatype
    day = "2025-12-15"
    for kind in ("clinical", "imaging", "images", "findings", "labs"):
        rec = counts[sid][kind]
        rjc = n_rej_tags if kind == "images" else 0
        emit(g(sid, "provenance"), f"""<{KG}etl/{sid}/{day}/{kind}> a prov:Activity ;
  prov:used <{KG}SourceDatabase/{sid}> ; prov:generated <{g(sid, kind)}> ;
  prov:startedAtTime "{day}T16:00:00Z"^^xsd:dateTime ; prov:endedAtTime "{day}T16:{rng.randint(10, 50)}:00Z"^^xsd:dateTime ;
  prov:wasAssociatedWith <{KG}Agent/{sid}/etl-engine> ;
  afri:etlVersion "0.1-demo" ; afri:recordsProcessed {rec} ; afri:recordsRejected {rjc} ;
  afri:rejectedGraphURI <{g(sid, 'rejected')}> .""")
    emit(g(sid, "provenance"), f"""<{KG}Agent/{sid}/etl-engine> a prov:SoftwareAgent ;
  rdfs:label "AfriBiobank ETL v0.1-demo @ {label}" ; prov:actedOnBehalfOf sitei:{sid} .""")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/afribiobank-demo.trig")
    a = ap.parse_args()
    core()
    for i, s in enumerate(SITES):
        make_site(*s, uid_base=f"1.2.826.0.1.3680043.8.498.{i + 1}")
    with open(a.out, "w", encoding="utf-8") as f:
        f.write("# AfriBiobank SYNTHETIC demo dataset - generated by tools/generate_data.py\n")
        f.write("# Not real patient data. Model: AfriBiobank RDF Knowledge Graph Data Model v2.0\n")
        f.write(PREFIXES + "\n")
        for graph, blocks in out.items():
            f.write(f"\n<{graph}> {{\n")
            for b in blocks:
                f.write(b + "\n")
            f.write("}\n")
    print("wrote", a.out, "graphs:", len(out))


if __name__ == "__main__":
    main()
