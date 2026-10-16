/* ==========================================================================
   Import (STL / OBJ / formes de base) et export (STL binaire / OBJ)
   ========================================================================== */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------- Import */
  function parseSTL(buf) {
    const dv = new DataView(buf);
    let out = null;

    // Détection binaire : vérifie la cohérence du nombre de triangles avec la taille du buffer
    if (buf.byteLength >= 84) {
      const nTri = dv.getUint32(80, true);
      const expectedSize = 84 + nTri * 50;
      // Tolérance sur la taille (certains exports ont un petit padding ou footer)
      if (nTri > 0 && (expectedSize === buf.byteLength || (expectedSize <= buf.byteLength && buf.byteLength - expectedSize < 2048))) {
        out = new Float32Array(nTri * 9);
        for (let t = 0; t < nTri; t++) {
          const o = 84 + t * 50 + 12;
          for (let v = 0; v < 9; v++) out[t * 9 + v] = dv.getFloat32(o + v * 4, true);
        }
      }
    }

    // Si pas binaire ou lecture infructueuse, tentative ASCII
    if (!out) {
      const txt = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/gi;
      const arr = [];
      let m;
      while ((m = re.exec(txt))) arr.push(+m[1], +m[2], +m[3]);
      if (arr.length >= 9) {
        const validLen = arr.length - (arr.length % 9);
        out = new Float32Array(validLen);
        out.set(arr.slice(0, validLen));
      }
    }

    // Secours si le fichier était binaire mais sans taille stricte
    if (!out && buf.byteLength >= 84) {
      const nTri = dv.getUint32(80, true);
      if (nTri > 0 && nTri < 2000000) {
        const actualTri = Math.min(nTri, Math.floor((buf.byteLength - 84) / 50));
        out = new Float32Array(actualTri * 9);
        for (let t = 0; t < actualTri; t++) {
          const o = 84 + t * 50 + 12;
          for (let v = 0; v < 9; v++) out[t * 9 + v] = dv.getFloat32(o + v * 4, true);
        }
      }
    }

    if (!out || out.length < 9) {
      throw new Error('Fichier STL non reconnu ou vide');
    }

    // Convention STL : Z vers le haut -> Three.js Y vers le haut
    for (let i = 0; i < out.length; i += 3) {
      const y = out[i + 1], z = out[i + 2];
      out[i + 1] = z; out[i + 2] = -y;
    }
    return out;
  }

  function parseOBJ(text) {
    const v = [];
    const tris = [];
    const lines = text.split(/\r?\n/);
    for (let l = 0; l < lines.length; l++) {
      const line = lines[l].trim();
      if (!line || line.startsWith('#')) continue;
      if (line.startsWith('v ') || line.startsWith('v\t')) {
        const parts = line.split(/\s+/);
        if (parts.length >= 4) {
          v.push(+parts[1], +parts[2], +parts[3]);
        }
      } else if (line.startsWith('f ') || line.startsWith('f\t')) {
        const parts = line.split(/\s+/).slice(1);
        const poly = [];
        for (let i = 0; i < parts.length; i++) {
          const token = parts[i].trim();
          if (!token) continue;
          let idx = parseInt(token.split('/')[0], 10);
          if (isNaN(idx)) continue;
          if (idx < 0) idx = v.length / 3 + idx + 1;
          poly.push((idx - 1) * 3);
        }
        // Triangulation en éventail pour quads et polygones
        for (let i = 1; i + 1 < poly.length; i++) {
          const a = poly[0], b = poly[i], c = poly[i + 1];
          if (a >= 0 && b >= 0 && c >= 0 && c + 2 < v.length) {
            tris.push(v[a], v[a + 1], v[a + 2], v[b], v[b + 1], v[b + 2], v[c], v[c + 1], v[c + 2]);
          }
        }
      }
    }
    if (tris.length < 9) {
      throw new Error('Fichier OBJ sans triangles valides');
    }
    return new Float32Array(tris);
  }

  /** Centre le maillage et le met à l'échelle (plus grande dimension = 1). */
  function normalize(soup) {
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < soup.length; i += 3) {
      const x = soup[i], y = soup[i + 1], z = soup[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const ex = maxX - minX, ey = maxY - minY, ez = maxZ - minZ;
    const maxDim = Math.max(ex, ey, ez) || 1;
    const s = 1 / maxDim;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    const out = new Float32Array(soup.length);
    for (let i = 0; i < soup.length; i += 3) {
      out[i] = (soup[i] - cx) * s;
      out[i + 1] = (soup[i + 1] - cy) * s;
      out[i + 2] = (soup[i + 2] - cz) * s;
    }
    return {
      pos: out,
      ext: [ex * s, ey * s, ez * s],
      origExt: [ex, ey, ez],
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ]
    };
  }

  function soupFromGeometry(g) {
    const ng = g.index ? g.toNonIndexed() : g;
    return ng.getAttribute('position').array.slice();
  }

  /** Formes de base (THREE requis) */
  const SHAPES = [
    { id: 'sphere', name: 'Boule', emoji: '⚪' },
    { id: 'cube', name: 'Cube', emoji: '🟦' },
    { id: 'cylinder', name: 'Cylindre', emoji: '🥫' },
    { id: 'cone', name: 'Cône', emoji: '🔺' },
    { id: 'pyramid', name: 'Pyramide', emoji: '🔻' },
    { id: 'torus', name: 'Anneau', emoji: '🍩' },
    { id: 'heart', name: 'Cœur', emoji: '❤️' },
    { id: 'star', name: 'Étoile', emoji: '⭐' },
    { id: 'flower', name: 'Fleur', emoji: '🌸' },
    { id: 'paw', name: 'Patte', emoji: '🐾' },
    { id: 'moon', name: 'Lune', emoji: '🌙' },
    { id: 'drop', name: 'Goutte', emoji: '💧' },
    { id: 'diamond', name: 'Diamant', emoji: '💎' }
  ];

  /** Motifs plats (face vers +Z) : formes de base + épaisseur douce */
  const FLAT_OPTS = { depth: 0.3, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.04, bevelSegments: 2, steps: 1 };
  function flatShape(THREE, id) {
    const s = new THREE.Shape();
    if (id === 'flower') {
      for (let i = 0; i < 120; i++) {
        const t = (i / 120) * Math.PI * 2, r = 0.62 + 0.38 * Math.cos(5 * t);
        const x = Math.cos(t) * r, y = Math.sin(t) * r;
        if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
      }
      s.closePath();
    } else if (id === 'moon') {
      const d = 0.45, r = 0.82, x = (1 - r * r + d * d) / (2 * d), y = Math.sqrt(1 - x * x);
      const alpha = Math.atan2(y, x), beta = Math.atan2(y, x - d);
      for (let i = 0; i <= 48; i++) {
        const t = alpha + (i / 48) * (Math.PI * 2 - 2 * alpha);
        if (i === 0) s.moveTo(Math.cos(t), Math.sin(t)); else s.lineTo(Math.cos(t), Math.sin(t));
      }
      for (let i = 1; i <= 48; i++) {
        const f = -beta - (i / 48) * (Math.PI * 2 - 2 * beta);
        s.lineTo(d + r * Math.cos(f), r * Math.sin(f));
      }
      s.closePath();
    } else if (id === 'drop') {
      for (let i = 0; i < 64; i++) {
        const t = (i / 64) * Math.PI * 2;
        const x = 0.62 * Math.sin(t) * Math.pow(Math.sin(t / 2), 1.2), y = Math.cos(t);
        if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
      }
      s.closePath();
    } else { // diamond
      s.moveTo(0, 1); s.lineTo(0.62, 0.1); s.lineTo(0, -1); s.lineTo(-0.62, 0.1); s.closePath();
    }
    return s;
  }
  function pawShapes(THREE) {
    const mk = (x, y, rx, ry) => { const e = new THREE.Shape(); e.absellipse(x, y, rx, ry, 0, Math.PI * 2, false, 0); return e; };
    return [mk(0, -0.25, 0.42, 0.34), mk(-0.58, 0.12, 0.15, 0.2), mk(-0.21, 0.48, 0.15, 0.21), mk(0.21, 0.48, 0.15, 0.21), mk(0.58, 0.12, 0.15, 0.2)];
  }

  function shapeSoup(THREE, id) {
    let g;
    switch (id) {
      case 'sphere': g = new THREE.SphereGeometry(1, 28, 20); break;
      case 'cube': g = new THREE.BoxGeometry(1, 1, 1); break;
      case 'cylinder': g = new THREE.CylinderGeometry(0.5, 0.5, 1, 32); break;
      case 'cone': g = new THREE.ConeGeometry(0.5, 1, 32); break;
      case 'pyramid': g = new THREE.ConeGeometry(0.7, 1, 4); break;
      case 'torus': g = new THREE.TorusGeometry(1, 0.42, 16, 40); break;
      case 'heart': {
        const s = new THREE.Shape();
        for (let i = 0; i <= 64; i++) {
          const t = (i / 64) * Math.PI * 2;
          const x = 16 * Math.pow(Math.sin(t), 3);
          const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
          if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
        }
        g = new THREE.ExtrudeGeometry(s, { depth: 10, bevelEnabled: true, bevelThickness: 4, bevelSize: 3, bevelSegments: 2, steps: 1 });
        break;
      }
      case 'star': {
        const s = new THREE.Shape();
        for (let i = 0; i < 10; i++) {
          const a = Math.PI / 2 + (i * Math.PI) / 5;
          const r = i % 2 === 0 ? 1 : 0.45;
          const x = Math.cos(a) * r, y = Math.sin(a) * r;
          if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
        }
        s.closePath();
        g = new THREE.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.08, bevelSegments: 2, steps: 1 });
        break;
      }
      case 'flower': case 'moon': case 'drop': case 'diamond':
        g = new THREE.ExtrudeGeometry(flatShape(THREE, id), FLAT_OPTS);
        break;
      case 'paw':
        g = new THREE.ExtrudeGeometry(pawShapes(THREE), Object.assign({}, FLAT_OPTS, { bevelSize: 0.02 }));
        break;
      default: g = new THREE.SphereGeometry(1, 24, 16);
    }
    const soup = soupFromGeometry(g);
    g.dispose();
    return soup;
  }

  /* ---------------------------------------------------------------- Export */
  /** Matrice de transformation monde (Y haut) -> imprimante (Z haut), posé sur le plateau */
  function transformForPrint(mesh, targetMm) {
    const p = mesh.positions;
    const [minX, minY, minZ] = mesh.min, [maxX, maxY, maxZ] = mesh.max;
    const dim = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
    const s = targetMm / dim;
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const out = new Float32Array(p.length);
    for (let i = 0; i < p.length; i += 3) {
      out[i] = (p[i] - cx) * s;
      out[i + 1] = -(p[i + 2] - cz) * s;
      out[i + 2] = (p[i + 1] - minY) * s;
    }
    return { positions: out, scale: s, size: [(maxX - minX) * s, (maxZ - minZ) * s, (maxY - minY) * s] };
  }

  function writeSTL(mesh, targetMm) {
    const { positions } = transformForPrint(mesh, targetMm);
    const idx = mesh.indices;
    const n = idx.length / 3;
    const buf = new ArrayBuffer(84 + n * 50);
    const dv = new DataView(buf);
    const head = 'Clay3D - sculpture manifold';
    for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
    dv.setUint32(80, n, true);
    let o = 84;
    for (let t = 0; t < n; t++) {
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
      const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(o, nx / nl, true); dv.setFloat32(o + 4, ny / nl, true); dv.setFloat32(o + 8, nz / nl, true);
      o += 12;
      for (const q of [a, b, c]) {
        dv.setFloat32(o, positions[q], true); dv.setFloat32(o + 4, positions[q + 1], true); dv.setFloat32(o + 8, positions[q + 2], true);
        o += 12;
      }
      dv.setUint16(o, 0, true); o += 2;
    }
    return new Blob([buf], { type: 'model/stl' });
  }

  /** OBJ ; si la sculpture a plusieurs couleurs, chaque sommet porte sa couleur (« v x y z r g b », 0 à 1) : lue par Blender, MeshLab… */
  function writeOBJ(mesh, targetMm) {
    const { positions } = transformForPrint(mesh, targetMm);
    const idx = mesh.indices, col = mesh.hasColors ? mesh.colors : null;
    const parts = ['# Clay3D - sculpture manifold (mm)' + (col ? ', couleurs par sommet' : '') + '\n'];
    for (let i = 0; i < positions.length; i += 3) {
      parts.push('v ' + positions[i].toFixed(4) + ' ' + positions[i + 1].toFixed(4) + ' ' + positions[i + 2].toFixed(4) +
        (col ? ' ' + (col[i] / 255).toFixed(4) + ' ' + (col[i + 1] / 255).toFixed(4) + ' ' + (col[i + 2] / 255).toFixed(4) : '') + '\n');
    }
    for (let t = 0; t < idx.length; t += 3) {
      parts.push('f ' + (idx[t] + 1) + ' ' + (idx[t + 1] + 1) + ' ' + (idx[t + 2] + 1) + '\n');
    }
    return new Blob(parts, { type: 'text/plain' });
  }

  /** PLY (texte) avec couleurs par sommet : lu partout (Blender, MeshLab, ZBrush, logiciels de découpe couleur…) */
  function writePLY(mesh, targetMm) {
    const { positions } = transformForPrint(mesh, targetMm);
    const idx = mesh.indices, col = mesh.colors, V = positions.length / 3;
    const parts = ['ply\nformat ascii 1.0\ncomment Clay3D - sculpture manifold (mm)\nelement vertex ' + V +
      '\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face ' + (idx.length / 3) +
      '\nproperty list uchar int vertex_indices\nend_header\n'];
    for (let i = 0; i < positions.length; i += 3) {
      parts.push(positions[i].toFixed(4) + ' ' + positions[i + 1].toFixed(4) + ' ' + positions[i + 2].toFixed(4) + ' ' + col[i] + ' ' + col[i + 1] + ' ' + col[i + 2] + '\n');
    }
    for (let t = 0; t < idx.length; t += 3) parts.push('3 ' + idx[t] + ' ' + idx[t + 1] + ' ' + idx[t + 2] + '\n');
    return new Blob(parts, { type: 'text/plain' });
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
  }

  global.ClayIO = { parseSTL, parseOBJ, normalize, SHAPES, shapeSoup, transformForPrint, writeSTL, writeOBJ, writePLY, download };
})(window);
