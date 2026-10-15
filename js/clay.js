/* ==========================================================================
   Clay engine : champ de densité (voxels) + surface "marching tetrahedra".
   La surface extraite est TOUJOURS fermée et manifold (2 triangles par arête),
   donc imprimable en 3D quoi que fasse l'enfant.
   ========================================================================== */
(function (global) {
  'use strict';

  const ISO = 0.5;
  const C = 16;                    // cellules par chunk
  let L = 100, HALF = 50;          // taille du plateau / volume de travail (mm), modifiable : voir configure
  // grille courante (modifiable : voir configure)
  let N, H, FK, FLOOR_Y, NC, N2, N3, COFF, DELTA;

  /** Paramètres d'une grille de n voxels par axe sur un plateau de lw mm : le sol reste à y = 0 quelle que soit la résolution */
  function gridParams(n, lw) {
    const h = (lw || L) / (n - 1);
    const fk = Math.max(2, Math.round(3.1646 / h + 0.5));
    return { n, h, fk, fy: (fk - 0.5) * h };
  }

  /* ---------------------------------------------------------------- Échantillonnage */
  /** Interpolation trilinéaire d'une carte à 3 composantes par voxel ; le résultat est écrit dans out[0..2] */
  const _mo = [0, 0, 0];
  function sampleMap(m, x, y, z, out) {
    if (x < 0) x = 0; else if (x > N - 1) x = N - 1;
    if (y < 0) y = 0; else if (y > N - 1) y = N - 1;
    if (z < 0) z = 0; else if (z > N - 1) z = N - 1;
    let i = x | 0, j = y | 0, k = z | 0;
    if (i > N - 2) i = N - 2;
    if (j > N - 2) j = N - 2;
    if (k > N - 2) k = N - 2;
    const fx = x - i, fy = y - j, fz = z - k, b = (i + j * N + k * N2) * 3, sN = N * 3, sN2 = N2 * 3;
    for (let c = 0; c < 3; c++) {
      const o = b + c;
      const c00 = m[o] * (1 - fx) + m[o + 3] * fx;
      const c10 = m[o + sN] * (1 - fx) + m[o + sN + 3] * fx;
      const c01 = m[o + sN2] * (1 - fx) + m[o + sN2 + 3] * fx;
      const c11 = m[o + sN + sN2] * (1 - fx) + m[o + sN + sN2 + 3] * fx;
      out[c] = (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz;
    }
  }
  function sample(f, x, y, z) {
    if (x < 0) x = 0; else if (x > N - 1) x = N - 1;
    if (y < 0) y = 0; else if (y > N - 1) y = N - 1;
    if (z < 0) z = 0; else if (z > N - 1) z = N - 1;
    let i = x | 0, j = y | 0, k = z | 0;
    if (i > N - 2) i = N - 2;
    if (j > N - 2) j = N - 2;
    if (k > N - 2) k = N - 2;
    const fx = x - i, fy = y - j, fz = z - k;
    const b = i + j * N + k * N2;
    const c00 = f[b] * (1 - fx) + f[b + 1] * fx;
    const c10 = f[b + N] * (1 - fx) + f[b + N + 1] * fx;
    const c01 = f[b + N2] * (1 - fx) + f[b + N2 + 1] * fx;
    const c11 = f[b + N + N2] * (1 - fx) + f[b + N + N2 + 1] * fx;
    const c0 = c00 * (1 - fy) + c10 * fy;
    const c1 = c01 * (1 - fy) + c11 * fy;
    return c0 * (1 - fz) + c1 * fz;
  }

  /** Rayon (monde) contre le champ. Retourne {t,x,y,z,nx,ny,nz} ou null. */
  function raycast(f, ox, oy, oz, dx, dy, dz) {
    const go = [(ox + HALF) / H, (oy + FLOOR_Y) / H, (oz + HALF) / H];
    const gd = [dx / H, dy / H, dz / H];
    let t0 = 0, t1 = Infinity;
    for (let a = 0; a < 3; a++) {
      const lo = 1, hi = N - 2;
      if (Math.abs(gd[a]) < 1e-9) {
        if (go[a] < lo || go[a] > hi) return null;
      } else {
        let ta = (lo - go[a]) / gd[a], tb = (hi - go[a]) / gd[a];
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
      }
    }
    if (t0 > t1) return null;
    const step = 0.4 * H;
    let prev = sample(f, go[0] + gd[0] * t0, go[1] + gd[1] * t0, go[2] + gd[2] * t0);
    if (prev >= ISO) return null;
    for (let t = t0 + step; t <= t1 + step; t += step) {
      const tt = Math.min(t, t1);
      const v = sample(f, go[0] + gd[0] * tt, go[1] + gd[1] * tt, go[2] + gd[2] * tt);
      if (v >= ISO) {
        let lo = tt - step, hi = tt;
        for (let it = 0; it < 6; it++) {
          const mid = (lo + hi) * 0.5;
          const m = sample(f, go[0] + gd[0] * mid, go[1] + gd[1] * mid, go[2] + gd[2] * mid);
          if (m >= ISO) hi = mid; else lo = mid;
        }
        const th = (lo + hi) * 0.5;
        const gx = go[0] + gd[0] * th, gy = go[1] + gd[1] * th, gz = go[2] + gd[2] * th;
        let nx = sample(f, gx - 1, gy, gz) - sample(f, gx + 1, gy, gz);
        let ny = sample(f, gx, gy - 1, gz) - sample(f, gx, gy + 1, gz);
        let nz = sample(f, gx, gy, gz - 1) - sample(f, gx, gy, gz + 1);
        const nl = Math.hypot(nx, ny, nz) || 1;
        return {
          t: th,
          x: ox + dx * th, y: oy + dy * th, z: oz + dz * th,
          nx: nx / nl, ny: ny / nl, nz: nz / nl
        };
      }
      prev = v;
      if (tt >= t1) break;
    }
    return null;
  }

  /* ---------------------------------------------------------------- Marching tetrahedra */
  const CX = [0, 1, 1, 0, 0, 1, 1, 0];
  const CY = [0, 0, 1, 1, 0, 0, 1, 1];
  const CZ = [0, 0, 0, 0, 1, 1, 1, 1];
  // Découpe de Kuhn : cohérente entre cellules voisines (pas de fissures)
  const TETS = [[0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6], [0, 5, 1, 6]];

  /* Pour chacune des 256 configurations de coins « dedans / dehors » d'une cellule, la liste des triangles
     (6 numéros de coins chacun : 3 arêtes), déjà orientés vers l'extérieur. Calculée une seule fois. */
  const DX = [1, 0, 0, 1, 1, 0, 1], DY = [0, 1, 0, 1, 0, 1, 1], DZ = [0, 0, 1, 0, 1, 1, 1];
  const TRI_TABLE = new Array(256);
  const EL = new Int8Array(64), ED = new Int8Array(64);
  (function buildTables() {
    for (let a = 0; a < 8; a++) {
      for (let b = 0; b < 8; b++) {
        if (a === b) continue;
        const ka = CX[a] + CY[a] * 2 + CZ[a] * 4, kb = CX[b] + CY[b] * 2 + CZ[b] * 4;
        const lo = ka < kb ? a : b, hi = ka < kb ? b : a;
        const dx = CX[hi] - CX[lo], dy = CY[hi] - CY[lo], dz = CZ[hi] - CZ[lo];
        let dir = -1;
        for (let d = 0; d < 7; d++) if (DX[d] === dx && DY[d] === dy && DZ[d] === dz) dir = d;
        EL[a * 8 + b] = lo; ED[a * 8 + b] = dir;
      }
    }
    const orient = (out, e1a, e1b, e2a, e2b, e3a, e3b, dx, dy, dz) => {
      const m = (a, b, C3) => (C3[a] + C3[b]) * 0.5;
      const ux = m(e2a, e2b, CX) - m(e1a, e1b, CX), uy = m(e2a, e2b, CY) - m(e1a, e1b, CY), uz = m(e2a, e2b, CZ) - m(e1a, e1b, CZ);
      const vx = m(e3a, e3b, CX) - m(e1a, e1b, CX), vy = m(e3a, e3b, CY) - m(e1a, e1b, CY), vz = m(e3a, e3b, CZ) - m(e1a, e1b, CZ);
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * dx + ny * dy + nz * dz >= 0) out.push(e1a, e1b, e2a, e2b, e3a, e3b);
      else out.push(e1a, e1b, e3a, e3b, e2a, e2b);
    };
    for (let mask = 0; mask < 256; mask++) {
      const tris = [];
      for (let t = 0; t < 6; t++) {
        const ins = [], outs = [];
        for (const c of TETS[t]) ((mask >> c) & 1 ? ins : outs).push(c);
        if (!ins.length || !outs.length) continue;
        if (ins.length === 1 || outs.length === 1) {
          const loneIn = ins.length === 1;
          const lone = loneIn ? ins[0] : outs[0], o = loneIn ? outs : ins, sg = loneIn ? 1 : -1;
          const dx = sg * ((CX[o[0]] + CX[o[1]] + CX[o[2]]) / 3 - CX[lone]);
          const dy = sg * ((CY[o[0]] + CY[o[1]] + CY[o[2]]) / 3 - CY[lone]);
          const dz = sg * ((CZ[o[0]] + CZ[o[1]] + CZ[o[2]]) / 3 - CZ[lone]);
          orient(tris, lone, o[0], lone, o[1], lone, o[2], dx, dy, dz);
        } else {
          const a = ins[0], b = ins[1], c = outs[0], d = outs[1];
          const dx = (CX[c] + CX[d] - CX[a] - CX[b]) * 0.5;
          const dy = (CY[c] + CY[d] - CY[a] - CY[b]) * 0.5;
          const dz = (CZ[c] + CZ[d] - CZ[a] - CZ[b]) * 0.5;
          orient(tris, a, c, a, d, b, d, dx, dy, dz);
          orient(tris, a, c, b, d, b, c, dx, dy, dz);
        }
      }
      TRI_TABLE[mask] = Int8Array.from(tris);
    }
  })();

  function configure(n, lw) {
    if (lw) { L = lw; HALF = lw / 2; }
    const g = gridParams(n);
    N = n; H = g.h; FK = g.fk; FLOOR_Y = g.fy;
    NC = Math.ceil((N - 1) / C);
    N2 = N * N; N3 = N2 * N;
    COFF = CX.map((x, q) => x + CY[q] * N + CZ[q] * N2);
    DELTA = [1, N, N2, 1 + N, 1 + N2, N + N2, 1 + N + N2];
  }
  configure(80, 100);

  /** Échantillonnage trilinéaire sur une grille de n voxels quelconque (indépendant de la grille courante) */
  function sampleGen(f, n, x, y, z) {
    const m = n - 1;
    if (x < 0) x = 0; else if (x > m) x = m;
    if (y < 0) y = 0; else if (y > m) y = m;
    if (z < 0) z = 0; else if (z > m) z = m;
    let i = x | 0, j = y | 0, k = z | 0;
    if (i > m - 1) i = m - 1;
    if (j > m - 1) j = m - 1;
    if (k > m - 1) k = m - 1;
    const fx = x - i, fy = y - j, fz = z - k;
    const n2 = n * n;
    const b = i + j * n + k * n2;
    const c00 = f[b] * (1 - fx) + f[b + 1] * fx;
    const c10 = f[b + n] * (1 - fx) + f[b + n + 1] * fx;
    const c01 = f[b + n2] * (1 - fx) + f[b + n2 + 1] * fx;
    const c11 = f[b + n + n2] * (1 - fx) + f[b + n + n2 + 1] * fx;
    return (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz;
  }

  /** Boîte englobante des voxels non vides d'un champ de n voxels : [x0,y0,z0,x1,y1,z1] ou null */
  function fieldBBox(f, n) {
    let x0 = n, y0 = n, z0 = n, x1 = -1, y1 = -1, z1 = -1;
    const n2 = n * n;
    for (let k = 0; k < n; k++)
      for (let j = 0; j < n; j++) {
        const o = j * n + k * n2;
        for (let i = 0; i < n; i++) {
          if (f[o + i] > 0.001) {
            if (i < x0) x0 = i; if (i > x1) x1 = i;
            if (j < y0) y0 = j; if (j > y1) y1 = j;
            if (k < z0) z0 = k; if (k > z1) z1 = k;
          }
        }
      }
    return x1 < 0 ? null : [x0, y0, z0, x1, y1, z1];
  }

  /** Rééchantillonne un champ (oN voxels, plateau oL mm) vers une grille de n voxels (plateau nL mm), en coordonnées monde.
   *  Seule la zone occupée est calculée. */
  function resampleTo(old, oN, oL, n, nL) {
    const o = gridParams(oN, oL), g = gridParams(n, nL);
    const out = new Float32Array(n * n * n);
    const bb = fieldBBox(old, oN);
    if (!bb) return out;
    const n2 = n * n;
    const r = g.h / o.h, offY = (o.fy - g.fy) / o.h, offX = (oL - nL) / (2 * o.h);
    const lo = (v, off) => Math.floor((v - off) / r) - 2, hi = (v, off) => Math.ceil((v - off) / r) + 2;
    const i0 = Math.max(1, lo(bb[0], offX)), i1 = Math.min(n - 2, hi(bb[3], offX));
    const k0 = Math.max(1, lo(bb[2], offX)), k1 = Math.min(n - 2, hi(bb[5], offX));
    const j0 = Math.max(g.fk, lo(bb[1], offY)), j1 = Math.min(n - 2, hi(bb[4], offY));
    for (let k = k0; k <= k1; k++) {
      const gz = k * r + offX;
      for (let j = j0; j <= j1; j++) {
        const gy = j * r + offY;
        let idx = i0 + j * n + k * n2;
        for (let i = i0; i <= i1; i++, idx++) {
          const v = sampleGen(old, oN, i * r + offX, gy, gz);
          out[idx] = (j === g.fk && v >= ISO) ? 1 : v;
        }
      }
    }
    return out;
  }

  /** Couleurs (une par voxel) rééchantillonnées vers une autre grille : voisin le plus proche, seulement là où il y a de la matière (champ `nf`) */
  function resampleColors(oc, oN, oL, n, nL, nf) {
    const o = gridParams(oN, oL), g = gridParams(n, nL);
    const out = new Uint8Array(n * n * n);
    const n2 = n * n, on2 = oN * oN;
    const r = g.h / o.h, offY = (o.fy - g.fy) / o.h, offX = (oL - nL) / (2 * o.h), m = oN - 1;
    const cl = (v) => { v = Math.round(v); return v < 0 ? 0 : v > m ? m : v; };
    for (let k = 0; k < n; k++)
      for (let j = 0; j < n; j++) {
        let idx = j * n + k * n2;
        for (let i = 0; i < n; i++, idx++) {
          if (nf[idx] <= 0.001) continue;
          out[idx] = oc[cl(i * r + offX) + cl(j * r + offY) * oN + cl(k * r + offX) * on2];
        }
      }
    return out;
  }

  /** Lissage de Taubin du maillage (λ puis μ) : lisse sans rétrécir ; la topologie (donc le manifold) est inchangée.
   *  Les sommets posés sur le plateau (y = 0) gardent leur hauteur : le dessous reste parfaitement plat. */
  function smoothMesh(pos, idx, iters, lambda, mu) {
    const V = pos.length / 3, T = idx.length / 3;
    const acc = new Float32Array(V * 3), cnt = new Uint16Array(V), pinned = new Uint8Array(V);
    for (let v = 0; v < V; v++) if (pos[v * 3 + 1] < 1e-3) pinned[v] = 1;
    const pass = (k) => {
      acc.fill(0); cnt.fill(0);
      for (let t = 0; t < T; t++) {
        const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
        for (let e = 0; e < 3; e++) {
          const u = e === 0 ? a : e === 1 ? b : c, w = e === 0 ? b : e === 1 ? c : a;
          acc[u * 3] += pos[w * 3]; acc[u * 3 + 1] += pos[w * 3 + 1]; acc[u * 3 + 2] += pos[w * 3 + 2];
          cnt[u]++;
        }
      }
      for (let v = 0; v < V; v++) {
        const n = cnt[v];
        if (!n) continue;
        const o = v * 3;
        pos[o] += k * (acc[o] / n - pos[o]);
        pos[o + 2] += k * (acc[o + 2] / n - pos[o + 2]);
        pos[o + 1] = pinned[v] ? 0 : pos[o + 1] + k * (acc[o + 1] / n - pos[o + 1]);
      }
    };
    for (let i = 0; i < iters; i++) { pass(lambda); pass(mu); }
  }

  /** Adoucit un champ (passes de moyenne sur 6 voisins) : surfaces plus lisses à l'export dense */
  function relaxField(f, n, passes, strength, bb) {
    const n2 = n * n, fk = gridParams(n).fk;
    const x0 = Math.max(1, bb[0] - 1), x1 = Math.min(n - 2, bb[3] + 1), y0 = Math.max(fk, bb[1] - 1), y1 = Math.min(n - 2, bb[4] + 1), z0 = Math.max(1, bb[2] - 1), z1 = Math.min(n - 2, bb[5] + 1);
    for (let p = 0; p < passes; p++) {
      const src = f.slice();
      for (let k = z0; k <= z1; k++)
        for (let j = y0; j <= y1; j++) {
          let idx = x0 + j * n + k * n2;
          for (let i = x0; i <= x1; i++, idx++) {
            const v = src[idx];
            const avg = (src[idx - 1] + src[idx + 1] + src[idx - n] + src[idx + n] + src[idx - n2] + src[idx + n2]) / 6;
            if (avg === v) continue;
            let nv = v + strength * (avg - v);
            if (j === fk && nv >= ISO) nv = 1;
            f[idx] = nv;
          }
        }
    }
  }

  /** Parcourt les cellules [x0..x1]×[y0..y1]×[z0..z1] et appelle emit(a1,b1,a2,b2,a3,b3) par triangle
   *  (indices globaux des deux extrémités de chacune des 3 arêtes). */
  function polygonize(f, x0, y0, z0, x1, y1, z1, emit) {
    for (let k = z0; k <= z1; k++) {
      for (let j = y0; j <= y1; j++) {
        for (let i = x0; i <= x1; i++) {
          const base = i + j * N + k * N2;
          let mask = 0;
          for (let c = 0; c < 8; c++) if (f[base + COFF[c]] >= ISO) mask |= 1 << c;
          if (mask === 0 || mask === 255) continue;
          const tt = TRI_TABLE[mask];
          for (let q = 0; q < tt.length; q += 6) {
            emit(base + COFF[tt[q]], base + COFF[tt[q + 1]], base + COFF[tt[q + 2]], base + COFF[tt[q + 3]], base + COFF[tt[q + 4]], base + COFF[tt[q + 5]]);
          }
        }
      }
    }
  }

  /* Sommet sur l'arête (ia, ib) : position (+ normale) dans vx.. */
  let vx = 0, vy = 0, vz = 0, vnx = 0, vny = 0, vnz = 0;
  function gradAt(f, idx, i, j, k, out) {
    const xm = i > 0 ? f[idx - 1] : f[idx], xp = i < N - 1 ? f[idx + 1] : f[idx];
    const ym = j > 0 ? f[idx - N] : f[idx], yp = j < N - 1 ? f[idx + N] : f[idx];
    const zm = k > 0 ? f[idx - N2] : f[idx], zp = k < N - 1 ? f[idx + N2] : f[idx];
    out[0] = xm - xp; out[1] = ym - yp; out[2] = zm - zp; // = -gradient : vers l'extérieur
  }
  const gA = [0, 0, 0], gB = [0, 0, 0];
  function edgeVertex(f, ia, ib, wantNormal) {
    if (ia > ib) { const s = ia; ia = ib; ib = s; }
    const fa = f[ia], fb = f[ib];
    let t = (ISO - fa) / (fb - fa);
    if (t < 0.02) t = 0.02; else if (t > 0.98) t = 0.98;
    const ai = ia % N, ar = (ia - ai) / N, aj = ar % N, ak = (ar - aj) / N;
    const bi = ib % N, br = (ib - bi) / N, bj = br % N, bk = (br - bj) / N;
    vx = (ai + t * (bi - ai)) * H - HALF;
    vy = (aj + t * (bj - aj)) * H - FLOOR_Y;
    vz = (ak + t * (bk - ak)) * H - HALF;
    if (wantNormal) {
      gradAt(f, ia, ai, aj, ak, gA);
      gradAt(f, ib, bi, bj, bk, gB);
      const nx = gA[0] + t * (gB[0] - gA[0]);
      const ny = gA[1] + t * (gB[1] - gA[1]);
      const nz = gA[2] + t * (gB[2] - gA[2]);
      const nl = Math.hypot(nx, ny, nz) || 1;
      vnx = nx / nl; vny = ny / nl; vnz = nz / nl;
    }
  }

  /* Tampons temporaires pour construire un chunk (maillage indexé, sommets partagés) */
  const CW = C + 1, CW2 = CW * CW;
  const edgeVal = new Int32Array(CW2 * CW * 7);
  const edgeGen = new Int32Array(CW2 * CW * 7);
  const insBuf = new Uint8Array(CW2 * CW);
  const rowSum = new Uint8Array(CW2);
  let gen = 0;
  let tp = new Float32Array(3 * 2048);
  let tn = new Float32Array(3 * 2048);
  let tcol = new Float32Array(3 * 2048);
  let ti = new Uint32Array(3 * 4096);
  let tc = 0, tic = 0;
  let cF = null, cC = null, cPR = null, cX0 = 0, cY0 = 0, cZ0 = 0;

  /* Sommet de l'arête (coins ca,cb) de la cellule locale (a,b,c) ; partagé entre toutes les cellules qui la touchent */
  function chunkVert(ca, cb, a, b, c) {
    const k8 = ca * 8 + cb, lo = EL[k8], dir = ED[k8];
    const lx = a + CX[lo], ly = b + CY[lo], lz = c + CZ[lo];
    const key = (lx + ly * CW + lz * CW2) * 7 + dir;
    if (edgeGen[key] === gen) return edgeVal[key];
    const gx = cX0 + lx, gy = cY0 + ly, gz = cZ0 + lz;
    const ia = gx + gy * N + gz * N2, ib = ia + DELTA[dir];
    const fa = cF[ia], fb = cF[ib];
    let t = (ISO - fa) / (fb - fa);
    if (t < 0.02) t = 0.02; else if (t > 0.98) t = 0.98;
    const ddx = DX[dir], ddy = DY[dir], ddz = DZ[dir];
    gradAt(cF, ia, gx, gy, gz, gA);
    gradAt(cF, ib, gx + ddx, gy + ddy, gz + ddz, gB);
    let nx = gA[0] + t * (gB[0] - gA[0]), ny = gA[1] + t * (gB[1] - gA[1]), nz = gA[2] + t * (gB[2] - gA[2]);
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    const o = tc * 3;
    if (o + 3 > tp.length) {
      const np = new Float32Array(tp.length * 2); np.set(tp); tp = np;
      const nn = new Float32Array(tn.length * 2); nn.set(tn); tn = nn;
      const nc = new Float32Array(tcol.length * 2); nc.set(tcol); tcol = nc;
    }
    tp[o] = (gx + t * ddx) * H - HALF; tp[o + 1] = (gy + t * ddy) * H - FLOOR_Y; tp[o + 2] = (gz + t * ddz) * H - HALF;
    tn[o] = nx / nl; tn[o + 1] = ny / nl; tn[o + 2] = nz / nl;
    const pc = cC[fa >= ISO ? ia : ib] * 3;            // couleur du voxel de matière au bout de l'arête
    tcol[o] = cPR[pc]; tcol[o + 1] = cPR[pc + 1]; tcol[o + 2] = cPR[pc + 2];
    edgeGen[key] = gen; edgeVal[key] = tc;
    return tc++;
  }

  /** Maillage d'un bloc de C×C×C cellules : balayage rapide (bits dedans/dehors + lignes entièrement pleines/vides ignorées) */
  function buildChunk(f, col, pal, cx, cy, cz) {
    const x0 = cx * C, y0 = cy * C, z0 = cz * C;
    const nx = Math.min(C, N - 1 - x0) + 1, ny = Math.min(C, N - 1 - y0) + 1, nz = Math.min(C, N - 1 - z0) + 1;
    let inside = 0;
    for (let c = 0; c < nz; c++) {
      for (let b = 0; b < ny; b++) {
        const src = x0 + (y0 + b) * N + (z0 + c) * N2, dst = b * CW + c * CW2;
        let cnt = 0;
        for (let a = 0; a < nx; a++) {
          const v = f[src + a] >= ISO ? 1 : 0;
          insBuf[dst + a] = v; cnt += v;
        }
        rowSum[b + c * CW] = cnt;
        inside += cnt;
      }
    }
    if (inside === 0 || inside === nx * ny * nz) return null;
    tc = 0; tic = 0; gen++;
    cF = f; cC = col; cPR = pal; cX0 = x0; cY0 = y0; cZ0 = z0;
    for (let c = 0; c < nz - 1; c++) {
      for (let b = 0; b < ny - 1; b++) {
        const r00 = rowSum[b + c * CW], r10 = rowSum[b + 1 + c * CW], r01 = rowSum[b + (c + 1) * CW], r11 = rowSum[b + 1 + (c + 1) * CW];
        if ((r00 | r10 | r01 | r11) === 0 || (r00 === nx && r10 === nx && r01 === nx && r11 === nx)) continue;
        let base = b * CW + c * CW2;
        for (let a = 0; a < nx - 1; a++, base++) {
          const m = insBuf[base] | (insBuf[base + 1] << 1) | (insBuf[base + 1 + CW] << 2) | (insBuf[base + CW] << 3)
            | (insBuf[base + CW2] << 4) | (insBuf[base + 1 + CW2] << 5) | (insBuf[base + 1 + CW + CW2] << 6) | (insBuf[base + CW + CW2] << 7);
          if (m === 0 || m === 255) continue;
          const tt = TRI_TABLE[m];
          if (tic + tt.length / 2 > ti.length) { const nt = new Uint32Array(ti.length * 2); nt.set(ti); ti = nt; }
          for (let q = 0; q < tt.length; q += 6) {
            ti[tic++] = chunkVert(tt[q], tt[q + 1], a, b, c);
            ti[tic++] = chunkVert(tt[q + 2], tt[q + 3], a, b, c);
            ti[tic++] = chunkVert(tt[q + 4], tt[q + 5], a, b, c);
          }
        }
      }
    }
    if (tic === 0) return null;
    return { vc: tc, ic: tic };
  }

  /** Copie le dernier bloc construit dans le maillage `mesh`, en réutilisant ses tampons (aucune allocation, aucun
   *  tampon GPU perdu) ; ne réalloue que si le bloc a grandi. */
  function uploadChunk(THREE, mesh, vc, ic) {
    let geo = mesh.geometry;
    let pa = geo.getAttribute('position'), na = geo.getAttribute('normal'), ca = geo.getAttribute('color'), ia = geo.getIndex();
    const wide = vc >= 65536;
    if (!pa || pa.array.length < vc * 3 || ia.array.length < ic || (wide && !(ia.array instanceof Uint32Array))) {
      const capV = Math.max(256, Math.ceil(vc * 1.4)), capI = Math.max(768, Math.ceil(ic * 1.4));
      const ng = new THREE.BufferGeometry();
      pa = new THREE.BufferAttribute(new Float32Array(capV * 3), 3); pa.setUsage(THREE.DynamicDrawUsage);
      na = new THREE.BufferAttribute(new Float32Array(capV * 3), 3); na.setUsage(THREE.DynamicDrawUsage);
      ca = new THREE.BufferAttribute(new Float32Array(capV * 3), 3); ca.setUsage(THREE.DynamicDrawUsage);
      ia = new THREE.BufferAttribute(wide ? new Uint32Array(capI) : new Uint16Array(capI), 1); ia.setUsage(THREE.DynamicDrawUsage);
      ng.setAttribute('position', pa); ng.setAttribute('normal', na); ng.setAttribute('color', ca); ng.setIndex(ia);
      geo.dispose();
      mesh.geometry = geo = ng;
    }
    pa.array.set(tp.subarray(0, vc * 3)); pa.updateRange.offset = 0; pa.updateRange.count = vc * 3; pa.needsUpdate = true;
    na.array.set(tn.subarray(0, vc * 3)); na.updateRange.offset = 0; na.updateRange.count = vc * 3; na.needsUpdate = true;
    ca.array.set(tcol.subarray(0, vc * 3)); ca.updateRange.offset = 0; ca.updateRange.count = vc * 3; ca.needsUpdate = true;
    ia.array.set(ti.subarray(0, ic)); ia.updateRange.offset = 0; ia.updateRange.count = ic; ia.needsUpdate = true;
    geo.setDrawRange(0, ic);
  }

  /* ---------------------------------------------------------------- Encodage (sauvegarde auto) */
  function b64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function encode(f) {
    const out = new Uint8Array(N3 * 2 + 2);
    let o = 0, prev = -1, run = 0;
    for (let i = 0; i < N3; i++) {
      const v = Math.round(f[i] * 255);
      if (v === prev && run < 255) run++;
      else {
        if (run > 0) { out[o++] = prev; out[o++] = run; }
        prev = v; run = 1;
      }
    }
    out[o++] = prev; out[o++] = run;
    return b64(out.subarray(0, o));
  }
  function encodeBytes(u) {
    const out = new Uint8Array(u.length * 2 + 2);
    let o = 0, prev = -1, run = 0;
    for (let i = 0; i < u.length; i++) {
      const v = u[i];
      if (v === prev && run < 255) run++;
      else {
        if (run > 0) { out[o++] = prev; out[o++] = run; }
        prev = v; run = 1;
      }
    }
    out[o++] = prev; out[o++] = run;
    return b64(out.subarray(0, o));
  }
  function decodeBytes(str, u) {
    const s = atob(str), n = u.length;
    let p = 0;
    for (let o = 0; o + 1 < s.length; o += 2) {
      const v = s.charCodeAt(o), c = s.charCodeAt(o + 1);
      for (let q = 0; q < c && p < n; q++) u[p++] = v;
    }
    if (p !== n) throw new Error('bad colors');
  }
  function decode(str, f, n3) {
    const s = atob(str);
    let p = 0;
    for (let o = 0; o + 1 < s.length; o += 2) {
      const v = s.charCodeAt(o) / 255, c = s.charCodeAt(o + 1);
      for (let q = 0; q < c && p < n3; q++) f[p++] = v;
    }
    if (p !== n3) throw new Error('bad data');
  }

  /* ================================================================== Clay */
  class Clay {
    constructor(THREE) {
      this.THREE = THREE;
      this.f = new Float32Array(N3);
      this.before = null;
      this.box = null;
      this.group = new THREE.Group();
      this.col = new Uint8Array(N3);          // couleur de chaque voxel = numéro dans la palette
      this.paint = 0;                         // couleur courante (numéro de palette) des outils
      this._shc = null;                       // couleurs de l'état validé (comme _sh pour la matière)
      this._tch = null;                       // voxels dont la couleur a été fixée par le geste en cours
      this.loadedColors = true;
      this.setPalette(Clay.DEFAULT_PALETTE);
      this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.72, metalness: 0 });
      this.chunks = new Array(NC * NC * NC).fill(null);
      this.dirty = new Set();
      this._tmp = null;
      this._sh = null;      // état validé de la sculpture (= « avant » du geste en cours), tenu à jour par zones
    }

    /** Palette : liste de couleurs 0xRRGGBB (256 au plus) ; les numéros enregistrés dans `col` y renvoient */
    setPalette(list) {
      this.pal = list.slice(0, 256);
      const rgb = new Float32Array(256 * 3), d = this.pal[0] || 0xe9936b;
      for (let i = 0; i < 256; i++) {
        const c = i < this.pal.length ? this.pal[i] : d;
        rgb[i * 3] = ((c >> 16) & 255) / 255; rgb[i * 3 + 1] = ((c >> 8) & 255) / 255; rgb[i * 3 + 2] = (c & 255) / 255;
      }
      this._palRGB = rgb;
    }
    /** Couleur (numéro de palette) du voxel de matière le plus proche de (x,y,z) dans l'état bf/bc */
    _nearCol(bf, bc, x, y, z) {
      let i = Math.round(x), j = Math.round(y), k = Math.round(z);
      i = i < 0 ? 0 : i > N - 1 ? N - 1 : i; j = j < 0 ? 0 : j > N - 1 ? N - 1 : j; k = k < 0 ? 0 : k > N - 1 ? N - 1 : k;
      const idx = i + j * N + k * N2;
      if (bf[idx] >= ISO) return bc[idx];
      if (i > 0 && bf[idx - 1] >= ISO) return bc[idx - 1];
      if (i < N - 1 && bf[idx + 1] >= ISO) return bc[idx + 1];
      if (j > 0 && bf[idx - N] >= ISO) return bc[idx - N];
      if (j < N - 1 && bf[idx + N] >= ISO) return bc[idx + N];
      if (k > 0 && bf[idx - N2] >= ISO) return bc[idx - N2];
      if (k < N - 1 && bf[idx + N2] >= ISO) return bc[idx + N2];
      return bc[idx];
    }
    /** La matière apparue dans la boîte (lissage, gonflage…) prend la couleur de la matière voisine d'avant le geste */
    _inherit(x0, y0, z0, x1, y1, z1) {
      const bf = this.before || this._sh, bc = this._shc;
      if (!bf || !bc) return;
      const f = this.f, col = this.col, tch = this._tch;
      x0 = Math.max(2, x0); y0 = Math.max(2, y0); z0 = Math.max(2, z0);
      x1 = Math.min(N - 3, x1); y1 = Math.min(N - 3, y1); z1 = Math.min(N - 3, z1);
      for (let k = z0; k <= z1; k++)
        for (let j = y0; j <= y1; j++) {
          let idx = x0 + j * N + k * N2;
          for (let i = x0; i <= x1; i++, idx++) {
            if (f[idx] < ISO || bf[idx] >= ISO || (tch && tch[idx])) continue;
            let best = -1, bd = 99;
            for (let dz = -2; dz <= 2; dz++)
              for (let dy = -2; dy <= 2; dy++)
                for (let dx = -2; dx <= 2; dx++) {
                  const q = idx + dx + dy * N + dz * N2;
                  if (bf[q] < ISO) continue;
                  const d = dx * dx + dy * dy + dz * dz;
                  if (d < bd) { bd = d; best = q; }
                }
            col[idx] = best >= 0 ? bc[best] : this.paint;
          }
        }
    }
    /** Peint la surface (sans toucher à la forme) : la couche de matière sous la surface, dans la sphère. idx = numéro de palette */
    paintAt(cx, cy, cz, r, idx) {
      const f = this.f, col = this.col;
      const gx = (cx + HALF) / H, gy = (cy + FLOOR_Y) / H, gz = (cz + HALF) / H;
      const R = r / H, R2 = R * R, D = 3;
      const x0 = Math.max(D, Math.floor(gx - R)), x1 = Math.min(N - 1 - D, Math.ceil(gx + R));
      const y0 = Math.max(Math.max(D, FK), Math.floor(gy - R)), y1 = Math.min(N - 1 - D, Math.ceil(gy + R));
      const z0 = Math.max(D, Math.floor(gz - R)), z1 = Math.min(N - 1 - D, Math.ceil(gz + R));
      if (x0 > x1 || y0 > y1 || z0 > z1) return false;
      const tch = this._tch || (this._tch = new Uint8Array(N3));
      let c0x = N, c0y = N, c0z = N, c1x = -1, c1y = -1, c1z = -1;
      for (let k = z0; k <= z1; k++)
        for (let j = y0; j <= y1; j++) {
          let id = x0 + j * N + k * N2;
          for (let i = x0; i <= x1; i++, id++) {
            if (f[id] < ISO || col[id] === idx) continue;
            const ex = i - gx, ey = j - gy, ez = k - gz;
            if (ex * ex + ey * ey + ez * ez > R2) continue;
            let shell = false;
            for (let t = 1; t <= D && !shell; t++)
              shell = f[id - t] < ISO || f[id + t] < ISO || f[id - t * N] < ISO || f[id + t * N] < ISO || f[id - t * N2] < ISO || f[id + t * N2] < ISO;
            if (!shell) continue;
            col[id] = idx; tch[id] = 1;
            if (i < c0x) c0x = i; if (i > c1x) c1x = i;
            if (j < c0y) c0y = j; if (j > c1y) c1y = j;
            if (k < c0z) c0z = k; if (k > c1z) c1z = k;
          }
        }
      if (c1x < 0) return false;
      this._grow(c0x, c0y, c0z, c1x, c1y, c1z);
      return true;
    }

    /* ---- remplissage / reset ---- */
    clear() { this.f.fill(0); this.col.fill(0); this._sh = null; this._shc = null; this.markAll(); }
    /** Nouvelle sculpture à partir d'une forme de départ (voir starters.js) : 'ball' par défaut, 'empty' = surface vide */
    reset(kind) {
      this.f.fill(0);
      this.col.fill(this.paint);               // la forme de départ est de la couleur choisie
      this._sh = null; this._shc = null;
      this.box = null;
      if (kind === 'empty') { this.markAll(); return; }
      this.beginEdit();
      const st = global.ClayStarters && global.ClayStarters.get(kind || 'ball');
      this.build(st ? st.ops : [['s', 0, 15, 0, 16]]);
      this.endEdit();
      this.markAll();
    }
    /** Maillage d'une forme de départ sous forme de « soupe » de triangles (9 nombres par triangle, en mm, posée sur le
     *  plateau), pour la poser comme n'importe quelle forme. Construit dans un champ temporaire de la grille courante :
     *  la sculpture en cours n'est pas touchée. Retourne null si la forme est vide. */
    starterSoup(id) {
      const tmp = new Clay(this.THREE);
      tmp.reset(id);
      const m = tmp.buildExport(0, 4);
      if (!m || !m.nTri) return null;
      const soup = new Float32Array(m.nTri * 9);
      for (let t = 0; t < m.nTri * 3; t++) {
        const v = m.indices[t] * 3;
        soup[t * 3] = m.positions[v]; soup[t * 3 + 1] = m.positions[v + 1]; soup[t * 3 + 2] = m.positions[v + 2];
      }
      return soup;
    }
    /** Construit une forme à partir d'une liste d'opérations (unités : mm, sol à y = 0) :
     *  s sphère · c capsule · t cône arrondi · e ellipsoïde · b boîte arrondie · p prisme (extrusion en z) · q prisme (extrusion en x).
     *  Un « - » devant le code (« -s ») creuse au lieu d'ajouter. */
    build(ops) {
      for (const op of ops) {
        const rm = op[0].charAt(0) === '-';
        const t = rm ? op[0].slice(1) : op[0], mode = rm ? 'remove' : 'add';
        switch (t) {
          case 's': this.capsule(op[1], op[2], op[3], op[1], op[2], op[3], op[4], mode); break;
          case 'c': this.capsule(op[1], op[2], op[3], op[4], op[5], op[6], op[7], mode); break;
          case 't': this.cone(op[1], op[2], op[3], op[4], op[5], op[6], op[7], op[8], mode); break;
          case 'e': this.ellipsoid(op[1], op[2], op[3], op[4], op[5], op[6], mode); break;
          case 'b': this.roundBox(op[1], op[2], op[3], op[4], op[5], op[6], op[7], mode); break;
          case 'p': this.prism(op[1], op[2], op[3], op[4], op[5], op[6], op[7], 'z', mode); break;
          case 'q': this.prism(op[1], op[2], op[3], op[4], op[5], op[6], op[7], 'x', mode); break;
          default: break;
        }
      }
    }
    markAll() { for (let i = 0; i < this.chunks.length; i++) this.dirty.add(i); }

    /* ---- gestion des zones modifiées ---- */
    beginEdit() {
      if (!this._sh || this._sh.length !== N3) this._sh = this.f.slice();   // seule recopie complète : la première fois
      if (!this._shc || this._shc.length !== N3) this._shc = this.col.slice();
      this.before = this._sh;
      this.box = null;
      this._mapZero();
    }
    _grow(x0, y0, z0, x1, y1, z1) {
      const b = this.box;
      if (!b) this.box = { x0, y0, z0, x1, y1, z1 };
      else {
        if (x0 < b.x0) b.x0 = x0; if (y0 < b.y0) b.y0 = y0; if (z0 < b.z0) b.z0 = z0;
        if (x1 > b.x1) b.x1 = x1; if (y1 > b.y1) b.y1 = y1; if (z1 > b.z1) b.z1 = z1;
      }
      this.markBox(x0, y0, z0, x1, y1, z1);
    }
    markBox(x0, y0, z0, x1, y1, z1) {
      const c0 = (v) => Math.max(0, Math.min(NC - 1, Math.floor(Math.max(0, v - 2) / C)));
      const c1 = (v) => Math.max(0, Math.min(NC - 1, Math.floor(Math.min(N - 2, v + 1) / C)));
      for (let cz = c0(z0); cz <= c1(z1); cz++)
        for (let cy = c0(y0); cy <= c1(y1); cy++)
          for (let cx = c0(x0); cx <= c1(x1); cx++)
            this.dirty.add(cx + cy * NC + cz * NC * NC);
    }
    _crop(src, b) {
      const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1, d = b.z1 - b.z0 + 1;
      const out = new src.constructor(w * h * d);
      let o = 0;
      for (let k = b.z0; k <= b.z1; k++)
        for (let j = b.y0; j <= b.y1; j++) {
          const s = b.x0 + j * N + k * N2;
          out.set(src.subarray(s, s + w), o);
          o += w;
        }
      return out;
    }
    _paste(data, b, cdata) {
      const w = b.x1 - b.x0 + 1;
      let o = 0;
      const sh = this._sh && this._sh.length === N3 ? this._sh : null;
      const shc = cdata && this._shc && this._shc.length === N3 ? this._shc : null;
      for (let k = b.z0; k <= b.z1; k++)
        for (let j = b.y0; j <= b.y1; j++) {
          const at = b.x0 + j * N + k * N2, row = data.subarray(o, o + w);
          this.f.set(row, at);
          if (sh) sh.set(row, at);
          if (cdata) {
            const crow = cdata.subarray(o, o + w);
            this.col.set(crow, at);
            if (shc) shc.set(crow, at);
          }
          o += w;
        }
      this.markBox(b.x0, b.y0, b.z0, b.x1, b.y1, b.z1);
    }
    /** Recopie la zone b de la sculpture vers l'état validé */
    _syncShadow(b) {
      const sh = this._sh, shc = this._shc, w = b.x1 - b.x0 + 1;
      if (!sh) return;
      for (let k = b.z0; k <= b.z1; k++)
        for (let j = b.y0; j <= b.y1; j++) {
          const at = b.x0 + j * N + k * N2;
          sh.set(this.f.subarray(at, at + w), at);
          if (shc) shc.set(this.col.subarray(at, at + w), at);
          if (this._tch) this._tch.fill(0, at, at + w);
        }
    }
    /** Termine une édition ; retourne une entrée d'historique (ou null) */
    endEdit() {
      const b = this.box;
      this.box = null;
      this._mapZero();
      if (!b) { this.before = null; return null; }
      const entry = { box: b, before: this._crop(this._sh, b), after: this._crop(this.f, b),
        cbefore: this._shc ? this._crop(this._shc, b) : null, cafter: this._crop(this.col, b) };
      this._syncShadow(b);
      this.before = null;
      return entry;
    }
    undoEntry(e) { this._paste(e.before, e.box, e.cbefore); }
    redoEntry(e) { this._paste(e.after, e.box, e.cafter); }

    /* ---- pinceaux ---- */
    /** Capsule (sphère balayée) en coordonnées monde. mode: 'add' | 'remove'.
     *  sup = {nx, ny, nz, depth, w0, below} : ajout « propre ». La matière n'est déposée que là où l'argile d'avant le geste
     *  se trouve juste en dessous (direction -n, `depth` mm au plus ; le plateau compte comme de l'argile) : rien ne dépasse
     *  derrière une partie fine, au-delà d'un bord ni dans le vide (copies de la symétrie). w0 = hauteur (le long de n) du
     *  point visé, `below` = de combien en dessous on accepte encore de déposer (surface qui s'éloigne). */
    capsule(ax, ay, az, bx, by, bz, r, mode, sup) {
      const f = this.f;
      const gax = (ax + HALF) / H, gay = (ay + FLOOR_Y) / H, gaz = (az + HALF) / H;
      const gbx = (bx + HALF) / H, gby = (by + FLOOR_Y) / H, gbz = (bz + HALF) / H;
      const R = r / H;
      const pad = R + 1.5;
      const x0 = Math.max(1, Math.floor(Math.min(gax, gbx) - pad)), x1 = Math.min(N - 2, Math.ceil(Math.max(gax, gbx) + pad));
      const y0 = Math.max(FK, Math.floor(Math.min(gay, gby) - pad)), y1 = Math.min(N - 2, Math.ceil(Math.max(gay, gby) + pad));
      const z0 = Math.max(1, Math.floor(Math.min(gaz, gbz) - pad)), z1 = Math.min(N - 2, Math.ceil(Math.max(gaz, gbz) + pad));
      if (x0 > x1 || y0 > y1 || z0 > z1) return;
      const sx = gbx - gax, sy = gby - gay, sz = gbz - gaz;
      const dd = sx * sx + sy * sy + sz * sz;
      const lim = (R + 1) * (R + 1);
      const add = mode === 'add';
      const src = add && sup ? (this.before || this._sh || f) : null;   // l'argile « d'avant » sert de support
      const col = this.col, pn = this.paint, tch = add ? (this._tch || (this._tch = new Uint8Array(N3))) : null;
      let snx = 0, sny = 0, snz = 0, steps = 0, wb = 0, wi = 0, wj = 0, wk = 0, wLo = -Infinity;
      const SL = 1;                                                     // pas de la marche vers le bas, en voxels
      if (src) {
        const l = Math.hypot(sup.nx, sup.ny, sup.nz) || 1;
        snx = sup.nx / l; sny = sup.ny / l; snz = sup.nz / l;
        steps = Math.max(1, Math.ceil(sup.depth / H / SL));
        // hauteur (le long de n) d'un voxel : on écarte d'emblée ce qui est bien plus bas que la surface visée
        // (derrière une partie fine…), sans lancer la marche
        wb = -HALF * snx - FLOOR_Y * sny - HALF * snz; wi = H * snx; wj = H * sny; wk = H * snz;
        wLo = sup.w0 - sup.below;
      }
      for (let k = z0; k <= z1; k++) {
        for (let j = y0; j <= y1; j++) {
          let idx = x0 + j * N + k * N2;
          for (let i = x0; i <= x1; i++, idx++) {
            let t = 0;
            if (dd > 0) {
              t = ((i - gax) * sx + (j - gay) * sy + (k - gaz) * sz) / dd;
              t = t < 0 ? 0 : t > 1 ? 1 : t;
            }
            const ex = i - gax - t * sx, ey = j - gay - t * sy, ez = k - gaz - t * sz;
            const d2 = ex * ex + ey * ey + ez * ez;
            if (d2 > lim) continue;
            let b = 0.5 + (R - Math.sqrt(d2)) * 0.5;
            b = b < 0 ? 0 : b > 1 ? 1 : b;
            if (add) {
              if (b > f[idx]) {
                if (src && j > FK) {
                  if (wb + i * wi + j * wj + k * wk < wLo) continue;
                  let ok = false;
                  for (let s = 0; s <= steps; s++) {
                    const u = s * SL, gj = Math.round(j - sny * u);
                    if (gj <= FK) { ok = true; break; }               // le plateau
                    const gi = Math.round(i - snx * u), gk = Math.round(k - snz * u);
                    if (gi < 0 || gi >= N || gk < 0 || gk >= N || gj >= N) break;
                    if (src[gi + gj * N + gk * N2] >= ISO) { ok = true; break; }
                  }
                  if (!ok) continue;
                }
                f[idx] = (j === FK && b >= ISO) ? 1 : b;
                if (b >= ISO) { col[idx] = pn; tch[idx] = 1; }
              }
            } else {
              const nb = 1 - b;
              if (nb < f[idx]) { f[idx] = nb; if (j === FK && nb >= ISO) f[idx] = 1; }
            }
          }
        }
      }
      this._grow(x0, y0, z0, x1, y1, z1);
    }

    /** Lissage local (flou) */
    smooth(cx, cy, cz, r, strength, fillOnly) {
      const f = this.f;
      const gx = (cx + HALF) / H, gy = (cy + FLOOR_Y) / H, gz = (cz + HALF) / H;
      const R = r / H;
      const x0 = Math.max(1, Math.floor(gx - R)), x1 = Math.min(N - 2, Math.ceil(gx + R));
      const y0 = Math.max(FK, Math.floor(gy - R)), y1 = Math.min(N - 2, Math.ceil(gy + R));
      const z0 = Math.max(1, Math.floor(gz - R)), z1 = Math.min(N - 2, Math.ceil(gz + R));
      if (x0 > x1 || y0 > y1 || z0 > z1) return;
      const w = x1 - x0 + 1, h = y1 - y0 + 1, d = z1 - z0 + 1;
      const need = w * h * d;
      if (!this._tmp || this._tmp.length < need) this._tmp = new Float32Array(need);
      const tmp = this._tmp;
      let o = 0;
      for (let k = z0; k <= z1; k++)
        for (let j = y0; j <= y1; j++)
          for (let i = x0; i <= x1; i++, o++) {
            const idx = i + j * N + k * N2;
            const dx = i - gx, dy = j - gy, dz = k - gz;
            const q = (dx * dx + dy * dy + dz * dz) / (R * R);
            const v = f[idx];
            if (q >= 1) { tmp[o] = v; continue; }
            const avg = (f[idx - 1] + f[idx + 1] + f[idx - N] + f[idx + N] + f[idx - N2] + f[idx + N2]) / 6;
            const nv = v + strength * (1 - q) * (avg - v);
            tmp[o] = fillOnly && nv < v ? v : nv;      // « combler » : on ne retire jamais de matière
          }
      o = 0;
      for (let k = z0; k <= z1; k++)
        for (let j = y0; j <= y1; j++)
          for (let i = x0; i <= x1; i++, o++) {
            const idx = i + j * N + k * N2;
            let v = tmp[o];
            if (j === FK && v >= ISO) v = 1;
            f[idx] = v;
          }
      this._inherit(x0, y0, z0, x1, y1, z1);
      this._grow(x0, y0, z0, x1, y1, z1);
    }

    /* ---- déformations « élastiques » (élastique, pincer, pousser) ----
     * Chaque petit pas de déformation est composé dans une carte (déplacement de la position source, par voxel) puis la
     * sculpture D'AVANT le geste est rééchantillonnée UNE seule fois avec la carte cumulée : le flou ne s'accumule plus,
     * les petits détails survivent aux longs étirements et la matière reste d'un seul tenant. */
    _mapZero() {
      const b = this._mapBox, m = this._map;
      this._mapBox = null;
      if (!m || !b) return;
      const w = (b.x1 - b.x0 + 1) * 3;
      for (let k = b.z0; k <= b.z1; k++)
        for (let j = b.y0; j <= b.y1; j++) m.fill(0, (b.x0 + j * N + k * N2) * 3, (b.x0 + j * N + k * N2) * 3 + w);
    }
    /** kind 0 : déplacement (p0..p2 en mm) ; kind 1 : pincement vers (cx,cy,cz), n = (p0,p1,p2), p3 = intensité (négative : écarte) */
    _warp(kind, cx, cy, cz, r, p0, p1, p2, p3) {
      const f = this.f, bf = this.before || this._sh || f;
      const col = this.col, bc = this._shc || col, tch = this._tch || (this._tch = new Uint8Array(N3));
      if (!this._map || this._map.length !== N3 * 3) { this._map = new Float32Array(N3 * 3); this._mapBox = null; }
      const map = this._map;
      const gx = (cx + HALF) / H, gy = (cy + FLOOR_Y) / H, gz = (cz + HALF) / H;
      const R = r / H, R2 = R * R;
      const x0 = Math.max(1, Math.floor(gx - R)), x1 = Math.min(N - 2, Math.ceil(gx + R));
      const y0 = Math.max(FK, Math.floor(gy - R)), y1 = Math.min(N - 2, Math.ceil(gy + R));
      const z0 = Math.max(1, Math.floor(gz - R)), z1 = Math.min(N - 2, Math.ceil(gz + R));
      if (x0 > x1 || y0 > y1 || z0 > z1) return;
      const cnt = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
      if (!this._wu || this._wu.length < cnt * 3) { this._wu = new Float32Array(cnt * 3); this._wv = new Float32Array(cnt); }
      const tu = this._wu, tv = this._wv, mo = _mo;
      const Dx = kind === 0 ? p0 / H : 0, Dy = kind === 0 ? p1 / H : 0, Dz = kind === 0 ? p2 / H : 0;
      let o = 0;
      for (let k = z0; k <= z1; k++)
        for (let j = y0; j <= y1; j++)
          for (let i = x0; i <= x1; i++, o++) {
            const ex = i - gx, ey = j - gy, ez = k - gz;
            const q = (ex * ex + ey * ey + ez * ez) / R2;
            if (q >= 1) { tv[o] = -1; continue; }
            let ux, uy, uz;
            if (kind === 0) {                       // inverse approchée de x -> x + D·w : deux itérations de point fixe
              let yx = i, yy = j, yz = k, wy = (1 - q) * (1 - q);
              for (let it = 0; it < 2; it++) {
                yx = i - Dx * wy; yy = j - Dy * wy; yz = k - Dz * wy;
                const fx = yx - gx, fy = yy - gy, fz = yz - gz, qy = (fx * fx + fy * fy + fz * fz) / R2;
                wy = qy < 1 ? (1 - qy) * (1 - qy) : 0;
              }
              ux = -Dx * wy; uy = -Dy * wy; uz = -Dz * wy;
            } else {                                // pincement : on prélève plus loin dans le plan de la surface
              const w = (1 - q) * (1 - q), dn = ex * p0 + ey * p1 + ez * p2, lift = p3 * 0.5 * R * w;   // la matière se rassemble ET monte : une arête
              ux = p3 * w * (ex - dn * p0) - lift * p0; uy = p3 * w * (ey - dn * p1) - lift * p1; uz = p3 * w * (ez - dn * p2) - lift * p2;
            }
            sampleMap(map, i + ux, j + uy, k + uz, mo);          // carte cumulée à la position source de ce pas
            const vx = ux + mo[0], vy = uy + mo[1], vz = uz + mo[2];
            tu[o * 3] = vx; tu[o * 3 + 1] = vy; tu[o * 3 + 2] = vz;
            let sy = j + vy; if (sy < FK) sy = FK;               // on ne puise jamais sous le plateau
            tv[o] = sample(bf, i + vx, sy, k + vz);
          }
      o = 0;
      for (let k = z0; k <= z1; k++)
        for (let j = y0; j <= y1; j++) {
          let idx = x0 + j * N + k * N2;
          for (let i = x0; i <= x1; i++, idx++, o++) {
            const v = tv[o];
            if (v < 0) continue;
            map[idx * 3] = tu[o * 3]; map[idx * 3 + 1] = tu[o * 3 + 1]; map[idx * 3 + 2] = tu[o * 3 + 2];
            f[idx] = (j === FK && v >= ISO) ? 1 : v;
            if (v >= ISO) {                                      // la couleur vient de la même position source que la matière
              let sy = j + tu[o * 3 + 1]; if (sy < FK) sy = FK;
              col[idx] = this._nearCol(bf, bc, i + tu[o * 3], sy, k + tu[o * 3 + 2]); tch[idx] = 1;
            }
          }
        }
      const mb = this._mapBox;
      if (!mb) this._mapBox = { x0, y0, z0, x1, y1, z1 };
      else {
        if (x0 < mb.x0) mb.x0 = x0; if (y0 < mb.y0) mb.y0 = y0; if (z0 < mb.z0) mb.z0 = z0;
        if (x1 > mb.x1) mb.x1 = x1; if (y1 > mb.y1) mb.y1 = y1; if (z1 > mb.z1) mb.z1 = z1;
      }
      this._grow(x0, y0, z0, x1, y1, z1);
    }
    /** Déplace la matière autour de (cx,cy,cz) de (dx,dy,dz) mm, avec un rayon r (mm) : élastique, pousser */
    warpGrab(cx, cy, cz, dx, dy, dz, r) { this._warp(0, cx, cy, cz, r, dx, dy, dz, 0); }
    /** Pince la matière vers le point (cx,cy,cz) dans le plan de normale n ; amount négatif : écarte */
    warpPinch(cx, cy, cz, nx, ny, nz, r, amount) { this._warp(1, cx, cy, cz, r, nx, ny, nz, amount); }

    /** Gonfle (amount > 0, mm) ou dégonfle (< 0) la surface autour d'un point : elle avance le long de sa normale. */
    inflate(cx, cy, cz, r, amount) {
      const f = this.f;
      const gx = (cx + HALF) / H, gy = (cy + FLOOR_Y) / H, gz = (cz + HALF) / H;
      const R = r / H, R2 = R * R;
      const x0 = Math.max(2, Math.floor(gx - R) - 1), x1 = Math.min(N - 3, Math.ceil(gx + R) + 1);
      const y0 = Math.max(FK + 1, Math.floor(gy - R) - 1), y1 = Math.min(N - 3, Math.ceil(gy + R) + 1);
      const z0 = Math.max(2, Math.floor(gz - R) - 1), z1 = Math.min(N - 3, Math.ceil(gz + R) + 1);
      if (x0 > x1 || y0 > y1 || z0 > z1) return;
      const steps = Math.max(1, Math.ceil(Math.abs(amount) / H / 0.45)), s = amount / H / steps;
      const cnt = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
      if (!this._tmp || this._tmp.length < cnt) this._tmp = new Float32Array(cnt);
      const tmp = this._tmp;
      for (let st = 0; st < steps; st++) {
        let o = 0;
        for (let k = z0; k <= z1; k++)
          for (let j = y0; j <= y1; j++) {
            let idx = x0 + j * N + k * N2;
            for (let i = x0; i <= x1; i++, idx++, o++) {
              const ex = i - gx, ey = j - gy, ez = k - gz, q = (ex * ex + ey * ey + ez * ez) / R2;
              const v = f[idx];
              if (q >= 1) { tmp[o] = v; continue; }
              const gxx = f[idx + 1] - f[idx - 1], gyy = f[idx + N] - f[idx - N], gzz = f[idx + N2] - f[idx - N2];
              const gl = Math.sqrt(gxx * gxx + gyy * gyy + gzz * gzz);
              if (gl < 1e-3) { tmp[o] = v; continue; }
              const w = (1 - q) * (1 - q) * s / gl;       // la surface avance de s·w voxels le long de la normale (−∇f)
              tmp[o] = sample(f, i + gxx * w, j + gyy * w, k + gzz * w);
            }
          }
        o = 0;
        for (let k = z0; k <= z1; k++)
          for (let j = y0; j <= y1; j++) {
            let idx = x0 + j * N + k * N2;
            for (let i = x0; i <= x1; i++, idx++, o++) f[idx] = tmp[o];
          }
      }
      this._inherit(x0, y0, z0, x1, y1, z1);
      this._grow(x0, y0, z0, x1, y1, z1);
    }

    /** Rabote : coupe ce qui dépasse d'un plan (point p, normale n) autour du centre b. */
    flatten(bx, by, bz, px, py, pz, nx, ny, nz, r) {
      const f = this.f;
      const cx = (bx + HALF) / H, cy = (by + FLOOR_Y) / H, cz = (bz + HALF) / H;
      const ox = (px + HALF) / H, oy = (py + FLOOR_Y) / H, oz = (pz + HALF) / H;
      const R = r / H;
      const x0 = Math.max(1, Math.floor(cx - R)), x1 = Math.min(N - 2, Math.ceil(cx + R));
      const y0 = Math.max(FK, Math.floor(cy - R)), y1 = Math.min(N - 2, Math.ceil(cy + R));
      const z0 = Math.max(1, Math.floor(cz - R)), z1 = Math.min(N - 2, Math.ceil(cz + R));
      if (x0 > x1 || y0 > y1 || z0 > z1) return;
      for (let k = z0; k <= z1; k++) {
        for (let j = y0; j <= y1; j++) {
          let idx = x0 + j * N + k * N2;
          for (let i = x0; i <= x1; i++, idx++) {
            const ex = i - cx, ey = j - cy, ez = k - cz;
            const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
            if (d >= R) continue;
            let w = (1 - d / R) * 2; if (w > 1) w = 1;
            const sd = (i - ox) * nx + (j - oy) * ny + (k - oz) * nz;
            let cut = 0.5 - sd * 0.5;
            cut = cut < 0 ? 0 : cut > 1 ? 1 : cut;
            const lim = 1 + w * (cut - 1);
            if (lim < f[idx]) { f[idx] = (j === FK && lim >= ISO) ? 1 : lim; }
          }
        }
      }
      this._grow(x0, y0, z0, x1, y1, z1);
    }

    /** Étire / écrase toute la sculpture (facteurs sx, sy, sz) en gardant le pied posé au sol. */
    scaleAbout(sx, sy, sz) {
      const f = this.f;
      let x0 = N, y0 = N, z0 = N, x1 = -1, y1 = -1, z1 = -1;
      for (let k = 0; k < N; k++)
        for (let j = 0; j < N; j++) {
          const o = j * N + k * N2;
          for (let i = 0; i < N; i++) {
            if (f[o + i] >= ISO) {
              if (i < x0) x0 = i; if (i > x1) x1 = i;
              if (j < y0) y0 = j; if (j > y1) y1 = j;
              if (k < z0) z0 = k; if (k > z1) z1 = k;
            }
          }
        }
      if (x1 < 0) return false;
      const cx = (N - 1) / 2, cz = (N - 1) / 2, cy = FK - 0.5;
      const lo = (a, c, s) => Math.min(a, c + (a - c) * s);
      const hi = (a, c, s) => Math.max(a, c + (a - c) * s);
      const bx0 = Math.max(1, Math.floor(Math.min(lo(x0, cx, sx), x0) - 3)), bx1 = Math.min(N - 2, Math.ceil(Math.max(hi(x1, cx, sx), x1) + 3));
      const by0 = Math.max(FK, Math.floor(Math.min(lo(y0, cy, sy), y0) - 3)), by1 = Math.min(N - 2, Math.ceil(Math.max(hi(y1, cy, sy), y1) + 3));
      const bz0 = Math.max(1, Math.floor(Math.min(lo(z0, cz, sz), z0) - 3)), bz1 = Math.min(N - 2, Math.ceil(Math.max(hi(z1, cz, sz), z1) + 3));
      const src = this._src || (this._src = new Float32Array(N3));
      src.set(f);
      const srcC = this._srcC || (this._srcC = new Uint8Array(N3));
      srcC.set(this.col);
      for (let k = bz0; k <= bz1; k++)
        for (let j = by0; j <= by1; j++) {
          let idx = bx0 + j * N + k * N2;
          for (let i = bx0; i <= bx1; i++, idx++) {
            let v = sample(src, cx + (i - cx) / sx, cy + (j - cy) / sy, cz + (k - cz) / sz);
            if (j === FK && v >= ISO) v = 1;
            f[idx] = v;
            if (v >= ISO) this.col[idx] = this._nearCol(src, srcC, cx + (i - cx) / sx, cy + (j - cy) / sy, cz + (k - cz) / sz);
          }
        }
      this._grow(bx0, by0, bz0, bx1, by1, bz1);
      return true;
    }

    /* ---- primitives à distance signée (formes de départ) ---- */
    /** Écrit une primitive : fn(i,j,k) donne la distance signée en voxels (négative à l'intérieur). */
    _sdf(gx0, gy0, gz0, gx1, gy1, gz1, fn, mode) {
      const f = this.f, add = mode === 'add';
      const x0 = Math.max(1, Math.floor(gx0)), x1 = Math.min(N - 2, Math.ceil(gx1));
      const y0 = Math.max(FK, Math.floor(gy0)), y1 = Math.min(N - 2, Math.ceil(gy1));
      const z0 = Math.max(1, Math.floor(gz0)), z1 = Math.min(N - 2, Math.ceil(gz1));
      if (x0 > x1 || y0 > y1 || z0 > z1) return;
      for (let k = z0; k <= z1; k++) {
        for (let j = y0; j <= y1; j++) {
          let idx = x0 + j * N + k * N2;
          for (let i = x0; i <= x1; i++, idx++) {
            const sd = fn(i, j, k);
            if (sd > 1.1) continue;
            let b = 0.5 - sd * 0.5;
            b = b < 0 ? 0 : b > 1 ? 1 : b;
            if (add) { if (b > f[idx]) { f[idx] = (j === FK && b >= ISO) ? 1 : b; if (b >= ISO) this.col[idx] = this.paint; } }
            else { const nb = 1 - b; if (nb < f[idx]) f[idx] = (j === FK && nb >= ISO) ? 1 : nb; }
          }
        }
      }
      this._grow(x0, y0, z0, x1, y1, z1);
    }
    /** Cône arrondi : sphère de rayon ra en a, rb en b, reliées (membres effilés, oreilles, cornes, trompes…) */
    cone(ax, ay, az, ra, bx, by, bz, rb, mode) {
      const gax = (ax + HALF) / H, gay = (ay + FLOOR_Y) / H, gaz = (az + HALF) / H;
      const gbx = (bx + HALF) / H, gby = (by + FLOOR_Y) / H, gbz = (bz + HALF) / H;
      const gra = ra / H, grb = rb / H, m = Math.max(gra, grb) + 2;
      const dx = gbx - gax, dy = gby - gay, dz = gbz - gaz, dd = dx * dx + dy * dy + dz * dz;
      this._sdf(Math.min(gax, gbx) - m, Math.min(gay, gby) - m, Math.min(gaz, gbz) - m,
        Math.max(gax, gbx) + m, Math.max(gay, gby) + m, Math.max(gaz, gbz) + m, (i, j, k) => {
          let t = dd > 0 ? ((i - gax) * dx + (j - gay) * dy + (k - gaz) * dz) / dd : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = i - gax - t * dx, ey = j - gay - t * dy, ez = k - gaz - t * dz;
          return Math.sqrt(ex * ex + ey * ey + ez * ez) - (gra + (grb - gra) * t);
        }, mode);
    }
    ellipsoid(cx, cy, cz, rx, ry, rz, mode) {
      const gx = (cx + HALF) / H, gy = (cy + FLOOR_Y) / H, gz = (cz + HALF) / H;
      const a = rx / H, b = ry / H, c = rz / H, mn = Math.min(a, b, c);
      this._sdf(gx - a - 2, gy - b - 2, gz - c - 2, gx + a + 2, gy + b + 2, gz + c + 2, (i, j, k) => {
        const qx = (i - gx) / a, qy = (j - gy) / b, qz = (k - gz) / c;
        return (Math.sqrt(qx * qx + qy * qy + qz * qz) - 1) * mn;
      }, mode);
    }
    /** Boîte à coins arrondis (demi-dimensions hx, hy, hz ; rayon des coins r) */
    roundBox(cx, cy, cz, hx, hy, hz, r, mode) {
      const gx = (cx + HALF) / H, gy = (cy + FLOOR_Y) / H, gz = (cz + HALF) / H;
      const a = hx / H, b = hy / H, c = hz / H, rr = r / H;
      this._sdf(gx - a - 2, gy - b - 2, gz - c - 2, gx + a + 2, gy + b + 2, gz + c + 2, (i, j, k) => {
        const qx = Math.abs(i - gx) - (a - rr), qy = Math.abs(j - gy) - (b - rr), qz = Math.abs(k - gz) - (c - rr);
        const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0, oz = qz > 0 ? qz : 0;
        const inside = Math.min(Math.max(qx, qy, qz), 0);
        return Math.sqrt(ox * ox + oy * oy + oz * oz) + inside - rr;
      }, mode);
    }
    /** Prisme triangulaire (toits, voiles, ailerons) : base de largeur 2·hw posée en y = cy, sommet à cy + ht, longueur 2·hl.
     *  axis 'z' : triangle dans le plan XY, extrusion en z ; axis 'x' : triangle dans le plan ZY, extrusion en x. */
    prism(cx, cy, cz, hw, ht, hl, r, axis, mode) {
      const gx = (cx + HALF) / H, gy = (cy + FLOOR_Y) / H, gz = (cz + HALF) / H;
      const w = hw / H, h = ht / H, l = hl / H, rr = r / H;
      const alongX = axis === 'x';
      const tri = (px, py) => {            // distance signée au triangle (-w,0) (w,0) (0,h)
        const ax = -w, ay = 0, bx = w, by = 0, qx = 0, qy = h;
        const e0x = bx - ax, e0y = by - ay, e1x = qx - bx, e1y = qy - by, e2x = ax - qx, e2y = ay - qy;
        const v0x = px - ax, v0y = py - ay, v1x = px - bx, v1y = py - by, v2x = px - qx, v2y = py - qy;
        let t = Math.max(0, Math.min(1, (v0x * e0x + v0y * e0y) / (e0x * e0x + e0y * e0y)));
        const p0 = (v0x - e0x * t) ** 2 + (v0y - e0y * t) ** 2;
        t = Math.max(0, Math.min(1, (v1x * e1x + v1y * e1y) / (e1x * e1x + e1y * e1y)));
        const p1 = (v1x - e1x * t) ** 2 + (v1y - e1y * t) ** 2;
        t = Math.max(0, Math.min(1, (v2x * e2x + v2y * e2y) / (e2x * e2x + e2y * e2y)));
        const p2 = (v2x - e2x * t) ** 2 + (v2y - e2y * t) ** 2;
        const sg = Math.sign(e0x * e2y - e0y * e2x);
        const c0 = sg * (v0x * e0y - v0y * e0x), c1 = sg * (v1x * e1y - v1y * e1x), c2 = sg * (v2x * e2y - v2y * e2x);
        return -Math.sqrt(Math.min(p0, p1, p2)) * Math.sign(Math.min(c0, c1, c2));
      };
      const ux = alongX ? l : w, uz = alongX ? w : l;
      this._sdf(gx - ux - rr - 2, gy - rr - 2, gz - uz - rr - 2, gx + ux + rr + 2, gy + h + rr + 2, gz + uz + rr + 2, (i, j, k) => {
        const d2 = tri(alongX ? k - gz : i - gx, j - gy);
        const e = Math.abs(alongX ? i - gx : k - gz) - l;
        const ox = d2 > 0 ? d2 : 0, oe = e > 0 ? e : 0;
        return Math.min(Math.max(d2, e), 0) + Math.sqrt(ox * ox + oe * oe) - rr;
      }, mode);
    }

    /** Lisse toute la sculpture (deux passes douces) */
    smoothAll(k) {
      const bb = fieldBBox(this.f, N);
      if (!bb) return false;
      this._grow(Math.max(1, bb[0] - 2), Math.max(FK, bb[1] - 2), Math.max(1, bb[2] - 2), Math.min(N - 2, bb[3] + 2), Math.min(N - 2, bb[4] + 2), Math.min(N - 2, bb[5] + 2));
      this.relaxBox(k); this.relaxBox(k);
      return true;
    }

    /** Adoucit légèrement les arêtes vives dans la zone modifiée (rendu "pâte à modeler") */
    relaxBox(strength) {
      const b = this.box;
      if (!b) return;
      const f = this.f;
      const x0 = Math.max(1, b.x0), x1 = Math.min(N - 2, b.x1);
      const y0 = Math.max(FK, b.y0), y1 = Math.min(N - 2, b.y1);
      const z0 = Math.max(1, b.z0), z1 = Math.min(N - 2, b.z1);
      const w = x1 - x0 + 1, h = y1 - y0 + 1, d = z1 - z0 + 1;
      if (w <= 0 || h <= 0 || d <= 0) return;
      const tmp = new Float32Array(w * h * d);
      let o = 0;
      for (let k = z0; k <= z1; k++)
        for (let j = y0; j <= y1; j++)
          for (let i = x0; i <= x1; i++, o++) {
            const idx = i + j * N + k * N2;
            const v = f[idx];
            const avg = (f[idx - 1] + f[idx + 1] + f[idx - N] + f[idx + N] + f[idx - N2] + f[idx + N2]) / 6;
            tmp[o] = v + strength * (avg - v);
          }
      o = 0;
      for (let k = z0; k <= z1; k++)
        for (let j = y0; j <= y1; j++)
          for (let i = x0; i <= x1; i++, o++) {
            let v = tmp[o];
            if (j === FK && v >= ISO) v = 1;
            f[i + j * N + k * N2] = v;
          }
      this._inherit(x0, y0, z0, x1, y1, z1);
      this.markBox(x0, y0, z0, x1, y1, z1);
    }

    /** Colle (add) ou creuse (remove) un maillage "soupe de triangles" en coordonnées monde. */
    stampMesh(pos, mode) {
      const nT = Math.floor(pos.length / 9);
      const S = N * 2;
      const cols = new Array(S * S);
      const EPX = 0.000137, EPZ = 0.000091;
      let bx0 = N, by0 = N, bz0 = N, bx1 = -1, by1 = -1, bz1 = -1;
      for (let t = 0; t < nT; t++) {
        const o = t * 9;
        const ax = (pos[o] + HALF) / H, ay = (pos[o + 1] + FLOOR_Y) / H, az = (pos[o + 2] + HALF) / H;
        const bx = (pos[o + 3] + HALF) / H, by = (pos[o + 4] + FLOOR_Y) / H, bz = (pos[o + 5] + HALF) / H;
        const cx = (pos[o + 6] + HALF) / H, cy = (pos[o + 7] + FLOOR_Y) / H, cz = (pos[o + 8] + HALF) / H;
        const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(den) < 1e-9) continue;
        const minx = Math.min(ax, bx, cx), maxx = Math.max(ax, bx, cx);
        const minz = Math.min(az, bz, cz), maxz = Math.max(az, bz, cz);
        const s0 = Math.max(0, Math.ceil((minx + 0.25) * 2)), s1 = Math.min(S - 1, Math.floor((maxx + 0.25) * 2));
        const r0 = Math.max(0, Math.ceil((minz + 0.25) * 2)), r1 = Math.min(S - 1, Math.floor((maxz + 0.25) * 2));
        for (let r = r0; r <= r1; r++) {
          const z = r * 0.5 - 0.25 + EPZ;
          for (let s = s0; s <= s1; s++) {
            const x = s * 0.5 - 0.25 + EPX;
            const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den;
            const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den;
            const l3 = 1 - l1 - l2;
            if (l1 < 0 || l2 < 0 || l3 < 0) continue;
            const y = l1 * ay + l2 * by + l3 * cy;
            const key = r * S + s;
            (cols[key] || (cols[key] = [])).push(y);
          }
        }
      }
      const acc = this._acc || (this._acc = new Float32Array(N3));
      for (let key = 0; key < cols.length; key++) {
        const arr = cols[key];
        if (!arr) continue;
        arr.sort((p, q) => p - q);
        const s = key % S, r = (key - s) / S;
        const i = s >> 1, k = r >> 1;
        if (i < 1 || i > N - 2 || k < 1 || k > N - 2) continue;
        for (let m = 0; m + 1 < arr.length; m += 2) {
          const y0 = arr[m], y1 = arr[m + 1];
          const j0 = Math.max(FK, Math.floor(y0 + 0.5)), j1 = Math.min(N - 2, Math.floor(y1 + 0.5));
          for (let j = j0; j <= j1; j++) {
            const ov = Math.min(y1, j + 0.5) - Math.max(y0, j - 0.5);
            if (ov > 0) {
              acc[i + j * N + k * N2] += 0.25 * ov;
              if (i < bx0) bx0 = i; if (i > bx1) bx1 = i;
              if (j < by0) by0 = j; if (j > by1) by1 = j;
              if (k < bz0) bz0 = k; if (k > bz1) bz1 = k;
            }
          }
        }
      }
      if (bx1 < 0) return false;
      const f = this.f, add = mode === 'add', tch = this._tch || (this._tch = new Uint8Array(N3));
      for (let k = bz0; k <= bz1; k++)
        for (let j = by0; j <= by1; j++) {
          let idx = bx0 + j * N + k * N2;
          for (let i = bx0; i <= bx1; i++, idx++) {
            let a = acc[idx];
            if (a <= 0) continue;
            if (a > 1) a = 1;
            if (add) { if (a > f[idx]) { f[idx] = (j === FK && a >= ISO) ? 1 : a; if (a >= ISO) { this.col[idx] = this.paint; tch[idx] = 1; } } }
            else { const nb = 1 - a; if (nb < f[idx]) f[idx] = (j === FK && nb >= ISO) ? 1 : nb; }
          }
        }
      for (let k = bz0; k <= bz1; k++)
        for (let j = by0; j <= by1; j++) {
          const o = bx0 + j * N + k * N2;
          acc.fill(0, o, o + (bx1 - bx0 + 1));
        }
      this._grow(bx0, by0, bz0, bx1, by1, bz1);
      return true;
    }

    /* ---- rayon ---- */
    raycast(field, ox, oy, oz, dx, dy, dz) { return raycast(field || this.f, ox, oy, oz, dx, dy, dz); }

    isEmpty() {
      const f = this.f;
      for (let i = 0; i < N3; i++) if (f[i] >= ISO) return false;
      return true;
    }

    /* ---- maillage d'affichage ---- */
    rebuild() {
      if (this.dirty.size === 0) return false;
      const THREE = this.THREE;
      for (const id of this.dirty) {
        const cx = id % NC, cy = Math.floor(id / NC) % NC, cz = Math.floor(id / (NC * NC));
        const g = buildChunk(this.f, this.col, this._palRGB, cx, cy, cz);
        let mesh = this.chunks[id];
        if (!g) {
          if (mesh) mesh.visible = false;
          continue;
        }
        if (!mesh) {
          mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
          mesh.frustumCulled = false;
          this.chunks[id] = mesh;
          this.group.add(mesh);
        }
        mesh.visible = true;
        uploadChunk(THREE, mesh, g.vc, g.ic);
      }
      this.dirty.clear();
      return true;
    }

    /* ---- sauvegarde ---- */
    serialize() { return N + ':' + L + '|' + encode(this.f) + '|' + encodeBytes(this.col) + '|' + this.pal.join(','); }
    deserialize(str) {
      let n = 80, lw = 100, cstr = null, pstr = null;
      const bar = str.indexOf('|');
      if (bar > 0) {
        const parts = str.split('|');
        const head = parts[0].split(':');
        n = parseInt(head[0], 10);
        if (head[1]) lw = parseFloat(head[1]);
        str = parts[1]; cstr = parts[2] || null; pstr = parts[3] || null;
      }
      if (!(n >= 32 && n <= 256) || !(lw >= 50 && lw <= 400)) throw new Error('bad grid');
      const tmp = new Float32Array(n * n * n);
      decode(str, tmp, n * n * n);
      let col = new Uint8Array(n * n * n), has = false;
      if (cstr) { try { decodeBytes(cstr, col); has = true; } catch (e) { col = new Uint8Array(n * n * n); } }
      if (pstr) {
        const list = pstr.split(',').map((x) => parseInt(x, 10)).filter((x) => x >= 0 && x <= 0xffffff);
        if (list.length) this.setPalette(list);
      }
      this._applyGrid(tmp, n, lw, col);
      this.loadedColors = has;       // sans couleurs (ancienne sauvegarde) : l'application choisit
    }

    /** Installe un champ déjà rééchantillonné et reconfigure la grille */
    _applyGrid(field, n, lw, col) {
      configure(n, lw);
      this.f = field;
      this.col = col || new Uint8Array(n * n * n);
      this._src = this._sh = this._shc = this._srcC = this._tch = this._tmp = this._acc = this._map = this._mapBox = this._wu = this._wv = null;
      this.before = null;
      this.box = null;
      for (const m of this.chunks) if (m) { this.group.remove(m); m.geometry.dispose(); }
      this.chunks = new Array(NC * NC * NC).fill(null);
      this.dirty.clear();
      this.markAll();
    }

    /** Change la taille du plateau (mm) et/ou la résolution de la grille (voxels par axe) en conservant la forme */
    setWorld(lw, n) {
      if (lw === L && n === N) return;
      const nf = resampleTo(this.f, N, L, n, lw);
      this._applyGrid(nf, n, lw, resampleColors(this.col, N, L, n, lw, nf));
    }
    /** Change la résolution de travail (conserve la forme) */
    setResolution(n) { this.setWorld(L, n); }
    get resolution() { return N; }
    get world() { return L; }

    /** Utilise un matériau fourni par l'application (matcap, éclairé…) pour tous les blocs */
    useMaterial(mat) {
      this.material = mat;
      mat.vertexColors = true; mat.color.setHex(0xffffff); mat.needsUpdate = true;   // les couleurs viennent des sommets
      for (const m of this.chunks) if (m) m.material = mat;
    }

    /* ---- export imprimable ---- */
    /** Retire les petits débris flottants (copie), retourne {f, removed} */
    _cleaned() {
      const f = this.f.slice();
      const seen = new Uint8Array(N3);
      const stack = new Int32Array(N3);
      let removed = 0;
      const MIN = 60;
      for (let s = 0; s < N3; s++) {
        if (seen[s] || f[s] < ISO) continue;
        let sp = 0, cnt = 0;
        stack[sp++] = s; seen[s] = 1;
        const members = [];
        while (sp > 0) {
          const v = stack[--sp];
          cnt++;
          if (cnt <= MIN) members.push(v);
          const i = v % N, j = ((v - i) / N) % N, k = (v - i - j * N) / N2;
          for (let dz = -1; dz <= 1; dz++) {
            const kk = k + dz; if (kk < 0 || kk >= N) continue;
            for (let dy = -1; dy <= 1; dy++) {
              const jj = j + dy; if (jj < 0 || jj >= N) continue;
              for (let dx = -1; dx <= 1; dx++) {
                const ii = i + dx; if (ii < 0 || ii >= N) continue;
                const u = ii + jj * N + kk * N2;
                if (!seen[u] && f[u] >= ISO) { seen[u] = 1; stack[sp++] = u; }
              }
            }
          }
        }
        if (cnt < MIN) { for (const m of members) f[m] = 0; removed++; }
      }
      return { f, removed };
    }

    /** Construit un maillage indexé et vérifie qu'il est manifold */
    buildExport(targetN, smoothIters) {
      const cleaned = this._cleaned();
      const removed = cleaned.removed;
      let f = cleaned.f;
      const baseN = N;
      let n = N;
      if (targetN && targetN !== N) {
        f = resampleTo(f, N, L, targetN, L);
        n = targetN;
        const hb = fieldBBox(f, n);
        if (hb) relaxField(f, n, 2, 0.5, hb);
      }
      configure(n, L);
      try {
        return this._buildExportMesh(f, removed, n, fieldBBox(f, n), smoothIters || 0);
      } finally {
        configure(baseN, L);
      }
    }

    _buildExportMesh(f, removed, n, bb, smoothIters) {
      const map = new Map();
      const verts = [];
      const idxs = [];
      const vid = (a, b) => {
        if (a > b) { const s = a; a = b; b = s; }
        const key = a * N3 + b;
        let id = map.get(key);
        if (id === undefined) {
          edgeVertex(f, a, b, false);
          id = verts.length / 3;
          verts.push(vx, vy, vz);
          map.set(key, id);
        }
        return id;
      };
      if (bb) {
        polygonize(f, Math.max(0, bb[0] - 2), Math.max(0, bb[1] - 2), Math.max(0, bb[2] - 2),
          Math.min(n - 2, bb[3] + 2), Math.min(n - 2, bb[4] + 2), Math.min(n - 2, bb[5] + 2), function (a1, b1, a2, b2, a3, b3) {
            idxs.push(vid(a1, b1), vid(a2, b2), vid(a3, b3));
          });
      }
      const positions = new Float32Array(verts);
      const indices = new Uint32Array(idxs);
      if (smoothIters > 0) smoothMesh(positions, indices, smoothIters, 0.5, -0.53);
      const V = positions.length / 3;
      const nTri = indices.length / 3;

      // vérification : chaque arête orientée apparaît une seule fois et son opposée existe
      const directed = new Set();
      let bad = 0;
      for (let t = 0; t < nTri; t++) {
        const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
        if (a === b || b === c || a === c) { bad++; continue; }
        const es = [a * V + b, b * V + c, c * V + a];
        for (const e of es) { if (directed.has(e)) bad++; else directed.add(e); }
      }
      for (let t = 0; t < nTri; t++) {
        const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
        if (!directed.has(b * V + a)) bad++;
        if (!directed.has(c * V + b)) bad++;
        if (!directed.has(a * V + c)) bad++;
      }

      let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let v = 0; v < V; v++) {
        const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      let vol = 0;
      for (let t = 0; t < nTri; t++) {
        const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
        vol += positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1])
          - positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c])
          + positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
      }
      vol /= 6;
      return {
        positions, indices, nTri, nVert: V, res: n,
        manifold: bad === 0 && nTri > 0,
        problems: bad, removed,
        min: [minX, minY, minZ], max: [maxX, maxY, maxZ],
        volume: vol // mm³
      };
    }
  }

  Clay.DEFAULT_PALETTE = [0xf2a679, 0x7cb7ff, 0x6ee7a0, 0xf78fc0, 0xfde047, 0xfaf9f7, 0xb8a2fb, 0x4ee3cf];
  global.ClayEngine = { Clay, ISO, grid: () => ({ N, H, FK, FLOOR_Y, L, HALF }) };
})(window);
