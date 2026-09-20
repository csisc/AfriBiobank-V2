/* Canvas viewer: window/level, zoom, pan, length and ellipse ROI.
 * Production replacement: Cornerstone3D (or OHIF) reading from DICOMweb. The tool behaviour below
 * (left-drag = window/level, wheel = zoom, shift/middle-drag = pan) mirrors what radiologists expect.
 */
import { clamp } from "./util.js";

export class Viewer {
  constructor(canvas, { onChange = () => {} } = {}) {
    this.canvas = canvas; this.ctx = canvas.getContext("2d");
    this.onChange = onChange;
    this.tool = "wl"; this.img = null; this.off = document.createElement("canvas");
    this.zoom = 1; this.pan = [0, 0]; this.wc = 0; this.ww = 1; this.invert = false;
    this.ann = []; this.drag = null; this.cursor = null; this.watermark = "";
    this._bind();
    this.ro = new ResizeObserver(() => { this._size(); this.draw(); });
    this.ro.observe(canvas.parentElement);
    this._size();
  }
  destroy() { this.ro.disconnect(); }

  setImage(img) {
    this.img = img; this.ann = [];
    this.off.width = img.cols; this.off.height = img.rows;
    this.wc = img.wc; this.ww = img.ww; this.invert = !!img.invert;
    this.resetView(false); this.renderPixels(); this.draw();
  }
  resetView(redraw = true) {
    this.zoom = 1; this.pan = [0, 0];
    if (this.img) { this.wc = this.img.defaultWC ?? this.img.wc; this.ww = this.img.defaultWW ?? this.img.ww; this.invert = !!this.img.invert; }
    if (redraw) { this.renderPixels(); this.draw(); }
  }
  setWindow(wc, ww) { this.wc = wc; this.ww = Math.max(1, ww); this.renderPixels(); this.draw(); }
  toggleInvert() { this.invert = !this.invert; this.renderPixels(); this.draw(); }
  setTool(t) { this.tool = t; this.canvas.dataset.tool = t; }
  clearAnnotations() { this.ann = []; this.draw(); }

  _size() {
    const p = this.canvas.parentElement, dpr = window.devicePixelRatio || 1;
    this.cw = Math.max(50, p.clientWidth); this.ch = Math.max(50, p.clientHeight);
    this.canvas.width = this.cw * dpr; this.canvas.height = this.ch * dpr;
    this.canvas.style.width = this.cw + "px"; this.canvas.style.height = this.ch + "px";
    this.dpr = dpr;
  }
  get base() { return this.img ? Math.min(this.cw / this.img.cols, this.ch / this.img.rows) * 0.96 : 1; }
  get scale() { return this.base * this.zoom; }
  _origin() { const s = this.scale; return [(this.cw - this.img.cols * s) / 2 + this.pan[0], (this.ch - this.img.rows * s) / 2 + this.pan[1]]; }
  toImage(cx, cy) { const [ox, oy] = this._origin(), s = this.scale; return [(cx - ox) / s, (cy - oy) / s]; }
  toScreen(ix, iy) { const [ox, oy] = this._origin(), s = this.scale; return [ox + ix * s, oy + iy * s]; }

  renderPixels() {
    if (!this.img) return;
    const { rows, cols, pixels } = this.img;
    const id = this.off.getContext("2d").createImageData(cols, rows), d = id.data;
    const lo = this.wc - this.ww / 2, k = 255 / this.ww, inv = this.invert;
    for (let i = 0, j = 0; i < pixels.length; i++, j += 4) {
      let v = (pixels[i] - lo) * k; v = v < 0 ? 0 : v > 255 ? 255 : v;
      if (inv) v = 255 - v;
      d[j] = d[j + 1] = d[j + 2] = v; d[j + 3] = 255;
    }
    this.off.getContext("2d").putImageData(id, 0, 0);
    this.onChange(this.state());
  }
  state() { return { wc: this.wc, ww: this.ww, zoom: this.zoom, invert: this.invert, tool: this.tool }; }

  valueAt(ix, iy) {
    if (!this.img) return null;
    const x = Math.floor(ix), y = Math.floor(iy);
    if (x < 0 || y < 0 || x >= this.img.cols || y >= this.img.rows) return null;
    return this.img.pixels[y * this.img.cols + x];
  }

  draw() {
    const c = this.ctx; c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = "#050607"; c.fillRect(0, 0, this.cw, this.ch);
    if (!this.img) return;
    const [ox, oy] = this._origin(), s = this.scale;
    c.imageSmoothingEnabled = s < 3; c.imageSmoothingQuality = "high";
    c.drawImage(this.off, ox, oy, this.img.cols * s, this.img.rows * s);
    if (this.watermark) {
      c.save(); c.font = "500 12px 'IBM Plex Sans', sans-serif"; c.fillStyle = "rgba(226,160,20,.9)"; c.textAlign = "center";
      c.fillText(this.watermark, this.cw / 2, this.ch - 12); c.restore();
    }
    for (const a of [...this.ann, ...(this.drag && this.drag.ann ? [this.drag.ann] : [])]) this._drawAnn(a);
    this._overlay();
  }

  _mm(px) { const sp = this.img.spacing; return sp ? px * sp[1] : null; }
  _drawAnn(a) {
    const c = this.ctx; c.save(); c.lineWidth = 1.6; c.strokeStyle = "#E3A21A"; c.fillStyle = "#E3A21A";
    c.font = "500 12px 'IBM Plex Sans', sans-serif";
    if (a.type === "length") {
      const [x1, y1] = this.toScreen(a.p1[0], a.p1[1]), [x2, y2] = this.toScreen(a.p2[0], a.p2[1]);
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
      for (const [x, y] of [[x1, y1], [x2, y2]]) { c.beginPath(); c.arc(x, y, 3.5, 0, 6.3); c.fill(); }
      const px = Math.hypot(a.p2[0] - a.p1[0], a.p2[1] - a.p1[1]), mm = this._mm(px);
      this._label(mm != null ? mm.toFixed(1) + " mm" : px.toFixed(0) + " px", (x1 + x2) / 2 + 8, (y1 + y2) / 2 - 8);
    } else if (a.type === "roi") {
      const [x1, y1] = this.toScreen(a.p1[0], a.p1[1]), [x2, y2] = this.toScreen(a.p2[0], a.p2[1]);
      c.beginPath(); c.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, 6.3); c.stroke();
      const st = this.roiStats(a);
      if (st) this._label(`mean ${st.mean.toFixed(0)}${this.img.unit ? " " + this.img.unit : ""} · sd ${st.sd.toFixed(0)}` + (st.area != null ? ` · ${st.area.toFixed(0)} mm²` : ""), Math.max(x1, x2) + 6, Math.min(y1, y2));
    }
    c.restore();
  }
  _label(t, x, y) {
    const c = this.ctx, w = c.measureText(t).width + 10;
    c.save(); c.fillStyle = "rgba(5,6,7,.78)"; c.fillRect(x - 3, y - 12, w, 18); c.fillStyle = "#F3C55A"; c.fillText(t, x + 2, y + 1); c.restore();
  }
  roiStats(a) {
    const { cols, rows, pixels } = this.img;
    const cx = (a.p1[0] + a.p2[0]) / 2, cy = (a.p1[1] + a.p2[1]) / 2, rx = Math.abs(a.p2[0] - a.p1[0]) / 2, ry = Math.abs(a.p2[1] - a.p1[1]) / 2;
    if (rx < 1 || ry < 1) return null;
    let n = 0, sum = 0, sq = 0;
    for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(rows - 1, Math.ceil(cy + ry)); y++)
      for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(cols - 1, Math.ceil(cx + rx)); x++) {
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) { const v = pixels[y * cols + x]; n++; sum += v; sq += v * v; }
      }
    if (!n) return null;
    const mean = sum / n, sd = Math.sqrt(Math.max(0, sq / n - mean * mean)), sp = this.img.spacing;
    return { mean, sd, n, area: sp ? n * sp[0] * sp[1] : null };
  }
  _overlay() {
    const c = this.ctx; c.save(); c.font = "400 11.5px 'IBM Plex Mono', monospace"; c.fillStyle = "rgba(230,236,240,.82)";
    const img = this.img, lines = [`WC ${this.wc.toFixed(0)}  WW ${this.ww.toFixed(0)}${this.invert ? "  inverted" : ""}`, `Zoom ${(this.zoom * 100).toFixed(0)}%   ${img.cols}×${img.rows}`];
    lines.forEach((t, i) => c.fillText(t, 10, this.ch - 30 + i * 14 - (this.watermark ? 16 : 0)));
    if (this.cursor) {
      const [ix, iy] = this.toImage(...this.cursor), v = this.valueAt(ix, iy);
      if (v != null) { c.textAlign = "right"; c.fillText(`x ${Math.floor(ix)}  y ${Math.floor(iy)}  ${v.toFixed(0)}${img.unit ? " " + img.unit : ""}`, this.cw - 10, this.ch - 12 - (this.watermark ? 16 : 0)); }
    }
    c.restore();
  }

  _bind() {
    const cv = this.canvas, pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
    cv.addEventListener("pointerdown", (e) => {
      if (!this.img) return; cv.setPointerCapture(e.pointerId);
      const p = pos(e); let mode = this.tool;
      if (e.button === 1 || e.shiftKey || e.button === 2) mode = "pan";
      this.drag = { mode, start: p, last: p, wc: this.wc, ww: this.ww, pan: [...this.pan], zoom: this.zoom, i0: this.toImage(...p) };
    });
    cv.addEventListener("pointermove", (e) => {
      const p = pos(e); this.cursor = p;
      const d = this.drag;
      if (d && this.img) {
        const dx = p[0] - d.start[0], dy = p[1] - d.start[1];
        if (d.mode === "wl") {
          const range = this.img.max - this.img.min || 1;
          this.wc = d.wc + dy * range / 500; this.ww = Math.max(1, d.ww + dx * range / 250); this.renderPixels();
        } else if (d.mode === "pan") { this.pan = [d.pan[0] + dx, d.pan[1] + dy]; }
        else if (d.mode === "zoom") { this.zoom = clamp(d.zoom * Math.exp(-dy / 120), 0.2, 30); this.onChange(this.state()); }
        else if (d.mode === "length" || d.mode === "roi") d.ann = { type: d.mode, p1: d.i0, p2: this.toImage(...p) };
      }
      this.draw();
    });
    const end = () => {
      const d = this.drag; this.drag = null;
      if (d && d.ann) {
        const len = Math.hypot(d.ann.p2[0] - d.ann.p1[0], d.ann.p2[1] - d.ann.p1[1]);
        if (len > 3) { this.ann.push(d.ann); this.onChange(this.state()); }
      }
      this.draw();
    };
    cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
    cv.addEventListener("pointerleave", () => { this.cursor = null; this.draw(); });
    cv.addEventListener("wheel", (e) => {
      if (!this.img) return; e.preventDefault();
      const p = pos(e), before = this.toImage(...p);
      this.zoom = clamp(this.zoom * Math.exp(-e.deltaY / 400), 0.2, 30);
      const [sx, sy] = this.toScreen(...before);            // keep the point under the cursor fixed
      this.pan = [this.pan[0] + p[0] - sx, this.pan[1] + p[1] - sy];
      this.onChange(this.state()); this.draw();
    }, { passive: false });
    cv.addEventListener("dblclick", () => this.resetView());
  }
}
