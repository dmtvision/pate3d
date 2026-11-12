/* ==========================================================================
   Formes de départ (« Nouveau ») : listes d'opérations lues par Clay.build()
   Unités : mm, sol à y = 0, centre en x = z = 0, le devant est du côté +z.
   s sphère · c capsule · t cône arrondi (rayon différent à chaque bout) · e ellipsoïde ·
   b boîte arrondie · p prisme (extrusion en z) · q prisme (extrusion en x) · « - » devant = creuser.
   Les formes tiennent dans 6-7 cm ; la plupart reposent sur le plateau (les animaux sur leurs pattes), quelques-unes flottent (boule, oiseau en vol).
   ========================================================================== */
(function (global) {
  'use strict';

  const S = (x, y, z, r) => ['s', x, y, z, r];
  const Cp = (x1, y1, z1, x2, y2, z2, r) => ['c', x1, y1, z1, x2, y2, z2, r];
  const T = (x1, y1, z1, r1, x2, y2, z2, r2) => ['t', x1, y1, z1, r1, x2, y2, z2, r2];
  const E = (x, y, z, rx, ry, rz) => ['e', x, y, z, rx, ry, rz];
  const B = (x, y, z, hx, hy, hz, r) => ['b', x, y, z, hx, hy, hz, r];
  const P = (x, y, z, hw, ht, hl, r) => ['p', x, y, z, hw, ht, hl, r];
  const Q = (x, y, z, hw, ht, hx, r) => ['q', x, y, z, hw, ht, hx, r];
  const cut = (op) => ['-' + op[0]].concat(op.slice(1));

  /* symétrie gauche-droite : on écrit un côté, on obtient les deux */
  const XIDX = { s: [1], c: [1, 4], t: [1, 5], e: [1], b: [1], p: [1], q: [1] };
  function mirrorOp(op) {
    const o = op.slice();
    for (const i of XIDX[op[0].replace('-', '')]) o[i] = -o[i];
    return o;
  }
  const X2 = (...ops) => ops.reduce((a, op) => a.concat([op, mirrorOp(op)]), []);

  /* quart de tour autour de la verticale : la forme se présente de profil (tête vers +x) */
  function turn(ops) {
    const f = (x, z) => [z, -x];
    return ops.map((op) => {
      const neg = op[0].charAt(0) === '-', t = neg ? op[0].slice(1) : op[0], pre = neg ? '-' : '';
      const o = op.slice();
      const mv = (i, j) => { const r = f(op[i], op[j]); o[i] = r[0]; o[j] = r[1]; };
      switch (t) {
        case 's': case 'e': case 'b': mv(1, 3); break;
        case 'c': mv(1, 3); mv(4, 6); break;
        case 't': mv(1, 3); mv(5, 7); break;
        case 'p': mv(1, 3); o[0] = pre + 'q'; return o;
        case 'q': mv(1, 3); o[0] = pre + 'p'; return o;
        default: break;
      }
      if (t === 'e') { o[4] = op[6]; o[6] = op[4]; }
      if (t === 'b') { o[4] = op[6]; o[6] = op[4]; }
      return o;
    });
  }

  const list = [];
  const add = (id, name, emoji, cat, ops) => list.push({ id, name, emoji, cat, ops });

  /* Formes de départ : GROSSES (9 à 12 cm), peu détaillées, faites de formes simples et épaisses (aucune tige ni aucun tube fin) :
     les enfants ont toute la liberté de les modifier. Devant = +z. */

  /* ----------------------------------------------------------------- Bases */
  add('ball', 'Boule', '🟤', 'Bases', [S(0, 30, 0, 30)]);
  add('ballair', "Boule en l'air", '🎈', 'Bases', [S(0, 62, 0, 30)]);
  add('egg', 'Œuf', '🥚', 'Bases', [E(0, 36, 0, 26, 36, 26)]);
  add('cube', 'Cube', '🧊', 'Bases', [B(0, 30, 0, 30, 30, 30, 9)]);
  add('pillar', 'Pilier', '🏛️', 'Bases', [B(0, 40, 0, 24, 40, 24, 9)]);
  add('cone', 'Cône', '🔺', 'Bases', [T(0, 0, 0, 34, 0, 66, 0, 9)]);
  add('prism', 'Toit', '⛺', 'Bases', [P(0, 0, 0, 36, 56, 32, 4)]);
  add('plate', 'Plaque', '🟫', 'Bases', [B(0, 10, 0, 60, 10, 60, 6)]);

  /* ----------------------------------------------------------- Personnages */
  add('snowman', 'Bonhomme de neige', '⛄', 'Personnages', [
    S(0, 30, 0, 30), S(0, 78, 0, 22), S(0, 112, 0, 16)
  ]);
  add('person', 'Personnage', '🧍', 'Personnages', [
    ...X2(T(10, 6, 0, 11, 10, 36, 0, 11), S(10, 4, 5, 11)),
    E(0, 58, 0, 21, 24, 14), ...X2(T(24, 68, 0, 9, 34, 42, 0, 9), S(34, 40, 0, 10)), S(0, 100, 0, 17)
  ]);
  add('robot', 'Robot', '🤖', 'Personnages', [
    ...X2(B(11, 16, 0, 9, 16, 11, 4)), B(0, 56, 0, 24, 22, 15, 6),
    ...X2(B(33, 58, 0, 9, 18, 10, 5)), B(0, 98, 0, 19, 15, 15, 6)
  ]);

  /* --------------------------------------------------------------- Animaux */
  /* quadrupèdes debout : corps épais, quatre grosses pattes */
  const legs = (x, zf, zb, y0, r) => X2(T(x, y0, zf, r, x, 6, zf, r - 1), T(x, y0, zb, r + 1, x, 6, zb, r));
  add('dog', 'Chien', '🐶', 'Animaux', [
    E(0, 40, 0, 17, 16, 28), ...legs(10, 17, -17, 34, 8),
    T(0, 50, 20, 11, 0, 60, 28, 10), S(0, 64, 30, 15), E(0, 58, 44, 9, 8, 10),
    ...X2(E(15, 62, 28, 8, 13, 10)), T(0, 48, -26, 10, 0, 60, -36, 9)
  ]);
  add('cat', 'Chat', '🐱', 'Animaux', [
    E(0, 38, 0, 15, 15, 26), ...legs(9, 16, -16, 32, 7),
    S(0, 62, 26, 15), E(0, 57, 38, 8, 7, 7),
    ...X2(S(10, 76, 24, 9)), T(0, 42, -26, 9, 0, 34, -42, 9), T(0, 34, -42, 9, 0, 54, -48, 8)
  ]);
  add('horse', 'Cheval', '🐴', 'Animaux', [
    E(0, 62, 0, 20, 21, 36), ...X2(T(11, 56, 24, 12, 11, 7, 24, 9), T(11, 56, -24, 13, 11, 7, -24, 9)),
    T(0, 74, 28, 15, 0, 98, 38, 12), E(0, 106, 46, 12, 15, 15), E(0, 98, 58, 9, 9, 9),
    ...X2(S(8, 120, 42, 8)), T(0, 70, -34, 11, 0, 44, -46, 9)
  ]);
  add('bear', 'Ours', '🐻', 'Animaux', [
    E(0, 46, 0, 26, 26, 30), ...X2(T(14, 40, 20, 13, 14, 8, 20, 11), T(14, 40, -20, 14, 14, 8, -20, 12)),
    S(0, 78, 28, 19), E(0, 72, 46, 10, 9, 10), ...X2(S(14, 94, 26, 9)), S(0, 46, -32, 9)
  ]);
  add('pig', 'Cochon', '🐷', 'Animaux', [
    E(0, 40, 0, 26, 24, 32), ...X2(T(14, 30, 20, 12, 14, 7, 20, 10), T(14, 30, -20, 12, 14, 7, -20, 10)),
    S(0, 48, 34, 19), E(0, 44, 52, 10, 9, 6), ...X2(E(12, 68, 32, 9, 9, 10)), S(0, 46, -36, 9)
  ]);
  add('elephant', 'Éléphant', '🐘', 'Animaux', [
    E(0, 58, 0, 28, 28, 38), ...X2(T(16, 50, 24, 15, 16, 8, 24, 13), T(16, 50, -24, 15, 16, 8, -24, 13)),
    S(0, 72, 44, 23), T(0, 62, 60, 12, 0, 36, 72, 9), ...X2(E(24, 76, 40, 9, 20, 17))
  ]);
  add('rabbit', 'Lapin', '🐰', 'Animaux', [
    E(0, 32, 0, 24, 30, 26), S(0, 76, 14, 19), ...X2(E(9, 112, 12, 9, 20, 8), S(15, 12, 18, 12)),
    S(0, 40, -26, 12)
  ]);
  add('frog', 'Grenouille', '🐸', 'Animaux', [
    E(0, 26, 0, 30, 22, 34), ...X2(S(15, 52, 20, 11), E(32, 14, -10, 11, 14, 24), E(26, 6, 24, 10, 6, 14))
  ]);
  add('turtle', 'Tortue', '🐢', 'Animaux', [
    E(0, 14, 0, 40, 12, 46), E(0, 32, 0, 34, 22, 40), S(0, 24, 52, 15),
    ...X2(S(30, 10, 30, 12), S(30, 10, -30, 12))
  ]);
  add('penguin', 'Pingouin', '🐧', 'Animaux', [
    E(0, 46, 0, 27, 46, 23), S(0, 98, 2, 17), S(0, 93, 19, 8),
    ...X2(E(13, 6, 12, 11, 6, 14), E(31, 50, 0, 9, 24, 14))
  ]);
  add('owl', 'Hibou', '🦉', 'Animaux', [
    E(0, 50, 0, 28, 50, 24), ...X2(S(13, 76, 18, 11), E(13, 6, 12, 11, 6, 14), S(18, 102, 0, 10))
  ]);
  add('chick', 'Poussin', '🐥', 'Animaux', [
    S(0, 32, 0, 30), S(0, 76, 14, 20), S(0, 73, 33, 8), E(0, 36, -30, 9, 14, 12),
    ...X2(E(10, 6, 8, 11, 6, 14))
  ]);
  add('fish', 'Poisson', '🐟', 'Animaux', [
    E(0, 34, 0, 44, 30, 18), T(-40, 34, 0, 18, -60, 56, 0, 9), T(-40, 34, 0, 18, -60, 12, 0, 9), E(0, 62, 0, 14, 12, 9), S(28, 42, 14, 9)
  ]);
  add('dino', 'Dinosaure', '🦖', 'Animaux', [
    E(0, 54, 0, 21, 25, 33), ...X2(T(13, 42, 0, 14, 13, 8, 4, 11), E(13, 6, 10, 11, 6, 15)),
    T(0, 64, 26, 15, 0, 84, 38, 12), S(0, 90, 44, 15), E(0, 84, 58, 9, 8, 9),
    T(0, 50, -28, 14, 0, 28, -62, 9)
  ]);
  add('snail', 'Escargot', '🐌', 'Animaux', [
    E(0, 11, 0, 17, 11, 42), S(0, 30, 40, 13), S(0, 40, -8, 29)
  ]);
  add('caterpillar', 'Chenille', '🐛', 'Animaux', [
    S(0, 18, -56, 16), S(0, 22, -32, 19), S(0, 24, -6, 20), S(0, 22, 20, 20), S(0, 26, 48, 24)
  ]);
  add('flyer', 'Oiseau en vol', '🕊️', 'Animaux', [
    E(0, 66, 0, 17, 15, 28), S(0, 72, 30, 13), S(0, 70, 42, 8),
    ...X2(E(38, 68, 0, 28, 9, 18)), E(0, 64, -34, 12, 8, 16)
  ]);

  /* ---------------------------------------------------------------- Objets */
  add('house', 'Maison', '🏠', 'Objets', [
    B(0, 28, 0, 38, 28, 32, 3), P(0, 54, 0, 46, 30, 38, 3), B(14, 82, -10, 9, 12, 9, 3),
    cut(B(0, 16, 33, 10, 16, 6, 2)), ...X2(cut(B(22, 34, 33, 9, 9, 6, 2)))
  ]);
  add('castle', 'Château', '🏰', 'Objets', [
    B(0, 32, 0, 38, 32, 28, 4),
    ...[[44, 34], [-44, 34], [44, -34], [-44, -34]].reduce((a, [x, z]) => a.concat([T(x, 0, z, 15, x, 70, z, 15), T(x, 70, z, 17, x, 96, z, 8)]), []),
    cut(B(0, 14, 29, 11, 14, 8, 3))
  ]);
  add('tree', 'Arbre', '🌳', 'Objets', [
    T(0, 0, 0, 16, 0, 44, 0, 13), S(0, 72, 0, 32), S(-24, 58, 6, 21), S(24, 58, -6, 21), S(0, 56, 24, 20)
  ]);
  add('mushroom', 'Champignon', '🍄', 'Objets', [
    T(0, 0, 0, 16, 0, 40, 0, 13), E(0, 50, 0, 42, 22, 42)
  ]);
  add('rocket', 'Fusée', '🚀', 'Objets', [
    T(0, 14, 0, 20, 0, 76, 0, 20), T(0, 76, 0, 20, 0, 106, 0, 10),
    ...X2(E(26, 22, 0, 12, 22, 9)), E(0, 22, 26, 9, 22, 12), S(0, 58, 19, 9)
  ]);
  add('car', 'Voiture', '🚗', 'Objets', [
    B(0, 24, 0, 26, 12, 46, 6), B(0, 46, -6, 22, 11, 26, 6),
    ...X2(S(28, 14, 28, 14), S(28, 14, -28, 14))
  ]);
  add('boat', 'Bateau', '⛵', 'Objets', [
    B(0, 18, 0, 26, 16, 50, 9), B(0, 50, -8, 17, 14, 22, 5), T(0, 64, -8, 8, 0, 82, -8, 8)
  ]);
  add('flower', 'Fleur', '🌸', 'Objets', (() => {
    const o = [T(0, 0, 0, 9, 0, 56, 0, 8), S(0, 68, 0, 13)];
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3;
      o.push(S(20 * Math.cos(a), 68 + 20 * Math.sin(a), 0, 12));
    }
    return o;
  })());
  add('cupcake', 'Cupcake', '🧁', 'Objets', [
    T(0, 0, 0, 28, 0, 28, 0, 34), S(0, 38, 0, 31), S(0, 58, 0, 21), S(0, 74, 0, 12)
  ]);

  /** Les mêmes opérations, décalées de dy mm vers le haut (forme qui flotte au-dessus du plateau) */
  const YIDX = { s: [2], c: [2, 5], t: [2, 6], e: [2], b: [2], p: [2], q: [2] };
  function lifted(ops, dy) {
    return ops.map((op) => {
      const o = op.slice();
      for (const i of YIDX[op[0].replace('-', '')]) o[i] += dy;
      return o;
    });
  }

  global.ClayStarters = {
    lifted,
    list,
    categories: ['Bases', 'Personnages', 'Animaux', 'Objets'],
    get(id) { return list.find((s) => s.id === id) || list.find((s) => s.id === 'ball') || list[0]; }
  };
})(typeof window !== 'undefined' ? window : self);
