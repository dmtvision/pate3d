/* ==========================================================================
   Construit js/models.js : les « Modèles de l'atelier » (modèles faits à la main en STL) deviennent des formes de départ.
   Chaque STL est remis debout (Z haut → Y haut), tourné pour regarder vers l'avant (+z), mis à la taille voulue, centré et posé
   sur le plateau, puis transformé en champ de voxels (le moteur de Pâte3D lui-même) et enregistré de façon compacte.
   Dans l'application, ce champ est rééchantillonné à la résolution courante puis légèrement lissé (« blur », en mm).

   Utilisation :  node tools/build-models.js
   (les chemins des STL sont ceux de l'ordinateur de l'auteur : à adapter dans MODELS si besoin)
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = 'E:/Documents/SITES/cours/tuto/';
const MODELS = [
  // id (unique), nom affiché, emoji, fichier, rotation autour de la verticale (degrés) pour regarder vers l'avant, taille (plus grande dimension, mm)
  { id: 'atelier-fantome', name: 'Fantôme', emoji: '👻', file: SRC + 'FANTOME-high.stl', rot: 0, size: 100 },
  { id: 'atelier-bonhomme', name: 'Bonhomme', emoji: '🙂', file: SRC + 'perso.stl', rot: -90, size: 110 },
  { id: 'atelier-alien', name: 'Alien', emoji: '👽', file: SRC + 'ALIEN.stl', rot: 0, size: 110 },
  { id: 'atelier-chat-debout', name: 'Chat debout', emoji: '🐈', file: SRC + 'chat1.stl', rot: 0, size: 105 },
  { id: 'atelier-chat-assis', name: 'Chat assis', emoji: '🐱', file: SRC + 'chat2.stl', rot: 0, size: 100 }
];
const PLATE = 140;   // mm : grille de stockage (les modèles y tiennent)
const GRID = 128;    // voxels par côté (≈ 1,1 mm)
const BLUR = 1.8;    // mm : lissage appliqué au chargement (efface les marches des voxels, garde la forme)
const CATEGORY = "Modèles de l'atelier";

/* ---- moteur de Pâte3D, sans affichage ---- */
global.window = global;
const THREE = {
  Group: function () { this.add = function () {}; this.remove = function () {}; },
  MeshStandardMaterial: function () { this.color = { setHex() {} }; this.dispose = function () {}; }
};
eval(fs.readFileSync(path.join(__dirname, '..', 'js', 'clay.js'), 'utf8'));
const { Clay } = global.ClayEngine;

/** STL binaire ou texte → triangles (9 nombres par triangle), repère du fichier */
function readSTL(file) {
  const buf = fs.readFileSync(file);
  if (buf.length >= 84) {
    const n = buf.readUInt32LE(80);
    if (n > 0 && 84 + n * 50 <= buf.length && buf.length - (84 + n * 50) < 2048) {
      const out = new Float32Array(n * 9);
      for (let t = 0; t < n; t++) for (let v = 0; v < 9; v++) out[t * 9 + v] = buf.readFloatLE(84 + t * 50 + 12 + v * 4);
      return out;
    }
  }
  const txt = buf.toString('utf8'), re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g, a = [];
  let m;
  while ((m = re.exec(txt))) a.push(+m[1], +m[2], +m[3]);
  if (a.length < 9) throw new Error('STL illisible : ' + file);
  return new Float32Array(a.slice(0, a.length - (a.length % 9)));
}

function build(m) {
  const soup = readSTL(m.file);
  const t = (m.rot * Math.PI) / 180, co = Math.cos(t), si = Math.sin(t);
  for (let i = 0; i < soup.length; i += 3) {
    const x = soup[i], y = soup[i + 2], z = -soup[i + 1];        // Z haut (STL) → Y haut (scène), devant = +z
    soup[i] = x * co + z * si; soup[i + 1] = y; soup[i + 2] = -x * si + z * co;
  }
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < soup.length; i += 3) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], soup[i + a]); mx[a] = Math.max(mx[a], soup[i + a]); }
  const s = m.size / Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
  const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2;
  for (let i = 0; i < soup.length; i += 3) {
    soup[i] = (soup[i] - cx) * s; soup[i + 1] = (soup[i + 1] - mn[1]) * s; soup[i + 2] = (soup[i + 2] - cz) * s;
  }
  const clay = new Clay(THREE);
  clay.setWorld(PLATE, GRID);
  clay.stampMesh(soup, 'add');
  const f = clay.f;
  for (let i = 0; i < f.length; i++) f[i] = f[i] >= 0.5 ? 1 : 0;   // tout ou rien : stockage bien plus compact (le lissage du chargement arrondit)
  const field = clay.serialize().split('|').slice(0, 2).join('|');
  const dims = [(mx[0] - mn[0]) * s, (mx[1] - mn[1]) * s, (mx[2] - mn[2]) * s].map((v) => Math.round(v));
  console.log(m.name.padEnd(12), (soup.length / 9 + ' triangles').padEnd(18), 'L×H×P ' + dims.join(' × ') + ' mm', ' ' + Math.round(field.length / 1024) + ' Ko');
  return { id: m.id, name: m.name, emoji: m.emoji, blur: BLUR, field };
}

const out = MODELS.map(build);
const js = `/* ==========================================================================
   Modèles de l'atelier : formes de départ faites à la main (STL), stockées comme champs de voxels.
   FICHIER GÉNÉRÉ par tools/build-models.js — ne pas modifier à la main.
   ========================================================================== */
(function (global) {
  'use strict';
  const S = global.ClayStarters;
  if (!S) return;
  const CAT = ${JSON.stringify(CATEGORY)};
  const MODELS = ${JSON.stringify(out, null, 0).replace(/},{/g, '},\n    {')};
  for (const m of MODELS) S.list.push({ id: m.id, name: m.name, emoji: m.emoji, cat: CAT, ops: [], field: m.field, blur: m.blur });
  if (S.categories.indexOf(CAT) < 0) S.categories.unshift(CAT);
})(typeof window !== 'undefined' ? window : self);
`;
fs.writeFileSync(path.join(__dirname, '..', 'js', 'models.js'), js);
console.log('js/models.js : ' + Math.round(js.length / 1024) + ' Ko');
