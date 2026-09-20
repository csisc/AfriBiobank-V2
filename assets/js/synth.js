/* Procedural, clearly synthetic "radiographs".
 * These are NOT medical images. They exist so the viewer, windowing and measurement tools can be
 * demonstrated without shipping any patient data. The picture is drawn from the study's RDF findings:
 * a "Present" pneumonia with laterality "Right" puts an opacity in the right lung, and so on.
 */
import { rngFrom } from "./util.js";

const N = 512;

function makeNoise(seed) {
  const rnd = rngFrom("noise" + seed);
  const perm = new Float32Array(256 * 256).map(() => rnd());
  const at = (x, y) => perm[((y & 255) << 8) | (x & 255)];
  const sm = (t) => t * t * (3 - 2 * t);
  const vnoise = (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = sm(x - x0), fy = sm(y - y0);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (x, y, oct = 3) => { let s = 0, amp = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f, y * f); f *= 2; amp *= 0.5; } return s; };
}
const ell = (u, v, cx, cy, rx, ry) => { const d = ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2; return d; };
const soft = (d, edge = 0.25) => Math.min(1, Math.max(0, (1 - d) / edge));   // 1 inside, 0 outside, soft rim
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Separable box blur, in place: takes the digital "edge" off procedural shapes. */
function boxBlur(a, r) {
  const t = new Float32Array(a.length), w = 2 * r + 1;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let s = 0; for (let k = -r; k <= r; k++) s += a[y * N + Math.min(N - 1, Math.max(0, x + k))]; t[y * N + x] = s / w; }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let s = 0; for (let k = -r; k <= r; k++) s += t[Math.min(N - 1, Math.max(0, y + k)) * N + x]; a[y * N + x] = s / w; }
}

/**
 * @param {object} o  { modality, body, seed, findings:[{key:'Pneumonia', value:'Present', lat:'Right'}], quality:0..1 }
 * @returns display image {rows, cols, pixels, wc, ww, min, max, invert, spacing, presets, source:'synthetic'}
 */
export function synthImage(o) {
  const { modality = "CR", body = "CHEST", seed = "x", findings = [], quality = 0.9 } = o;
  const noise = makeNoise(seed);
  const rnd = rngFrom("j" + seed);
  const px = new Float32Array(N * N);
  const grain = (1 - Math.min(1, quality)) * 0.10 + 0.012;
  const jit = () => (rnd() - 0.5) * 0.06;
  const present = (name) => findings.filter((f) => f.key === name && f.value === "Present");
  const sides = (arr) => arr.flatMap((f) => (f.lat === "Bilateral" ? ["Left", "Right"] : [f.lat === "Left" || f.lat === "Right" ? f.lat : (rnd() < 0.5 ? "Left" : "Right")]));

  let kind = "chest-cr", wc, ww, presets, spacing = [0.143, 0.143], unit = "";
  if (modality === "CR" || modality === "DX") kind = "chest-cr";
  else if (modality === "CT") kind = body === "HEAD" ? "ct-head" : body === "ABDOMEN" ? "ct-abd" : "ct-chest";
  else if (modality === "MR") kind = body === "SPINE" ? "mr-spine" : "mr-head";
  else if (modality === "US") kind = "us";

  const pna = sides(present("Pneumonia")), tb = sides(present("Pulmonary tuberculosis")), eff = sides(present("Pleural effusion"));
  const cmg = present("Cardiomegaly").length > 0;

  for (let y = 0; y < N; y++) {
    const v = (y / (N - 1)) * 2 - 1;
    for (let x = 0; x < N; x++) {
      const u = (x / (N - 1)) * 2 - 1;
      let val = 0;
      const n1 = noise(x / 40, y / 40, 4), n2 = noise(x / 9, y / 9, 2);
      if (kind === "chest-cr") {
        const thorax = soft(ell(u, v, 0, 0.02, 0.9, 1.0), 0.32);
        const lungL = soft(ell(u, v, 0.40, -0.02, 0.31, 0.56), 0.4), lungR = soft(ell(u, v, -0.40, -0.02, 0.31, 0.56), 0.4);
        const lung = Math.max(lungL, lungR);
        const hr = cmg ? [0.36, 0.30] : [0.24, 0.24];
        const heart = soft(ell(u, v, 0.12, 0.34, hr[0], hr[1]), 0.6);
        const mediast = soft(ell(u, v, 0.02, -0.05, 0.13, 0.6), 0.7);
        const spine = soft(ell(u, v, 0, 0, 0.09, 1.0), 0.9);
        const ribs = lung * 0.035 * Math.pow(Math.max(0, Math.sin((v * 9.5 + 2.4 * Math.abs(u)) * Math.PI)), 2);
        const clav = 0.07 * Math.exp(-Math.pow((v + 0.70 - 0.32 * Math.abs(u)) / 0.03, 2)) * thorax;
        val = 0.06 + thorax * (0.46 + 0.10 * n1) - lung * (0.27 + 0.06 * n1) + heart * 0.17 + mediast * 0.08 + spine * 0.07 + ribs + clav;
        // diaphragm shading
        val += sstep(0.55, 0.85, v) * 0.18 * thorax;
        for (const side of pna) {
          const cx = side === "Left" ? 0.40 : -0.40, cy = 0.08 + jit() * 3;
          const d = ell(u, v, cx, cy, 0.19, 0.17);
          val += soft(d, 0.9) * (0.20 + 0.10 * n1);
        }
        for (const side of tb) {
          const cx = side === "Left" ? 0.42 : -0.42;
          val += soft(ell(u, v, cx, -0.32, 0.20, 0.17), 0.9) * (0.12 + 0.12 * n1) * lung;
          const ring = ell(u, v, cx - 0.02, -0.34, 0.06, 0.06);
          if (ring < 1) val -= 0.10 * (1 - ring) * lung;               // cavity
          if (ring > 1 && ring < 1.7) val += 0.05 * lung;
        }
        for (const side of eff) {
          const cx = side === "Left" ? 0.40 : -0.40;
          const lat = Math.abs(u - cx) / 0.31;
          const vt = 0.36 - 0.14 * Math.min(1, lat);                    // meniscus: fluid climbs the chest wall
          val += sstep(vt - 0.02, vt + 0.03, v) * soft(ell(u, v, cx, -0.02, 0.33, 0.58), 0.2) * 0.30;
        }
        val = val * 4095;
      } else if (kind === "ct-chest") {
        const bodyM = soft(ell(u, v, 0, 0.02, 0.92, 0.72), 0.06);
        const lungL = soft(ell(u, v, 0.42, -0.02, 0.32, 0.5), 0.15), lungR = soft(ell(u, v, -0.42, -0.02, 0.32, 0.5), 0.15);
        const lung = Math.max(lungL, lungR);
        const heart = soft(ell(u, v, 0.05, 0.2, 0.22, 0.24), 0.2);
        const spine = soft(ell(u, v, 0, 0.52, 0.11, 0.13), 0.3);
        const vessel = Math.max(lung * (rnd() < 0.0 ? 0 : 0), 0);
        val = -1000 + bodyM * (1040 + 30 * n1) - lung * (760 - 80 * n2) + heart * 30 + spine * 480 + soft(ell(u, v, 0, 0.5, 0.55, 0.06), 0.4) * 0 + vessel;
        val += bodyM * (1 - lung) * 8 * n2;
        for (const side of pna) { const cx = side === "Left" ? 0.42 : -0.42; val += soft(ell(u, v, cx, 0.08, 0.2, 0.17), 0.6) * (600 + 60 * n2) * lung; }
        val += (rnd() - 0.5) * 30 * (1 + (1 - quality) * 2);
      } else if (kind === "ct-head") {
        const skull = ell(u, v, 0, 0, 0.78, 0.92), inner = ell(u, v, 0, 0, 0.70, 0.84);
        const scalp = soft(ell(u, v, 0, 0, 0.84, 0.98), 0.06);
        const vent = soft(ell(u, v, 0.12, -0.05, 0.10, 0.22), 0.5) + soft(ell(u, v, -0.12, -0.05, 0.10, 0.22), 0.5);
        val = -1000 + scalp * 1035;
        if (skull < 1 && inner >= 1) val = 900 + 200 * n2;
        if (inner < 1) val = 32 + 8 * n1 - Math.min(1, vent) * 24;
        val += (rnd() - 0.5) * 12;
      } else if (kind === "ct-abd") {
        const outer = soft(ell(u, v, 0, 0, 0.9, 0.68), 0.06), inner = soft(ell(u, v, 0, 0, 0.78, 0.55), 0.12);
        const liver = soft(ell(u, v, -0.35, -0.08, 0.36, 0.3), 0.25), spleen = soft(ell(u, v, 0.55, -0.05, 0.14, 0.2), 0.3);
        const kid = soft(ell(u, v, 0.28, 0.22, 0.1, 0.13), 0.3) + soft(ell(u, v, -0.28, 0.22, 0.1, 0.13), 0.3);
        const spine = soft(ell(u, v, 0, 0.42, 0.1, 0.12), 0.3), gut = soft(ell(u, v, 0.1, -0.2, 0.25, 0.2), 0.3);
        // air -1000 | subcutaneous fat -90 | muscle and organs ~40 | liver ~65 | kidney ~100 | bone ~450 above
        val = -1000 + outer * 910 + inner * 130 + liver * 25 + spleen * 20 + Math.min(1, kid) * 60 + gut * (-90 + 60 * n2) + spine * 420;
        val += (rnd() - 0.5) * 25;
      } else if (kind === "mr-head") {
        const skull = ell(u, v, 0, 0, 0.8, 0.94), brain = ell(u, v, 0, 0, 0.68, 0.82);
        const vent = Math.min(1, soft(ell(u, v, 0.13, -0.04, 0.09, 0.2), 0.5) + soft(ell(u, v, -0.13, -0.04, 0.09, 0.2), 0.5));
        const gyri = Math.sin((noise(x / 14, y / 14, 3) * 9)) * 0.5 + 0.5;
        val = 20;
        if (skull < 1) val = 700 - 400 * sstep(0.85, 1, skull);
        if (brain < 1) val = 380 + 200 * gyri * sstep(0.35, 0.7, brain + 0.2 * n1) + 40 * n2 - vent * 320;
        val += (rnd() - 0.5) * 30;
      } else if (kind === "mr-spine") {
        const col = Math.abs(u - 0.02 * Math.sin(v * 3));
        const idx = ((v + 1) / 2) * 9, f = idx - Math.floor(idx);
        const bodyV = col < 0.16 ? (f > 0.14 ? 1 : 0.25) : 0;
        val = 60 + bodyV * (520 + 60 * n2) + (col < 0.06 && f <= 0.14 ? 200 : 0) + (col > 0.17 && col < 0.22 ? 250 : 0) + (rnd() - 0.5) * 30;
        if (Math.abs(u) > 0.7) val = 30;
      } else { // ultrasound: sector, speckle, hypoechoic structure
        const ang = Math.atan2(u, v + 1.05), rad = Math.hypot(u, v + 1.05);
        const inFan = Math.abs(ang) < 0.62 && rad > 0.12 && rad < 1.95;
        const sp = -Math.log(1 - rnd() * 0.999) * 0.5;
        const organ = soft(ell(u, v, 0.05, 0.25, 0.42, 0.28), 0.4);
        const cyst = soft(ell(u, v, -0.25, 0.45, 0.12, 0.1), 0.4);
        const fall = Math.exp(-rad * 0.55);
        val = inFan ? 4095 * Math.min(1, (0.10 + 0.32 * sp * (1 - 0.55 * organ) * (1 - 0.9 * cyst) + 0.05 * n1) * (0.6 + 0.9 * fall)) : 0;
        if (inFan && rad < 0.16) val = 4095 * 0.08;
      }
      // acquisition noise + degradation blockiness
      if (kind === "chest-cr") val += (rnd() - 0.5) * grain * 4095;
      px[y * N + x] = val;
    }
  }
  if (kind !== "us") boxBlur(px, kind === "chest-cr" ? 2 : 1);
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < px.length; i++) { const v = px[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  if (kind.startsWith("ct")) {
    unit = "HU"; spacing = [0.7, 0.7];
    if (kind === "ct-chest") { wc = -500; ww = 1500; } else if (kind === "ct-head") { wc = 40; ww = 90; } else { wc = 40; ww = 400; }
    presets = [["Soft tissue", 40, 400], ["Lung", -600, 1500], ["Bone", 400, 1800], ["Brain", 40, 80]];
    if (kind === "ct-chest") presets.unshift(["Default", wc, ww]);
  } else if (kind.startsWith("mr")) { spacing = [0.9, 0.9]; wc = 380; ww = 760; presets = [["Default", wc, ww], ["High contrast", 350, 400]]; }
  else if (kind === "us") { spacing = [0.3, 0.3]; wc = 2000; ww = 4000; presets = [["Default", wc, ww], ["Gain +", 1500, 3000]]; }
  else { wc = 2100; ww = 3800; presets = [["Default", wc, ww], ["Lung detail", 1500, 2400], ["Bone", 2900, 2200]]; }
  return { rows: N, cols: N, pixels: px, min: mn, max: mx, wc, ww, defaultWC: wc, defaultWW: ww, invert: false, spacing, unit, presets, source: "synthetic", kind };
}
