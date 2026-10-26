/* =========================================================================
   Tejeshwar Vijayakumar — particle portfolio
   One canvas. One accent. Everything else is quiet.
   Vanilla JS, no build step. Typed arrays, no per-frame allocation in loops.

   The silhouette is EDGE-WEIGHTED: most particles trace the outline (bright,
   dense), a minority scatter through the interior (dim) — a sculpted,
   portrait-grade look rather than a flat fill.
   ========================================================================= */
(() => {
  "use strict";

  const canvas = document.getElementById("field");
  const ctx = canvas.getContext("2d", { alpha: false });
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- Config -----------------------------------------------------------
  const BASE_COUNT = 16000;          // particle budget
  const ACCENT_COUNT = 420;          // the lowk node (always accent-colored)
  let COUNT = BASE_COUNT;

  // Palette read from CSS variables so invert "just works".
  let col = { ground: "#0C0D11", ink: "#EEF1F6", ink2: "#A4ABB8", ink3: "#5C6475", accent: "#5E6DFF", hair: "#242833" };
  function readPalette() {
    const cs = getComputedStyle(document.body);
    const g = (n, f) => (cs.getPropertyValue(n).trim() || f);
    col.ground = g("--ground", col.ground);
    col.ink = g("--ink", col.ink);
    col.ink2 = g("--ink2", col.ink2);
    col.ink3 = g("--ink3", col.ink3);
    col.accent = g("--accent", col.accent);
    col.hair = g("--hair", col.hair);
  }
  // "#rrggbb" + alpha -> "rgba()"
  function hexA(hex, a) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // ---- Canvas sizing ----------------------------------------------------
  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    layout();
    buildFormation(currentMode, true);
    updateAnchors();
    if (!ambInit) initAmbient();
  }

  // ---- Particle state (typed arrays, allocated once at max budget) ------
  const MAX = BASE_COUNT;
  const px = new Float32Array(MAX);
  const py = new Float32Array(MAX);
  const vx = new Float32Array(MAX);
  const vy = new Float32Array(MAX);
  const tx = new Float32Array(MAX);
  const ty = new Float32Array(MAX);
  const seed = new Float32Array(MAX);
  const shade = new Uint8Array(MAX);   // 0 bright (edge), 1 mid, 2 dim (interior)

  const NET_NODES = 46;
  const netX = new Float32Array(NET_NODES);
  const netY = new Float32Array(NET_NODES);

  for (let i = 0; i < MAX; i++) {
    px[i] = Math.random() * 1200;
    py[i] = Math.random() * 800;
    seed[i] = Math.random() * Math.PI * 2;
  }

  // Ambient drifting field — fills negative space, sits behind the portrait.
  const N_AMB = 320;
  const ambX = new Float32Array(N_AMB), ambY = new Float32Array(N_AMB);
  const ambVX = new Float32Array(N_AMB), ambVY = new Float32Array(N_AMB), ambS = new Float32Array(N_AMB);
  let ambInit = false;
  function initAmbient() {
    for (let i = 0; i < N_AMB; i++) {
      ambX[i] = Math.random() * W; ambY[i] = Math.random() * H;
      const a = Math.random() * Math.PI * 2, sp = 0.05 + Math.random() * 0.12;
      ambVX[i] = Math.cos(a) * sp; ambVY[i] = Math.sin(a) * sp; ambS[i] = Math.random();
    }
    ambInit = true;
  }

  // shade bucket derived from a particle's stable seed (used by non-portrait forms)
  function shadeFromSeed(i) {
    const v = (Math.abs(Math.sin(seed[i] * 12.9898 + i * 0.013)) * 43758.5453) % 1;
    return v < 0.5 ? 0 : (v < 0.82 ? 1 : 2);
  }
  function resetShade(start, end) { for (let i = start; i < end; i++) shade[i] = shadeFromSeed(i); }

  // ---- Geometry anchors computed per-resize -----------------------------
  const geo = {};
  function layout() {
    const isMobile = W <= 720;
    const sh = isMobile ? Math.min(H * 0.54, 440) : Math.min(H * 0.86, 820);
    const sw = sh * 0.64;
    const cx = isMobile ? W * 0.5 : W * 0.46;
    const cy = isMobile ? H * 0.42 : H * 0.53;
    geo.sil = { x: cx, y: cy, w: sw, h: sh };
    geo.node = { x: cx, y: cy + sh * 0.22 };   // chest
    const fw = Math.min(W * (isMobile ? 0.84 : 0.56), 760);
    const fh = Math.min(H * (isMobile ? 0.44 : 0.62), 520);
    geo.frame = { x: cx, y: isMobile ? H * 0.40 : H * 0.50, w: fw, h: fh };
  }

  // ======================================================================
  //  SILHOUETTE — draw an offscreen bust, then alpha-sample it, splitting
  //  points into EDGE (near a transparency boundary) and FILL (interior).
  //  A transparent me.png cutout can be wired in via sampleSilhouette(img).
  // ======================================================================
  const silCanvas = document.createElement("canvas");
  const silCtx = silCanvas.getContext("2d", { willReadFrequently: true });
  let silEdge = new Float32Array(0);   // normalized [x,y] edge points (within subject bbox)
  let silFill = new Float32Array(0);   // normalized [x,y] interior points
  let silAR = 0.78;                    // silhouette aspect (w/h), set on sample
  let silFillS = new Uint8Array(0);    // per-fill-point shade (tonal, from photo luminance)

  function drawProceduralSilhouette(c, w, h) {
    c.clearRect(0, 0, w, h);
    c.fillStyle = "#000";
    const cx = w / 2;

    const headRx = w * 0.165, headRy = h * 0.155, headCy = h * 0.335;
    const neckW = w * 0.097;

    // --- shoulders / upper torso (rounded caps, gently widening) ---
    const shTop = h * 0.60, shHalf = w * 0.5;
    c.beginPath();
    c.moveTo(cx - neckW, shTop - h * 0.015);
    c.bezierCurveTo(cx - w * 0.25, shTop - h * 0.012, cx - shHalf * 0.84, shTop + h * 0.035, cx - shHalf, shTop + h * 0.165);
    c.lineTo(cx - (shHalf + w * 0.02), h);
    c.lineTo(cx + (shHalf + w * 0.02), h);
    c.lineTo(cx + shHalf, shTop + h * 0.165);
    c.bezierCurveTo(cx + shHalf * 0.84, shTop + h * 0.035, cx + w * 0.25, shTop - h * 0.012, cx + neckW, shTop - h * 0.015);
    c.closePath();
    c.fill();

    // --- neck ---
    c.beginPath();
    c.moveTo(cx - neckW * 0.82, headCy + headRy * 0.66);
    c.lineTo(cx + neckW * 0.82, headCy + headRy * 0.66);
    c.lineTo(cx + neckW * 0.95, shTop + h * 0.005);
    c.lineTo(cx - neckW * 0.95, shTop + h * 0.005);
    c.closePath();
    c.fill();

    // --- face (oval + jaw taper) ---
    c.beginPath();
    c.ellipse(cx, headCy, headRx, headRy, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.moveTo(cx - headRx * 0.92, headCy + headRy * 0.46);
    c.quadraticCurveTo(cx, headCy + headRy * 1.24, cx + headRx * 0.92, headCy + headRy * 0.46);
    c.closePath();
    c.fill();

    // --- ears ---
    c.beginPath(); c.ellipse(cx - headRx * 0.99, headCy + headRy * 0.05, w * 0.022, h * 0.03, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(cx + headRx * 0.99, headCy + headRy * 0.05, w * 0.022, h * 0.03, 0, 0, Math.PI * 2); c.fill();

    // --- curly hair: head-hugging base that frames to the ears, plus spiky crown curls ---
    let s = 9.71;
    const rnd = () => { s = Math.sin(s * 97.3 + 13.1) * 43758.5453; return s - Math.floor(s); };
    const hairR = headRx * 1.2;                 // radius of the afro mass
    const hcx = cx, hcy = headCy - headRy * 0.62; // sits on top of the head, overlapping
    // interior fill so the mass is solid
    for (let i = 0; i < 52; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * hairR * 0.82;
      const size = w * (0.03 + rnd() * 0.03);
      c.beginPath(); c.ellipse(hcx + Math.cos(a) * r, hcy + Math.sin(a) * r * 0.98, size, size, 0, 0, Math.PI * 2); c.fill();
    }
    // bumpy perimeter curls around the whole ring (bottom overlaps the head, so only
    // the top + sides read as the visible bushy outline)
    const bumps = 58;
    for (let i = 0; i < bumps; i++) {
      const a = (i / bumps) * Math.PI * 2;
      const rr = hairR * (0.9 + rnd() * 0.24);
      const size = w * (0.024 + rnd() * 0.03);
      c.beginPath(); c.ellipse(hcx + Math.cos(a) * rr, hcy + Math.sin(a) * rr * 0.98, size, size * 1.04, 0, 0, Math.PI * 2); c.fill();
    }
  }

  function sampleSilhouette(img) {
    const SW = 300, SH = 380;
    silCanvas.width = SW; silCanvas.height = SH;
    const isPhoto = !!img;
    if (img) {
      const ar = img.width / img.height;
      let dw = SW, dh = SW / ar;
      if (dh > SH) { dh = SH; dw = SH * ar; }
      silCtx.clearRect(0, 0, SW, SH);
      silCtx.drawImage(img, (SW - dw) / 2, SH - dh, dw, dh);
    } else {
      drawProceduralSilhouette(silCtx, SW, SH);
    }
    const data = silCtx.getImageData(0, 0, SW, SH).data;
    const T = 60, step = isPhoto ? 1 : 2, e = step;
    const idx = (x, y) => (y * SW + x) * 4;
    const A = (x, y) => (x < 0 || y < 0 || x >= SW || y >= SH) ? 0 : data[idx(x, y) + 3];
    // subject bounding box (so placement is aspect-correct & tightly framed)
    let minx = SW, miny = SH, maxx = 0, maxy = 0, any = false;
    for (let y = 0; y < SH; y += step) for (let x = 0; x < SW; x += step) {
      if (A(x, y) > T) { any = true; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
    }
    if (!any) { minx = 0; miny = 0; maxx = SW - 1; maxy = SH - 1; }
    const bw = Math.max(1, maxx - minx), bh = Math.max(1, maxy - miny);
    silAR = bw / bh;
    const edge = [], fill = [], fillS = [];
    for (let y = 0; y < SH; y += step) {
      for (let x = 0; x < SW; x += step) {
        if (A(x, y) <= T) continue;
        const isEdge =
          A(x - e, y) <= T || A(x + e, y) <= T || A(x, y - e) <= T || A(x, y + e) <= T ||
          A(x - e, y - e) <= T || A(x + e, y + e) <= T || A(x - e, y + e) <= T || A(x + e, y - e) <= T;
        const nx = (x - minx + (Math.random() - 0.5)) / bw;
        const ny = (y - miny + (Math.random() - 0.5)) / bh;
        if (isEdge) { edge.push([nx, ny]); continue; }
        if (isPhoto) {
          const L = data[idx(x, y)] / 255;                 // grayscale tone, 0 dark .. 1 light
          const prob = 0.1 + 0.9 * Math.pow(1 - L, 1.25);  // darker tones carry more particles
          if (Math.random() < prob) { fill.push([nx, ny]); fillS.push(L < 0.32 ? 0 : (L < 0.6 ? 1 : 2)); }
        } else {
          if (Math.random() < 0.42) { fill.push([nx, ny]); fillS.push(2); }
        }
      }
    }
    // shuffle so truncation / subsampling stays spatially uniform (no top-biased fills)
    const shuf = (a, b) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = a[i]; a[i] = a[j]; a[j] = t; if (b) { const u = b[i]; b[i] = b[j]; b[j] = u; } } };
    shuf(edge); shuf(fill, fillS);
    silEdge = new Float32Array(edge.length * 2);
    for (let i = 0; i < edge.length; i++) { silEdge[i * 2] = edge[i][0]; silEdge[i * 2 + 1] = edge[i][1]; }
    silFill = new Float32Array(fill.length * 2);
    for (let i = 0; i < fill.length; i++) { silFill[i * 2] = fill[i][0]; silFill[i * 2 + 1] = fill[i][1]; }
    silFillS = Uint8Array.from(fillS);
  }
  sampleSilhouette(null);   // procedural fallback renders instantly
  (function loadMe() {       // then morph into the real photo portrait
    const img = new Image();
    img.onload = () => { sampleSilhouette(img); if (currentMode === "about") buildFormation("about", false); };
    img.onerror = () => {};
    img.src = "./me.png?v=6";
  })();

  // ======================================================================
  //  FORMATION TARGET GENERATORS
  // ======================================================================
  function spread(points, start, end, offX, offY, scaleX, scaleY) {
    const n = points.length / 2;
    if (n === 0) return;
    for (let k = 0, i = start; i < end; k++, i++) {
      const p = (k % n) * 2;
      const j = k >= n ? (Math.random() - 0.5) * 3 : 0;
      tx[i] = offX + points[p] * scaleX + j;
      ty[i] = offY + points[p + 1] * scaleY + j;
    }
  }
  function spreadRaw(points, start, end) {
    const n = points.length / 2;
    if (n === 0) return;
    for (let k = 0, i = start; i < end; k++, i++) {
      const p = (k % n) * 2;
      const j = k >= n ? (Math.random() - 0.5) * 2.4 : 0;
      tx[i] = points[p] + j;
      ty[i] = points[p + 1] + j;
    }
  }
  function placeNode(nx, ny, r) {
    for (let i = 0; i < ACCENT_COUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.pow(Math.random(), 0.62) * r;
      tx[i] = nx + Math.cos(a) * rr;
      ty[i] = ny + Math.sin(a) * rr * 1.08;
    }
  }

  // --- About / silhouette (edge-weighted) ---
  function formAbout() {
    const isMobile = W <= 720;
    const ar = silAR > 0 ? silAR : 0.78;
    const targetH = isMobile ? Math.min(H * 0.56, 500) : Math.min(H * 0.86, 880);
    let fh = targetH, fw = fh * ar;
    const maxW = W * (isMobile ? 0.94 : 0.62);
    if (fw > maxW) { fw = maxW; fh = fw / ar; }
    const cx = isMobile ? W * 0.5 : W * 0.455;
    const cy = isMobile ? H * 0.44 : H * 0.5;
    const ox = cx - fw / 2, oy = cy - fh / 2;
    const nodeX = cx, nodeY = oy + fh * 0.9;      // the lowk mark sits at the base of the bust
    geo.node = { x: nodeX, y: nodeY };
    placeNode(nodeX, nodeY, Math.max(7, fw * 0.042));
    const avail = COUNT - ACCENT_COUNT;
    const nEdge = silEdge.length / 2, nFill = silFill.length / 2;
    const edgeShare = Math.round(avail * 0.42);   // outline detail; the rest is tonal fill
    let i = ACCENT_COUNT;
    for (let k = 0; k < edgeShare && i < COUNT; k++, i++) {
      const p = nEdge ? (k % nEdge) * 2 : 0;
      const j = k >= nEdge ? (Math.random() - 0.5) * 1.8 : 0;
      tx[i] = ox + (nEdge ? silEdge[p] : 0.5) * fw + j;
      ty[i] = oy + (nEdge ? silEdge[p + 1] : 0.5) * fh + j;
      shade[i] = (k & 3) === 0 ? 1 : 0;
    }
    for (; i < COUNT; i++) {
      const k = i - ACCENT_COUNT - edgeShare;
      const p = nFill ? (k % nFill) * 2 : 0;
      tx[i] = ox + (nFill ? silFill[p] : 0.5) * fw + (Math.random() - 0.5) * 2.2;
      ty[i] = oy + (nFill ? silFill[p + 1] : 0.5) * fh + (Math.random() - 0.5) * 2.2;
      shade[i] = nFill ? silFillS[k % nFill] : 2;
    }
  }

  // --- Discover: India outline + city pins ---
  const INDIA = [
    [0.44,0.02],[0.52,0.04],[0.55,0.10],[0.62,0.10],[0.66,0.15],[0.63,0.19],
    [0.68,0.22],[0.76,0.20],[0.82,0.24],[0.80,0.30],[0.72,0.33],[0.74,0.40],
    [0.80,0.44],[0.86,0.52],[0.82,0.58],[0.76,0.56],[0.72,0.62],[0.66,0.72],
    [0.60,0.82],[0.54,0.92],[0.50,0.99],[0.46,0.92],[0.44,0.82],[0.40,0.74],
    [0.34,0.66],[0.30,0.58],[0.26,0.50],[0.22,0.44],[0.18,0.40],[0.14,0.36],
    [0.10,0.30],[0.14,0.26],[0.20,0.28],[0.24,0.24],[0.22,0.18],[0.28,0.16],
    [0.30,0.10],[0.36,0.12],[0.40,0.07],[0.44,0.02]
  ];
  const CITIES = [[0.40,0.18],[0.30,0.40],[0.56,0.58],[0.44,0.70],[0.66,0.34],[0.50,0.50],[0.38,0.55]];
  let indiaPoly = null;
  (function densifyIndia() {
    const out = [];
    for (let i = 0; i < INDIA.length - 1; i++) {
      const [x1, y1] = INDIA[i], [x2, y2] = INDIA[i + 1];
      for (let s = 0; s < 26; s++) { const t = s / 26; out.push(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t); }
    }
    indiaPoly = new Float32Array(out);
  })();

  function formDiscover() {
    resetShade(ACCENT_COUNT, COUNT);
    const f = geo.frame;
    const size = Math.min(f.w, f.h) * 1.02;
    const ox = f.x - size * 0.5, oy = f.y - size * 0.52;
    const pinScale = Math.max(6, size * 0.03);
    placeNode(ox + CITIES[5][0] * size, oy + CITIES[5][1] * size, pinScale);
    const pinShare = Math.floor((COUNT - ACCENT_COUNT) * 0.16);
    const outlineEnd = COUNT - pinShare;
    spread(indiaPoly, ACCENT_COUNT, outlineEnd, ox, oy, size, size);
    for (let i = ACCENT_COUNT; i < outlineEnd; i++) shade[i] = 0; // bright outline
    const per = Math.max(1, Math.floor(pinShare / CITIES.length));
    let idx = outlineEnd;
    for (let c = 0; c < CITIES.length && idx < COUNT; c++) {
      const cxp = ox + CITIES[c][0] * size, cyp = oy + CITIES[c][1] * size;
      for (let k = 0; k < per && idx < COUNT; k++, idx++) {
        const a = Math.random() * Math.PI * 2, rr = Math.pow(Math.random(), 0.5) * pinScale * 0.8;
        tx[idx] = cxp + Math.cos(a) * rr; ty[idx] = cyp + Math.sin(a) * rr; shade[idx] = 1;
      }
    }
    while (idx < COUNT) { tx[idx] = ox + CITIES[0][0] * size; ty[idx] = oy + CITIES[0][1] * size; shade[idx] = 1; idx++; }
  }

  // --- Ticket: body + perforation + tearable stub ---
  let ticketGeo = null, stubTorn = false;
  function formTicket() {
    resetShade(ACCENT_COUNT, COUNT);
    const f = geo.frame;
    const tw = Math.min(f.w * 0.92, 560), th = Math.min(tw * 0.42, f.h * 0.78);
    const x0 = f.x - tw / 2, y0 = f.y - th / 2;
    const perfX = x0 + tw * 0.70;
    ticketGeo = { x0, y0, tw, th, perfX };
    placeNode(x0 + tw * 0.16, y0 + th * 0.30, Math.max(6, th * 0.1));
    const pts = [];
    const r = Math.min(18, th * 0.14);
    const edge = (x1, y1, x2, y2, n) => { for (let s = 0; s < n; s++) { const t = s / n; pts.push(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t); } };
    edge(x0 + r, y0, x0 + tw - r, y0, 120);
    edge(x0 + tw, y0 + r, x0 + tw, y0 + th - r, 60);
    edge(x0 + tw - r, y0 + th, x0 + r, y0 + th, 120);
    edge(x0, y0 + th - r, x0, y0 + r, 60);
    for (let s = 0; s < 26; s++) { if (s % 2 === 0) continue; pts.push(perfX, y0 + (th * s / 26)); }
    edge(x0 + tw * 0.08, y0 + th * 0.58, x0 + tw * 0.56, y0 + th * 0.58, 50);
    edge(x0 + tw * 0.08, y0 + th * 0.74, x0 + tw * 0.40, y0 + th * 0.74, 34);
    const outline = new Float32Array(pts);
    const traceEnd = ACCENT_COUNT + Math.floor((COUNT - ACCENT_COUNT) * 0.72);
    spreadRaw(outline, ACCENT_COUNT, traceEnd);
    for (let i = ACCENT_COUNT; i < traceEnd; i++) shade[i] = 0;
    for (let i = traceEnd; i < COUNT; i++) {
      tx[i] = perfX + Math.random() * (x0 + tw - perfX) * 0.96 + tw * 0.01;
      ty[i] = y0 + Math.random() * th;
      shade[i] = 2;
    }
    ticketGeo.stubStart = traceEnd;
  }
  function tearStub() {
    if (!ticketGeo || stubTorn) return;
    stubTorn = true;
    for (let i = ticketGeo.stubStart; i < COUNT; i++) {
      tx[i] += ticketGeo.tw * 0.4 + Math.random() * 120;
      ty[i] -= 60 + Math.random() * 160;
      vx[i] += 2 + Math.random() * 3; vy[i] -= 2 + Math.random() * 3;
    }
    setCaption("Ticket", "Booked. Your stub tears off — that's your entry to the event.");
  }

  // --- Network: nodes + live links near cursor ---
  function formNetwork() {
    resetShade(ACCENT_COUNT, COUNT);
    const f = geo.frame;
    const ox = f.x - f.w / 2, oy = f.y - f.h / 2;
    placeNode(f.x, f.y, Math.max(6, f.h * 0.055));
    for (let n = 0; n < NET_NODES; n++) {
      const gx = (n % 8) / 7, gy = Math.floor(n / 8) / 5;
      netX[n] = ox + (gx * 0.86 + 0.07 + (Math.random() - 0.5) * 0.08) * f.w;
      netY[n] = oy + (gy * 0.86 + 0.07 + (Math.random() - 0.5) * 0.08) * f.h;
    }
    const span = COUNT - ACCENT_COUNT;
    for (let k = 0; k < span; k++) {
      const i = ACCENT_COUNT + k;
      const n = k % NET_NODES;
      const a = Math.random() * Math.PI * 2;
      const rr = Math.pow(Math.random(), 0.7) * Math.max(5, f.h * 0.03);
      tx[i] = netX[n] + Math.cos(a) * rr;
      ty[i] = netY[n] + Math.sin(a) * rr;
      shade[i] = rr < f.h * 0.012 ? 0 : 1;   // node cores brighter
    }
  }

  // --- Organise: tournament bracket ---
  function formOrganise() {
    resetShade(ACCENT_COUNT, COUNT);
    const f = geo.frame;
    const ox = f.x - f.w / 2, oy = f.y - f.h / 2;
    const cols = 4, colW = f.w / cols;
    const pts = [];
    let slots = 8;
    for (let c = 0; c < cols; c++) {
      const x = ox + colW * c + colW * 0.14;
      const nextX = ox + colW * (c + 1) + colW * 0.14;
      const gap = f.h / slots;
      for (let sI = 0; sI < slots; sI++) {
        const y = oy + gap * (sI + 0.5);
        const hx2 = x + colW * 0.56;
        for (let t = 0; t < 40; t++) { const tt = t / 40; pts.push(x + (hx2 - x) * tt, y); }
        if (c < cols - 1 && sI % 2 === 0) {
          const yPair = oy + gap * (sI + 1.5);
          for (let t = 0; t < 24; t++) { const tt = t / 24; pts.push(hx2, y + (yPair - y) * tt); }
          const midY = (y + yPair) / 2;
          for (let t = 0; t < 20; t++) { const tt = t / 20; pts.push(hx2 + (colW * 0.44) * tt, midY); }
        }
      }
      slots = Math.max(1, slots / 2);
    }
    const champX = ox + colW * (cols - 1) + colW * 0.70, champY = oy + f.h * 0.5;
    placeNode(champX, champY, Math.max(6, f.h * 0.055));
    spreadRaw(new Float32Array(pts), ACCENT_COUNT, COUNT);
    for (let i = ACCENT_COUNT; i < COUNT; i++) shade[i] = 0;
  }

  // ======================================================================
  //  MODE SWITCHING
  // ======================================================================
  let currentMode = "about";
  const CAPTIONS = {
    about:    ["About", "lowk.in is my core work — a nationwide platform for event discovery, ticketing and real-world networking, built for tournaments, MUNs, college fests and grassroots gatherings."],
    discover: ["Discover", "lowk puts every event on one map — tournaments, MUNs, fests and grassroots meetups across India. Find what's happening near you."],
    ticket:   ["Ticket", "Tap the stub to tear it off. lowk turns discovery into a booked seat in one move — no scattered forms, no DMs."],
    network:  ["Network", "Move through the field — people connect. lowk turns events into real-world networks — meet people before the night even starts."],
    organise: ["Organise", "lowk hands organisers the whole stack — list it, ticket it, and run the bracket end to end."],
  };
  function setCaption(key, text) {
    document.getElementById("caption-key").textContent = key;
    document.getElementById("caption-text").textContent = text;
  }
  function buildFormation(mode, immediate) {
    stubTorn = false;
    if (mode === "discover") formDiscover();
    else if (mode === "ticket") formTicket();
    else if (mode === "network") formNetwork();
    else if (mode === "organise") formOrganise();
    else formAbout();
    if (immediate || prefersReduced) {
      for (let i = 0; i < COUNT; i++) { px[i] = tx[i]; py[i] = ty[i]; vx[i] = 0; vy[i] = 0; }
    }
  }
  function setMode(mode) {
    if (!CAPTIONS[mode]) return;
    currentMode = mode;
    const [k, t] = CAPTIONS[mode];
    setCaption(k, t);
    buildFormation(mode, false);
    document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    showSample(mode);
    hideHint();
  }

  // ======================================================================
  //  POINTER
  // ======================================================================
  const pointer = { x: -9999, y: -9999, active: false };
  let lastHubX = 0, lastHubY = 0;   // live lowk-node position (for label + click)
  function onMove(e) {
    const t = e.touches ? e.touches[0] : e;
    pointer.x = t.clientX; pointer.y = t.clientY; pointer.active = true;
    if (!e.touches) canvas.style.cursor = Math.hypot(t.clientX - lastHubX, t.clientY - lastHubY) < 30 ? "pointer" : "default";
  }
  function onLeave() { pointer.active = false; pointer.x = -9999; pointer.y = -9999; }
  window.addEventListener("mousemove", onMove, { passive: true });
  window.addEventListener("touchmove", onMove, { passive: true });
  window.addEventListener("touchstart", onMove, { passive: true });
  window.addEventListener("mouseleave", onLeave);
  window.addEventListener("touchend", onLeave);
  canvas.addEventListener("pointerdown", (e) => {
    if (Math.hypot(e.clientX - lastHubX, e.clientY - lastHubY) < 30) {   // the lowk node → open lowk.in
      window.open("https://lowk.in", "_blank", "noopener"); return;
    }
    if (currentMode === "ticket" && ticketGeo && !stubTorn) {
      const x = e.clientX, y = e.clientY;
      if (x > ticketGeo.perfX - 14 && x < ticketGeo.x0 + ticketGeo.tw + 20 &&
          y > ticketGeo.y0 - 20 && y < ticketGeo.y0 + ticketGeo.th + 20) tearStub();
    }
  });

  // ======================================================================
  //  BUTTON ANCHORS (hairlines join each pill to the lowk node)
  // ======================================================================
  const anchors = [];
  function updateAnchors() {
    anchors.length = 0;
    document.querySelectorAll(".fx").forEach((b) => {
      const r = b.getBoundingClientRect();
      anchors.push({ l: r.left, t: r.top, r: r.right, b: r.bottom });
    });
  }

  // ======================================================================
  //  RENDER LOOP
  // ======================================================================
  const REPEL_R = 112;
  const REPEL_R2 = REPEL_R * REPEL_R;
  const dotSize = () => (DPR >= 2 ? 1.4 : 1.65);

  function frame() {
    ctx.fillStyle = col.ground;
    ctx.fillRect(0, 0, W, H);

    // ambient drifting field (behind everything) — fills the negative space
    ctx.fillStyle = col.ink3;
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < N_AMB; i++) {
      let x = ambX[i] + ambVX[i], y = ambY[i] + ambVY[i];
      if (x < 0) x += W; else if (x > W) x -= W;
      if (y < 0) y += H; else if (y > H) y -= H;
      ambX[i] = x; ambY[i] = y;
      const s = ambS[i] < 0.5 ? 1 : 1.4;
      ctx.fillRect(x, y, s, s);
    }
    ctx.globalAlpha = 1;

    // hub = mean of accent particles (the lowk node — origin of the constellation)
    let axSum = 0, aySum = 0;
    for (let i = 0; i < ACCENT_COUNT; i++) { axSum += px[i]; aySum += py[i]; }
    const hubX = axSum / ACCENT_COUNT, hubY = aySum / ACCENT_COUNT;
    lastHubX = hubX; lastHubY = hubY;

    // constellation hairlines from the node to the nearest edge of each scattered button
    ctx.strokeStyle = col.ink3;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.42;
    ctx.beginPath();
    for (let a = 0; a < anchors.length; a++) {
      const an = anchors[a];
      const nx = hubX < an.l ? an.l : (hubX > an.r ? an.r : hubX);
      const ny = hubY < an.t ? an.t : (hubY > an.b ? an.b : hubY);
      ctx.moveTo(hubX, hubY); ctx.lineTo(nx, ny);
    }
    ctx.stroke();
    // a small node dot where each hairline meets its button
    ctx.fillStyle = col.ink2;
    for (let a = 0; a < anchors.length; a++) {
      const an = anchors[a];
      const nx = hubX < an.l ? an.l : (hubX > an.r ? an.r : hubX);
      const ny = hubY < an.t ? an.t : (hubY > an.b ? an.b : hubY);
      ctx.fillRect(nx - 1.4, ny - 1.4, 2.8, 2.8);
    }
    ctx.globalAlpha = 1;

    // network links near cursor
    if (currentMode === "network" && pointer.active) {
      ctx.strokeStyle = col.accent;
      ctx.lineWidth = 1;
      ctx.beginPath();
      let drawn = 0;
      for (let n = 0; n < NET_NODES && drawn < 120; n++) {
        const dx = netX[n] - pointer.x, dy = netY[n] - pointer.y;
        if (dx * dx + dy * dy < 200 * 200) {
          for (let m = n + 1; m < NET_NODES; m++) {
            const ex = netX[n] - netX[m], ey = netY[n] - netY[m];
            if (ex * ex + ey * ey < 150 * 150) { ctx.moveTo(netX[n], netY[n]); ctx.lineTo(netX[m], netY[m]); drawn++; }
          }
        }
      }
      ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
    }

    const t = performance.now();
    const k = prefersReduced ? 1 : 0.075;
    const damp = 0.82;
    const px0 = pointer.x, py0 = pointer.y, repelOn = pointer.active;
    const ds = dotSize();
    const shimmer = prefersReduced ? 0 : 0.028;

    // Pass A: physics for ALL ink particles + draw shade 0 (brightest — edges)
    ctx.fillStyle = col.ink;
    const sA = ds + 0.35;
    for (let i = ACCENT_COUNT; i < COUNT; i++) {
      let x = px[i], y = py[i];
      let ax = (tx[i] - x) * k, ay = (ty[i] - y) * k;
      if (shimmer) { ax += Math.sin(t * 0.0012 + seed[i]) * shimmer; ay += Math.cos(t * 0.001 + seed[i] * 1.3) * shimmer; }
      if (repelOn) {
        const dx = x - px0, dy = y - py0, d2 = dx * dx + dy * dy;
        if (d2 < REPEL_R2 && d2 > 0.01) { const f = 1 - d2 / REPEL_R2, inv = 1 / Math.sqrt(d2); ax += dx * inv * f * 7.5; ay += dy * inv * f * 7.5; }
      }
      const nvx = (vx[i] + ax) * damp, nvy = (vy[i] + ay) * damp;
      x += nvx; y += nvy; vx[i] = nvx; vy[i] = nvy; px[i] = x; py[i] = y;
      if (shade[i] === 0) ctx.fillRect(x, y, sA, sA);
    }
    // Pass B: shade 1 (mid)
    ctx.fillStyle = col.ink2;
    for (let i = ACCENT_COUNT; i < COUNT; i++) if (shade[i] === 1) ctx.fillRect(px[i], py[i], ds, ds);
    // Pass C: shade 2 (dim interior)
    ctx.fillStyle = col.ink3;
    const sC = Math.max(0.9, ds - 0.2);
    for (let i = ACCENT_COUNT; i < COUNT; i++) if (shade[i] === 2) ctx.fillRect(px[i], py[i], sC, sC);

    // Accent node: soft pulsing glow, then particles on top
    const pulse = prefersReduced ? 1 : (0.5 + 0.5 * Math.sin(t * 0.0024));
    if (!prefersReduced) {
      const glowR = 52 + 16 * pulse;
      const gr = ctx.createRadialGradient(hubX, hubY, 0, hubX, hubY, glowR);
      gr.addColorStop(0, hexA(col.accent, 0.22 * (0.6 + 0.4 * pulse)));
      gr.addColorStop(0.45, hexA(col.accent, 0.07));
      gr.addColorStop(1, hexA(col.accent, 0));
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(hubX, hubY, glowR, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = col.accent;
    const ak = prefersReduced ? 1 : 0.1;
    const as = ds + 0.4 + (prefersReduced ? 0 : 0.35 * pulse);
    for (let i = 0; i < ACCENT_COUNT; i++) {
      let x = px[i], y = py[i];
      let ax = (tx[i] - x) * ak, ay = (ty[i] - y) * ak;
      if (repelOn) {
        const dx = x - px0, dy = y - py0, d2 = dx * dx + dy * dy;
        if (d2 < REPEL_R2 && d2 > 0.01) { const f = 1 - d2 / REPEL_R2, inv = 1 / Math.sqrt(d2); ax += dx * inv * f * 6; ay += dy * inv * f * 6; }
      }
      const nvx = (vx[i] + ax) * damp, nvy = (vy[i] + ay) * damp;
      x += nvx; y += nvy; vx[i] = nvx; vy[i] = nvy; px[i] = x; py[i] = y;
      ctx.fillRect(x, y, as, as);
    }

    // the lowk mark — a label at the node; the node itself is clickable → lowk.in
    ctx.font = '500 11px "Geist Mono", ui-monospace, monospace';
    ctx.textBaseline = "middle";
    ctx.fillStyle = col.accent;
    ctx.fillText("lowk.in", hubX + 15, hubY + 0.5);
    ctx.textBaseline = "alphabetic";

    requestAnimationFrame(frame);
  }

  // ======================================================================
  //  CONTROLS
  // ======================================================================
  document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  window.addEventListener("keydown", (e) => {
    const map = { "1": "discover", "2": "ticket", "3": "network", "4": "organise", "5": "about" };
    if (map[e.key]) setMode(map[e.key]);
    else if (e.key === "6") window.open("https://lowk.in", "_blank", "noopener");
    else if (e.key === "7") window.location.href = "mailto:7tejeshwar@gmail.com";
    else if (e.key.toLowerCase() === "i") document.getElementById("invert").click();
  });
  const invertBtn = document.getElementById("invert");
  invertBtn.addEventListener("click", () => {
    const on = document.body.classList.toggle("invert");
    invertBtn.setAttribute("aria-pressed", String(on));
    readPalette();
  });
  const reduceBtn = document.getElementById("reduce");
  reduceBtn.addEventListener("click", () => {
    const next = reduceBtn.getAttribute("aria-pressed") !== "true";
    reduceBtn.setAttribute("aria-pressed", String(next));
    COUNT = next ? Math.floor(BASE_COUNT * 0.45) : BASE_COUNT;
    buildFormation(currentMode, true);
  });

  let hintHidden = false;
  function hideHint() { if (hintHidden) return; hintHidden = true; const h = document.getElementById("hint"); if (h) h.style.opacity = "0"; }
  setTimeout(hideHint, 6000);

  // ----- Sample lowk ticket: the ticket formation resolves into a real product -----
  const sample = document.getElementById("sample");
  const sampleCards = document.querySelectorAll("#sample .card");
  const tkt = document.getElementById("tkt");
  const tktStub = document.getElementById("tktStub");
  const tktStatus = document.getElementById("tktStatus");
  const tktTear = document.getElementById("tktTear");
  const sampleHint = document.getElementById("sampleHint");
  const SAMPLE_WITH = ["ticket", "discover", "network", "organise"];
  const SAMPLE_HINT = {
    ticket: "a real Nocturne ticket · hover it, then tear the stub",
    discover: "a live slice of lowk Discover",
    network: "lowk Network — meet people at real events",
    organise: "the lowk organiser toolkit",
  };
  function showSample(mode) {
    const has = SAMPLE_WITH.includes(mode);
    sample.classList.toggle("on", has);
    sample.setAttribute("aria-hidden", String(!has));
    sampleCards.forEach((c) => c.classList.toggle("show", c.dataset.for === mode));
    if (mode === "ticket") {
      tkt.classList.remove("torn"); tkt.style.transform = "";
      tktStatus.textContent = "Reserved"; tktTear.textContent = "tear to book ▸";
    }
    if (sampleHint) sampleHint.textContent = SAMPLE_HINT[mode] || "";
  }
  tktStub.addEventListener("click", () => {
    if (tkt.classList.contains("torn")) return;
    tkt.classList.add("torn");
    tktStatus.textContent = "Booked";
    if (sampleHint) sampleHint.textContent = "booked with lowk — see you at Nocturne ✓";
    tearStub();   // echo the tear in the particle field
  });
  if (!prefersReduced) {
    tkt.addEventListener("pointermove", (e) => {
      if (tkt.classList.contains("torn")) return;
      const r = tkt.getBoundingClientRect();
      const rx = (e.clientX - r.left) / r.width - 0.5;
      const ry = (e.clientY - r.top) / r.height - 0.5;
      tkt.style.transform = `translate(-50%,-50%) perspective(1000px) rotateY(${rx * 11}deg) rotateX(${-ry * 11}deg) scale(1.03)`;
    });
    tkt.addEventListener("pointerleave", () => { if (!tkt.classList.contains("torn")) tkt.style.transform = ""; });
  }

  // ======================================================================
  //  BOOT
  // ======================================================================
  readPalette();
  window.addEventListener("resize", resize);
  resize();
  // seed an "assembling" scatter, then morph into the portrait
  for (let i = 0; i < MAX; i++) { px[i] = geo.sil.x + (Math.random() - 0.5) * W; py[i] = geo.sil.y + (Math.random() - 0.5) * H; }
  setMode("about");
  requestAnimationFrame(frame);
})();
