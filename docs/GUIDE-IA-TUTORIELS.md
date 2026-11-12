# Pâte3D — guide pour une IA qui crée des tutoriels

Ce fichier sert à une IA (ou à une personne) qui doit produire des **tutoriels détaillés avec captures d'écran** de Pâte3D, **sans erreur**.
Tout ce qui est écrit ici a été vérifié sur la **version 66** (le numéro s'affiche en bas de la fenêtre d'aide « ? »).
Si la version affichée est différente, revérifier les libellés avant de publier.

Compagnon : [`docs/tuto-helper.js`](tuto-helper.js) — petite aide JavaScript (`window.T`) pour piloter l'application de façon reproductible
(nouvelle sculpture, outil, trait simulé, caméra, cadres rouges numérotés sur les captures). Elle n'altère pas l'application.

---

## 1. Règles d'or (pour ne jamais se tromper)

1. **Ne jamais inventer un libellé.** Copier les noms de boutons **exactement** depuis les tableaux ci-dessous (accents, majuscules, « Oups » et non « Annuler »).
   Attention aux apostrophes : les messages affichés par l'application utilisent l'apostrophe typographique ’ (« l’impression », « Plus d’options »).
2. **Toujours vérifier l'état** avant chaque capture avec `T.state()` (outil actif, fenêtre ouverte, version) et regarder la capture.
3. **Partir d'un état propre** (section 3) : sinon l'aide « Comment ça marche ? » s'ouvre au premier lancement, ou une ancienne sculpture réapparaît.
4. **Le son est coupé par défaut** ; l'aide `T` le coupe aussi si quelqu'un l'a activé. Ne pas l'activer pendant les tests.
5. **Une capture = une action expliquée.** Encadrer l'élément à toucher (`T.highlight`), puis `T.hideHint()` **juste avant** la capture
   (chaque changement d'outil réaffiche une bulle d'aide en bas).
6. Public : **enfants de 4 à 10 ans**. Phrases courtes, tutoiement (comme l'application), un seul geste par étape.
7. L'application ne fait **aucune animation** : une capture faite juste après une action montre l'état final (appeler `T.render()` si le navigateur est caché).

---

## 2. Lancer l'application

```bash
cd E:\python-playground\clay-3D
python -m http.server 8823
```

Ouvrir `http://localhost:8823/index.html`. Il faut un serveur (pas `file://`) pour l'export en arrière-plan et pour charger `docs/tuto-helper.js`.

- Après une mise à jour du code, ajouter `?t=un-nombre` à l'adresse pour éviter le cache.
- **Taille de fenêtre conseillée pour les captures : 1280 × 720** (tout tient sans défilement). 1024 × 768 fonctionne aussi.
  En dessous de 1180 px de large, « Ouvrir » et « Enregistrer » n'affichent plus que leur icône.
- Si la page a été chargée dans une fenêtre de taille 0 (onglet caché), **la recharger après avoir fixé la taille** : sinon la caméra est faussée.

Charger l'aide dans la page (console du navigateur ou outil JavaScript) :

```js
await fetch('docs/tuto-helper.js?x=' + Date.now()).then((r) => r.text()).then((code) => (0, eval)(code));
T.state();   // { version: 'Version 66', tool: 'add', modals: [], sound: false, … }
```

---

## 3. État propre (avant chaque tutoriel)

```js
localStorage.clear(); indexedDB.deleteDatabase('pate3d'); location.reload();
```

Après rechargement : la fenêtre **« Comment ça marche ? »** s'ouvre (premier lancement). La fermer avec **« J'ai compris ! »** (ou `T.closeModals()`).
On obtient alors : une **boule** terre cuite au centre d'un **plateau de 20 cm**, outil **Ajouter**, symétrie **gauche-droite**, son coupé.

Mémoire de l'application (pour comprendre ce qui « revient » après un rechargement) :

| Clé `localStorage` | Contenu |
|---|---|
| `pate3d.v3` | la sculpture (grille, couleurs, palette) |
| `pate3d.opts` | options (plateau, résolution, affichage, symétrie…) |
| `pate3d.tools` | taille / force de chaque outil |
| `pate3d.color`, `pate3d.palette` | couleur choisie, palette (couleurs ajoutées avec « + ») |
| `pate3d.sound` | `'1'` seulement si le son a été activé |
| `pate3d.seen` | l'aide de premier lancement a déjà été montrée |
| IndexedDB `pate3d` | pièces importées « gardées telles quelles » |

---

## 4. Carte de l'interface (écran en largeur)

```
┌ Barre du haut : Oups · Refaire │ Nouveau · Ouvrir · Enregistrer          ? · Options · Sons · Imprimer 3D ┐
│ NAVIGATION (haut gauche)                                                         RÉGLAGES (droite)        │
│ SCULPTER / DÉCORER / OBJETS À POSER                 scène 3D                     outil · taille · couleur │
│                                    [ menu des pinceaux en bas, si Ajouter/Enlever ]                       │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Principe affiché aux enfants : **je choisis à gauche, je règle à droite, je varie en bas.**

### 4.1 Barre du haut

| Libellé exact | Sélecteur | Rôle |
|---|---|---|
| **Oups** | `#btn-undo` | annuler (Ctrl+Z) |
| (flèche, sans texte) | `#btn-redo` | refaire (Ctrl+Y) |
| **Nouveau** | `#btn-new` | fenêtre « Par quoi on commence ? » |
| **Ouvrir** | `#btn-import-top` | ouvrir un projet `.pate3d` ou importer un STL / OBJ |
| **Enregistrer** | `#btn-save` | télécharge `ma-sculpture.pate3d` (Ctrl+S) |
| « ? » (icône) | `#btn-help` | fenêtre « Comment ça marche ? » |
| réglages (icône) | `#btn-options` | fenêtre « Options » |
| haut-parleur (icône) | `#btn-sound` | sons (coupés par défaut) |
| **Imprimer 3D** | `#btn-print` | fenêtre « Imprimer en 3D » |

### 4.2 Navigation (carte en haut à gauche)

| Élément | Sélecteur | Rôle |
|---|---|---|
| sphère X Y Z | `#gizmo` | glisser = tourner ; toucher X, Y ou Z = regarder depuis cet axe (X rouge, Y vert, Z bleu) |
| ↺ / ↻ | `#cam-rotl` / `#cam-rotr` | tourner (aussi flèches ← → ou Q / D) |
| ∧ / ∨ | `#cam-up` / `#cam-down` | voir plus d'en haut / d'en bas (flèches ↑ ↓ ou Z / S) |
| loupes − / + et curseur | `#zoom-out`, `#zoom-in`, `#zoom-slider` | zoom (aussi la molette) |
| **Devant**, **Côté**, **Dessus** | `[data-view="front"]`, `"side"`, `"top"` | vues toutes faites |
| maison (icône) | `#cam-home` | vue de départ (touche H) |
| petite flèche | `#btn-nav-toggle` | replier / ouvrir la navigation |

### 4.3 Outils (colonne de gauche, trois groupes titrés)

| Groupe | Libellé exact | `data-tool` | Touche | Ce qu'il fait | Avec Ctrl |
|---|---|---|---|---|---|
| SCULPTER | **Ajouter** | `add` | 1 | pose de la matière (ouvre le menu des pinceaux) | enlever |
| | **Enlever** | `remove` | 2 | gratte, creuse (ouvre le menu des pinceaux) | ajouter |
| | **Élastique** | `stretch` | 3 | attrape la pâte et l'étire | — |
| | **Tirer** | `pull` | 4 | fait sortir une corne, une queue | — |
| | **Lisser** | `smooth` | 5 | arrondit (Maj avec n'importe quel outil = lisser) | — |
| | **Aplatir** | `flatten` | 6 | rabote une surface plate | — |
| DÉCORER | **Tampon** | `stamp` | 7 | colle un motif (barre de motifs en bas) | — |
| | **Peindre** | `paint` | 8 | colore la surface sans changer la forme | remet la terre cuite |
| OBJETS À POSER | **Formes** | `#btn-shapes` | F | fenêtre des formes à placer | — |
| | **Importer** | `#btn-import-dock` | — | importer un STL / OBJ | — |

Le bouton de gauche **reste allumé** pour toute sa famille : Ajouter est allumé aussi avec Brosse, Gonfler, Pincer, Pousser, Combler ; Enlever avec Sillon.

### 4.4 Menu des pinceaux (en bas, visible avec Ajouter / Enlever et leurs pinceaux)

| Légende du groupe | Libellés exacts (`data-brush`) |
|---|---|
| **POSER ET RETIRER** | Ajouter (`add`) · Enlever (`remove`) · Brosse (`layer`) · Sillon (`groove`) |
| **DÉFORMER** | Gonfler (`inflate`) · Pincer (`pinch`) · Pousser (`nudge`) · Combler (`fill`) |

Avec Ctrl : Brosse ↔ Sillon, Gonfler → dégonfler, Pincer → écarter, Pousser → à l'envers.

### 4.5 Réglages (colonne de droite, de haut en bas)

| Élément | Sélecteur | Détail |
|---|---|---|
| pastille **OUTIL** + nom | `#side-tool` | rappelle l'outil actif, à sa couleur |
| **TAILLE ET FORCE** | `.size[data-size="0/1/2"]`, `#brush-size`, `#brush-force` | 3 tailles rapides (Petit, Moyen, Grand), curseurs Taille (2–25) et Force (%), **propres à chaque outil** |
| **Symétrie** | `#btn-mirror` | chaque toucher change : aucune → gauche-droite → 4 miroirs → étoile ×6 (touche X). Sous-titre = symétrie en cours |
| **COULEUR** *pour poser et peindre* | `#colors` | 8 couleurs + « + » (couleur de son choix). Atténuée quand l'outil ne colore pas : seuls Ajouter, Brosse, Tampon, Tirer, Peindre colorent |
| **PIÈCES IMPORTÉES** | `#sec-parts` | visible seulement s'il y a une pièce grise : boutons **Déplacer**, **Sculpter**, ✕ |
| **TAILLE DE LA SCULPTURE** | `#rs-l`, `#rs-h`, `#rs-p`, `#rs-lock`, `#rs-slider`, `#rs-minus`, `#rs-plus` | L / H / P en cm, cadenas = proportions gardées, curseur 20–300 % ; pendant le réglage apparaissent **Annuler** (`#rs-cancel`) et **Appliquer** (`#rs-apply`) |
| 5 petits boutons | `[data-scale-all]`, `#btn-smooth-all` | plus haut, plus bas, plus large, plus fin, lisser toute la sculpture (icônes seules) |

Ordre des 8 couleurs : terre cuite, bleu, vert, rose, jaune, blanc, violet, turquoise (boutons `.swatch`, `aria-label="Couleur bleu"`…).

---

## 5. Fenêtres

### « Par quoi on commence ? » (`#modal-new`, bouton Nouveau)
- **Surface vide** (`#start-empty`) : plateau vide, la fenêtre Formes s'ouvre aussitôt.
- **En l'air** (`#start-air`, interrupteur) : la forme choisie flotte 22 mm au-dessus du plateau.
- Formes de départ (`[data-start="…"]`), grosses et lisses :
  - Modèles de l'atelier (en premier) : `atelier-fantome` Fantôme, `atelier-bonhomme` Bonhomme, `atelier-alien` Alien, `atelier-chat-debout` Chat debout,
    `atelier-chat-assis` Chat assis (modèles faits à la main, voir `tools/build-models.js`)
  - Bases : `ball` Boule, `ballair` Boule en l'air, `egg` Œuf, `cube` Cube, `pillar` Pilier, `cone` Cône, `prism` Toit, `plate` Plaque
  - Personnages : `snowman` Bonhomme de neige, `person` Personnage, `robot` Robot
  - Animaux : `dog` Chien, `cat` Chat, `horse` Cheval, `bear` Ours, `pig` Cochon, `elephant` Éléphant, `rabbit` Lapin, `frog` Grenouille, `turtle` Tortue,
    `penguin` Pingouin, `owl` Hibou, `chick` Poussin, `fish` Poisson, `dino` Dinosaure, `snail` Escargot, `caterpillar` Chenille, `flyer` Oiseau en vol
  - Objets : `house` Maison, `castle` Château, `tree` Arbre, `mushroom` Champignon, `rocket` Fusée, `car` Voiture, `boat` Bateau, `flower` Fleur, `cupcake` Cupcake
- **« Non, je garde ma sculpture »** ferme sans rien changer.

### Formes (`#modal-shapes`, bouton Formes ou touche F)
- « Formes simples » (`#shape-grid`) : Boule, Cube, Cylindre, Cône, Pyramide, Anneau, Cœur, Étoile, Fleur, Patte, Lune, Goutte, Diamant.
- Puis les formes de départ, titres exacts : « Modèles de l'atelier », « Personnages », « Animaux », « Objets », « Autres formes » (les bases, sans Boule ni Boule en l'air),
  et un bouton « Importer un fichier 3D (STL ou OBJ) ».
- Toucher une forme ferme la fenêtre et ouvre le **panneau de placement** (section 6).

### Imprimer en 3D (`#modal-print`)
- Message d'état (`#print-status`) : « Ton objet est solide et prêt pour l’impression 3D ! » quand tout va bien (le calcul prend 1 à 4 s).
- QUALITÉ DU MAILLAGE : Standard / Dense / Ultra. TAILLE DE L'OBJET IMPRIMÉ : Mini 3 cm, Petit 5 cm, Moyen 8 cm, Grand 12 cm, **Réelle 1 : 1**
  (choisie d'office s'il y a des pièces importées).
- Boutons : **Télécharger (STL)** (`#dl-stl`), **OBJ couleur** (`#dl-obj`), **PLY couleur** (`#dl-ply`) ; fichiers `ma-sculpture.stl / .obj / .ply`.

### Options (`#modal-options`), en 5 bandeaux
MON ORDINATEUR (Performances : Très faible / Faible / Normal / Élevé ; Résolution : Minimale / Éco / Normale / **Fine** (par défaut) / Très fine ;
Affichage : Éco / Normal / Réaliste ; Netteté) · ZONE DE TRAVAIL (10 / 15 / **20 cm** / autre taille) · INTERFACE (taille, outils à gauche / à droite) ·
OUTILS (stylet ; aperçu du résultat en posant une forme : Oui / Non) · EXPORT (maillage par défaut).

### Comment ça marche ? (`#modal-help`)
Liste illustrée des outils ; bouton **« J'ai compris ! »** ; numéro de version en bas.

---

## 6. Panneau de placement (après Formes, Importer ou Ouvrir un STL/OBJ)

Il remplace la colonne de droite (bordure rose). Une forme bleue translucide montre l'objet ; un **cercle bleu au sol et un trait vertical** montrent sa position et sa hauteur.

| Libellé exact | Sélecteur | Rôle |
|---|---|---|
| nom + **L / H / P** (champs, cm) | `#place-name`, `#place-dims input` | dimensions modifiables au clavier (proportions gardées) |
| **Déplacer** · **Hauteur** · **Tourner la vue** | `#pl-mode-move`, `#pl-mode-height`, `#pl-mode-view` | ce que fait un glisser dans la scène |
| **Plus d’options** / **Moins d’options** | `#pl-more` | rotation 3 axes, déplacements fins (ouvert d'office sur surface vide) |
| tailles 1.5 cm, 2.5 cm, 4 cm, 6 cm ; ½ − + 2× ; curseur | `[data-scale]`, `#pl-half`, `#pl-smaller`, `#pl-bigger`, `#pl-double`, `#pl-size` | taille |
| Tourner : ↺ ↻ basculer ; **Droit (0°)** | `#pl-q-l`, `#pl-q-r`, `#pl-q-flip`, `#pl-rot-reset` | rotation |
| **Centrer**, **Au sol**, ▲ ◀ ▼ ▶, **Haut**, **Bas** | `#pl-center`, `#pl-floor`, `#pl-step-*`, `#pl-up`, `#pl-down` | position |
| **Miroir : …** | `#pl-mirror` | copie symétrique (visible si une symétrie est active) |
| **Coller** · **Creuser** · **Garder tel quel** | `#pl-add`, `#pl-carve`, `#pl-keep` | fondre dans l'argile / creuser / garder le maillage d'un fichier importé (ce 3ᵉ bouton n'existe que pour un fichier importé, et il est choisi d'office) |
| **Annuler** · **Poser** | `#pl-cancel`, `#pl-ok` | abandonner / valider (Échap / Entrée) |

Gestes : glisser **sur la forme** = la déplacer sans saut ; toucher **ailleurs** = elle y va ; **Maj + glisser** = hauteur ; **Maj + molette** = taille.
Avec « Coller » ou « Creuser », le résultat s'affiche en direct dans la sculpture (aperçu).

**Pièce grise** = fichier « gardé tel quel » : on ne peut pas la sculpter. Le bouton **Sculpter** (colonne de droite) la fond dans l'argile ;
toucher la pièce avec un outil affiche « Cette pièce grise garde le maillage de ton fichier : touche « Sculpter » à droite pour la fondre dans l’argile et la modifier. »

---

## 7. Raccourcis clavier (clavier AZERTY)

| Touche | Effet |
|---|---|
| Maj (maintenue) | lisser avec n'importe quel outil |
| Ctrl (maintenue) | faire l'inverse (voir tableaux) |
| Alt + glisser | déplacer la vue |
| Espace + glisser, clic droit | tourner la vue |
| flèches ou Q Z S D | tourner la caméra ; avec Maj : déplacer la vue |
| + / − (ou PageHaut / PageBas), H | zoom, vue de départ |
| 1 à 8 | outils dans l'ordre du tableau 4.3 |
| F | fenêtre Formes |
| X | changer de symétrie |
| [ et ] | taille du pinceau |
| Ctrl+Z, Ctrl+Y, Ctrl+S | Oups, refaire, enregistrer le projet |
| Échap, Entrée | fermer / annuler le placement, poser |

---

## 8. L'aide `T` (fichier `docs/tuto-helper.js`)

| Fonction | Effet |
|---|---|
| `T.state()` | version, outil, fenêtres ouvertes, sculpture vide ?, grille, plateau, Oups actif ?, pièces, son, taille de fenêtre |
| `T.closeModals()` | ferme toutes les fenêtres |
| `T.click('#btn-print')` | clique un vrai bouton (mêmes effets qu'un clic) |
| `T.tool('inflate')` | choisit un outil (gauche ou menu du bas) |
| `T.newSculpture('dog')`, `T.newSculpture('ball', true)`, `T.newSculpture('empty')` | comme Nouveau (2ᵉ argument = « En l'air ») ; avec `'empty'` la fenêtre Formes s'ouvre ensuite, comme dans l'application |
| `T.view({ az, el, dist, tx, ty, tz })` | caméra : `az`/`el` en radians (az 0 = de face, el 0.3 ≈ un peu d'en haut), `dist` en mm, cible en mm |
| `T.project(x, y, z)` | pixels écran (CSS) d'un point 3D en mm (x droite, y haut, z vers l'avant ; le sol est y = 0) |
| `T.toShot([x, y], largeurCapture)` | convertit ces pixels dans le repère d'une capture d'écran réduite |
| `T.stroke([[x,y,z], [x,y,z], …])` | trait simulé avec l'outil actif, le long de points 3D (même chemin qu'une vraie souris) |
| `T.highlight('#btn-print', '1')` | cadre rouge numéroté autour d'un élément |
| `T.highlightPoint(x, y, z, '2')` | cercle rouge numéroté sur un point de la scène |
| `T.clearHighlights()` | enlève les repères rouges |
| `T.hideHint()` | cache la bulle d'aide et le message du bas (à appeler juste avant la capture) |
| `T.render()` | dessine une image (si le panneau du navigateur est caché) |

Ordres de grandeur utiles (formes de départ, en mm) : la boule a son centre à y = 30 (rayon 30) ; le chien a la tête vers z ≈ +30 à y ≈ 64 ;
le plateau va de −100 à +100 en x et z.

API de bas niveau de l'application (pour vérifier) : `window.__pate` (`clay`, `view`, `camera`, `setTool`, `getPlacement()`, `parts`, `step()`…).

---

## 9. Recettes de tutoriels testées

Chaque recette : étapes destinées aux enfants, puis le code qui reproduit l'état pour la capture. Toujours finir par `T.hideHint()` puis capturer.

### A. « Ma première sculpture : ajouter et lisser »
1. Touche **Nouveau**, puis **Boule**.
2. Touche **Ajouter** (à gauche). Glisse sur la boule : de la pâte s'ajoute.
3. Maintiens **Maj** en glissant (ou touche **Lisser**) pour arrondir.
4. Raté ? Touche **Oups**.
```js
T.newSculpture('ball'); T.view({ az: 0.4, el: 0.35, dist: 230, tx: 0, ty: 30, tz: 0 });
T.tool('add'); T.highlight('.tool[data-tool="add"]', '1'); T.stroke([[-10, 50, 22], [10, 50, 22]]); T.hideHint();
```

### B. « Les pinceaux du bas »
1. Touche **Ajouter** : le menu des pinceaux apparaît en bas.
2. Groupe **POSER ET RETIRER** : Ajouter, Enlever, Brosse, Sillon. Groupe **DÉFORMER** : Gonfler, Pincer, Pousser, Combler.
```js
T.tool('inflate'); T.highlight('#brush-bar', '1'); T.hideHint();
```

### C. « Peindre et choisir une couleur »
1. Choisis une couleur à droite (section **COULEUR**). Le **+** ajoute une couleur de ton choix.
2. Touche **Peindre** (groupe DÉCORER) et glisse sur la sculpture : seule la couleur change.
3. Ajouter, Brosse, Tampon et Tirer posent aussi la couleur choisie.
```js
T.click('#colors .swatch[aria-label="Couleur bleu"]'); T.tool('paint'); T.stroke([[-10, 50, 22], [10, 50, 22]]);
T.highlight('#sec-color', '1'); T.highlight('.tool[data-tool="paint"]', '2'); T.hideHint();
```

### D. « Poser une forme »
1. Touche **Formes**, choisis **Étoile** : le panneau de placement s'ouvre.
2. Glisse la forme bleue pour la déplacer ; le cercle bleu au sol montre où elle est.
3. Change sa taille (boutons ou champs L / H / P), puis touche **Poser**.
```js
T.click('#btn-shapes'); [...document.querySelectorAll('#shape-grid .shape')].find((b) => b.textContent.includes('Étoile')).click();
T.highlight('#pl-ok', '3'); T.hideHint();   // puis, pour la capture suivante : T.click('#pl-ok')
```

### E. « Changer la taille de toute la sculpture »
1. Dans **TAILLE DE LA SCULPTURE**, tape une hauteur (H) ou utilise le curseur.
2. La sculpture grandit sur place (cercle bleu au sol = point fixe) ; touche **Appliquer** (ou **Annuler**).
```js
T.click('#rs-plus'); T.highlight('#rs-apply', '2'); T.hideHint();
```

### F. « Enregistrer et rouvrir mon projet »
1. Touche **Enregistrer** : le fichier `ma-sculpture.pate3d` est téléchargé.
2. Plus tard, touche **Ouvrir** et choisis ce fichier : tout revient (sculpture, couleurs, pièces).
```js
T.highlight('#btn-save', '1'); T.highlight('#btn-import-top', '2'); T.hideHint();
```

### G. « Importer un fichier STL »
1. Touche **Importer** (ou **Ouvrir**) et choisis un fichier `.stl` ou `.obj` (jusqu'à 3 000 000 de triangles).
2. Il arrive à sa taille d'origine. **Garder tel quel** : maillage exact, pièce grise non sculptable. **Coller** : fondu dans l'argile, modifiable.
3. Pour sculpter plus tard une pièce grise : bouton **Sculpter** à droite.
(La fenêtre de choix de fichier du système ne se pilote pas par script : la capturer à la main ou montrer seulement le panneau de placement.)

### H. « Imprimer en 3D »
1. Touche **Imprimer 3D** et attends « Ton objet est solide et prêt pour l’impression 3D ! ».
2. Choisis la taille, puis **Télécharger (STL)** (ou OBJ / PLY couleur pour garder les couleurs).
```js
T.click('#btn-print'); await T.wait(4000); T.highlight('#dl-stl', '2');
```

---

## 10. Pièges connus (déjà rencontrés)

- **Repère des captures** : un outil de capture peut renvoyer une image plus petite que la fenêtre (ex. 800 × 450 pour 1280 × 720). Les coordonnées de clic
  de l'outil sont alors dans le repère de **la capture** : convertir avec `T.toShot(...)`.
- **Fenêtre de taille 0** (onglet caché) : caméra faussée ; fixer la taille de la fenêtre puis **recharger**.
- **Bulle d'aide** : réapparaît à chaque changement d'outil ou de mode ; `T.hideHint()` en dernier.
- **Toasts** (messages noirs en bas) : restent ~3 s.
- **Cache** : après une mise à jour, recharger avec `?t=...` et vérifier la version dans « ? ».
- **Pièces importées** : elles survivent au rechargement (IndexedDB) ; « Nouveau » les efface.
- **Fichiers téléchargés** : nommés `ma-sculpture.*` ; le navigateur peut demander une confirmation.
- **Les tests automatiques ne remplacent pas un vrai clic** : pour une capture « avec le doigt », vérifier au moins une fois avec un vrai clic de souris au bon endroit.

---

## 11. Checklist avant de publier un tutoriel

- [ ] Version affichée dans « ? » = celle du tutoriel.
- [ ] Chaque libellé du texte existe tel quel dans l'interface (tableaux 4 à 6).
- [ ] Chaque capture montre l'état décrit (outil allumé, fenêtre ouverte, cadre rouge au bon endroit), sans bulle d'aide parasite.
- [ ] Les étapes ont été rejouées dans l'ordre depuis un état propre (section 3).
- [ ] Le son est resté coupé (`T.state().sound === false`).
- [ ] Phrases courtes, tutoiement, un geste par étape.
