/* =========================================================================
   Tejeshwar Vijayakumar — particle portfolio
   One canvas. One accent. Everything else is quiet.
   Vanilla JS, no build step. Typed arrays, no per-frame allocation.
   ========================================================================= */
(() => {
  "use strict";

  const canvas = document.getElementById("field");
  const ctx = canvas.getContext("2d", { alpha: false });
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- Config -----------------------------------------------------------
  const BASE_COUNT = 12000;          // desktop particle budget
  const ACCENT_COUNT = 360;          // the lowk node (always accent-colored)
  let COUNT = BASE_COUNT;            // active count (reduce toggle halves it)

  // Palette read from CSS variables so invert "just works".
  let col = { ground: "#E8EBEF", ink: "#15181D", accent: "#2230FF", hair: "#C3C9D2" };
  function readPalette() {
    const cs = getComputedStyle(document.body);
    col.ground = cs.getPropertyValue("--ground").trim() || col.ground;
    col.ink = cs.getPropertyValue("--ink").trim() || col.ink;
    col.accent = cs.getPropertyValue("--accent").trim() || col.accent;
    col.hair = cs.getPropertyValue("--hair").trim() || col.hair;
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
    layout();            // recompute formation geometry for new size
    buildFormation(currentMode, true);
    updateAnchors();
  }

  // ---- Particle state (typed arrays, allocated once at max budget) ------
  const MAX = BASE_COUNT;
  const px = new Float32Array(MAX);   // current position
  const py = new Float32Array(MAX);
  const vx = new Float32Array(MAX);   // velocity
  const vy = new Float32Array(MAX);
  const tx = new Float32Array(MAX);   // target position (current formation)
  const ty = new Float32Array(MAX);
  const seed = new Float32Array(MAX); // per-particle phase for idle drift

  // graph/network scratch (reused, no per-frame alloc)
  const NET_NODES = 46;
  const netX = new Float32Array(NET_NODES);
  const netY = new Float32Array(NET_NODES);
  const netCount = new Int16Array(NET_NODES); // particles assigned per node

  for (let i = 0; i < MAX; i++) {
    px[i] = Math.random() * 1200;
    py[i] = Math.random() * 800;
    seed[i] = Math.random() * Math.PI * 2;
  }

  // ---- Geometry anchors computed per-resize -----------------------------
  const geo = {};
  function layout() {
    const isMobile = W <= 720;
    // Silhouette box
    const sh = isMobile ? Math.min(H * 0.52, 420) : Math.min(H * 0.82, 760);
    const sw = sh * 0.62;
    const cx = isMobile ? W * 0.5 : W * 0.46;
    const cy = isMobile ? H * 0.40 : H * 0.52;
    geo.sil = { x: cx, y: cy, w: sw, h: sh };
    // The lowk node lives at the chest of the silhouette
    geo.node = { x: cx, y: cy + sh * 0.20 };
    // Generic formation frame (for ticket / bracket / map)
    const fw = Math.min(W * (isMobile ? 0.84 : 0.56), 760);
    const fh = Math.min(H * (isMobile ? 0.44 : 0.62), 520);
    geo.frame = { x: cx, y: isMobile ? H * 0.40 : H * 0.50, w: fw, h: fh };
  }

  // ======================================================================
  //  SILHOUETTE  — sample a head+shoulders shape from an offscreen canvas.
  //  Attempts /me.png (alpha>threshold). Falls back to a procedural path.
  // ======================================================================
  const silCanvas = document.createElement("canvas");
  const silCtx = silCanvas.getContext("2d", { willReadFrequently: true });
  let silPoints = null;      // Float32Array of normalized [x,y] in 0..1 box
  let silImage = null;       // loaded HTMLImageElement or null

  function drawProceduralSilhouette(c, w, h) {
    // Head + shoulders bust, centered, filling the box.
    c.clearRect(0, 0, w, h);
    c.fillStyle = "#000";
    const cx = w / 2;
    // Head
    const headR = w * 0.205;
    const headCy = h * 0.235;
    c.beginPath();
    c.ellipse(cx, headCy, headR * 0.86, headR, 0, 0, Math.PI * 2);
    c.fill();
    // Neck
    c.beginPath();
    c.moveTo(cx - headR * 0.42, headCy + headR * 0.72);
    c.lineTo(cx + headR * 0.42, headCy + headR * 0.72);
    c.lineTo(cx + headR * 0.5, h * 0.5);
    c.lineTo(cx - headR * 0.5, h * 0.5);
    c.closePath();
    c.fill();
    // Shoulders / torso (rounded trapezoid)
    const topY = h * 0.47;
    const shoulderHalf = w * 0.46;
    c.beginPath();
    c.moveTo(cx - w * 0.12, topY);
    c.quadraticCurveTo(cx - shoulderHalf, topY + h * 0.06, cx - shoulderHalf, h);
    c.lineTo(cx + shoulderHalf, h);
    c.quadraticCurveTo(cx + shoulderHalf, topY + h * 0.06, cx + w * 0.12, topY);
    c.closePath();
    c.fill();
  }

  function sampleSilhouette(img) {
    const SW = 300, SH = 360;
    silCanvas.width = SW; silCanvas.height = SH;
    if (img) {
      // object-fit: contain into box, bottom-aligned
      const ar = img.width / img.height;
      let dw = SW, dh = SW / ar;
      if (dh > SH) { dh = SH; dw = SH * ar; }
      const dx = (SW - dw) / 2, dy = SH - dh;
      silCtx.clearRect(0, 0, SW, SH);
      silCtx.drawImage(img, dx, dy, dw, dh);
    } else {
      drawProceduralSilhouette(silCtx, SW, SH);
    }
    const data = silCtx.getImageData(0, 0, SW, SH).data;
    const pts = [];
    const step = 2; // sampling resolution
    for (let y = 0; y < SH; y += step) {
      for (let x = 0; x < SW; x += step) {
        const a = data[(y * SW + x) * 4 + 3];
        if (a > 110) {
          // jitter a touch so edges aren't gridded
          pts.push((x + (Math.random() - 0.5)) / SW, (y + (Math.random() - 0.5)) / SH);
        }
      }
    }
    silPoints = new Float32Array(pts);
  }

  // Try to load me.png; fall back to procedural immediately so first paint works.
  sampleSilhouette(null);
  (function tryLoadMe() {
    const img = new Image();
    img.onload = () => { silImage = img; sampleSilhouette(img); if (currentMode === "about") buildFormation("about", true); };
    img.onerror = () => {};
    img.src = "./me.png";
  })();

  // ======================================================================
  //  FORMATION TARGET GENERATORS
  //  Each fills tx[],ty[] for i in [0,COUNT). First ACCENT_COUNT particles
  //  are the lowk node and are placed by placeNode().
  // ======================================================================

  // Distribute a point list across a range of particle indices (with repeat).
  function spread(points, start, end, offX, offY, scaleX, scaleY) {
    const n = points.length / 2;
    if (n === 0) return;
    const span = end - start;
    for (let k = 0; k < span; k++) {
      const i = start + k;
      const p = (k % n) * 2;
      // slight jitter on repeats so overlaps feel organic
      const jx = k >= n ? (Math.random() - 0.5) * 3 : 0;
      const jy = k >= n ? (Math.random() - 0.5) * 3 : 0;
      tx[i] = offX + points[p] * scaleX + jx;
      ty[i] = offY + points[p + 1] * scaleY + jy;
    }
  }

  // Place the accent node as a filled "lowk" dot cluster at (nx,ny).
  function placeNode(nx, ny, r) {
    for (let i = 0; i < ACCENT_COUNT; i++) {
      // concentrated disc with a denser core
      const a = Math.random() * Math.PI * 2;
      const rr = Math.pow(Math.random(), 0.65) * r;
      tx[i] = nx + Math.cos(a) * rr;
      ty[i] = ny + Math.sin(a) * rr * 1.08;
    }
  }

  // --- About / silhouette ---
  function formAbout() {
    const s = geo.sil;
    placeNode(geo.node.x, geo.node.y, Math.max(7, s.w * 0.045));
    spread(silPoints, ACCENT_COUNT, COUNT,
      s.x - s.w / 2, s.y - s.h / 2, s.w, s.h);
  }

  // --- Discover: simplified India outline + city pins ---
  // Normalized (0..1) polyline tracing a recognizable India silhouette.
  const INDIA = [
    [0.44,0.02],[0.52,0.04],[0.55,0.10],[0.62,0.10],[0.66,0.15],[0.63,0.19],
    [0.68,0.22],[0.76,0.20],[0.82,0.24],[0.80,0.30],[0.72,0.33],[0.74,0.40],
    [0.80,0.44],[0.86,0.52],[0.82,0.58],[0.76,0.56],[0.72,0.62],[0.66,0.72],
    [0.60,0.82],[0.54,0.92],[0.50,0.99],[0.46,0.92],[0.44,0.82],[0.40,0.74],
    [0.34,0.66],[0.30,0.58],[0.26,0.50],[0.22,0.44],[0.18,0.40],[0.14,0.36],
    [0.10,0.30],[0.14,0.26],[0.20,0.28],[0.24,0.24],[0.22,0.18],[0.28,0.16],
    [0.30,0.10],[0.36,0.12],[0.40,0.07],[0.44,0.02]
  ];
  // City pins (approx normalized positions within the India box)
  const CITIES = [
    [0.40,0.18],[0.30,0.40],[0.56,0.58],[0.44,0.70],[0.66,0.34],[0.50,0.50],[0.38,0.55]
  ];
  let indiaPoly = null; // densified Float32Array
  function densifyIndia() {
    const out = [];
    for (let i = 0; i < INDIA.length - 1; i++) {
      const [x1, y1] = INDIA[i], [x2, y2] = INDIA[i + 1];
      const segs = 26;
      for (let s = 0; s < segs; s++) {
        const t = s / segs;
        out.push(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
      }
    }
    indiaPoly = new Float32Array(out);
  }
  densifyIndia();

  function formDiscover() {
    const f = geo.frame;
    const size = Math.min(f.w, f.h) * 1.02;
    const ox = f.x - size * 0.5, oy = f.y - size * 0.52;
    // accent node = the brightest, "live" pin (centre of the country)
    const pinScaleBase = Math.max(6, size * 0.03);
    placeNode(ox + CITIES[5][0] * size, oy + CITIES[5][1] * size, pinScaleBase);
    // most particles trace the outline; a slice fills the pins
    const pinShare = Math.floor((COUNT - ACCENT_COUNT) * 0.14);
    const outlineEnd = COUNT - pinShare;
    spread(indiaPoly, ACCENT_COUNT, outlineEnd, ox, oy, size, size);
    // pins as small discs
    const per = Math.max(1, Math.floor(pinShare / CITIES.length));
    let idx = outlineEnd;
    for (let c = 0; c < CITIES.length && idx < COUNT; c++) {
      const cxp = ox + CITIES[c][0] * size, cyp = oy + CITIES[c][1] * size;
      for (let k = 0; k < per && idx < COUNT; k++, idx++) {
        const a = Math.random() * Math.PI * 2, rr = Math.pow(Math.random(), 0.5) * pinScaleBase * 0.8;
        tx[idx] = cxp + Math.cos(a) * rr;
        ty[idx] = cyp + Math.sin(a) * rr;
      }
    }
    while (idx < COUNT) { tx[idx] = ox + CITIES[0][0] * size; ty[idx] = oy + CITIES[0][1] * size; idx++; }
  }

  // --- Ticket: rounded rect with a perforation + tearable stub ---
  let ticketGeo = null;
  let stubTorn = false;
  function formTicket() {
    const f = geo.frame;
    const tw = Math.min(f.w * 0.92, 560), th = Math.min(tw * 0.42, f.h * 0.78);
    const x0 = f.x - tw / 2, y0 = f.y - th / 2;
    const perfX = x0 + tw * 0.70; // perforation line
    ticketGeo = { x0, y0, tw, th, perfX };
    // accent node = a small "seat" dot on the main body
    placeNode(x0 + tw * 0.16, y0 + th * 0.30, Math.max(6, th * 0.09));

    // Build outline points of the ticket (body + stub), plus inner text lines.
    const pts = [];
    const r = Math.min(18, th * 0.14);
    function edge(x1, y1, x2, y2, n) {
      for (let s = 0; s < n; s++) { const t = s / n; pts.push(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t); }
    }
    // outer rectangle (sampled as 4 edges)
    edge(x0 + r, y0, x0 + tw - r, y0, 120);
    edge(x0 + tw, y0 + r, x0 + tw, y0 + th - r, 60);
    edge(x0 + tw - r, y0 + th, x0 + r, y0 + th, 120);
    edge(x0, y0 + th - r, x0, y0 + r, 60);
    // perforation (dashed vertical)
    for (let s = 0; s < 26; s++) {
      if (s % 2 === 0) continue;
      const yy = y0 + (th * s / 26);
      pts.push(perfX, yy);
    }
    // a couple of "detail" lines on the body (like printed info)
    edge(x0 + tw * 0.08, y0 + th * 0.58, x0 + tw * 0.56, y0 + th * 0.58, 50);
    edge(x0 + tw * 0.08, y0 + th * 0.74, x0 + tw * 0.40, y0 + th * 0.74, 34);
    const outline = new Float32Array(pts);

    // Fill: 70% trace outline+details, 30% fill stub face lightly
    const traceEnd = ACCENT_COUNT + Math.floor((COUNT - ACCENT_COUNT) * 0.74);
    spreadRaw(outline, ACCENT_COUNT, traceEnd);
    // stub face fill (right of perforation)
    for (let i = traceEnd; i < COUNT; i++) {
      tx[i] = perfX + Math.random() * (x0 + tw - perfX) * 0.96 + (tw * 0.01);
      ty[i] = y0 + Math.random() * th;
    }
    ticketGeo.stubStart = traceEnd; // particles that belong to the stub face
  }
  // spread for already-pixel-space point arrays
  function spreadRaw(points, start, end) {
    const n = points.length / 2;
    if (n === 0) return;
    for (let k = 0, i = start; i < end; i++, k++) {
      const p = (k % n) * 2;
      const j = k >= n ? (Math.random() - 0.5) * 2.4 : 0;
      tx[i] = points[p] + j;
      ty[i] = points[p + 1] + j;
    }
  }

  function tearStub() {
    if (!ticketGeo || stubTorn) return;
    stubTorn = true;
    // fling the stub-face particles up and to the right
    for (let i = ticketGeo.stubStart; i < COUNT; i++) {
      tx[i] += (ticketGeo.tw * 0.4) + Math.random() * 120;
      ty[i] -= 60 + Math.random() * 160;
      vx[i] += 2 + Math.random() * 3;
      vy[i] -= 2 + Math.random() * 3;
    }
    setCaption("Ticket", "Booked. Your stub tears off — that's your entry to the event.");
  }

  // --- Network: scattered nodes, links drawn live near the cursor ---
  function formNetwork() {
    const f = geo.frame;
    const ox = f.x - f.w / 2, oy = f.y - f.h / 2;
    placeNode(f.x, f.y, Math.max(6, f.h * 0.05));
    // lay out NET_NODES on a loose organic grid
    for (let n = 0; n < NET_NODES; n++) {
      const gx = (n % 8) / 7, gy = Math.floor(n / 8) / 5;
      netX[n] = ox + (gx * 0.86 + 0.07 + (Math.random() - 0.5) * 0.08) * f.w;
      netY[n] = oy + (gy * 0.86 + 0.07 + (Math.random() - 0.5) * 0.08) * f.h;
      netCount[n] = 0;
    }
    // assign each particle to a node, cluster tightly around it
    const span = COUNT - ACCENT_COUNT;
    for (let k = 0; k < span; k++) {
      const i = ACCENT_COUNT + k;
      const n = k % NET_NODES;
      const a = Math.random() * Math.PI * 2;
      const rr = Math.pow(Math.random(), 0.7) * Math.max(5, f.h * 0.028);
      tx[i] = netX[n] + Math.cos(a) * rr;
      ty[i] = netY[n] + Math.sin(a) * rr;
    }
  }

  // --- Organise: tournament bracket ---
  let bracketLines = null;
  function formOrganise() {
    const f = geo.frame;
    const ox = f.x - f.w / 2, oy = f.y - f.h / 2;
    const cols = 4;               // 8 -> 4 -> 2 -> 1 (champion)
    const colW = f.w / cols;
    const pts = [];
    const lines = [];
    // Build bracket from left (8 slots) collapsing to the right.
    let slots = 8;
    for (let c = 0; c < cols; c++) {
      const x = ox + colW * c + colW * 0.14;
      const nextX = ox + colW * (c + 1) + colW * 0.14;
      const gap = f.h / slots;
      for (let s = 0; s < slots; s++) {
        const y = oy + gap * (s + 0.5);
        // horizontal match line
        const hx2 = x + colW * 0.56;
        for (let t = 0; t < 40; t++) { const tt = t / 40; pts.push(x + (hx2 - x) * tt, y); }
        // connectors: join pairs into the next round
        if (c < cols - 1 && s % 2 === 0) {
          const yPair = oy + gap * (s + 1.5);
          for (let t = 0; t < 24; t++) { const tt = t / 24; pts.push(hx2, y + (yPair - y) * tt); }
          const midY = (y + yPair) / 2;
          for (let t = 0; t < 20; t++) { const tt = t / 20; pts.push(hx2 + (nextX - hx2) * 0.0 + (colW * 0.44) * tt, midY); }
        }
      }
      slots = Math.max(1, slots / 2);
    }
    bracketLines = lines;
    // accent node = the champion slot (far right)
    const champX = ox + colW * (cols - 1) + colW * 0.70;
    const champY = oy + f.h * 0.5;
    placeNode(champX, champY, Math.max(6, f.h * 0.05));
    spreadRaw(new Float32Array(pts), ACCENT_COUNT, COUNT);
  }

  // ======================================================================
  //  MODE SWITCHING
  // ======================================================================
  let currentMode = "about";
  const CAPTIONS = {
    about:    ["About", "Tejeshwar Vijayakumar — Tej, 18. Solo founder of lowk.in. I build calm software for real-world gatherings."],
    discover: ["Discover", "Events across India — tournaments, MUNs, college fests and grassroots gatherings. lowk lights up what's happening near you."],
    ticket:   ["Ticket", "Tap the stub to tear it off. lowk handles discovery and ticketing in one move."],
    network:  ["Network", "Move through the field — people connect. lowk turns events into real-world networks. First paying client: Revolution Clash."],
    organise: ["Organise", "Run the whole bracket. lowk gives organisers the tools to host tournaments and fests end to end."],
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

    // Park any particles beyond COUNT off-target (they aren't drawn).
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
    // button active state
    document.querySelectorAll(".pill[data-mode]").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === mode);
    });
    hideHint();
  }

  // ======================================================================
  //  POINTER
  // ======================================================================
  const pointer = { x: -9999, y: -9999, active: false };
  function onMove(e) {
    const t = e.touches ? e.touches[0] : e;
    pointer.x = t.clientX; pointer.y = t.clientY; pointer.active = true;
  }
  function onLeave() { pointer.active = false; pointer.x = -9999; pointer.y = -9999; }
  window.addEventListener("mousemove", onMove, { passive: true });
  window.addEventListener("touchmove", onMove, { passive: true });
  window.addEventListener("touchstart", onMove, { passive: true });
  window.addEventListener("mouseleave", onLeave);
  window.addEventListener("touchend", onLeave);

  // Click to tear the ticket stub
  canvas.addEventListener("pointerdown", (e) => {
    if (currentMode === "ticket" && ticketGeo && !stubTorn) {
      const x = e.clientX, y = e.clientY;
      if (x > ticketGeo.perfX - 14 && x < ticketGeo.x0 + ticketGeo.tw + 20 &&
          y > ticketGeo.y0 - 20 && y < ticketGeo.y0 + ticketGeo.th + 20) {
        tearStub();
      }
    }
  });

  // ======================================================================
  //  BUTTON ANCHORS  (for the hairlines joining each pill to the lowk node)
  // ======================================================================
  const anchors = [];
  function updateAnchors() {
    anchors.length = 0;
    document.querySelectorAll(".pill").forEach((b) => {
      const r = b.getBoundingClientRect();
      // anchor on the inner edge of the pill (toward the silhouette)
      const x = W <= 720 ? r.left + r.width / 2 : r.left;
      const y = W <= 720 ? r.top : r.top + r.height / 2;
      anchors.push({ x, y });
    });
  }

  // ======================================================================
  //  RENDER LOOP
  // ======================================================================
  const REPEL_R = 108;
  const REPEL_R2 = REPEL_R * REPEL_R;
  const dotSize = () => (DPR >= 2 ? 1.35 : 1.6);

  function frame() {
    // ground
    ctx.fillStyle = col.ground;
    ctx.fillRect(0, 0, W, H);

    const node = geo.node;
    const nodeX = (currentMode === "about") ? node.x
                : (tx[0] || node.x); // accent cluster centre approximation
    // use the mean of accent particles as the node point for hairlines
    let axSum = 0, aySum = 0;
    for (let i = 0; i < ACCENT_COUNT; i++) { axSum += px[i]; aySum += py[i]; }
    const hubX = axSum / ACCENT_COUNT, hubY = aySum / ACCENT_COUNT;

    // --- hairlines from hub to each button anchor ---
    ctx.strokeStyle = col.hair;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    for (let a = 0; a < anchors.length; a++) {
      ctx.moveTo(hubX, hubY);
      ctx.lineTo(anchors[a].x, anchors[a].y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // --- network links (only in network mode, near the cursor) ---
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
            if (ex * ex + ey * ey < 150 * 150) {
              ctx.moveTo(netX[n], netY[n]);
              ctx.lineTo(netX[m], netY[m]);
              drawn++;
            }
          }
        }
      }
      ctx.globalAlpha = 0.55;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // --- physics + draw: ink particles ---
    const k = prefersReduced ? 1 : 0.075;    // spring stiffness
    const damp = 0.82;
    const px0 = pointer.x, py0 = pointer.y, repelOn = pointer.active;
    const ds = dotSize();

    ctx.fillStyle = col.ink;
    for (let i = ACCENT_COUNT; i < COUNT; i++) {
      let x = px[i], y = py[i];
      let ax = (tx[i] - x) * k;
      let ay = (ty[i] - y) * k;
      if (repelOn) {
        const dx = x - px0, dy = y - py0;
        const d2 = dx * dx + dy * dy;
        if (d2 < REPEL_R2 && d2 > 0.01) {
          const f = (1 - d2 / REPEL_R2);
          const inv = 1 / Math.sqrt(d2);
          ax += dx * inv * f * 7.5;
          ay += dy * inv * f * 7.5;
        }
      }
      let nvx = (vx[i] + ax) * damp;
      let nvy = (vy[i] + ay) * damp;
      x += nvx; y += nvy;
      vx[i] = nvx; vy[i] = nvy;
      px[i] = x; py[i] = y;
      ctx.fillRect(x, y, ds, ds);
    }

    // --- physics + draw: accent node particles (drawn on top) ---
    ctx.fillStyle = col.accent;
    const ak = prefersReduced ? 1 : 0.10;
    for (let i = 0; i < ACCENT_COUNT; i++) {
      let x = px[i], y = py[i];
      let ax = (tx[i] - x) * ak;
      let ay = (ty[i] - y) * ak;
      if (repelOn) {
        const dx = x - px0, dy = y - py0;
        const d2 = dx * dx + dy * dy;
        if (d2 < REPEL_R2 && d2 > 0.01) {
          const f = (1 - d2 / REPEL_R2);
          const inv = 1 / Math.sqrt(d2);
          ax += dx * inv * f * 6;
          ay += dy * inv * f * 6;
        }
      }
      let nvx = (vx[i] + ax) * damp;
      let nvy = (vy[i] + ay) * damp;
      x += nvx; y += nvy;
      vx[i] = nvx; vy[i] = nvy;
      px[i] = x; py[i] = y;
      ctx.fillRect(x, y, ds + 0.4, ds + 0.4);
    }

    requestAnimationFrame(frame);
  }

  // ======================================================================
  //  CONTROLS
  // ======================================================================
  document.querySelectorAll(".pill[data-mode]").forEach((b) => {
    b.addEventListener("click", () => setMode(b.dataset.mode));
  });

  // keyboard 1-7
  window.addEventListener("keydown", (e) => {
    const map = { "1": "discover", "2": "ticket", "3": "network", "4": "organise", "5": "about" };
    if (map[e.key]) { setMode(map[e.key]); }
    else if (e.key === "6") { window.open("https://lowk.in", "_blank", "noopener"); }
    else if (e.key === "7") { window.location.href = "mailto:7tejeshwar@gmail.com"; }
    else if (e.key.toLowerCase() === "i") { document.getElementById("invert").click(); }
  });

  // invert palette
  const invertBtn = document.getElementById("invert");
  invertBtn.addEventListener("click", () => {
    const on = document.body.classList.toggle("invert");
    invertBtn.setAttribute("aria-pressed", String(on));
    readPalette();
  });

  // reduce particles
  const reduceBtn = document.getElementById("reduce");
  reduceBtn.addEventListener("click", () => {
    const on = reduceBtn.getAttribute("aria-pressed") === "true";
    const next = !on;
    reduceBtn.setAttribute("aria-pressed", String(next));
    COUNT = next ? Math.floor(BASE_COUNT * 0.45) : BASE_COUNT;
    buildFormation(currentMode, true);
  });

  let hintHidden = false;
  function hideHint() {
    if (hintHidden) return; hintHidden = true;
    const h = document.getElementById("hint");
    if (h) h.style.opacity = "0";
  }
  setTimeout(hideHint, 6000);

  // ======================================================================
  //  BOOT
  // ======================================================================
  readPalette();
  window.addEventListener("resize", resize);
  resize();
  setMode("about");
  // seed initial positions from a scatter so the first morph reads as "assembling"
  for (let i = 0; i < MAX; i++) {
    px[i] = geo.sil.x + (Math.random() - 0.5) * W;
    py[i] = geo.sil.y + (Math.random() - 0.5) * H;
  }
  requestAnimationFrame(frame);
})();
