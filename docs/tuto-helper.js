/* Aide « tutoriel » pour Pâte3D — à coller dans la console de la page (ou à exécuter par un outil JavaScript).
   Crée window.T. Ne modifie pas l'application : utilise ses boutons et son API de test window.__pate. */
(() => {
  const P = window.__pate;
  if (!P) throw new Error('Pâte3D n’est pas encore chargé : attendre la fin du chargement de la page');
  const c = P.clay, cv = document.querySelector('#gl'), $ = (s) => document.querySelector(s);
  const need = (sel) => { const el = $(sel); if (!el) throw new Error('Élément introuvable : ' + sel); return el; };
  let pid = 900;
  const T = {
    /** attendre (ms) */
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    /** dessiner une image (indispensable si le panneau du navigateur est caché) */
    render() { P.step(); },
    /** état utile pour vérifier une étape */
    state() {
      return {
        version: $('#app-version').textContent, tool: P.dbg().tool, placing: !!P.getPlacement(),
        modals: [...document.querySelectorAll('.modal')].filter((m) => !m.hidden).map((m) => m.id),
        empty: c.isEmpty(), grid: c.resolution, plateMm: c.world, undo: !$('#btn-undo').disabled,
        parts: P.parts.length, sound: !!(window.Sfx && Sfx.isOn()), viewport: [innerWidth, innerHeight]
      };
    },
    /** fermer toutes les fenêtres (aide, options…) */
    closeModals() { document.querySelectorAll('.modal').forEach((m) => { if (m.id !== 'nogl') m.hidden = true; }); P.step(); },
    /** cliquer un élément de l'interface par son sélecteur CSS (bouton réel, mêmes effets qu'un clic) */
    click(sel) { need(sel).click(); P.step(); },
    /** choisir un outil par son identifiant (add, remove, stretch, pull, smooth, flatten, stamp, paint, layer, groove, inflate, pinch, nudge, fill) */
    tool(id) { const b = $('.tool[data-tool="' + id + '"]') || $('.brush-btn[data-brush="' + id + '"]'); if (!b) throw new Error('Outil inconnu : ' + id); b.click(); P.step(); },
    /** nouvelle sculpture depuis une forme de départ (« empty » = surface vide), comme avec le bouton Nouveau */
    newSculpture(id, enLAir) {
      need('#btn-new').click();
      const air = need('#start-air');
      if (air.classList.contains('active') !== !!enLAir) air.click();
      if (id === 'empty') need('#start-empty').click(); else need('[data-start="' + id + '"]').click();   // « Surface vide » ouvre ensuite la fenêtre Formes (comportement normal)
      P.step();
    },
    /** caméra : az et el en radians (az 0 = de face), dist en mm, cible tx/ty/tz en mm */
    view(o) { Object.assign(P.view, o); P.step(); },
    /** position écran (pixels CSS du viewport) d'un point 3D en mm (x droite, y haut, z vers l'avant) */
    project(x, y, z) {
      P.step();
      const r = cv.getBoundingClientRect(), q = new c.THREE.Vector3(x, y, z).project(P.camera);
      return [Math.round(r.left + (q.x + 1) / 2 * r.width), Math.round(r.top + (1 - q.y) / 2 * r.height)];
    },
    /** convertit des pixels CSS en coordonnées d'une capture d'écran de largeur shotW (outil « computer » : repère de la capture) */
    toShot(xy, shotW) { const k = shotW / innerWidth; return [Math.round(xy[0] * k), Math.round(xy[1] * k)]; },
    /** trait de sculpture simulé le long de points 3D (mm) : même chemin qu'un vrai geste à la souris */
    stroke(points, steps) {
      const id = pid++, n = steps || 14, pts = [];
      for (let s = 0; s + 1 < points.length; s++) for (let i = 0; i < n; i++) {
        const a = points[s], b = points[s + 1], t = i / n;
        pts.push(this.project(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t));
      }
      pts.push(this.project(...points[points.length - 1]));
      const ev = (type, p, buttons) => cv.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'mouse', clientX: p[0], clientY: p[1], buttons, button: 0, bubbles: true, isPrimary: true }));
      ev('pointerdown', pts[0], 1);
      for (const p of pts.slice(1)) { ev('pointermove', p, 1); P.step(); }
      ev('pointerup', pts[pts.length - 1], 0); P.step();
    },
    /** cache le message d'aide en bas de l'écran (captures plus propres) */
    hideHint() { $('#hint').classList.add('off'); $('#toast').hidden = true; },
    /** entoure un élément d'un cadre rouge numéroté (pour les captures de tutoriel) ; renvoie le rectangle */
    highlight(sel, label) {
      const r = need(sel).getBoundingClientRect(), d = document.createElement('div');
      d.className = 'tuto-hl';
      d.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;border:4px solid #e11d48;border-radius:14px;box-shadow:0 0 0 4px rgba(255,255,255,.85);'
        + 'left:' + (r.left - 6) + 'px;top:' + (r.top - 6) + 'px;width:' + (r.width + 12) + 'px;height:' + (r.height + 12) + 'px';
      if (label !== undefined) {
        const b = document.createElement('b');
        b.textContent = label;
        b.style.cssText = 'position:absolute;left:-16px;top:-16px;min-width:28px;height:28px;border-radius:14px;background:#e11d48;color:#fff;font:700 16px/28px sans-serif;text-align:center;padding:0 6px';
        d.appendChild(b);
      }
      document.body.appendChild(d);
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    },
    /** cercle rouge sur un point de la scène 3D (mm) */
    highlightPoint(x, y, z, label, radius) {
      const p = this.project(x, y, z), R = radius || 26, d = document.createElement('div');
      d.className = 'tuto-hl';
      d.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;border:4px solid #e11d48;border-radius:50%;box-shadow:0 0 0 4px rgba(255,255,255,.85);'
        + 'left:' + (p[0] - R) + 'px;top:' + (p[1] - R) + 'px;width:' + (2 * R) + 'px;height:' + (2 * R) + 'px';
      if (label !== undefined) { const b = document.createElement('b'); b.textContent = label; b.style.cssText = 'position:absolute;left:-18px;top:-18px;min-width:28px;height:28px;border-radius:14px;background:#e11d48;color:#fff;font:700 16px/28px sans-serif;text-align:center;padding:0 6px'; d.appendChild(b); }
      document.body.appendChild(d);
      return p;
    },
    /** enlève tous les repères rouges */
    clearHighlights() { document.querySelectorAll('.tuto-hl').forEach((e) => e.remove()); }
  };
  window.T = T;
  if (window.Sfx && Sfx.isOn()) document.querySelector('#btn-sound').click();   // tests et captures : toujours sans son
  return T.state();
})();
