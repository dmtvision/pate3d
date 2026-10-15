/* ==========================================================================
   Pâte3D - application (scène, navigation, outils, placement, export)
   Rendu à la demande ; gestes traités une fois par image ; résolution adaptative.
   ========================================================================== */
(function () {
  'use strict';

  const { Clay } = window.ClayEngine;
  const IO = window.ClayIO;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const body = document.body;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const TAU = Math.PI * 2;
  const nearestAngle = (cur, target) => target + TAU * Math.round((cur - target) / TAU);

  /* état partagé (déclaré tôt) */
  let tool = 'add', stroke = null, placement = null;
  let WL = 100, WH = 50;                       // plateau (mm) et sa moitié, lus dans le moteur
  const syncWorld = () => { const g = ClayEngine.grid(); WL = g.L; WH = g.HALF; };
  const gridSizeFor = (lw, res) => clamp(Math.round(lw / (100 / (res - 1))) + 1, 40, 160);

  /* ---- options générales (mémorisées sur l'ordinateur : retrouvées à chaque ouverture) ---- */
  const lowEnd = (navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2);
  const OPT_V = 2;                                  // version des réglages : la 2 passe au plateau de 15 cm et à la résolution fine
  const opts = {
    res: lowEnd ? 56 : 112, world: 150, display: lowEnd ? 'eco' : 'norm', penMode: 'force', exportQ: 'dense',
    ui: 1, side: 'left', sideOpen: true, sideOpenP: false, navOpen: true, stampSeries: false,
    sharp: 1, perf: lowEnd ? 'low' : 'custom', sym: 'x', stamp: 'star', boolPreview: !lowEnd, v: OPT_V
  };
  try {
    const saved = JSON.parse(localStorage.getItem('pate3d.opts') || '{}');
    if ('eco' in saved && !('display' in saved)) saved.display = saved.eco ? 'eco' : 'norm';
    if ('pen' in saved && !('penMode' in saved)) saved.penMode = saved.pen ? 'force' : 'off';
    if ((+saved.v || 0) < OPT_V) { saved.world = 150; if (!lowEnd) { saved.res = 112; saved.perf = 'custom'; } }   // nouveaux réglages par défaut, une seule fois
    Object.assign(opts, saved);
  } catch (e) { /* ignore */ }
  opts.v = OPT_V;
  opts.boolPreview = !!opts.boolPreview;
  delete opts.pen;
  if (['off', 'force', 'size', 'both'].indexOf(opts.penMode) < 0) opts.penMode = 'force';
  if (![40, 56, 80, 112].includes(+opts.res)) opts.res = lowEnd ? 56 : 112;
  opts.res = +opts.res;
  opts.world = Number.isFinite(+opts.world) && +opts.world >= 60 && +opts.world <= 400 ? +opts.world : 150;
  if (![0.6, 1, 1.4].includes(+opts.sharp)) opts.sharp = 1;
  opts.sharp = +opts.sharp;
  if (['off', 'x', 'xz', 'rot6'].indexOf(opts.sym) < 0) opts.sym = 'x';
  const saveOpts = () => { try { localStorage.setItem('pate3d.opts', JSON.stringify(opts)); } catch (e) { /* ignore */ } };
  saveOpts();

  /* ------------------------------------------------------------------ Rendu */
  const canvas = $('#gl');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) < 1.75 && opts.perf !== 'min', alpha: true, powerPreference: 'low-power' });
  } catch (err) {
    $('#nogl').hidden = false;
    return;
  }
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  canvas.addEventListener('webglcontextrestored', () => { clay.markAll(); invalidate(); });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 5, 1200);

  /* ---- textures procédurales (aucun fichier à charger) ---- */
  /** « Matcap » argile : l'éclairage est cuit dans l'image, donc 1 seule lecture de texture par pixel (très léger) */
  function makeMatcapCanvas() {
    const S = 256, cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(S, S), d = img.data;
    const nrm = (x, y, z) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
    const L1 = nrm(-0.5, 0.62, 0.62), L2 = nrm(0.78, -0.25, 0.45), H1 = nrm(L1[0], L1[1], L1[2] + 1);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        let nx = ((x + 0.5) / S) * 2 - 1, ny = 1 - ((y + 0.5) / S) * 2;
        const r2 = nx * nx + ny * ny;
        let nz = 0;
        if (r2 < 1) nz = Math.sqrt(1 - r2); else { const l = Math.sqrt(r2); nx /= l; ny /= l; }
        const key = Math.max(0, (nx * L1[0] + ny * L1[1] + nz * L1[2] + 0.3) / 1.3);
        const fill = Math.max(0, nx * L2[0] + ny * L2[1] + nz * L2[2]);
        const sky = 0.5 + 0.5 * ny;
        const rim = Math.pow(1 - nz, 3);
        const spec = Math.pow(Math.max(0, nx * H1[0] + ny * H1[1] + nz * H1[2]), 26) * 0.22;
        let v = 0.52 + 0.12 * sky + 0.38 * key * key + 0.08 * fill + 0.08 * rim + spec;
        v = Math.min(1, v);
        const o = (y * S + x) * 4, sh = 1 - v;
        d[o] = Math.min(255, v * (1 + 0.06 * sh) * 255);
        d[o + 1] = v * 255;
        d[o + 2] = v * (1 - 0.12 * sh) * 255;
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }
  const matcapTex = new THREE.CanvasTexture(makeMatcapCanvas());
  matcapTex.generateMipmaps = false;
  matcapTex.minFilter = THREE.LinearFilter;

  /** Plateau : grille 1 cm, lignes fortes tous les 5 cm, zone de travail encadrée (redessiné si la taille change) */
  const plateCv = document.createElement('canvas');
  plateCv.width = plateCv.height = 1024;
  function drawPlate() {
    const S = 1024, ctx = plateCv.getContext('2d'), tot = WL + 10, mm = S / tot;
    const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.75);
    g.addColorStop(0, '#fbeccb'); g.addColorStop(1, '#f0d9a5');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    const u = (x) => (x + tot / 2) * mm;
    const kmax = Math.floor(WH / 10 + 1e-6);
    for (let k = -kmax; k <= kmax; k++) {
      const major = k % 5 === 0;
      ctx.strokeStyle = major ? '#c9a15f' : '#e3c892';
      ctx.lineWidth = major ? 3.2 : 1.6;
      ctx.beginPath();
      ctx.moveTo(u(k * 10), u(-WH)); ctx.lineTo(u(k * 10), u(WH));
      ctx.moveTo(u(-WH), u(k * 10)); ctx.lineTo(u(WH), u(k * 10));
      ctx.stroke();
    }
    ctx.strokeStyle = '#b98f4c'; ctx.lineWidth = 5;
    ctx.strokeRect(u(-WH), u(-WH), WL * mm, WL * mm);
  }
  const plateTex = new THREE.CanvasTexture(plateCv);
  plateTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1);

  /* ---- éclairage (uniquement pour le mode « Réaliste ») ---- */
  const lights = new THREE.Group();
  lights.add(new THREE.HemisphereLight(0xfff6e6, 0xb89a78, 0.45));
  const sun = new THREE.DirectionalLight(0xffffff, 0.72);
  const fill = new THREE.DirectionalLight(0xbcd7ff, 0.25);
  lights.add(sun, fill);
  scene.add(lights);

  /* ---- plateau d'impression ---- */
  const sideA = new THREE.MeshBasicMaterial({ color: 0xe2c48a }), sideB = new THREE.MeshBasicMaterial({ color: 0xd6b577 });
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(110, 5, 110),
    [sideA, sideA, new THREE.MeshBasicMaterial({ map: plateTex }), sideB, sideB, sideB]
  );
  plate.position.y = -2.55;
  scene.add(plate);

  /* ---- sculpture ---- */
  const clay = new Clay(THREE);
  scene.add(clay.group);
  const clayMatcap = new THREE.MeshMatcapMaterial({ color: 0xe9936b, matcap: matcapTex });
  const clayReal = new THREE.MeshStandardMaterial({ color: 0xe9936b, roughness: 0.72, metalness: 0 });

  /* ---- ombre douce sous la sculpture (empreinte floutée de la base) ---- */
  const SH = 64;
  const shadowCv = document.createElement('canvas');
  shadowCv.width = shadowCv.height = SH;
  const shadowCtx = shadowCv.getContext('2d');
  const shadowCv2 = document.createElement('canvas');
  shadowCv2.width = shadowCv2.height = SH;
  const shadowCtx2 = shadowCv2.getContext('2d');
  const shadowTex = new THREE.CanvasTexture(shadowCv2);
  const shadowMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.9 })
  );
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.y = 0.08;
  shadowMesh.renderOrder = 1;
  scene.add(shadowMesh);
  let shadowT = 0, shadowDirty = false;
  function updateShadow() {
    const g = ClayEngine.grid(), n = g.N, f = clay.f, base = g.FK * n;
    const img = shadowCtx.createImageData(SH, SH);
    for (let ck = 0; ck < SH; ck++) {
      const k = Math.round(ck * (n - 1) / (SH - 1));
      for (let ci = 0; ci < SH; ci++) {
        const i = Math.round(ci * (n - 1) / (SH - 1));
        const o = (ck * SH + ci) * 4;
        img.data[o] = 70; img.data[o + 1] = 40; img.data[o + 2] = 12;
        img.data[o + 3] = Math.min(255, f[i + base + k * n * n] * 150);
      }
    }
    shadowCtx.putImageData(img, 0, 0);
    shadowCtx2.clearRect(0, 0, SH, SH);
    try { shadowCtx2.filter = 'blur(1.6px)'; } catch (e) { /* ignore */ }
    shadowCtx2.drawImage(shadowCv, 0.8, 0.8);
    shadowTex.needsUpdate = true;
  }

  /* ---- plans de symétrie ---- */
  const mirrorMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false });
  const mirrorPlane = new THREE.Mesh(new THREE.PlaneGeometry(100, 60), mirrorMat);
  mirrorPlane.rotation.y = Math.PI / 2;
  mirrorPlane.visible = false;
  scene.add(mirrorPlane);
  const mirrorPlane2 = new THREE.Mesh(new THREE.PlaneGeometry(100, 60), mirrorMat);
  mirrorPlane2.visible = false;
  scene.add(mirrorPlane2);

  /** (Re)construit tout ce qui dépend de la taille du plateau */
  function buildWorld() {
    plate.geometry.dispose();
    plate.geometry = new THREE.BoxGeometry(WL + 10, 5, WL + 10);
    drawPlate(); plateTex.needsUpdate = true;
    shadowMesh.geometry.dispose();
    shadowMesh.geometry = new THREE.PlaneGeometry(WL, WL);
    for (const m of [mirrorPlane, mirrorPlane2]) {
      m.geometry.dispose();
      m.geometry = new THREE.PlaneGeometry(WL, WL * 0.6);
      m.position.y = WL * 0.3;
    }
    camera.far = 1200 * WL / 100;
    camera.updateProjectionMatrix();
    shadowDirty = true;
  }

  /* ---- curseur de pinceau : bille translucide + anneau posé sur la surface (orienté selon sa normale) ---- */
  const cursorMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.2, depthWrite: false });
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide });
  const sphereGeo = new THREE.SphereGeometry(1, 20, 14), ringGeo = new THREE.RingGeometry(0.86, 1, 48);
  function makeCursor() {
    const g = new THREE.Group();
    const s = new THREE.Mesh(sphereGeo, cursorMat); s.renderOrder = 5;
    const r = new THREE.Mesh(ringGeo, ringMat); r.renderOrder = 6;
    g.add(s, r);
    g.visible = false;
    scene.add(g);
    return g;
  }
  const cursors = [];
  for (let i = 0; i < 6; i++) cursors.push(makeCursor());

  /* ------------------------------------------------------------------ Caméra */
  const defaultView = () => ({ az: 0, el: 0.38, dist: 235 * (WL + 10) / 110, tx: 0, ty: 20, tz: 0 });
  const view = defaultView();
  const clampEl = (v) => clamp(v, 0.03, 1.5);
  const DIST_MIN = 50;
  const distMax = () => 480 * WL / 100;
  const clampDist = (v) => clamp(v, DIST_MIN, distMax());

  function applyCamera() {
    const ce = Math.cos(view.el);
    camera.position.set(
      view.tx + view.dist * ce * Math.sin(view.az),
      view.ty + view.dist * Math.sin(view.el),
      view.tz + view.dist * ce * Math.cos(view.az)
    );
    camera.lookAt(view.tx, view.ty, view.tz);
    sun.position.set(camera.position.x + 110, camera.position.y + 110, camera.position.z + 30);
    fill.position.set(camera.position.x - 90, camera.position.y + 20, camera.position.z + 60);
  }
  function setNow(p) { Object.assign(view, p); invalidate(); }
  function goTo(p) {
    const q = Object.assign({}, p);
    if ('el' in q) q.el = clampEl(q.el);
    if ('dist' in q) q.dist = clampDist(q.dist);
    setNow(q);
  }

  /** Recentre la sculpture au milieu de la zone libre (entre les panneaux) */
  const freeC = { x: 0, y: 0 };
  function updateViewOffset() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const rc = canvas.getBoundingClientRect();
    let l = 0, t = 0, r = w, b = h;
    const bar = $('#top-bar').getBoundingClientRect();
    t = Math.max(t, bar.bottom - rc.top);
    const portrait = body.classList.contains('portrait');
    for (const el of [$('#tools'), $('#side'), $('#place')]) {
      if (!el || el.offsetParent === null) continue;
      const q = el.getBoundingClientRect();
      if (portrait) { if (q.top - rc.top > h * 0.4) b = Math.min(b, q.top - rc.top); continue; }   // panneaux du bas
      if (q.right - rc.left < w / 2) l = Math.max(l, q.right - rc.left);
      else if (q.left - rc.left > w / 2) r = Math.min(r, q.left - rc.left);
    }
    for (const sbar of [$('#stamp-bar'), $('#brush-bar')]) {   // barres du bas (tampons, pinceaux) : la sculpture se recentre au-dessus
      if (sbar && !sbar.hidden && sbar.offsetParent !== null) {
        const sq = sbar.getBoundingClientRect();
        if (sq.top - rc.top > h * 0.4) b = Math.min(b, sq.top - rc.top);
      }
    }
    const dx = (l + r) / 2 - w / 2, dy = (t + b) / 2 - h / 2;
    freeC.x = (l + r) / 2; freeC.y = (t + b) / 2;
    camera.setViewOffset(w, h, -dx, -dy, w, h);
    camera.updateProjectionMatrix();
  }

  /* ------------------------------------------------------------------ Taille de l'interface (rem) */
  const isPortrait = () => window.innerWidth / window.innerHeight < 1.1;
  function computeFs() {
    const w = window.innerWidth, h = window.innerHeight, portrait = isPortrait();
    let base = portrait ? Math.min(h / 46, w / 30) : Math.min(h / 38, w / 54);
    base = clamp(base, 10, 24);
    const fs = clamp(base * opts.ui, 9, 30);
    document.documentElement.style.fontSize = fs.toFixed(2) + 'px';
    body.classList.toggle('portrait', portrait);
  }

  /* ------------------------------------------------------------------ Boucle (rendu à la demande) */
  let raf = 0;
  function invalidate() { if (!raf) raf = requestAnimationFrame(frame); }

  // résolution adaptative : si l'appareil rame, on baisse la netteté, puis on la remonte quand ça va mieux
  const PR_MIN = 0.75;
  let prBase = 1, pr = 1, ema = 16, goodFrames = 0, lastNow = 0, lastPr = 0;
  function basePixelRatio() {
    const dpr = Math.max(window.devicePixelRatio || 1, 1), cap = opts.display === 'eco' ? 1 : 1.5;
    return clamp(Math.min(dpr, cap) * (opts.sharp || 1), 0.5, dpr * 1.5);
  }
  function setPixelRatio(v, now) {
    pr = v; lastPr = now || 0; ema = 16; goodFrames = 0;
    renderer.setPixelRatio(pr);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  }
  function adaptResolution(dt, now) {
    ema = ema * 0.88 + dt * 0.12;
    if (now - lastPr < 800) return;
    if (ema > 30 && pr > PR_MIN) setPixelRatio(Math.max(PR_MIN, pr * 0.85), now);
    else if (ema < 20 && pr < prBase) { if (++goodFrames > 40) setPixelRatio(Math.min(prBase, pr * 1.12), now); }
    else goodFrames = 0;
  }

  function resize() {
    const w = $('#viewport').clientWidth, h = $('#viewport').clientHeight;
    prBase = basePixelRatio();
    pr = Math.min(pr, prBase);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    updateViewOffset();
    camera.updateProjectionMatrix();
    sizeGizmo();
    invalidate();
  }

  let gizmoKey = '';
  function frame(now) {
    raf = 0;
    if (lastNow && now - lastNow < 120) adaptResolution(now - lastNow, now);
    lastNow = now;
    processInput();
    applyCamera();
    if (clay.rebuild()) shadowDirty = true;
    if (shadowDirty) {
      if (opts.display === 'eco') shadowDirty = false;
      else if (now - shadowT > 120) { shadowT = now; shadowDirty = false; updateShadow(); }
      else setTimeout(invalidate, 130);
    }
    for (const cu of cursors) if (cu.visible && !cu.userData.n) cu.children[1].quaternion.copy(camera.quaternion);
    renderer.render(scene, camera);
    const key = view.az.toFixed(4) + view.el.toFixed(4) + gizmo.width;
    if (key !== gizmoKey) { gizmoKey = key; drawGizmo(); }
    syncZoom();
    if (!stroke && !pending()) lastNow = 0;
  }

  /* ------------------------------------------------------------------ État */
  /* symétries : liste de transformations linéaires (matrices 3x3) appliquées à chaque geste */
  const MI = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const rotY = (deg) => { const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
  const SYMS = {
    off: { label: 'aucune', xf: [MI], planes: [] },
    x: { label: 'gauche-droite', xf: [MI, [-1, 0, 0, 0, 1, 0, 0, 0, 1]], planes: [0] },
    xz: { label: '4 miroirs', xf: [MI, [-1, 0, 0, 0, 1, 0, 0, 0, 1], [1, 0, 0, 0, 1, 0, 0, 0, -1], [-1, 0, 0, 0, 1, 0, 0, 0, -1]], planes: [0, 1] },
    rot6: { label: 'étoile ×6', xf: [0, 60, 120, 180, 240, 300].map(rotY), planes: [] }
  };
  let sym = 'x'; // miroir gauche-droite par défaut
  const xfs = () => SYMS[sym].xf;
  const ap = (M, p) => [M[0] * p[0] + M[1] * p[1] + M[2] * p[2], M[3] * p[0] + M[4] * p[1] + M[5] * p[2], M[6] * p[0] + M[7] * p[1] + M[8] * p[2]];
  function applyM(arr, M) {
    const o = new Float32Array(arr.length);
    for (let i = 0; i < arr.length; i += 3) {
      o[i] = M[0] * arr[i] + M[1] * arr[i + 1] + M[2] * arr[i + 2];
      o[i + 1] = M[3] * arr[i] + M[4] * arr[i + 1] + M[5] * arr[i + 2];
      o[i + 2] = M[6] * arr[i] + M[7] * arr[i + 1] + M[8] * arr[i + 2];
    }
    return o;
  }

  /* taille (rayon, mm) et force (0-1) propres à chaque outil */
  const toolSet = {};
  ['add', 'remove', 'pull', 'stretch', 'flatten', 'smooth', 'stamp', 'layer', 'inflate', 'pinch', 'nudge', 'groove', 'fill', 'paint'].forEach((t) => {
    toolSet[t] = { size: ['stretch', 'stamp', 'layer', 'nudge'].includes(t) ? 8 : 7, force: 0.5 };
  });
  try {
    const sv = JSON.parse(localStorage.getItem('pate3d.tools') || '{}');
    Object.keys(toolSet).forEach((t) => { if (sv[t]) Object.assign(toolSet[t], sv[t]); });
  } catch (e) { /* ignore */ }
  const saveTools = () => { try { localStorage.setItem('pate3d.tools', JSON.stringify(toolSet)); } catch (e) { /* ignore */ } };
  const setOf = (t) => toolSet[t] || toolSet.add;
  const undoStack = [];
  const redoStack = [];

  /* stylet : la pression change la force (comme l'intensité d'une brosse), la taille, ou les deux */
  let curPressure = 1, curForceMul = 1, penLast = 0.5, penSeen = 0;
  function readPressure(e) {
    if (e.pointerType !== 'pen' || opts.penMode === 'off') { curPressure = 1; curForceMul = 1; return; }
    let p = e.pressure;
    if (!(p > 0)) p = penLast;                    // les derniers points avant de lever le stylet annoncent 0 : on garde la valeur précédente
    penLast = penLast * 0.45 + p * 0.55;
    const k = 0.35 + 1.3 * penLast;               // pression moyenne (0,5) = comportement de la souris
    curPressure = (opts.penMode === 'size' || opts.penMode === 'both') ? k : 1;
    curForceMul = (opts.penMode === 'force' || opts.penMode === 'both') ? k : 1;
  }
  const F = (t) => clamp(setOf(t).force * curForceMul, 0.05, 1);
  const brushR = (t) => setOf(t || (stroke ? stroke.tool : tool)).size * curPressure;

  const CURSOR_COLORS = {
    add: 0x22c55e, remove: 0xef4444, pull: 0x3b82f6, smooth: 0xeab308, stamp: 0xf97316, stretch: 0x06b6d4, flatten: 0x84cc16,
    layer: 0xd97706, inflate: 0xec4899, pinch: 0x8b5cf6, nudge: 0x0ea5e9, groove: 0x64748b, fill: 0x14b8a6, paint: 0xe11d48, orbit: 0x000000
  };
  const TOOL_INFO = {
    add: ['Ajouter', 'pose de la matière, la force règle l’épaisseur. Ctrl : enlever.'],
    remove: ['Enlever', 'gratte et creuse la matière. Ctrl : ajouter.'],
    stretch: ['Élastique', 'attrape la pâte et tire-la comme un élastique : elle suit ton doigt, même très loin.'],
    pull: ['Tirer', 'fait sortir une pointe, une corne, une queue.'],
    smooth: ['Lisser', 'arrondit et adoucit les bosses. Astuce : maintiens Maj avec n’importe quel outil.'],
    flatten: ['Aplatir', 'rabote pour obtenir une surface plate.'],
    stamp: ['Tampon', 'touche pour coller. Reste appuyé et glisse pour choisir la taille.'],
    layer: ['Brosse', 'peint une fine couche d’argile bien régulière. Ctrl : sillon.'],
    inflate: ['Gonfler', 'gonfle la surface comme un ballon. Ctrl : dégonfler.'],
    pinch: ['Pincer', 'pince la matière pour faire une arête ou un pli. Ctrl : écarter.'],
    nudge: ['Pousser', 'pousse la matière dans le sens de ton geste. Ctrl : à l’envers.'],
    groove: ['Sillon', 'trace un sillon fin pour dessiner des lignes et des plis. Ctrl : brosse.'],
    fill: ['Combler', 'remplit les trous et les creux sans toucher aux bosses.'],
    paint: ['Peindre', 'colore la surface avec la couleur choisie, sans changer la forme. Ctrl : remet la terre cuite.']
  };
  /* pinceaux supplémentaires (menu en bas de l'écran) */
  const BRUSHES = [
    { id: 'paint', icon: 'i-paint', c: '#e11d48', cs: '#fde4ea', cd: '#9f1239' },
    { id: 'layer', icon: 'i-layer', c: '#d97706', cs: '#fdeccf', cd: '#b45309' },
    { id: 'inflate', icon: 'i-inflate', c: '#ec4899', cs: '#fde6f2', cd: '#be185d' },
    { id: 'pinch', icon: 'i-pinch', c: '#8b5cf6', cs: '#ede8fe', cd: '#6d28d9' },
    { id: 'nudge', icon: 'i-nudge', c: '#0ea5e9', cs: '#dff1fb', cd: '#0369a1' },
    { id: 'groove', icon: 'i-groove', c: '#64748b', cs: '#e5ebf3', cd: '#3b4d68' },
    { id: 'fill', icon: 'i-fill', c: '#14b8a6', cs: '#d7f5ef', cd: '#0f766e' }
  ];
  const BRUSH_IDS = BRUSHES.map((b) => b.id);
  const TOOL_KEYS = ['add', 'remove', 'stretch', 'pull', 'smooth', 'flatten', 'stamp'];
  const brushBar = $('#brush-bar');
  BRUSHES.forEach((b) => {
    const el = document.createElement('button');
    el.className = 'brush-btn'; el.dataset.tool = b.id;
    el.style.setProperty('--c', b.c); el.style.setProperty('--cs', b.cs); el.style.setProperty('--cd', b.cd);
    el.title = TOOL_INFO[b.id][0] + ' : ' + TOOL_INFO[b.id][1];
    el.innerHTML = '<svg class="ic"><use href="#' + b.icon + '"/></svg><span>' + TOOL_INFO[b.id][0] + '</span>';
    brushBar.appendChild(el);
  });
  let brushBarOpen = false;

  /* modificateurs au clavier : Maj = lisser, Ctrl = faire l'inverse (ajouter ↔ enlever…), Alt + glisser = déplacer la vue,
     Espace + glisser = tourner la vue */
  const keyMods = { shift: false, ctrl: false, alt: false };
  let spaceDown = false;
  const readMods = (e) => ({ shift: !!e.shiftKey, ctrl: !!(e.ctrlKey || e.metaKey), alt: !!e.altKey });
  const INVERSE = { add: 'remove', remove: 'add', layer: 'groove', groove: 'layer' };
  /** Outil réellement utilisé : tient compte de Maj (lisser) et de Ctrl (inverse) ; inv = variante « à l'envers » (dégonfler, écarter…) */
  function resolveTool(base, m) {
    if (m && m.shift && base !== 'smooth') return { tool: 'smooth', inv: false };
    if (m && m.ctrl) return INVERSE[base] ? { tool: INVERSE[base], inv: false } : { tool: base, inv: true };
    return { tool: base, inv: false };
  }
  function syncToolHighlight() {
    const shown = resolveTool(tool, keyMods).tool;
    $$('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === shown));
    $('#btn-brushes').classList.toggle('active', BRUSH_IDS.includes(shown));
    $('#btn-brushes').classList.toggle('open', brushBarOpen);
  }

  let hintTimer = 0;
  function setHint(txt) {
    $('#hint-text').textContent = txt;
    const el = $('#hint');
    el.classList.remove('off');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => el.classList.add('off'), 6000);
  }
  let toastTimer = 0;
  function toast(txt) {
    const t = $('#toast');
    t.textContent = txt; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  let cursorColorTool = '';
  function setCursorColor(t) {
    if (cursorColorTool === t) return;
    cursorColorTool = t;
    const c = CURSOR_COLORS[t] || 0x22c55e;
    cursorMat.color.setHex(c); ringMat.color.setHex(c);
  }
  function setBrushBar(open) {
    brushBarOpen = open;
    brushBar.hidden = !open || !!placement;
    syncToolHighlight();
    updateViewOffset();
    invalidate();
  }
  function setTool(name) {
    if (stroke) endStroke();
    tool = name;
    const ti = TOOL_INFO[name];
    if (ti) setHint(ti[0] + ' : ' + ti[1]);
    brushBarOpen = BRUSH_IDS.includes(name);
    setCursorColor(name);
    cursors.forEach((c) => { c.visible = false; });
    hideStampGhost(); hideSizeTip();
    $('#stamp-bar').hidden = name !== 'stamp' || !!placement;
    brushBar.hidden = !brushBarOpen || !!placement;
    syncToolHighlight();
    syncBrushUI();
    updateViewOffset();
    invalidate();
  }
  $$('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  $('#btn-brushes').addEventListener('click', () => setBrushBar(!brushBarOpen));

  const SIZE_PRESETS = [4, 7, 12];
  function syncBrushUI() {
    const on = tool !== 'orbit';
    const st = setOf(tool);
    $('#brush-size').disabled = $('#brush-force').disabled = !on;
    $('#brush-size').value = st.size;
    $('#brush-force').value = Math.round(st.force * 100);
    $('#brush-size-val').textContent = Number(st.size).toFixed(1).replace('.0', '');
    $('#brush-force-val').textContent = Math.round(st.force * 100) + '%';
    $$('.size').forEach((x) => x.classList.toggle('active', on && Math.abs(SIZE_PRESETS[+x.dataset.size] - st.size) < 0.5));
  }
  $$('.size').forEach((b) => b.addEventListener('click', () => {
    if (tool === 'orbit') return;
    setOf(tool).size = SIZE_PRESETS[+b.dataset.size];
    saveTools(); syncBrushUI();
  }));
  $('#brush-size').addEventListener('input', (e) => { if (tool !== 'orbit') { setOf(tool).size = +e.target.value; saveTools(); syncBrushUI(); } });
  $('#brush-force').addEventListener('input', (e) => { if (tool !== 'orbit') { setOf(tool).force = +e.target.value / 100; saveTools(); syncBrushUI(); } });

  const SYM_ORDER = ['off', 'x', 'xz', 'rot6'];
  function setSym(m, announce) {
    sym = m;
    $('#btn-mirror').classList.toggle('on', m !== 'off');
    $('#sym-label').textContent = SYMS[m].label;
    $('#sym-use').setAttribute('href', '#i-sym' + SYM_ORDER.indexOf(m));      // l'icône montre la symétrie choisie
    mirrorPlane.visible = SYMS[m].planes.includes(0);
    mirrorPlane2.visible = SYMS[m].planes.includes(1);
    if (opts.sym !== m) { opts.sym = m; saveOpts(); }
    if (announce) setHint(m === 'off' ? 'Symétrie coupée : chaque geste ne se fait qu’une fois.' : 'Symétrie « ' + SYMS[m].label + ' » : ce que tu fais d’un côté se répète !');
    invalidate();
  }
  const cycleSym = () => setSym(SYM_ORDER[(SYM_ORDER.indexOf(sym) + 1) % SYM_ORDER.length], true);
  $('#btn-mirror').addEventListener('click', cycleSym);

  /* couleurs : les outils qui posent de la matière (Ajouter, Brosse, Tampon, Tirer, formes) et « Peindre » utilisent la couleur choisie ;
     chaque morceau de la sculpture garde sa couleur. Le « + » ajoute une couleur de ton choix à la palette. */
  const COLOR_NAMES = ['terre cuite', 'bleu', 'vert', 'rose', 'jaune', 'blanc', 'violet', 'turquoise'];
  const PAL_MAX = 40;
  const colorBox = $('#colors');
  const hex6 = (c) => '#' + c.toString(16).padStart(6, '0');
  try {
    const pl = JSON.parse(localStorage.getItem('pate3d.palette') || 'null');
    if (Array.isArray(pl) && pl.length >= 8 && pl.every((c) => Number.isInteger(c) && c >= 0 && c <= 0xffffff)) clay.setPalette(pl.slice(0, PAL_MAX));
  } catch (e) { /* ignore */ }
  const savePalette = () => { try { localStorage.setItem('pate3d.palette', JSON.stringify(clay.pal)); } catch (e) { /* ignore */ } };
  function renderPalette() {
    colorBox.textContent = '';
    clay.pal.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'swatch' + (i === clay.paint ? ' active' : '');
      b.style.setProperty('--c', hex6(c));
      b.setAttribute('aria-label', 'Couleur ' + (COLOR_NAMES[i] || (i + 1)));
      b.title = COLOR_NAMES[i] || 'Couleur ' + (i + 1);
      b.addEventListener('click', () => pickColor(i));
      colorBox.appendChild(b);
    });
    const add = document.createElement('label');
    add.className = 'swatch add'; add.title = 'Ajouter une couleur de ton choix';
    add.innerHTML = '<svg class="ic"><use href="#i-plus"/></svg><input type="color" aria-label="Ajouter une couleur" value="' + hex6(clay.pal[clay.paint] || 0xf2a679) + '">';
    add.querySelector('input').addEventListener('change', (e) => addColor(parseInt(String(e.target.value).slice(1), 16)));
    colorBox.appendChild(add);
  }
  function addColor(c) {
    if (!(c >= 0 && c <= 0xffffff)) return;
    let i = clay.pal.indexOf(c);
    if (i < 0) {
      if (clay.pal.length >= PAL_MAX) { toast('La palette est pleine (' + PAL_MAX + ' couleurs)'); return; }
      clay.setPalette(clay.pal.concat([c]));
      i = clay.pal.length - 1;
      savePalette();
    }
    renderPalette();
    pickColor(i);
    scheduleSave();                       // la palette est enregistrée avec la sculpture
  }
  function pickColor(i) {
    i = clamp(i, 0, clay.pal.length - 1);
    clay.paint = i;
    Array.from(colorBox.querySelectorAll('.swatch:not(.add)')).forEach((x, n) => x.classList.toggle('active', n === i));
    try { localStorage.setItem('pate3d.color', String(i)); } catch (e) { /* ignore */ }
    CURSOR_COLORS.paint = clay.pal[i]; cursorColorTool = ''; setCursorColor(tool);     // le curseur de « Peindre » a la couleur choisie
    invalidate();
  }

  /* ------------------------------------------------------------------ Historique, clavier, sauvegarde */
  function refreshUndo() {
    $('#btn-undo').disabled = undoStack.length === 0;
    $('#btn-redo').disabled = redoStack.length === 0;
    body.classList.toggle('is-empty', clay.isEmpty());       // surface vide : Formes et Importer sont mis en évidence
  }
  function pushUndo(entry) {
    if (!entry) return;
    undoStack.push(entry);
    if (undoStack.length > 25) undoStack.shift();
    redoStack.length = 0;
    refreshUndo();
    scheduleSave();
  }
  function undo() {
    endStroke();
    clearPreview();
    const e = undoStack.pop();
    schedulePreview();
    if (!e) return;
    clay.undoEntry(e); redoStack.push(e); Sfx.undo();
    refreshUndo(); scheduleSave(); invalidate();
  }
  function redo() {
    endStroke();
    clearPreview();
    const e = redoStack.pop();
    schedulePreview();
    if (!e) return;
    clay.redoEntry(e); undoStack.push(e); Sfx.undo();
    refreshUndo(); scheduleSave(); invalidate();
  }
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);

  const modalOpen = () => $$('.modal').some((m) => !m.hidden && m.id !== 'nogl');
  const isTyping = (t) => !!t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '');
  let lastHover = null;
  function refreshHover() {
    if (lastHover && !stroke && !placement) {
      hoverEvt = Object.assign({}, lastHover, { shiftKey: keyMods.shift, ctrlKey: keyMods.ctrl, altKey: keyMods.alt });
      invalidate();
    }
  }
  function setMods(e) {
    const m = readMods(e);
    if (m.shift !== keyMods.shift || m.ctrl !== keyMods.ctrl || m.alt !== keyMods.alt) {
      Object.assign(keyMods, m);
      syncToolHighlight();
      refreshHover();
    }
  }
  /* caméra au clavier : flèches ou Q Z S D (comme les boutons de rotation) ; avec Maj on déplace la vue */
  const CAM_KEYS = { ArrowLeft: [1, 0], q: [1, 0], ArrowRight: [-1, 0], d: [-1, 0], ArrowUp: [0, 1], z: [0, 1], ArrowDown: [0, -1], s: [0, -1] };
  window.addEventListener('keydown', (e) => {
    setMods(e);
    if (e.key === 'Alt') e.preventDefault();                      // Alt seul ne doit pas activer le menu du navigateur
    if (e.key === 'Escape') { if (modalOpen()) closeModals(); else if (placement) cancelPlacement(); return; }
    if (isTyping(e.target)) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && key === 'y') { e.preventDefault(); redo(); return; }
    if (e.code === 'Space' || key === ' ') { if (!modalOpen()) { e.preventDefault(); spaceDown = true; hideCursor(); } return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (key === 'Enter' && placement && !modalOpen() && !/BUTTON|INPUT/.test((e.target || {}).tagName || '')) { validatePlacement(); return; }
    if (modalOpen()) return;
    if (/^[1-7]$/.test(key)) { setTool(TOOL_KEYS[+key - 1]); return; }
    if (key === '8') { setBrushBar(!brushBarOpen); return; }
    if (key === '+' || key === '=' || key === 'PageUp') { goTo({ dist: view.dist * 0.85 }); return; }
    if (key === '-' || key === '_' || key === 'PageDown') { goTo({ dist: view.dist / 0.85 }); return; }
    if (key === 'h') { goTo(Object.assign(defaultView(), { az: nearestAngle(view.az, 0) })); return; }
    if (key === 'x') { cycleSym(); return; }
    if (key === 'f') { if (!placement) openShapes(); return; }
    const cm = CAM_KEYS[key];
    if (cm) {
      e.preventDefault();
      if (e.shiftKey) { pan(-cm[0] * 30, -cm[1] * 30); invalidate(); }
      else goTo({ az: view.az + cm[0] * 0.12, el: view.el + cm[1] * 0.08 });
      return;
    }
    if ((key === '[' || key === ']') && tool !== 'orbit') {
      const st = setOf(tool);
      st.size = clamp(st.size + (key === ']' ? 1 : -1), 2, 25);
      saveTools(); syncBrushUI();
    }
  });
  window.addEventListener('keyup', (e) => {
    setMods(e);
    if (e.key === 'Alt') e.preventDefault();
    if (e.code === 'Space' || e.key === ' ') spaceDown = false;
  });
  window.addEventListener('blur', () => { keyMods.shift = keyMods.ctrl = keyMods.alt = false; spaceDown = false; syncToolHighlight(); });
  // les boutons et curseurs ne gardent pas le focus après un clic : Espace, flèches et Entrée restent pour la caméra et les gestes
  document.addEventListener('click', (e) => { const b = e.detail && e.target.closest ? e.target.closest('button') : null; if (b) b.blur(); });
  document.addEventListener('pointerup', (e) => { const t = e.target; if (t && t.tagName === 'INPUT' && t.type === 'range') setTimeout(() => t.blur(), 0); });

  /* sauvegarde automatique (aussi quand on quitte la page) */
  let saveTimer = 0, saveWarned = false;
  function saveNow() {
    clearTimeout(saveTimer); saveTimer = 0;
    const hadPreview = !!pvEntry;
    if (hadPreview) clearPreview();                       // on n'enregistre jamais l'aperçu
    try { localStorage.setItem('pate3d.v3', clay.serialize()); } catch (e) {
      if (!saveWarned) { saveWarned = true; toast('Sauvegarde automatique impossible (espace plein ?) : exporte ton travail !'); }
    }
    if (hadPreview) schedulePreview();
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const idle = window.requestIdleCallback;
      if (idle) idle(saveNow, { timeout: 1500 }); else saveNow();
    }, 900);
  }
  window.addEventListener('pagehide', () => { if (saveTimer) saveNow(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) saveNow(); });

  /* ------------------------------------------------------------------ Rayons */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function rayFrom(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray;
  }
  /** Retourne {x,y,z,nx,ny,nz,floor,t,c} sur l'argile ou le plateau (ou null) ;
   *  t = distance depuis la caméra, c = « franchise » de la visée (1 = de face, 0 = à plat : voir MIN_C). */
  function pick(e, field) {
    const ray = rayFrom(e);
    const o = ray.origin, d = ray.direction;
    const s = clay.raycast(field, o.x, o.y, o.z, d.x, d.y, d.z);
    let tf = Infinity;
    if (d.y < 0) tf = -o.y / d.y;
    if (s && s.t < tf) return { x: s.x, y: s.y, z: s.z, nx: s.nx, ny: s.ny, nz: s.nz, floor: false, t: s.t, c: Math.abs(s.nx * d.x + s.ny * d.y + s.nz * d.z) };
    if (tf < Infinity && tf > 0) {
      const x = o.x + d.x * tf, z = o.z + d.z * tf;
      if (Math.abs(x) < WH - 2 && Math.abs(z) < WH - 2) return { x, y: 0, z, nx: 0, ny: 1, nz: 0, floor: true, t: tf, c: -d.y };
    }
    return null;
  }
  /** Visée rasante (< ~7° entre le rayon et la surface) : un pixel de souris = des centimètres de matière,
   *  c'est là que naissent les traînées qui filent le long de la perspective. On ne sculpte pas à cet endroit. */
  const MIN_C = 0.12;
  /** Visée pour poser une forme : l'argile ou le plateau ; au-delà du bord du plateau, le point du plateau le plus proche */
  function pickPlace(e) {
    const h = pick(e, clay.f);
    if (h) return h;
    const ray = rayFrom(e), d = ray.direction, o = ray.origin;
    if (d.y > -0.02) return null;                       // le ciel : on ne pose rien
    const t = -o.y / d.y;
    return { x: clamp(o.x + d.x * t, -WH + 1, WH - 1), y: 0, z: clamp(o.z + d.z * t, -WH + 1, WH - 1), floor: true, t, c: -d.y, nx: 0, ny: 1, nz: 0 };
  }
  const worldPerPx = (depth) => (2 * depth * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(canvas.clientHeight, 1);

  /* ------------------------------------------------------------------ Sculpture */
  /** hit = point visé (avec sa normale) : l'ajout « propre » ne dépose de la matière que sur de l'argile existante
   *  (rien derrière une partie fine, au-delà d'un bord, ni dans le vide pour les copies de la symétrie). k = épaisseur visée. */
  function capsuleM(a, b, r, mode, hit, k) {
    const sup = hit && mode === 'add'
      ? { nx: 0, ny: 0, nz: 0, depth: r * ((k === undefined ? addHeightK() : k) + 0.45) + 1.5, below: 0.6 * r + 1.5, w0: hit.x * hit.nx + hit.y * hit.ny + hit.z * hit.nz }
      : null;
    for (const M of xfs()) {
      const pa = ap(M, a), pb = ap(M, b);
      if (sup) { const m = ap(M, [hit.nx, hit.ny, hit.nz]); sup.nx = m[0]; sup.ny = m[1]; sup.nz = m[2]; }   // w0 ne change pas (M orthogonale)
      clay.capsule(pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], r, mode, sup);
    }
  }
  function smoothM(c, r, fillOnly) {
    const k = 0.15 + 0.8 * F(fillOnly ? 'fill' : 'smooth');
    for (const M of xfs()) { const q = ap(M, c); clay.smooth(q[0], q[1], q[2], r, k, fillOnly); }
  }
  function inflateM(c, r, amount) {
    for (const M of xfs()) { const q = ap(M, c); clay.inflate(q[0], q[1], q[2], r, amount); }
  }
  function paintM(c, r, idx) {
    for (const M of xfs()) { const q = ap(M, c); clay.paintAt(q[0], q[1], q[2], r, idx); }
  }
  function pinchM(c, n, r, alpha) {
    for (const M of xfs()) { const q = ap(M, c), m = ap(M, n); clay.warpPinch(q[0], q[1], q[2], m[0], m[1], m[2], r, alpha); }
  }
  function grabM(c, d, r, gain) {
    const m = gain === undefined ? 0.6 + 0.8 * F('stretch') : gain;
    for (const M of xfs()) { const pc = ap(M, c), pd = ap(M, d); clay.warpGrab(pc[0], pc[1], pc[2], pd[0] * m, pd[1] * m, pd[2] * m, r); }
  }
  /** Curseur : bille translucide au centre du pinceau + anneau posé sur la surface (orienté selon sa normale n) :
   *  ring = {p: point de contact, r: rayon de l'empreinte}. */
  const Z_AXIS = new THREE.Vector3(0, 0, 1), nTmp = new THREE.Vector3();
  function showCursor(c, r, n, ring) {
    const xs = xfs();
    for (let i = 0; i < cursors.length; i++) {
      const cu = cursors[i];
      if (i < xs.length && tool !== 'orbit') {
        const q = ap(xs[i], c), rg = cu.children[1];
        cu.position.set(q[0], q[1], q[2]);
        cu.scale.setScalar(r);
        if (ring) { const qp = ap(xs[i], ring.p); rg.position.set((qp[0] - q[0]) / r, (qp[1] - q[1]) / r, (qp[2] - q[2]) / r); rg.scale.setScalar(ring.r / r); }
        else { rg.position.set(0, 0, 0); rg.scale.setScalar(1); }
        if (n) { const m = ap(xs[i], n); nTmp.set(m[0], m[1], m[2]).normalize(); rg.quaternion.setFromUnitVectors(Z_AXIS, nTmp); cu.userData.n = true; }
        else cu.userData.n = false;
        cu.visible = true;
      } else cu.visible = false;
    }
    invalidate();
  }
  function hideCursor() {
    let any = false;
    cursors.forEach((c) => { if (c.visible) { c.visible = false; any = true; } });
    if (any) invalidate();
  }

  /* outils qui peuvent aussi travailler sur le plateau / qui visent la surface en cours de déformation / sans lissage final */
  const FLOOR_OK = new Set(['add', 'layer', 'stamp']);
  const ON_CURRENT = new Set(['smooth', 'fill', 'inflate', 'pinch', 'nudge', 'paint']);
  const NO_RELAX = new Set(['smooth', 'fill', 'stretch', 'pinch', 'nudge', 'inflate', 'paint']);
  const allowed = (h, t) => !!h && h.c >= MIN_C && (FLOOR_OK.has(t || tool) || !h.floor);

  /* --- tampons --- */
  const STAMPS = ['sphere', 'cube', 'cone', 'heart', 'star', 'flower', 'paw', 'moon', 'drop', 'diamond', 'torus'];
  const FACE_Z = { heart: true, star: true, flower: true, paw: true, moon: true, drop: true, diamond: true };
  const stampCache = {}, stampGeoCache = {};
  let stampShape = 'star';
  const stampBar = $('#stamp-bar');
  STAMPS.forEach((id) => {
    const info = IO.SHAPES.find((x) => x.id === id);
    const b = document.createElement('button');
    b.className = 'stamp-btn' + (id === stampShape ? ' active' : '');
    b.textContent = info.emoji; b.title = info.name; b.dataset.stamp = id;
    b.setAttribute('aria-label', 'Tampon ' + info.name);
    b.addEventListener('click', () => {
      stampShape = id;
      $$('.stamp-btn[data-stamp]').forEach((x) => x.classList.toggle('active', x === b));
    });
    stampBar.appendChild(b);
  });
  const seriesBtn = document.createElement('button');
  seriesBtn.className = 'stamp-btn series';
  seriesBtn.title = 'Série : glisse pour coller plusieurs tampons à la suite';
  seriesBtn.setAttribute('aria-label', 'Mode série');
  seriesBtn.innerHTML = '<svg class="ic"><use href="#i-series"/></svg><span>Série</span>';
  seriesBtn.addEventListener('click', () => {
    opts.stampSeries = !opts.stampSeries; saveOpts();
    seriesBtn.classList.toggle('active', opts.stampSeries);
    setHint(opts.stampSeries ? 'Série : glisse pour coller plusieurs tampons.' : 'Un tampon à la fois : reste appuyé et glisse pour choisir la taille.');
  });
  stampBar.appendChild(seriesBtn);
  const stampSizeDefault = () => setOf('stamp').size * 2.2;
  const stampSoup = (id) => stampCache[id] || (stampCache[id] = IO.normalize(IO.shapeSoup(THREE, id)).pos);

  /** Repère du tampon posé sur la surface (la face des motifs plats est tournée vers l'extérieur, le haut vers le haut) */
  function stampBasis(h, size) {
    const id = stampShape;
    const n = new THREE.Vector3(h.nx, h.ny, h.nz).normalize();
    let x, y, z;
    if (FACE_Z[id]) {
      z = n; x = new THREE.Vector3(0, 1, 0).cross(z);
      if (x.lengthSq() < 1e-4) x.set(1, 0, 0);
      x.normalize(); y = z.clone().cross(x);
    } else {
      y = n;
      const flat = Math.abs(n.z) < 0.9;
      x = new THREE.Vector3(flat ? 0 : 1, 0, flat ? 1 : 0).cross(y).normalize();
      z = x.clone().cross(y);
    }
    const off = size * (FACE_Z[id] ? 0.04 : 0.2) * (1.5 - F('stamp'));
    return { x, y, z, p: [h.x + n.x * off, h.y + n.y * off, h.z + n.z * off] };
  }
  /** Colle le tampon (dans le champ) */
  function stampPlace(h, size) {
    const id = stampShape, base = stampSoup(id), b = stampBasis(h, size), [px, py, pz] = b.p;
    const w = new Float32Array(base.length);
    for (let i = 0; i < base.length; i += 3) {
      const u = base[i] * size, v = base[i + 1] * size, q = base[i + 2] * size;
      w[i] = px + b.x.x * u + b.y.x * v + b.z.x * q;
      w[i + 1] = py + b.x.y * u + b.y.y * v + b.z.y * q;
      w[i + 2] = pz + b.x.z * u + b.y.z * v + b.z.z * q;
    }
    xfs().forEach((M, i) => {
      if (i === 0) { clay.stampMesh(w, 'add'); return; }
      const q = ap(M, [px, py, pz]);
      if (Math.hypot(q[0] - px, q[1] - py, q[2] - pz) < 1.5) return;
      clay.stampMesh(applyM(w, M), 'add');
    });
    Sfx.stamp();
  }
  /* aperçu translucide du tampon (survol, ou pendant qu'on règle sa taille) */
  const ghostMat = new THREE.MeshMatcapMaterial({ color: 0x38a8ff, matcap: matcapTex, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false });
  const xrayMat = new THREE.MeshBasicMaterial({ color: 0x0284c7, transparent: true, opacity: 0.3, depthWrite: false, depthFunc: THREE.GreaterDepth, side: THREE.DoubleSide });
  const stampGhost = new THREE.Mesh(new THREE.BufferGeometry(), ghostMat);
  stampGhost.frustumCulled = false; stampGhost.matrixAutoUpdate = false; stampGhost.renderOrder = 4; stampGhost.visible = false;
  scene.add(stampGhost);
  function stampGeo(id) {
    if (!stampGeoCache[id]) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(stampSoup(id), 3));
      g.computeVertexNormals();
      stampGeoCache[id] = g;
    }
    return stampGeoCache[id];
  }
  function showStampGhost(h, size) {
    const b = stampBasis(h, size);
    stampGhost.geometry = stampGeo(stampShape);
    const m = stampGhost.matrix;
    m.makeBasis(b.x, b.y, b.z);
    m.scale(new THREE.Vector3(size, size, size));
    m.setPosition(b.p[0], b.p[1], b.p[2]);
    stampGhost.matrixWorldNeedsUpdate = true;
    stampGhost.visible = true;
    showCursor(b.p, size * 0.5);
  }
  function hideStampGhost() { if (stampGhost.visible) { stampGhost.visible = false; invalidate(); } }
  const sizeTip = $('#size-tip');
  function showSizeTip(x, y, size) { sizeTip.textContent = (size / 10).toFixed(1) + ' cm'; sizeTip.style.left = (x + 16) + 'px'; sizeTip.style.top = (y - 38) + 'px'; sizeTip.hidden = false; }
  function hideSizeTip() { sizeTip.hidden = true; }

  /* --- geste en cours --- */
  /** Un trait ne peut pas « sauter » en profondeur (bord de la sculpture → plateau lointain) : sinon une longue
   *  traînée de matière file le long de la perspective. Chaque point est comparé au point visé juste avant (même
   *  refusé, donc le trait reprend dès que la visée redevient continue) : le déplacement dans l'espace ne peut
   *  dépasser ~4 fois ce que le doigt a parcouru à l'écran. En plus, le trait reste dans une « fenêtre » de profondeur
   *  autour de l'endroit du premier appui. */
  function acceptHit(h, e) {
    const s = stroke, prev = s.prevHit, px = s.lastPx;
    s.prevHit = h; s.lastPx = [e.clientX, e.clientY];
    if (Math.abs(h.t - s.t0) > s.span) return false;
    if (!prev || !px) return true;
    const mv = Math.hypot(e.clientX - px[0], e.clientY - px[1]) * worldPerPx(h.t);
    return Math.hypot(h.x - prev.x, h.y - prev.y, h.z - prev.z) <= 4 * mv + 1.5 * ClayEngine.grid().H;
  }

  function beginStroke(h, rt, e) {
    clay.beginEdit();
    const t = rt.tool;
    stroke = { tool: t, inv: rt.inv, born: performance.now(), onFloor: !!h.floor, last: null, path: 0, t0: h.t, prevHit: h, span: Math.max(0.8 * WL, 8 * Math.max(brushR(t), 2)), lastPx: e ? [e.clientX, e.clientY] : null, lastT: e ? e.timeStamp : 0 };
    if (t === 'stamp') {
      if (opts.stampSeries) { const sz = stampSizeDefault(); stampPlace(h, sz); stroke.lastStamp = [h.x, h.y, h.z]; showStampGhost(h, sz); return; }
      stroke.stamp = { h, sx: e ? e.clientX : 0, sy: e ? e.clientY : 0, size: stampSizeDefault(), moved: false };
      showStampGhost(h, stroke.stamp.size);
      return;
    }
    if (t === 'stretch') {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      stroke.planeN = dir;
      stroke.planeP = new THREE.Vector3(h.x, h.y, h.z);
      stroke.last = [h.x, h.y, h.z];
      stroke.R = brushR() * 1.4;
      Sfx.pull();
      showCursor(stroke.last, stroke.R);
      return;
    }
    if (t === 'flatten') {
      const sh = brushR() * 1.3 * 0.6 * (F('flatten') - 0.15);
      stroke.plane = [h.x - h.nx * sh, h.y - h.ny * sh, h.z - h.nz * sh, h.nx, h.ny, h.nz];
      Sfx.smooth();
      flattenAt(h);
      return;
    }
    if (t === 'pull') {
      const R = brushR();
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      stroke.planeN = dir;
      stroke.planeP = new THREE.Vector3(h.x, h.y, h.z);
      stroke.R = R;
      stroke.taper = 40 + 100 * F('pull');
      const inner = [h.x - h.nx * R * 0.5, h.y - h.ny * R * 0.5, h.z - h.nz * R * 0.5];
      const p = [h.x, h.y, h.z];
      capsuleM(inner, p, R, 'add');
      Sfx.pull();
      stroke.last = p;
      showCursor(p, R);
    } else {
      strokePoint(h, 16);
    }
  }

  function flattenM(c, pl, r) {
    for (const M of xfs()) {
      const pc = ap(M, c), pp = ap(M, [pl[0], pl[1], pl[2]]), pn = ap(M, [pl[3], pl[4], pl[5]]);
      clay.flatten(pc[0], pc[1], pc[2], pp[0], pp[1], pp[2], pn[0], pn[1], pn[2], r);
    }
  }
  function flattenAt(h) {
    const R = brushR() * 1.3, c = [h.x, h.y, h.z], l = stroke.last;
    if (!l) flattenM(c, stroke.plane, R);
    else {
      const dx = c[0] - l[0], dy = c[1] - l[1], dz = c[2] - l[2];
      const n = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) / (R * 0.4)));
      for (let i = 1; i <= n; i++) flattenM([l[0] + dx * i / n, l[1] + dy * i / n, l[2] + dz * i / n], stroke.plane, R);
    }
    stroke.last = c;
    showCursor(c, R, [h.nx, h.ny, h.nz]);
  }

  /* Épaisseur ajoutée / profondeur creusée par un geste (en fraction du rayon du pinceau) : la force part vraiment de « très léger ».
   * Le centre de la bille est posé sous (ajout) ou au-dessus (creusage) de la surface pour obtenir cette épaisseur. */
  const addHeightK = () => lerp(0.1, 1.15, F('add'));
  const layerHeightK = () => lerp(0.05, 0.3, F('layer'));
  const removeDepthK = () => lerp(0.12, 1.15, F('remove'));
  const grooveDepthK = () => lerp(0.3, 1.0, F('groove'));
  const footprint = (R, k) => R * Math.sqrt(Math.max(0.12, 1 - Math.pow(1 - Math.min(k, 1), 2)));
  /** Rayon d'action R, décalage du centre le long de la normale (en fraction de R) et rayon de l'empreinte sur la surface pour l'outil t */
  function brushGeom(t) {
    const R = brushR(t);
    switch (t) {
      case 'add': { const k = addHeightK(); return { R, off: k - 1, fr: footprint(R, k) }; }
      case 'layer': { const k = layerHeightK(); return { R, off: k - 1, fr: footprint(R, k) }; }
      case 'remove': { const k = removeDepthK(); return { R, off: 1 - k, fr: footprint(R, k) }; }
      case 'groove': { const g = R * 0.4, k = grooveDepthK(); return { R: g, off: 1 - k, fr: footprint(g, k) }; }
      case 'smooth': case 'flatten': case 'fill': return { R: R * 1.3, off: 0, fr: R * 1.3 };
      case 'stretch': return { R: R * 1.4, off: 0, fr: R * 1.4 };
      case 'inflate': case 'pinch': case 'nudge': return { R: R * 1.2, off: 0, fr: R * 1.2 };
      default: return { R, off: 0, fr: R };
    }
  }
  /** Applique fn le long du chemin parcouru depuis le dernier point (un pas tous les `step` mm) */
  function alongPath(c, step, fn) {
    const l = stroke.last;
    if (!l) fn(c);
    else {
      const dx = c[0] - l[0], dy = c[1] - l[1], dz = c[2] - l[2];
      const n = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) / step));
      for (let i = 1; i <= n; i++) fn([l[0] + dx * i / n, l[1] + dy * i / n, l[2] + dz * i / n]);
    }
    stroke.last = c;
  }

  function strokePoint(h, dt) {
    const t = stroke.tool, g = brushGeom(t), R = brushR(t), c0 = [h.x, h.y, h.z], n0 = [h.nx, h.ny, h.nz];
    const ring = { p: c0, r: g.fr };
    if (t === 'smooth' || t === 'fill') {
      if (!stroke.last) Sfx.smooth();
      alongPath(c0, R * 0.4, (c) => smoothM(c, g.R, t === 'fill'));
      showCursor(c0, g.R, n0, ring);
    } else if (t === 'paint') {
      if (!stroke.last) Sfx.smooth();
      const idx = stroke.inv ? 0 : clay.paint;
      alongPath(c0, R * 0.35, (c) => paintM(c, g.R, idx));
      showCursor(c0, g.R, n0, ring);
    } else if (t === 'inflate') {
      const amt = (stroke.inv ? -1 : 1) * R * (0.03 + 0.2 * F('inflate'));
      if (!stroke.last) Sfx.smooth();
      alongPath(c0, R * 0.4, (c) => inflateM(c, g.R, amt));
      showCursor(c0, g.R, n0, ring);
    } else if (t === 'pinch') {
      const alpha = (stroke.inv ? -1 : 1) * lerp(0.04, 0.3, F('pinch'));
      if (!stroke.last) Sfx.pull();
      alongPath(c0, R * 0.4, (c) => pinchM(c, n0, g.R, alpha));
      showCursor(c0, g.R, n0, ring);
    } else if (t === 'nudge') {
      const l = stroke.last;
      if (l) {
        const k = (stroke.inv ? -1 : 1) * lerp(0.5, 1.2, F('nudge'));
        const dx = c0[0] - l[0], dy = c0[1] - l[1], dz = c0[2] - l[2], len = Math.hypot(dx, dy, dz);
        if (len > 0.05) {
          const n = Math.max(1, Math.ceil(len / (g.R * 0.3)));
          for (let i = 0; i < n; i++) grabM([l[0] + dx * i / n, l[1] + dy * i / n, l[2] + dz * i / n], [dx / n, dy / n, dz / n], g.R, k);
        }
      } else Sfx.pull();
      stroke.last = c0;
      showCursor(c0, g.R, n0, ring);
    } else {                                           // ajouter, brosse (couche fine), enlever, sillon
      const adds = t === 'add' || t === 'layer';
      let c = [h.x + h.nx * g.R * g.off, h.y + h.ny * g.R * g.off, h.z + h.nz * g.R * g.off];
      if (stroke.last) {
        // pinceau « stabilisé » : lisse le tremblement, avec la même durée de lissage quelle que soit la fréquence du périphérique
        const a = 1 - Math.exp(-clamp(dt || 16, 4, 40) / 18), l = stroke.last;
        c = [l[0] + (c[0] - l[0]) * a, l[1] + (c[1] - l[1]) * a, l[2] + (c[2] - l[2]) * a];
      } else if (adds) Sfx.add(); else Sfx.remove();
      capsuleM(stroke.last || c, c, g.R, adds ? 'add' : 'remove', h, t === 'layer' ? layerHeightK() : undefined);
      stroke.last = c;
      showCursor(c, g.R, n0, ring);
    }
  }

  const planeTmp = new THREE.Plane(), pTmp = new THREE.Vector3();
  function strokeMove(e) {
    if (!stroke) return;
    const dtEv = e.t !== undefined && stroke.lastT ? e.t - stroke.lastT : 16;
    if (e.t !== undefined) stroke.lastT = e.t;
    if (stroke.stamp) {                           // tampon : la distance parcourue règle la taille
      const s = stroke.stamp, dpx = Math.hypot(e.clientX - s.sx, e.clientY - s.sy);
      if (dpx > 8) s.moved = true;
      if (s.moved) {
        s.size = clamp(2 * dpx * worldPerPx(stroke.t0), 4, 0.6 * WL);
        showStampGhost(s.h, s.size);
        showSizeTip(e.clientX, e.clientY, s.size);
      }
      return;
    }
    if (stroke.tool === 'pull') {
      const ray = rayFrom(e);
      planeTmp.setFromNormalAndCoplanarPoint(stroke.planeN, stroke.planeP);
      if (!ray.intersectPlane(planeTmp, pTmp)) return;
      const p = pTmp;
      p.x = clamp(p.x, -WH + 2, WH - 2);
      p.z = clamp(p.z, -WH + 2, WH - 2);
      p.y = clamp(p.y, 1, WL - 2);
      const last = stroke.last;
      const seg = Math.hypot(p.x - last[0], p.y - last[1], p.z - last[2]);
      if (seg < 0.15) return;
      const k0 = Math.max(0.4, 1 - stroke.path / stroke.taper);
      stroke.path += seg;
      const k1 = Math.max(0.4, 1 - stroke.path / stroke.taper);
      // petit rétrécissement progressif : on obtient des cornes / queues effilées
      const r = stroke.R * (k0 + k1) * 0.5;
      const np = [p.x, p.y, p.z];
      capsuleM(last, np, r, 'add');
      stroke.last = np;
      showCursor(np, r);
      return;
    }
    if (stroke.tool === 'stretch') {
      const ray = rayFrom(e);
      planeTmp.setFromNormalAndCoplanarPoint(stroke.planeN, stroke.planeP);
      if (!ray.intersectPlane(planeTmp, pTmp)) return;
      const p = pTmp;
      p.x = clamp(p.x, -WH + 3, WH - 3);
      p.z = clamp(p.z, -WH + 3, WH - 3);
      p.y = clamp(p.y, 2, WL - 3);
      const l = stroke.last;
      const dx = p.x - l[0], dy = p.y - l[1], dz = p.z - l[2];
      const len = Math.hypot(dx, dy, dz);
      if (len < 0.2) return;
      const n = Math.ceil(len / (stroke.R * 0.3));       // petits pas : la déformation reste douce et sans repli
      let cur = l;
      for (let i = 1; i <= n; i++) {
        const nx = l[0] + dx * i / n, ny = l[1] + dy * i / n, nz = l[2] + dz * i / n;
        grabM(cur, [nx - cur[0], ny - cur[1], nz - cur[2]], stroke.R);
        cur = [nx, ny, nz];
      }
      stroke.last = cur;
      showCursor(cur, stroke.R);
      return;
    }
    const h = pick(e, ON_CURRENT.has(stroke.tool) ? clay.f : clay.before);
    // un trait reste sur la surface où il a commencé : sur la sculpture il ne « déborde » pas sur le plateau (et inversement)
    const strays = h && FLOOR_OK.has(stroke.tool) && h.floor !== stroke.onFloor;
    if (strays || !allowed(h, stroke.tool) || !acceptHit(h, e)) { stroke.last = null; hideCursor(); return; }
    if (stroke.tool === 'flatten') { flattenAt(h); return; }
    if (stroke.tool === 'stamp') {                // mode « série »
      const l = stroke.lastStamp, sz = stampSizeDefault();
      if (!l || Math.hypot(h.x - l[0], h.y - l[1], h.z - l[2]) > sz * 0.9) { stampPlace(h, sz); stroke.lastStamp = [h.x, h.y, h.z]; showStampGhost(h, sz); }
      return;
    }
    strokePoint(h, dtEv);
  }

  /** Abandonne le geste en cours et remet la sculpture comme avant (rien n'entre dans l'historique) */
  function cancelStroke() {
    if (!stroke) return;
    strokeQ = [];
    stroke = null;
    const entry = clay.endEdit();
    if (entry) clay.undoEntry(entry);
    hideCursor(); hideStampGhost(); hideSizeTip();
    invalidate();
  }

  function endStroke() {
    if (!stroke) return;
    flushInput();
    const s = stroke;
    stroke = null;
    if (s.stamp) {                                // tampon posé au relâchement, à la taille choisie
      stampPlace(s.stamp.h, s.stamp.size);
      if (s.stamp.moved) { setOf('stamp').size = s.stamp.size / 2.2; saveTools(); syncBrushUI(); }
      hideSizeTip();
    }
    if (s.tool === 'stamp') { hideStampGhost(); clay.relaxBox(0.5); clay.relaxBox(0.35); }
    else if (!NO_RELAX.has(s.tool)) clay.relaxBox(0.35);   // pas de lissage final pour les déformations : les petits détails restent
    pushUndo(clay.endEdit());
    hideCursor();
    invalidate();
  }

  /* ------------------------------------------------------------------ Souris / tactile / stylet
     Les mouvements sont mis en file puis traités une seule fois par image (avec tous les points intermédiaires
     du stylet) : le coût ne dépend plus de la fréquence d'échantillonnage du périphérique. */
  const ptrs = new Map();
  let lastTap = { t: 0, x: 0, y: 0 };
  let mode = null; // stroke | orbit | pan | nav | ghost | none
  let navPrev = null;
  let placementMode = 'move'; // 'move' | 'view'
  let strokeQ = [], hoverEvt = null, ghostEvt = null, orbitD = null, panD = null, navDirty = false;
  const pending = () => strokeQ.length > 0 || hoverEvt || ghostEvt || orbitD || panD || navDirty;

  function processInput() {
    if (strokeQ.length) {
      const q = strokeQ; strokeQ = [];
      if (stroke) for (const ev of q) { readPressure(ev); strokeMove(ev); }
    }
    if (orbitD) {
      const k = 4.8 / Math.max(canvas.clientHeight, 480);
      view.az -= orbitD.x * k; view.el = clampEl(view.el + orbitD.y * k);
      orbitD = null;
    }
    if (panD) { pan(panD.x, panD.y); panD = null; }
    if (navDirty) { navDirty = false; navMove(); }
    if (ghostEvt) { const h = pickPlace(ghostEvt); ghostEvt = null; if (h) moveGhost(h); }
    if (hoverEvt) { const e = hoverEvt; hoverEvt = null; hover(e); }
  }
  function flushInput() { processInput(); }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    const now = performance.now();
    if (e.pointerType === 'pen') { penSeen = now; penLast = e.pressure > 0 ? e.pressure : 0.5; }
    else if (e.pointerType === 'touch' && now - penSeen < 700) return;    // paume de la main posée près du stylet : ignorée
    readPressure(e);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) {
      // un 2e doigt qui arrive juste après le 1er : c'est un pincement, pas un trait → on annule la petite touche du 1er doigt
      if (stroke && performance.now() - stroke.born < 450) cancelStroke(); else endStroke();
      mode = 'nav';
      navPrev = navState();
      return;
    }
    if (ptrs.size > 2) return;
    const pen = e.pointerType === 'pen';
    if (e.pointerType === 'mouse' && e.button === 1) { mode = 'pan'; return; }
    if ((e.pointerType === 'mouse' && e.button === 2) || (pen && (e.buttons & 2))) { mode = 'orbit'; return; }   // clic droit / bouton du stylet : tourner
    const eraser = pen && ((e.buttons & 32) || e.button === 5);                                                      // gomme du stylet : enlever
    if (e.pointerType !== 'touch' && e.altKey) { mode = 'pan'; return; }                                             // Alt + glisser : déplacer la vue
    if (spaceDown) { mode = 'orbit'; return; }                                                                       // Espace + glisser : tourner la vue
    if (placement) {
      if (placementMode === 'view') { mode = 'orbit'; return; }
      const h = pickPlace(e);
      if (h) { moveGhost(h); mode = 'ghost'; } else mode = 'orbit';
      return;
    }
    if (tool !== 'orbit' || eraser) {
      const rt = eraser ? { tool: 'remove', inv: false } : resolveTool(tool, readMods(e));   // Maj : lisser · Ctrl : l'inverse
      const h = pick(e, clay.f);
      if (allowed(h, rt.tool)) { setCursorColor(rt.tool); beginStroke(h, rt, e); mode = 'stroke'; invalidate(); return; }
    } else {
      // double-touche : on s'approche de l'endroit touché
      if (now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 28) {
        const h = pick(e, clay.f);
        lastTap.t = 0;
        if (h) { goTo({ tx: clamp(h.x, -WH + 5, WH - 5), ty: clamp(h.y, 0, 0.9 * WL), tz: clamp(h.z, -WH + 5, WH - 5), dist: Math.max(70, view.dist * 0.6) }); mode = 'none'; return; }
      }
      lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
    mode = 'orbit';
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'pen') penSeen = performance.now();
    const p = ptrs.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse' || e.pointerType === 'pen') { hoverEvt = { clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey || e.metaKey, altKey: e.altKey }; invalidate(); }
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    switch (mode) {
      case 'stroke': {
        const list = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
        const src = list && list.length ? list : [e];
        for (const ce of src) strokeQ.push({ clientX: ce.clientX, clientY: ce.clientY, pressure: ce.pressure, pointerType: ce.pointerType, t: ce.timeStamp });
        if (strokeQ.length > 48) strokeQ.splice(0, strokeQ.length - 48);
        break;
      }
      case 'orbit': orbitD = orbitD || { x: 0, y: 0 }; orbitD.x += dx; orbitD.y += dy; break;
      case 'pan': panD = panD || { x: 0, y: 0 }; panD.x += dx; panD.y += dy; break;
      case 'ghost': ghostEvt = { clientX: e.clientX, clientY: e.clientY }; break;
      case 'nav': navDirty = true; break;
      default: return;
    }
    invalidate();
  });

  function up(e) {
    if (!ptrs.has(e.pointerId)) return;
    if (mode === 'stroke') { flushInput(); endStroke(); }
    ptrs.delete(e.pointerId);
    if (ptrs.size === 0) mode = null;
    else if (mode === 'nav') mode = 'none';
  }
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', (e) => { if (!ptrs.size && (e.pointerType === 'mouse' || e.pointerType === 'pen')) { lastHover = null; hideCursor(); hideStampGhost(); } });

  /** Zoom : la molette et le pincement rapprochent aussi de l'endroit visé */
  function zoomBy(factor, e) {
    const nd = clampDist(view.dist * factor);
    if (e && nd < view.dist) {
      const h = pick(e, clay.f);
      if (h) {
        const k = (1 - nd / view.dist) * 0.7;
        view.tx = clamp(view.tx + (h.x - view.tx) * k, -WH + 5, WH - 5);
        view.ty = clamp(view.ty + (h.y - view.ty) * k, 0, 0.9 * WL);
        view.tz = clamp(view.tz + (h.z - view.tz) * k, -WH + 5, WH - 5);
      }
    }
    view.dist = nd;
    invalidate();
  }
  const wheelFactor = (e) => Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.04 : 1) * (e.ctrlKey ? 0.01 : 0.0012));
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(wheelFactor(e), e); }, { passive: false });

  function hover(e) {
    lastHover = e;
    if (placement) {
      // le survol ne déplace JAMAIS la forme (sinon un clic ne la « poserait » pas : elle suivrait la souris) :
      // elle se place en cliquant ou en la faisant glisser ; au survol, un petit repère montre où le clic la posera
      const h = placementMode === 'move' ? pickPlace(e) : null;
      if (h) showCursor([h.x, h.y, h.z], 1.6); else hideCursor();
      return;
    }
    if (tool === 'orbit' || spaceDown || e.altKey) { hideCursor(); hideStampGhost(); return; }
    curPressure = 1; curForceMul = 1;               // survol : taille « normale » (la pression ne compte que pendant le trait)
    const t = resolveTool(tool, { shift: !!e.shiftKey, ctrl: !!e.ctrlKey, alt: false }).tool;   // Maj / Ctrl changent l'outil, donc le curseur
    setCursorColor(t);
    const h = pick(e, clay.f);
    if (!allowed(h, t)) { hideCursor(); hideStampGhost(); return; }
    if (t === 'stamp') { showStampGhost(h, stampSizeDefault()); return; }
    hideStampGhost();
    const g = brushGeom(t);
    showCursor([h.x + h.nx * g.R * g.off, h.y + h.ny * g.R * g.off, h.z + h.nz * g.R * g.off], g.R, [h.nx, h.ny, h.nz], { p: [h.x, h.y, h.z], r: g.fr });
  }

  const panR = new THREE.Vector3(), panU = new THREE.Vector3(), panF = new THREE.Vector3();
  function pan(dx, dy) {
    camera.updateMatrixWorld();
    const scale = worldPerPx(view.dist);
    camera.matrixWorld.extractBasis(panR, panU, panF);
    view.tx = clamp(view.tx - panR.x * dx * scale + panU.x * dy * scale, -WH + 5, WH - 5);
    view.ty = clamp(view.ty - panR.y * dx * scale + panU.y * dy * scale, 0, 0.9 * WL);
    view.tz = clamp(view.tz - panR.z * dx * scale + panU.z * dy * scale, -WH + 5, WH - 5);
  }

  function navState() {
    const a = Array.from(ptrs.values());
    if (a.length < 2) return null;
    return { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), mx: (a[0].x + a[1].x) / 2, my: (a[0].y + a[1].y) / 2 };
  }
  function navMove() {
    const s = navState();
    if (!s || !navPrev) return;
    if (navPrev.d > 10 && s.d > 10) view.dist = clampDist(view.dist * (navPrev.d / s.d));
    pan(s.mx - navPrev.mx, s.my - navPrev.my);
    navPrev = s;
  }

  /* ------------------------------------------------------------------ Navigation 3D (haut gauche) */
  /* Repère de l'imprimante : X rouge = gauche-droite, Y vert = devant-derrière, Z bleu = haut-bas
     (identique à l'export STL : Z vers le haut). Dans la scène : X → x, Y → -z, Z → y. */
  const gizmo = $('#gizmo'), gctx = gizmo.getContext('2d');
  const AXES = [
    { k: 'X', c: '#ef4444', v: [1, 0, 0] },
    { k: 'Y', c: '#22c55e', v: [0, 0, -1] },
    { k: 'Z', c: '#3b82f6', v: [0, 1, 0] }
  ];
  let gHits = [];
  function sizeGizmo() {
    const r = gizmo.getBoundingClientRect();
    const d = Math.max(60, Math.round(r.width * Math.min(window.devicePixelRatio || 1, 2)));
    if (gizmo.width !== d) { gizmo.width = gizmo.height = d; gizmoKey = ''; }
  }
  function drawGizmo() {
    if (body.classList.contains('nav-closed') && false) return;
    const W = gizmo.width, c = W / 2, R = W * 0.32;
    camera.updateMatrixWorld();
    const m = camera.matrixWorld.elements;
    const right = [m[0], m[1], m[2]], up = [m[4], m[5], m[6]], back = [m[8], m[9], m[10]];
    const proj = (v) => [v[0] * right[0] + v[1] * right[1] + v[2] * right[2], v[0] * up[0] + v[1] * up[1] + v[2] * up[2], v[0] * back[0] + v[1] * back[1] + v[2] * back[2]];
    gctx.clearRect(0, 0, W, W);
    const g = gctx.createRadialGradient(c * 0.8, c * 0.68, W * 0.04, c, c, W * 0.47);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.65, '#f3e9d3'); g.addColorStop(1, '#dac9a4');
    gctx.fillStyle = g; gctx.beginPath(); gctx.arc(c, c, W * 0.47, 0, TAU); gctx.fill();
    gctx.strokeStyle = 'rgba(120,85,40,.4)'; gctx.lineWidth = W * 0.014; gctx.stroke();
    // anneau du sol (plan horizontal) : donne le relief de la sphère
    gctx.strokeStyle = 'rgba(120,85,40,.28)'; gctx.lineWidth = W * 0.012; gctx.setLineDash([W * 0.03, W * 0.03]); gctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * TAU, p = proj([Math.cos(a), 0, Math.sin(a)]);
      const x = c + p[0] * R * 1.05, y = c - p[1] * R * 1.05;
      if (i === 0) gctx.moveTo(x, y); else gctx.lineTo(x, y);
    }
    gctx.stroke(); gctx.setLineDash([]);
    // axes, du plus loin au plus proche
    const items = [];
    for (const a of AXES) for (const sg of [1, -1]) {
      const p = proj([a.v[0] * sg, a.v[1] * sg, a.v[2] * sg]);
      items.push({ a, sg, x: c + p[0] * R, y: c - p[1] * R, z: p[2] });
    }
    items.sort((p, q) => p.z - q.z);
    gHits = [];
    gctx.textAlign = 'center'; gctx.textBaseline = 'middle';
    for (const it of items) {
      const far = it.z < -0.05, pos = it.sg > 0;
      gctx.globalAlpha = far ? 0.55 : 1;
      if (pos) {
        gctx.strokeStyle = it.a.c; gctx.lineWidth = W * 0.034; gctx.lineCap = 'round';
        gctx.beginPath(); gctx.moveTo(c, c); gctx.lineTo(it.x, it.y); gctx.stroke();
      }
      const rad = W * (pos ? 0.092 : 0.052) * (1 + 0.14 * it.z);
      gctx.fillStyle = pos ? it.a.c : '#fffaf0'; gctx.strokeStyle = it.a.c; gctx.lineWidth = W * 0.016;
      gctx.beginPath(); gctx.arc(it.x, it.y, rad, 0, TAU); gctx.fill(); gctx.stroke();
      if (pos) { gctx.fillStyle = '#fff'; gctx.font = '700 ' + Math.round(W * 0.115) + 'px Fredoka, sans-serif'; gctx.fillText(it.a.k, it.x, it.y + W * 0.006); }
      else if (it.a.k === 'Z') { gctx.fillStyle = it.a.c; gctx.font = '700 ' + Math.round(W * 0.07) + 'px sans-serif'; gctx.fillText('×', it.x, it.y); }
      gctx.globalAlpha = 1;
      gHits.push({ x: it.x, y: it.y, r: rad * 1.5, axis: it.a.k, sg: it.sg, z: it.z });
    }
  }
  function lookFromAxis(axis, sg) {
    if (axis === 'X') goTo({ az: nearestAngle(view.az, sg > 0 ? Math.PI / 2 : -Math.PI / 2), el: 0.12 });
    else if (axis === 'Y') goTo({ az: nearestAngle(view.az, sg > 0 ? Math.PI : 0), el: 0.12 });
    else if (sg > 0) goTo({ el: 1.5 });
    else toast('On ne peut pas regarder sous le plateau !');
  }
  let gdrag = null;
  gizmo.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { gizmo.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    gdrag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
  });
  gizmo.addEventListener('pointermove', (e) => {
    if (!gdrag || gdrag.id !== e.pointerId) return;
    const dx = e.clientX - gdrag.x, dy = e.clientY - gdrag.y;
    gdrag.x = e.clientX; gdrag.y = e.clientY; gdrag.moved += Math.abs(dx) + Math.abs(dy);
    if (gdrag.moved > 6) { view.az -= dx * 0.014; view.el = clampEl(view.el + dy * 0.014); invalidate(); }
  });
  const gizmoUp = (e) => {
    if (!gdrag || gdrag.id !== e.pointerId) return;
    const wasTap = gdrag.moved <= 6;
    gdrag = null;
    if (!wasTap || e.type === 'pointercancel') return;
    const r = gizmo.getBoundingClientRect(), s = gizmo.width / r.width;
    const px = (e.clientX - r.left) * s, py = (e.clientY - r.top) * s;
    let best = null;
    for (const h of gHits) if (Math.hypot(px - h.x, py - h.y) <= h.r && (!best || h.z > best.z)) best = h;
    if (best) lookFromAxis(best.axis, best.sg);
  };
  gizmo.addEventListener('pointerup', gizmoUp);
  gizmo.addEventListener('pointercancel', gizmoUp);

  $('#cam-rotl').addEventListener('click', () => goTo({ az: view.az + Math.PI / 4 }));
  $('#cam-rotr').addEventListener('click', () => goTo({ az: view.az - Math.PI / 4 }));
  $('#cam-up').addEventListener('click', () => goTo({ el: view.el + 0.3 }));
  $('#cam-down').addEventListener('click', () => goTo({ el: view.el - 0.3 }));
  $('#zoom-in').addEventListener('click', () => goTo({ dist: view.dist * 0.8 }));
  $('#zoom-out').addEventListener('click', () => goTo({ dist: view.dist * 1.25 }));
  $('#cam-home').addEventListener('click', () => goTo(Object.assign(defaultView(), { az: nearestAngle(view.az, 0) })));
  const VIEWS = { front: { az: 0, el: 0.25 }, side: { az: Math.PI / 2, el: 0.25 }, top: { el: 1.5 } };
  $$('[data-view]').forEach((b) => b.addEventListener('click', () => {
    const v = VIEWS[b.dataset.view], q = {};
    if ('az' in v) q.az = nearestAngle(view.az, v.az);
    q.el = v.el;
    goTo(q);
  }));
  /* zoom : curseur (échelle logarithmique) + molette sur le panneau */
  const zoomSlider = $('#zoom-slider');
  const zoomPos = (d) => 100 * (1 - Math.log(d / DIST_MIN) / Math.log(distMax() / DIST_MIN));
  const distFromPos = (p) => DIST_MIN * Math.pow(distMax() / DIST_MIN, 1 - p / 100);
  zoomSlider.addEventListener('input', () => setNow({ dist: clampDist(distFromPos(+zoomSlider.value)) }));
  function syncZoom() { const v = Math.round(zoomPos(view.dist)); if (+zoomSlider.value !== v) zoomSlider.value = v; }
  $('#nav').addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(wheelFactor(e), null); }, { passive: false });
  $('#btn-nav-toggle').addEventListener('click', () => { opts.navOpen = !opts.navOpen; saveOpts(); applyLayout(); });

  /* ------------------------------------------------------------------ Placement (formes / import) */
  function setPlacementMode(m) {
    placementMode = m;
    $('#pl-mode-move').classList.toggle('active', m === 'move');
    $('#pl-mode-view').classList.toggle('active', m === 'view');
    setHint(m === 'view' ? 'Glisse pour regarder sous tous les angles sans déplacer la forme.' : 'Touche l’endroit de la sculpture ou du plateau où poser la forme.');
  }
  $('#pl-mode-move').addEventListener('click', () => setPlacementMode('move'));
  $('#pl-mode-view').addEventListener('click', () => setPlacementMode('view'));

  function setPlacing(on) {
    body.classList.toggle('placing', on);
    $('#place').hidden = !on;
    $('#stamp-bar').hidden = on || tool !== 'stamp';
    brushBar.hidden = on || !brushBarOpen;
    if (on) { hideStampGhost(); hideCursor(); }
    updateViewOffset(); invalidate();
  }

  /** native = true : la forme garde sa vraie taille (formes de départ) ; sinon taille « agréable » selon que la surface est vide ou non */
  function startPlacement(soup, name, native) {
    cancelPlacement();
    endStroke();
    const norm = IO.normalize(soup);
    const startSize = native ? Math.max(norm.origExt[0], norm.origExt[1], norm.origExt[2])
      : clay.isEmpty() ? Math.min(40, 0.45 * WL) : Math.min(25, 0.4 * WL);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(norm.pos, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, ghostMat);
    mesh.rotation.order = 'YXZ';
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    const xray = new THREE.Mesh(geo, xrayMat);   // silhouette visible même quand la forme est cachée dans l'argile
    xray.frustumCulled = false; xray.renderOrder = 3;
    mesh.add(xray);
    scene.add(mesh);

    // la forme apparaît à l'endroit que l'on regarde (au milieu de la zone libre), pas cachée au centre du plateau
    const rc = canvas.getBoundingClientRect();
    let h = pick({ clientX: rc.left + freeC.x, clientY: rc.top + freeC.y }, clay.f);
    if (!h) h = { x: 0, y: 0, z: 0, floor: true };
    placement = {
      mesh, base: norm.pos, ext: norm.ext, name, geo, ghosts: [],
      size: clamp(startSize, 5, 0.9 * WL), yaw: 0, pitch: 0, roll: 0, offY: 0, carve: false, mirror: false, mirrorAuto: true,
      hit: { x: h.x, y: h.y, z: h.z, floor: h.floor }
    };
    $('#place-name').textContent = name;
    $('#pl-add').classList.add('active');
    $('#pl-carve').classList.remove('active');
    $('#place').classList.remove('expanded');
    $('#pl-more').textContent = 'Plus d’options';
    $('#pl-size').max = String(Math.round(0.9 * WL));
    setPlacing(true);
    setPlacementMode('move');
    updateGhost();
    setHint('Forme prête ! Touche l’endroit où la poser, change sa taille, puis appuie sur « Poser ».');
  }

  function ghostHalfHeight() {
    const p = placement;
    const m = new THREE.Matrix4().makeRotationFromEuler(p.mesh.rotation);
    let maxY = 0;
    const v = new THREE.Vector3();
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      v.set(sx * p.ext[0] / 2, sy * p.ext[1] / 2, sz * p.ext[2] / 2).applyMatrix4(m);
      if (v.y > maxY) maxY = v.y;
    }
    return maxY * p.size;
  }

  function updateGhost() {
    const p = placement;
    if (!p) return;
    p.mesh.scale.setScalar(p.size);
    p.mesh.rotation.set(p.pitch, p.yaw, p.roll, 'YXZ');
    const h = p.hit;
    const x = clamp(h.x, -WH + 1, WH - 1);
    const z = clamp(h.z, -WH + 1, WH - 1);
    const y = h.floor ? ghostHalfHeight() + p.offY : h.y + p.offY;
    p.mesh.position.set(x, Math.max(0, y), z);
    syncMirrorGhosts();

    $('#place-dims').textContent = `L ${(p.ext[0] * p.size / 10).toFixed(1)} × H ${(p.ext[1] * p.size / 10).toFixed(1)} × P ${(p.ext[2] * p.size / 10).toFixed(1)} cm`;
    $('#place-size-label').textContent = (p.size / 10).toFixed(1) + ' cm';
    $('#pl-size').value = Math.round(p.size);
    const deg = (r) => { let d = Math.round((r * 180 / Math.PI) % 360); if (d < 0) d += 360; return d; };
    $('#place-angles-label').textContent = `Y: ${deg(p.yaw)}° · X: ${deg(p.pitch)}° · Z: ${deg(p.roll)}°`;
    ghostMat.opacity = opts.boolPreview ? 0.3 : 0.78;       // avec l'aperçu, on voit le résultat à travers la forme
    schedulePreview();
    invalidate();
  }

  function moveGhost(h) {
    if (!placement) return;
    placement.hit = { x: h.x, y: h.y, z: h.z, floor: h.floor };
    updateGhost();
  }

  /** Copies « miroir » de la forme (symétrie active) : on voit exactement ce qui sera posé */
  const mirM4 = new THREE.Matrix4();
  function syncMirrorGhosts() {
    const p = placement, xs = xfs();
    // par défaut : un objet posé sur le plateau reste seul ; posé sur la sculpture (yeux, oreilles…), la symétrie le double.
    // Le bouton « Miroir » reprend la main.
    if (p.mirrorAuto) p.mirror = sym !== 'off' && !p.hit.floor;
    const chip = $('#pl-mirror');
    chip.hidden = sym === 'off';
    chip.classList.toggle('off', !p.mirror);
    chip.textContent = p.mirror ? 'Miroir : ' + SYMS[sym].label : 'Miroir : non';
    p.mesh.updateMatrix();
    while (p.ghosts.length < xs.length - 1) {            // une copie par transformation de la symétrie (sauf l'identité)
      const m = new THREE.Mesh(p.geo, ghostMat);
      m.frustumCulled = false; m.renderOrder = 4; m.matrixAutoUpdate = false;
      const xr = new THREE.Mesh(p.geo, xrayMat);
      xr.frustumCulled = false; xr.renderOrder = 3;
      m.add(xr);
      scene.add(m);
      p.ghosts.push(m);
    }
    const pc = [p.mesh.position.x, p.mesh.position.y, p.mesh.position.z];
    p.ghosts.forEach((m, i) => {
      const M = xs[i + 1];
      if (!M) { m.visible = false; return; }
      const q = ap(M, pc);
      m.visible = p.mirror && Math.hypot(q[0] - pc[0], q[1] - pc[1], q[2] - pc[2]) >= 2;   // au centre, la copie se confond avec la forme
      mirM4.set(M[0], M[1], M[2], 0, M[3], M[4], M[5], 0, M[6], M[7], M[8], 0, 0, 0, 0, 1);
      m.matrix.multiplyMatrices(mirM4, p.mesh.matrix);
      m.matrixWorldNeedsUpdate = true;
    });
  }
  $('#pl-mirror').addEventListener('click', () => { if (placement) { placement.mirrorAuto = false; placement.mirror = !placement.mirror; updateGhost(); } });

  function cancelPlacement() {
    if (!placement) return;
    clearPreview();
    scene.remove(placement.mesh);
    for (const g of placement.ghosts) scene.remove(g);
    placement.geo.dispose();
    placement = null;
    setPlacing(false);
  }

  /* Aperçu en direct du booléen (Coller / Creuser) : la forme est vraiment collée ou creusée dans la sculpture, puis
     * annulée au coup suivant. Un seul calcul à la fois, espacé de 3× son propre coût : le déplacement reste fluide. */
  let pvEntry = null, pvTimer = 0, pvLast = 0, pvCost = 20;
  function clearPreview() {
    clearTimeout(pvTimer); pvTimer = 0;
    if (pvEntry) { clay.undoEntry(pvEntry); pvEntry = null; invalidate(); }
  }
  function schedulePreview() {
    if (!opts.boolPreview || !placement || pvTimer) return;
    pvTimer = setTimeout(runPreview, Math.max(0, pvLast + Math.max(80, pvCost * 3) - performance.now()));
  }
  function runPreview() {
    pvTimer = 0;
    if (!placement || !opts.boolPreview) return;
    const t0 = performance.now();
    if (pvEntry) { clay.undoEntry(pvEntry); pvEntry = null; }
    pvEntry = placementEdit(placement);
    pvLast = performance.now(); pvCost = pvLast - t0;
    invalidate();
  }
  /** Colle ou creuse la forme (et ses copies miroir) dans la sculpture ; retourne l'entrée d'historique (ou null) */
  function placementEdit(p) {
    p.mesh.updateMatrix();
    const e = p.mesh.matrix.elements;
    const b = p.base, n = b.length;
    const world = new Float32Array(n);
    for (let i = 0; i < n; i += 3) {
      const x = b[i], y = b[i + 1], z = b[i + 2];
      world[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
      world[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      world[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    }
    const m = p.carve ? 'remove' : 'add';
    clay.beginEdit();
    const pc = [p.mesh.position.x, p.mesh.position.y, p.mesh.position.z];
    xfs().forEach((M, i) => {
      if (i === 0) { clay.stampMesh(world, m); return; }
      if (!p.mirror) return;                                   // la copie n'est posée que si on la voit
      const q = ap(M, pc);
      if (Math.hypot(q[0] - pc[0], q[1] - pc[1], q[2] - pc[2]) < 2) return;
      clay.stampMesh(applyM(world, M), m);
    });
    clay.relaxBox(0.5); clay.relaxBox(0.4);
    return clay.endEdit();
  }

  function validatePlacement() {
    const p = placement;
    if (!p) return;
    clearPreview();
    const entry = placementEdit(p);
    if (!entry) toast(p.carve ? 'Il n’y a rien à creuser à cet endroit !' : 'La forme est en dehors du plateau !');
    pushUndo(entry);
    if (entry) Sfx.place();
    cancelPlacement();
    setTool('add');
  }

  $('#pl-ok').addEventListener('click', validatePlacement);
  $('#pl-cancel').addEventListener('click', cancelPlacement);

  /* --- rotation, position, échelle --- */
  const bump = (k, v) => () => { if (placement) { placement[k] += v; updateGhost(); } };
  $('#pl-yaw-m45').addEventListener('click', bump('yaw', -Math.PI / 4));
  $('#pl-yaw-l').addEventListener('click', bump('yaw', -Math.PI / 12));
  $('#pl-yaw-r').addEventListener('click', bump('yaw', Math.PI / 12));
  $('#pl-yaw-p45').addEventListener('click', bump('yaw', Math.PI / 4));
  $('#pl-pitch-b').addEventListener('click', bump('pitch', -Math.PI / 4));
  $('#pl-pitch-f').addEventListener('click', bump('pitch', Math.PI / 4));
  $('#pl-roll-l').addEventListener('click', bump('roll', -Math.PI / 4));
  $('#pl-roll-r').addEventListener('click', bump('roll', Math.PI / 4));
  $('#pl-q-l').addEventListener('click', bump('yaw', -Math.PI / 6));
  $('#pl-q-r').addEventListener('click', bump('yaw', Math.PI / 6));
  $('#pl-q-flip').addEventListener('click', bump('pitch', Math.PI / 2));
  $('#pl-more').addEventListener('click', () => {
    const open = $('#place').classList.toggle('expanded');
    $('#pl-more').textContent = open ? 'Moins d’options' : 'Plus d’options';
    updateViewOffset(); invalidate();
  });
  $('#pl-rot-reset').addEventListener('click', () => {
    if (placement) { placement.yaw = placement.pitch = placement.roll = 0; updateGhost(); toast('Rotation remise à zéro (0°)'); }
  });
  $('#pl-step-left').addEventListener('click', () => { if (placement) { placement.hit.x -= 2.5; updateGhost(); } });
  $('#pl-step-right').addEventListener('click', () => { if (placement) { placement.hit.x += 2.5; updateGhost(); } });
  $('#pl-step-back').addEventListener('click', () => { if (placement) { placement.hit.z -= 2.5; updateGhost(); } });
  $('#pl-step-fwd').addEventListener('click', () => { if (placement) { placement.hit.z += 2.5; updateGhost(); } });
  $('#pl-up').addEventListener('click', bump('offY', 2.5));
  $('#pl-down').addEventListener('click', bump('offY', -2.5));
  $('#pl-center').addEventListener('click', () => { if (placement) { placement.hit.x = 0; placement.hit.z = 0; updateGhost(); toast('Forme centrée sur le plateau'); } });
  $('#pl-floor').addEventListener('click', () => {
    if (placement) { placement.hit.floor = true; placement.hit.y = 0; placement.offY = 0; updateGhost(); toast('Forme posée au sol du plateau'); }
  });
  const sizeMax = () => 0.9 * WL;
  $('#pl-bigger').addEventListener('click', () => { if (placement) { placement.size = Math.min(sizeMax(), placement.size * 1.15); updateGhost(); } });
  $('#pl-smaller').addEventListener('click', () => { if (placement) { placement.size = Math.max(5, placement.size / 1.15); updateGhost(); } });
  $('#pl-double').addEventListener('click', () => { if (placement) { placement.size = Math.min(sizeMax(), placement.size * 2); updateGhost(); } });
  $('#pl-half').addEventListener('click', () => { if (placement) { placement.size = Math.max(5, placement.size * 0.5); updateGhost(); } });
  $('#pl-size').addEventListener('input', (e) => { if (placement) { placement.size = +e.target.value; updateGhost(); } });
  $$('.chip[data-scale]').forEach((chip) => chip.addEventListener('click', () => { if (placement) { placement.size = +chip.dataset.scale; updateGhost(); } }));
  $('#pl-add').addEventListener('click', () => {
    if (placement) { placement.carve = false; $('#pl-add').classList.add('active'); $('#pl-carve').classList.remove('active'); schedulePreview(); }
  });
  $('#pl-carve').addEventListener('click', () => {
    if (placement) { placement.carve = true; $('#pl-carve').classList.add('active'); $('#pl-add').classList.remove('active'); schedulePreview(); }
  });

  /* ------------------------------------------------------------------ Fenêtres, formes, import */
  function openModal(id) { $(id).hidden = false; }
  function closeModals() { $$('.modal').forEach((m) => { if (m.id !== 'nogl') m.hidden = true; }); }
  $$('[data-close]').forEach((b) => b.addEventListener('click', closeModals));
  $$('.modal').forEach((m) => m.addEventListener('pointerdown', (e) => { if (e.target === m && m.id !== 'nogl') m.hidden = true; }));

  /* fenêtre « Formes » : formes simples, puis les formes de départ (personnages, animaux, maison…) à poser comme des objets */
  const shapeList = $('#shape-list');
  function shapeSection(title, items, gridId) {
    const h = document.createElement('h3');
    h.textContent = title;
    const grid = document.createElement('div');
    grid.className = 'shape-grid';
    if (gridId) grid.id = gridId;
    for (const it of items) {
      const b = document.createElement('button');
      b.className = 'shape';
      b.innerHTML = '<i>' + it.emoji + '</i><span>' + it.name + '</span>';
      b.addEventListener('click', it.pick);
      grid.appendChild(b);
    }
    shapeList.appendChild(h); shapeList.appendChild(grid);
  }
  /** Pose une forme de départ comme un objet : on la construit à part (la sculpture n'est pas touchée) puis on la place */
  function placeStarter(s) {
    closeModals();
    const soup = clay.starterSoup(s.id);
    if (!soup) { toast('Cette forme est vide !'); return; }
    startPlacement(soup, s.name, true);
  }
  shapeSection('Formes simples', IO.SHAPES.map((s) => ({
    emoji: s.emoji, name: s.name, pick: () => { closeModals(); startPlacement(IO.shapeSoup(THREE, s.id), s.name); }
  })), 'shape-grid');
  ['Personnages', 'Animaux', 'Objets', 'Bases'].forEach((cat) => {
    const items = ClayStarters.list.filter((s) => s.cat === cat && s.id !== 'ball');   // la boule existe déjà dans les formes simples
    shapeSection(cat === 'Bases' ? 'Autres formes' : cat, items.map((s) => ({ emoji: s.emoji, name: s.name, pick: () => placeStarter(s) })));
  });
  function openShapes() {
    $('#shapes-tip').textContent = clay.isEmpty()
      ? 'Surface vide : choisis ta forme, elle apparaît sur le plateau. Touche l’endroit où la poser, change sa taille, puis appuie sur « Poser ». (Ferme cette fenêtre pour dessiner avec « Ajouter ».)'
      : 'Touche une forme : elle apparaît sur ta sculpture. Touche l’endroit où la poser, change sa taille, puis appuie sur « Poser ».';
    openModal('#modal-shapes');
  }
  $('#btn-shapes').addEventListener('click', openShapes);
  $('#btn-import').addEventListener('click', () => $('#file').click());
  $('#btn-import-top').addEventListener('click', () => $('#file').click());
  $('#btn-import-dock').addEventListener('click', () => $('#file').click());
  $('#file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) handleFile(f);
    e.target.value = '';
  });

  function handleFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext !== 'stl' && ext !== 'obj') { toast('Je lis les fichiers .stl et .obj'); return; }
    const reader = new FileReader();
    reader.onerror = () => toast('Impossible de lire ce fichier');
    reader.onload = () => {
      try {
        const soup = ext === 'stl' ? IO.parseSTL(reader.result) : IO.parseOBJ(reader.result);
        if (soup.length < 9) { toast('Ce fichier ne contient pas de forme 3D'); return; }
        const nTri = Math.round(soup.length / 9);
        if (nTri > 500000) { toast('Ce fichier est trop gros (plus de 500 000 triangles)'); return; }
        closeModals();
        startPlacement(soup, file.name.replace(/\.[^.]+$/, '').slice(0, 24));
        toast(`Fichier ${file.name} chargé (${nTri.toLocaleString('fr-FR')} triangles)`);
      } catch (err) {
        console.error(err);
        toast('Ce fichier n’a pas pu être lu. Vérifie le format STL ou OBJ.');
      }
    };
    if (ext === 'stl') reader.readAsArrayBuffer(file); else reader.readAsText(file);
  }

  // glisser-déposer d'un fichier
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('#drop').hidden = false; });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop').hidden = true; } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; $('#drop').hidden = true;
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  /* nouveau : formes de départ classées (bases, personnages, animaux, objets) */
  const starterList = $('#starter-list');
  ClayStarters.categories.forEach((cat) => {
    const h = document.createElement('h3');
    h.textContent = cat;
    const grid = document.createElement('div');
    grid.className = 'shape-grid';
    ClayStarters.list.filter((s) => s.cat === cat).forEach((s) => {
      const b = document.createElement('button');
      b.className = 'shape';
      b.dataset.start = s.id;
      b.innerHTML = '<i>' + s.emoji + '</i><span>' + s.name + '</span>';
      b.addEventListener('click', () => startFrom(s.id));
      grid.appendChild(b);
    });
    starterList.appendChild(h); starterList.appendChild(grid);
  });
  function startFrom(id) {
    closeModals();
    cancelPlacement();
    undoStack.length = 0; redoStack.length = 0;
    clay.reset(id);
    refreshUndo();                                 // met aussi à jour l'état « surface vide »
    goTo(Object.assign(defaultView(), { az: nearestAngle(view.az, 0) }));
    scheduleSave();
    shadowDirty = true;
    invalidate();
    Sfx.place();
    setHint(id === 'empty' ? 'Surface vide ! Pose une forme avec « Formes », ou dessine avec « Ajouter ».' : 'Voilà ta pâte ! À toi de jouer.');
  }
  // « Surface vide » : on part de zéro et on ouvre tout de suite le choix des formes à poser soi-même
  $('#start-empty').addEventListener('click', () => { startFrom('empty'); openShapes(); });
  $('#btn-new').addEventListener('click', () => openModal('#modal-new'));
  $('#btn-help').addEventListener('click', () => openModal('#modal-help'));

  $('#btn-smooth-all').addEventListener('click', () => {
    endStroke();
    clay.beginEdit();
    const ok = clay.smoothAll(0.6);
    const entry = clay.endEdit();
    if (!ok || !entry) { toast('Il n’y a rien à lisser !'); return; }
    pushUndo(entry);
    Sfx.smooth();
    invalidate();
  });

  /* étirer toute la forme */
  $$('[data-scale-all]').forEach((b) => b.addEventListener('click', () => {
    endStroke();
    const [sx, sy, sz] = b.dataset.scaleAll.split(',').map(Number);
    clay.beginEdit();
    const ok = clay.scaleAbout(sx, sy, sz);
    if (ok) clay.relaxBox(0.3);
    const entry = clay.endEdit();
    if (!entry) { toast('Il n’y a rien à étirer !'); return; }
    pushUndo(entry);
    Sfx.place();
    invalidate();
  }));

  /* sons */
  const syncSoundIcon = () => $('#sound-use').setAttribute('href', Sfx.isOn() ? '#i-sound-on' : '#i-sound-off');
  syncSoundIcon();
  $('#btn-sound').addEventListener('click', () => { Sfx.toggle(); syncSoundIcon(); });

  /* ------------------------------------------------------------------ Options */
  function applyDisplay() {
    const real = opts.display === 'real';
    clay.useMaterial(real ? clayReal : clayMatcap);
    lights.visible = real;
    shadowMesh.visible = opts.display !== 'eco';
    plateTex.anisotropy = opts.display === 'eco' ? 1 : Math.min(8, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1);
    plateTex.needsUpdate = true;
    shadowDirty = true;
    pr = basePixelRatio();
    resize();
  }
  function afterGridChange(msg) {
    endStroke();
    undoStack.length = 0; redoStack.length = 0; refreshUndo();
    syncWorld();
    shadowDirty = true;
    scheduleSave();
    invalidate();
    if (msg) toast(msg);
  }
  function applyResolution(n, announce) {
    const target = gridSizeFor(WL, n);
    if (clay.resolution === target) return;
    cancelPlacement();
    clay.setWorld(WL, target);
    afterGridChange(announce ? 'Résolution : ' + (n <= 40 ? 'minimale' : n <= 56 ? 'éco' : n >= 112 ? 'fine' : 'normale') : '');
  }
  /** Change la taille du plateau : la sculpture reste au centre, posée sur le sol */
  function applyWorld(lw, announce) {
    if (Math.abs(lw - WL) < 0.01) return;
    cancelPlacement();
    clay.setWorld(lw, gridSizeFor(lw, opts.res));
    syncWorld();
    buildWorld();
    goTo(Object.assign(defaultView(), { az: nearestAngle(view.az, 0) }));
    afterGridChange(announce ? 'Plateau de ' + (Math.round(lw) / 10) + ' cm' + (lw > 100 ? ' : plus de place pour construire !' : '') : '');
    resize();
  }
  function applyLayout() {
    computeFs();
    body.classList.toggle('tools-right', opts.side === 'right');
    const open = isPortrait() ? opts.sideOpenP : opts.sideOpen;
    body.classList.toggle('side-closed', !open);
    body.classList.toggle('nav-closed', !opts.navOpen);
    $('#btn-side-toggle').setAttribute('aria-expanded', String(open));
    $('#btn-nav-toggle').setAttribute('aria-expanded', String(opts.navOpen));
    syncBrushUI();
    syncOptionsUI();
    resize();
  }
  $('#btn-side-toggle').addEventListener('click', () => {
    if (isPortrait()) opts.sideOpenP = !opts.sideOpenP; else opts.sideOpen = !opts.sideOpen;
    saveOpts(); applyLayout();
  });
  /* préréglages de performances : un choix règle d'un coup résolution, affichage, netteté et maillage d'export */
  const PERF = {
    min: { label: 'Très faible', res: 40, display: 'eco', sharp: 0.6, exportQ: 'std', bool: false },
    low: { label: 'Faible', res: 56, display: 'eco', sharp: 1, exportQ: 'std', bool: false },
    mid: { label: 'Normal', res: 80, display: 'norm', sharp: 1, exportQ: 'dense', bool: true },
    high: { label: 'Élevé', res: 112, display: 'real', sharp: 1, exportQ: 'dense', bool: true }
  };
  function applyPerf(id) {
    const pf = PERF[id];
    if (!pf) return;
    opts.perf = id; opts.res = pf.res; opts.display = pf.display; opts.sharp = pf.sharp; opts.exportQ = pf.exportQ; opts.boolPreview = pf.bool;
    saveOpts();
    applyDisplay();
    applyResolution(opts.res, false);
    syncOptionsUI();
    toast('Performances : ' + pf.label.toLowerCase() + ' (réglages appliqués)');
  }
  const customPerf = () => { opts.perf = 'custom'; };
  function syncOptionsUI() {
    $$('#opt-perf .seg-btn').forEach((x) => x.classList.toggle('active', x.dataset.v === opts.perf));
    $$('#opt-world .seg-btn').forEach((x) => x.classList.toggle('active', Math.abs(+x.dataset.v - WL) < 0.01));
    const cm = $('#opt-world-cm');
    if (document.activeElement !== cm) cm.value = String(Math.round(WL) / 10);
    const g = ClayEngine.grid();
    $('#world-info').textContent = 'Plateau de ' + (Math.round(WL) / 10) + ' cm : petits cubes de ' + g.H.toFixed(2) + ' mm (grille ' + g.N + '³).' +
      (WL > 200 ? ' Plus le plateau est grand, moins la sculpture est fine : demande un appareil puissant.' : ' Un plateau plus grand permet de construire des scènes ; ta sculpture est conservée.');
    $$('#opt-ui .seg-btn').forEach((x) => x.classList.toggle('active', +x.dataset.v === opts.ui));
    $$('#opt-side .seg-btn').forEach((x) => x.classList.toggle('active', x.dataset.v === opts.side));
    $$('#opt-res .seg-btn').forEach((x) => x.classList.toggle('active', +x.dataset.v === opts.res));
    $$('#opt-display .seg-btn').forEach((x) => x.classList.toggle('active', x.dataset.v === opts.display));
    $$('#opt-sharp .seg-btn').forEach((x) => x.classList.toggle('active', +x.dataset.v === opts.sharp));
    $$('#opt-pen .seg-btn').forEach((x) => x.classList.toggle('active', x.dataset.v === opts.penMode));
    $$('#opt-export .seg-btn').forEach((x) => x.classList.toggle('active', x.dataset.v === opts.exportQ));
    $$('#opt-bool .seg-btn').forEach((x) => x.classList.toggle('active', (x.dataset.v === '1') === opts.boolPreview));
    seriesBtn.classList.toggle('active', !!opts.stampSeries);
  }
  $('#btn-options').addEventListener('click', () => { syncOptionsUI(); openModal('#modal-options'); });
  $$('#opt-perf .seg-btn').forEach((b) => b.addEventListener('click', () => applyPerf(b.dataset.v)));
  $$('#opt-world .seg-btn').forEach((b) => b.addEventListener('click', () => { opts.world = +b.dataset.v; saveOpts(); applyWorld(opts.world, true); syncOptionsUI(); }));
  /** Taille du plateau choisie à la main (6 à 40 cm) */
  function applyCustomWorld() {
    const v = parseFloat(String($('#opt-world-cm').value).replace(',', '.'));
    if (!(v >= 6 && v <= 40)) { toast('Choisis une taille entre 6 et 40 cm'); return; }
    opts.world = Math.round(v * 10); saveOpts();
    applyWorld(opts.world, true);
    $('#opt-world-cm').blur();
    syncOptionsUI();
  }
  $('#opt-world-ok').addEventListener('click', applyCustomWorld);
  $('#opt-world-cm').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyCustomWorld(); } });
  $$('#opt-ui .seg-btn').forEach((b) => b.addEventListener('click', () => { opts.ui = +b.dataset.v; saveOpts(); applyLayout(); }));
  $$('#opt-side .seg-btn').forEach((b) => b.addEventListener('click', () => { opts.side = b.dataset.v; saveOpts(); applyLayout(); }));
  $$('#opt-res .seg-btn').forEach((b) => b.addEventListener('click', () => { opts.res = +b.dataset.v; customPerf(); saveOpts(); syncOptionsUI(); applyResolution(opts.res, true); }));
  $$('#opt-display .seg-btn').forEach((b) => b.addEventListener('click', () => { opts.display = b.dataset.v; customPerf(); saveOpts(); syncOptionsUI(); applyDisplay(); }));
  $$('#opt-sharp .seg-btn').forEach((b) => b.addEventListener('click', () => { opts.sharp = +b.dataset.v; customPerf(); saveOpts(); syncOptionsUI(); applyDisplay(); }));
  $$('#opt-pen .seg-btn').forEach((b) => b.addEventListener('click', () => { opts.penMode = b.dataset.v; saveOpts(); syncOptionsUI(); }));
  $$('#opt-bool .seg-btn').forEach((b) => b.addEventListener('click', () => {
    opts.boolPreview = b.dataset.v === '1'; saveOpts(); syncOptionsUI();
    if (opts.boolPreview) schedulePreview(); else clearPreview();
    if (placement) updateGhost();
  }));
  $$('#opt-export .seg-btn').forEach((b) => b.addEventListener('click', () => { opts.exportQ = b.dataset.v; customPerf(); saveOpts(); syncOptionsUI(); }));

  let resizeTimer = 0;
  const onResize = () => { computeFs(); clearTimeout(resizeTimer); resizeTimer = setTimeout(applyLayout, 60); resize(); };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);

  /* ------------------------------------------------------------------ Impression */
  let exportMesh = null;
  let exportMm = 80;
  function updatePrintStats() {
    const m = exportMesh;
    if (!m) return;
    const t = IO.transformForPrint(m, exportMm);
    const vol = (m.volume * Math.pow(t.scale, 3)) / 1000;
    $('#print-stats').innerHTML =
      'Taille : ' + (t.size[0] / 10).toFixed(1) + ' × ' + (t.size[1] / 10).toFixed(1) + ' × ' + (t.size[2] / 10).toFixed(1) + ' cm<br>' +
      'Matière : ' + vol.toFixed(1) + ' cm³ · ' + m.nTri.toLocaleString('fr-FR') + ' triangles · fichier ≈ ' + (m.nTri * 50 / 1e6).toFixed(1) + ' Mo (grille ' + m.res + ')' +
      (m.removed ? '<br>' + m.removed + ' petit(s) débris retiré(s) automatiquement' : '');
  }
  $('#btn-print').addEventListener('click', () => {
    endStroke();
    openModal('#modal-print');
    computeExport();
  });
  function denseTarget() { return Math.min(200, Math.max(144, clay.resolution * 2)); }
  function ultraTarget() { return Math.min(240, Math.max(200, clay.resolution * 3)); }
  const EXPORT_PLAN = () => opts.exportQ === 'ultra' ? [ultraTarget(), 18] : opts.exportQ === 'dense' ? [denseTarget(), 14] : [0, 8];

  /* Le calcul se fait dans un Web Worker (interface toujours fluide) ; repli sur le fil principal si indisponible. */
  let exportWorker = null, workerBroken = false, exportId = 0;
  function getWorker() {
    if (workerBroken || typeof Worker === 'undefined') return null;
    if (!exportWorker) {
      try {
        exportWorker = new Worker('js/exportWorker.js?v=39');
        exportWorker.onmessage = (e) => onExportDone(e.data);
        exportWorker.onerror = () => { workerBroken = true; exportWorker = null; if (pendingExport) runExportSync(); };
      } catch (err) { workerBroken = true; exportWorker = null; }
    }
    return exportWorker;
  }
  let pendingExport = null;
  function onExportDone(d) {
    if (!pendingExport || d.id !== pendingExport.id) return;      // résultat périmé (qualité changée entre-temps)
    pendingExport = null;
    if (d.error) { showExportError(); return; }
    showExport(d.mesh);
  }
  function showExportError() {
    const st = $('#print-status');
    st.className = 'status bad'; st.textContent = 'Le calcul a échoué. Essaie une qualité plus légère.';
  }
  function showExport(m) {
    const st = $('#print-status');
    if (m.nTri === 0) {
      st.className = 'status bad'; st.textContent = 'Il n’y a rien à imprimer : ajoute de l’argile !';
      return;
    }
    exportMesh = m;
    if (m.manifold) {
      st.className = 'status ok'; st.textContent = 'Ton objet est solide et prêt pour l’impression 3D !';
    } else {
      st.className = 'status bad'; st.textContent = 'Il y a un petit souci dans la forme (' + m.problems + '). Lisse un peu et réessaie.';
    }
    $('#dl-stl').disabled = $('#dl-obj').disabled = !m.manifold;
    updatePrintStats();
  }
  function runExportSync() {
    const job = pendingExport;
    pendingExport = null;
    if (!job) return;
    setTimeout(() => { showExport(clay.buildExport(job.target, job.iters)); }, 30);
  }
  function computeExport() {
    clearPreview();
    exportMesh = null;
    const st = $('#print-status');
    st.className = 'status'; st.textContent = opts.exportQ === 'std' ? 'Vérification…' : 'Calcul du maillage lisse… (quelques secondes)';
    $('#print-stats').textContent = '';
    $('#dl-stl').disabled = $('#dl-obj').disabled = true;
    $$('#print-quality .seg-btn').forEach((x) => x.classList.toggle('active', x.dataset.q === opts.exportQ));
    const plan = EXPORT_PLAN();
    pendingExport = { id: ++exportId, target: plan[0], iters: plan[1] };
    const w = getWorker();
    if (w) {
      const field = clay.f.slice();
      w.postMessage({ id: pendingExport.id, field, n: clay.resolution, L: clay.world, target: plan[0], iters: plan[1] }, [field.buffer]);
    } else runExportSync();
  }
  $$('#print-quality .seg-btn').forEach((b) => b.addEventListener('click', () => {
    if (opts.exportQ === b.dataset.q) return;
    opts.exportQ = b.dataset.q; saveOpts(); syncOptionsUI();
    computeExport();
  }));
  $$('#print-sizes .seg-btn').forEach((b) => b.addEventListener('click', () => {
    exportMm = +b.dataset.mm;
    $$('#print-sizes .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    updatePrintStats();
  }));
  $('#dl-stl').addEventListener('click', () => { if (exportMesh) { IO.download(IO.writeSTL(exportMesh, exportMm), 'ma-sculpture.stl'); Sfx.tada(); toast('Bravo ! Ton fichier est prêt.'); } });
  $('#dl-obj').addEventListener('click', () => { if (exportMesh) { IO.download(IO.writeOBJ(exportMesh, exportMm), 'ma-sculpture.obj'); Sfx.tada(); toast('Bravo ! Ton fichier est prêt.'); } });

  /* ------------------------------------------------------------------ Démarrage */
  let loaded = false;
  let ci = 0;
  try { ci = parseInt(localStorage.getItem('pate3d.color') || '0', 10) || 0; } catch (e) { /* ignore */ }
  try {
    const s = localStorage.getItem('pate3d.v3') || localStorage.getItem('pate3d.v2');
    if (s) { clay.deserialize(s); loaded = true; }            // une surface vide est une sauvegarde valide
  } catch (e) { loaded = false; console.warn('Sauvegarde illisible : nouvelle sculpture', e); }
  clay.paint = clamp(ci, 0, clay.pal.length - 1);
  if (loaded && !clay.loadedColors) clay.col.fill(clay.paint);   // ancienne sauvegarde sans couleurs : toute la sculpture prend la couleur qui était choisie
  // les OPTIONS sont la référence (taille du plateau, résolution…) : si la sauvegarde date d'avant (ou d'un autre réglage), la sculpture est
  // rééchantillonnée pour les respecter ; les options ne sont jamais écrasées par ce qui est chargé
  const wantN = gridSizeFor(opts.world, opts.res);
  if (!loaded) { clay.setWorld(opts.world, wantN); clay.reset(); }
  else if (Math.abs(clay.world - opts.world) > 0.01 || clay.resolution !== wantN) clay.setWorld(opts.world, wantN);
  syncWorld();
  buildWorld();
  Object.assign(view, defaultView());
  renderPalette();
  pickColor(clay.paint);
  refreshUndo();
  setSym(opts.sym, false);
  applyDisplay();
  setTool('add');
  applyLayout();
  setHint(loaded ? (clay.isEmpty() ? 'Surface vide ! Pose une forme avec « Formes », ou dessine avec « Ajouter ».' : 'Content de te revoir ! Continue ta sculpture.') : 'Bienvenue ! Touche l’argile pour la sculpter.');
  try { if (!localStorage.getItem('pate3d.seen')) { localStorage.setItem('pate3d.seen', '1'); openModal('#modal-help'); } } catch (e) { /* ignore */ }
  applyCamera();
  invalidate();

  // numéro de version (celui de ?v=N dans index.html) : permet de vérifier qu'on utilise bien la dernière mise à jour
  try {
    const me = Array.from(document.scripts).find((s) => /js\/app\.js/.test(s.src));
    const ver = me && /[?&]v=(\d+)/.exec(me.src);
    $('#app-version').textContent = ver ? 'Version ' + ver[1] : '';
  } catch (e) { /* ignore */ }

  // pour les tests / débogage
  window.__pate = {
    clay, view, goal: view, pick, camera, renderer, opts, cursors, stampGhost, drawGizmo, gHits: () => gHits,
    dbg: () => ({ mode, ptrs: ptrs.size, queued: strokeQ.length, tool, placing: !!placement, stroke: !!stroke }),
    step: () => { if (raf) cancelAnimationFrame(raf); raf = 0; frame(performance.now()); },
    startPlacement, getPlacement: () => placement, getStroke: () => stroke, applyWorld, gridSizeFor, zoomPos, distFromPos, applyPerf, setTool, keyMods,
    setPixelRatio: (v) => setPixelRatio(v, 0), getPixelRatio: () => pr, freeC
  };
})();
