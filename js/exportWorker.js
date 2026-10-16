/* Calcul du maillage d'export hors du fil principal : l'interface reste fluide pendant les exports « Dense » et « Ultra ».
   Réutilise tel quel clay.js (même code, même vérification manifold). */
'use strict';
self.window = self;
// clay.js n'a besoin de THREE que pour l'affichage : de simples coquilles suffisent ici
self.THREE = {
  Group: function () { this.add = function () {}; this.remove = function () {}; },
  MeshStandardMaterial: function () { this.color = { setHex: function () {} }; this.dispose = function () {}; }
};
importScripts('clay.js?v=46');

self.onmessage = function (e) {
  const d = e.data;
  try {
    const clay = new self.ClayEngine.Clay(self.THREE);
    clay._applyGrid(d.field, d.n, d.L, d.col);
    if (d.pal) clay.setPalette(d.pal);
    const m = clay.buildExport(d.target, d.iters);
    self.postMessage({ id: d.id, mesh: m }, [m.positions.buffer, m.indices.buffer, m.colors.buffer]);
  } catch (err) {
    self.postMessage({ id: d.id, error: String(err && err.message || err) });
  }
};
