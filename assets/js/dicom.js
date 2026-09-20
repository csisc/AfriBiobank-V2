/* Minimal DICOM parser for the AfriBiobank prototype.
 *
 * Scope: reads the header of any DICOM Part-10 file and decodes pixel data for the
 * UNCOMPRESSED transfer syntaxes (Implicit VR LE, Explicit VR LE, Explicit VR BE).
 * Compressed syntaxes (JPEG, JPEG 2000, RLE ...) still yield full metadata, but no pixels.
 * A production viewer uses Cornerstone3D, which ships the codecs for those.
 *
 * Runs in the browser and in Node (no DOM access) so it can be unit-tested.
 */

export const TS = {
  "1.2.840.10008.1.2": "Implicit VR Little Endian",
  "1.2.840.10008.1.2.1": "Explicit VR Little Endian",
  "1.2.840.10008.1.2.1.99": "Deflated Explicit VR Little Endian",
  "1.2.840.10008.1.2.2": "Explicit VR Big Endian",
  "1.2.840.10008.1.2.4.50": "JPEG Baseline",
  "1.2.840.10008.1.2.4.57": "JPEG Lossless",
  "1.2.840.10008.1.2.4.70": "JPEG Lossless SV1",
  "1.2.840.10008.1.2.4.90": "JPEG 2000 Lossless",
  "1.2.840.10008.1.2.4.91": "JPEG 2000",
  "1.2.840.10008.1.2.5": "RLE Lossless",
};
const UNCOMPRESSED = new Set(["1.2.840.10008.1.2", "1.2.840.10008.1.2.1", "1.2.840.10008.1.2.2"]);

// tag -> [name, VR]  (VR needed for implicit-VR files)
const DICT = {
  "0002,0010": ["TransferSyntaxUID", "UI"],
  "0008,0016": ["SOPClassUID", "UI"], "0008,0018": ["SOPInstanceUID", "UI"],
  "0008,0020": ["StudyDate", "DA"], "0008,0021": ["SeriesDate", "DA"], "0008,0022": ["AcquisitionDate", "DA"], "0008,0023": ["ContentDate", "DA"],
  "0008,0030": ["StudyTime", "TM"], "0008,0050": ["AccessionNumber", "SH"], "0008,0060": ["Modality", "CS"],
  "0008,0070": ["Manufacturer", "LO"], "0008,0080": ["InstitutionName", "LO"], "0008,0090": ["ReferringPhysicianName", "PN"],
  "0008,1030": ["StudyDescription", "LO"], "0008,103E": ["SeriesDescription", "LO"],
  "0010,0010": ["PatientName", "PN"], "0010,0020": ["PatientID", "LO"], "0010,0030": ["PatientBirthDate", "DA"],
  "0010,0040": ["PatientSex", "CS"], "0010,1000": ["OtherPatientIDs", "LO"], "0010,1010": ["PatientAge", "AS"],
  "0010,1040": ["PatientAddress", "LO"],
  "0018,0015": ["BodyPartExamined", "CS"], "0018,1030": ["ProtocolName", "LO"], "0018,1164": ["ImagerPixelSpacing", "DS"],
  "0018,5101": ["ViewPosition", "CS"],
  "0020,000D": ["StudyInstanceUID", "UI"], "0020,000E": ["SeriesInstanceUID", "UI"], "0020,0011": ["SeriesNumber", "IS"],
  "0028,0002": ["SamplesPerPixel", "US"], "0028,0004": ["PhotometricInterpretation", "CS"], "0028,0006": ["PlanarConfiguration", "US"],
  "0028,0008": ["NumberOfFrames", "IS"], "0028,0010": ["Rows", "US"], "0028,0011": ["Columns", "US"],
  "0028,0030": ["PixelSpacing", "DS"], "0028,0100": ["BitsAllocated", "US"], "0028,0101": ["BitsStored", "US"],
  "0028,0103": ["PixelRepresentation", "US"], "0028,1050": ["WindowCenter", "DS"], "0028,1051": ["WindowWidth", "DS"],
  "0028,1052": ["RescaleIntercept", "DS"], "0028,1053": ["RescaleSlope", "DS"],
  "7FE0,0010": ["PixelData", "OW"],
};
const NAME_TO_KEY = Object.fromEntries(Object.entries(DICT).map(([k, [n]]) => [n, k]));

/** Header elements that can identify a person or a place (DICOM PS3.15 basic profile, abridged). */
export const IDENTIFYING = ["PatientName", "PatientID", "PatientBirthDate", "PatientAddress", "OtherPatientIDs",
  "InstitutionName", "ReferringPhysicianName", "AccessionNumber"];

const LONG_VR = new Set(["OB", "OD", "OF", "OL", "OV", "OW", "SQ", "UC", "UN", "UR", "UT"]);
const STR_VR = new Set(["AE", "AS", "CS", "DA", "DS", "DT", "IS", "LO", "LT", "PN", "SH", "ST", "TM", "UC", "UI", "UR", "UT"]);
const UNDEF = 0xFFFFFFFF;

const key = (g, e) => g.toString(16).toUpperCase().padStart(4, "0") + "," + e.toString(16).toUpperCase().padStart(4, "0");

export function parseDicom(buffer) {
  const dv = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  const len = buffer.byteLength;
  const warnings = [];
  let off = 0;
  if (len > 132 && dv.getUint32(128, false) === 0x4449434D) off = 132;       // 'DICM'
  else warnings.push("No DICM preamble: treated as a raw dataset (implicit VR little-endian).");

  const elements = new Map();      // "gggg,eeee" -> {vr, off, len}
  let explicit = off === 132, little = true, ts = explicit ? "1.2.840.10008.1.2.1" : "1.2.840.10008.1.2";
  let inMeta = off === 132;
  let pixelInfo = null;

  const dec = (o, n) => {                 // latin1 decode, trim padding
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(u8[o + i]);
    return s.replace(/[\0 ]+$/g, "").replace(/^ +/, "");
  };

  function readHeader(o, isExplicit, isLittle) {
    const g = dv.getUint16(o, isLittle), e = dv.getUint16(o + 2, isLittle);
    let vr = null, length, hdr;
    const k = key(g, e);
    if (g === 0xFFFE) {                    // item / delimiter tags are always implicit-style
      return { g, e, k, vr: null, length: dv.getUint32(o + 4, isLittle), hdr: 8 };
    }
    if (isExplicit) {
      vr = String.fromCharCode(u8[o + 4], u8[o + 5]);
      if (LONG_VR.has(vr)) { length = dv.getUint32(o + 8, isLittle); hdr = 12; }
      else { length = dv.getUint16(o + 6, isLittle); hdr = 8; }
    } else {
      length = dv.getUint32(o + 4, isLittle); hdr = 8;
      vr = DICT[k] ? DICT[k][1] : (g === 0x7FE0 ? "OW" : "UN");
    }
    return { g, e, k, vr, length, hdr };
  }

  // Skip a sequence / item with undefined length. Returns offset just after it.
  function skipUndefinedSequence(o) {
    while (o + 8 <= len) {
      const h = readHeader(o, explicit, little);
      if (h.g === 0xFFFE && h.e === 0xE0DD) return o + 8;             // sequence delimiter
      if (h.g === 0xFFFE && h.e === 0xE000) {                         // item
        o += 8;
        if (h.length === UNDEF) o = skipItemContents(o);
        else o += h.length;
      } else break;
    }
    return o;
  }
  function skipItemContents(o) {
    while (o + 8 <= len) {
      const h = readHeader(o, explicit, little);
      if (h.g === 0xFFFE && h.e === 0xE00D) return o + 8;             // item delimiter
      o += h.hdr;
      if (h.length === UNDEF) o = skipUndefinedSequence(o); else o += h.length;
    }
    return o;
  }

  while (off + 8 <= len) {
    // meta group is always explicit LE; then switch to the dataset's transfer syntax
    if (inMeta) {
      const g = dv.getUint16(off, true);
      if (g !== 0x0002) {
        inMeta = false;
        explicit = ts !== "1.2.840.10008.1.2";
        little = ts !== "1.2.840.10008.1.2.2";
        if (ts === "1.2.840.10008.1.2.1.99") warnings.push("Deflated transfer syntax: metadata only in this prototype.");
      }
    }
    const isExplicit = inMeta ? true : explicit, isLittle = inMeta ? true : little;
    const h = readHeader(off, isExplicit, isLittle);
    if (h.g === 0xFFFE) { off += 8; continue; }
    const vo = off + h.hdr;
    if (h.k === "7FE0,0010") {
      if (h.length === UNDEF) { pixelInfo = { encapsulated: true, off: vo, len: 0 }; }
      else pixelInfo = { encapsulated: false, off: vo, len: Math.min(h.length, len - vo) };
      elements.set(h.k, { vr: h.vr, off: vo, len: pixelInfo.len });
      break;
    }
    if (h.length === UNDEF) { off = skipUndefinedSequence(vo); continue; }
    if (vo + h.length > len) { warnings.push("File truncated inside " + h.k); break; }
    elements.set(h.k, { vr: h.vr, off: vo, len: h.length });
    if (h.k === "0002,0010") ts = dec(vo, h.length);
    off = vo + h.length;
  }

  const readStr = (k) => { const el = elements.get(k); return el ? dec(el.off, el.len) : undefined; };
  const readNum = (k) => {
    const el = elements.get(k); if (!el) return undefined;
    if (STR_VR.has(el.vr)) { const v = parseFloat(dec(el.off, el.len).split("\\")[0]); return isNaN(v) ? undefined : v; }
    if (el.vr === "US") return dv.getUint16(el.off, little);
    if (el.vr === "SS") return dv.getInt16(el.off, little);
    if (el.vr === "UL") return dv.getUint32(el.off, little);
    if (el.vr === "SL") return dv.getInt32(el.off, little);
    if (el.vr === "UN" && el.len === 2) return dv.getUint16(el.off, little);
    return undefined;
  };
  const readNums = (k) => { const s = readStr(k); return s ? s.split("\\").map(parseFloat).filter((x) => !isNaN(x)) : undefined; };

  const get = (name) => {
    const k = NAME_TO_KEY[name] || name;
    const el = elements.get(k); if (!el) return undefined;
    const vr = DICT[k] ? DICT[k][1] : el.vr;
    if (vr === "US" || vr === "SS" || vr === "UL") return readNum(k);
    return readStr(k);
  };
  const has = (name) => elements.has(NAME_TO_KEY[name] || name);

  const tags = [];
  for (const [k, el] of elements) {
    if (k === "7FE0,0010") { tags.push({ tag: k, name: "PixelData", vr: el.vr, value: `${el.len} bytes` }); continue; }
    const name = DICT[k] ? DICT[k][0] : "";
    const vr = DICT[k] ? DICT[k][1] : el.vr;
    let value;
    if (["US", "SS", "UL", "SL"].includes(vr)) value = String(readNum(k));
    else if (STR_VR.has(vr) && el.len < 200) value = readStr(k);
    else value = `(${vr}, ${el.len} bytes)`;
    tags.push({ tag: k, name, vr, value });
  }

  // ---- pixel module
  const rows = readNum("0028,0010"), cols = readNum("0028,0011");
  const pixel = { rows, cols, samples: readNum("0028,0002") || 1, bitsAllocated: readNum("0028,0100"),
    bitsStored: readNum("0028,0101"), signed: readNum("0028,0103") === 1, photometric: readStr("0028,0004"),
    planar: readNum("0028,0006") || 0, frames: readNum("0028,0008") || 1, data: null, reason: null };
  if (!pixelInfo) pixel.reason = "No PixelData element";
  else if (pixelInfo.encapsulated || !UNCOMPRESSED.has(ts)) pixel.reason = `Compressed transfer syntax (${TS[ts] || ts}) needs codecs that are not bundled in this prototype`;
  else if (!rows || !cols || !pixel.bitsAllocated) pixel.reason = "Rows / Columns / BitsAllocated missing";
  else {
    const n = rows * cols * pixel.samples;
    try {
      if (pixel.bitsAllocated === 8) pixel.data = new Uint8Array(buffer, pixelInfo.off, Math.min(n, pixelInfo.len));
      else if (pixel.bitsAllocated === 16) {
        const cnt = Math.min(n, Math.floor(pixelInfo.len / 2));
        const arr = pixel.signed ? new Int16Array(cnt) : new Uint16Array(cnt);
        for (let i = 0; i < cnt; i++) arr[i] = pixel.signed ? dv.getInt16(pixelInfo.off + 2 * i, little) : dv.getUint16(pixelInfo.off + 2 * i, little);
        pixel.data = arr;
      } else pixel.reason = `BitsAllocated=${pixel.bitsAllocated} not supported`;
    } catch (err) { pixel.reason = "Pixel decode failed: " + err.message; }
  }

  return { transferSyntax: ts, transferSyntaxName: TS[ts] || ts, get, has, tags, pixel, warnings,
    numbers: (name) => readNums(NAME_TO_KEY[name] || name) };
}

/** Convert a parsed dataset into a displayable greyscale image. Returns null if pixels are unavailable. */
export function toDisplayImage(p) {
  const px = p.pixel;
  if (!px.data) return null;
  const { rows, cols, samples } = px;
  const out = new Float32Array(rows * cols);
  if (samples === 3) {
    const d = px.data;
    for (let i = 0; i < rows * cols; i++) {
      const r = px.planar === 1 ? d[i] : d[3 * i], g = px.planar === 1 ? d[rows * cols + i] : d[3 * i + 1],
        b = px.planar === 1 ? d[2 * rows * cols + i] : d[3 * i + 2];
      out[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
  } else {
    const slope = p.get("RescaleSlope") ?? 1, icpt = p.get("RescaleIntercept") ?? 0;
    const d = px.data, s = parseFloat(slope) || 1, c = parseFloat(icpt) || 0;
    for (let i = 0; i < out.length; i++) out[i] = d[i] * s + c;
  }
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < out.length; i++) { const v = out[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const wc = parseFloat(p.get("WindowCenter")), ww = parseFloat(p.get("WindowWidth"));
  const ps = p.numbers("PixelSpacing") || p.numbers("ImagerPixelSpacing");
  return {
    rows, cols, pixels: out, min: mn, max: mx,
    wc: isFinite(wc) ? wc : (mn + mx) / 2, ww: isFinite(ww) && ww > 0 ? ww : Math.max(1, mx - mn),
    invert: px.photometric === "MONOCHROME1",
    spacing: ps && ps.length >= 2 ? [ps[0], ps[1]] : null,
    source: "dicom",
  };
}

export const tagNames = () => Object.values(DICT).map(([n]) => n);
