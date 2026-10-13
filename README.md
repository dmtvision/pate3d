# Pâte3D — sculpture d'argile 3D pour enfants (4-10 ans)

Application web légère : on **ajoute**, **enlève**, **étire** et **tire** la matière, on part d'une boule ou d'une **forme de départ**
(personnage, animal, maison…), puis on exporte un objet **manifold (étanche)** prêt pour l'impression 3D. Pensée pour la tablette
(tactile, stylet, tablette graphique), sans backend.

## Déploiement
Copier le dossier tel quel sur un serveur web : `index.html`, `manifest.webmanifest`, `icon.svg`, `css/`, `js/`.
- Dépendances externes : Three.js r128 (cdnjs, avec secours jsDelivr) et la police Fredoka (Google Fonts, facultative).
  Hors-ligne : placer `three.min.js` dans `js/` et changer la balise `<script>` de `index.html`.
- Les fichiers sont référencés avec `?v=N` : changer ce numéro (dans `index.html`, `js/app.js` et `js/exportWorker.js`) force le
  rechargement chez les utilisateurs après une mise à jour. Le numéro courant s'affiche dans la fenêtre d'aide (« ? ») : en cas de
  doute sur le comportement observé, vérifier qu'il correspond à la dernière version envoyée (sinon : rechargement forcé, Ctrl+F5).
- Installable sur l'écran d'accueil (manifeste + icône SVG) : l'app s'ouvre alors en plein écran.
- Les workers (export hors du fil principal) demandent un vrai serveur web (`http(s)://`) ; en `file://` l'export se fait sur le fil principal.

## Disposition (tous les outils sont toujours visibles)
- **Colonne de gauche = navigation + outils**, de haut en bas :
  - **Navigation** (repliable avec la petite flèche) : **sphère 3D XYZ** (X rouge = gauche-droite, Y vert = devant-derrière, Z bleu = haut-bas, comme
    dans l'impression 3D) — on la **fait glisser pour tourner**, on **touche un axe pour regarder depuis cet axe** ; boutons de rotation
    (violet) et d'inclinaison (bleu), **curseur de zoom** + loupes (vert) + **molette** (qui rapproche de l'endroit visé), vues Devant / Côté /
    Dessus (orange) et accueil (rose).
  - **Outils** : Ajouter, Enlever, Élastique, Tirer, Lisser, Aplatir, Tampon et **Pinceaux** (menu en bas de l'écran, voir plus bas).
  - **Formes** et **Importer** (« objets » qu'on place au lieu de sculpter), en petits boutons tout en bas.
- **Réglages, à droite** : taille et force propres à chaque outil, 3 tailles rapides, **symétrie** (l'icône montre la symétrie choisie : un point,
  deux points de part et d'autre d'un axe, quatre points, étoile à six points), 8 couleurs, « Toute la forme » (plus haut / bas / large / fin, tout lisser).
- **Boutons colorés** : chaque famille de boutons a sa couleur (barre du haut, navigation, outils) pour s'y repérer d'un coup d'œil.
- En portrait, la navigation devient une carte en haut à gauche et les outils une grille en bas.

## Raccourcis clavier
| Touche | Effet |
|---|---|
| **Maj** (maintenue) | lisser, avec n'importe quel outil |
| **Ctrl** (maintenue) | faire l'inverse : ajouter ↔ enlever, brosse ↔ sillon, gonfler ↔ dégonfler, pincer ↔ écarter, pousser à l'envers |
| **Alt** + glisser | déplacer la vue |
| **Espace** + glisser | tourner la vue |
| flèches ou **Q Z S D** | tourner la caméra ; avec **Maj** : déplacer la vue |
| `+` `-` (ou PageHaut / PageBas), **H** | zoom, vue de départ |
| `1` à `7`, `8` | outils ; `8` ouvre / ferme le menu des pinceaux |
| **F**, **X** | choisir une forme ; changer de symétrie |
| `[` `]`, Ctrl+Z / Ctrl+Y, Échap, Entrée | taille du pinceau, annuler / refaire, fermer / annuler le placement, valider le placement |

Le curseur et la surbrillance de l'outil changent pendant que Maj ou Ctrl sont tenues. Souris : clic droit ou bouton du stylet = tourner,
molette = zoom, bouton du milieu = déplacer.

## Les outils
| Outil | Geste |
|---|---|
| Ajouter (1) | glisser sur l'argile ou le plateau : l'épaisseur déposée suit la force (de très léger à épais). **Ajout propre** : la matière n'est déposée que sur de l'argile existante, rien ne dépasse derrière une partie fine, au-delà d'un bord, ni dans le vide (copies de la symétrie) ; un trait reste sur la surface où il a commencé (sculpture ou plateau) |
| Enlever (2) | gratte / creuse (même échelle de force) |
| Élastique (3) | attrape la matière et la tire comme un élastique, même très loin. La sculpture d'avant le geste n'est rééchantillonnée **qu'une seule fois** (les petits pas sont composés dans une carte de déformation) : les détails fins ne sont plus détruits, il ne reste pas de morceaux détachés en l'air et il n'y a plus de lissage final de la zone. Le pied reste ancré au plateau |
| Tirer (4) | fait sortir une corne, une queue (s'effile en s'allongeant) |
| Lisser (5) | arrondit et adoucit |
| Aplatir (6) | rabote ce qui dépasse d'un plan |
| Tampon (7) | 11 motifs (boule, cube, cône, cœur, étoile, fleur, patte, lune, goutte, diamant, anneau) orientés selon la surface. **Rester appuyé et glisser règle la taille** (aperçu translucide + taille en cm) ; le bouton « Série » colle plusieurs tampons le long du geste |
| Formes | 13 formes simples + toutes les formes de départ (voir plus bas) : **un clic sur la forme la pose** (visible en transparence, même cachée dans l'argile). **Le survol ne la déplace jamais** : on touche l'endroit où la poser (ou on la glisse ; au-delà du bord du plateau elle va au bord le plus proche), on change taille / rotation 3 axes / hauteur, « Coller » ou « Creuser », puis **Poser** (ou Entrée). Avec la symétrie, la copie « miroir » est montrée en transparence ; elle est active par défaut pour un objet posé sur la sculpture, inactive sur le plateau, et le bouton « Miroir » reprend la main. Pendant le placement, les outils sont masqués pour laisser la place à la scène |
| Importer | fichier STL ou OBJ (bouton ou glisser-déposer), même placement que les formes |
| Pinceaux (8) | menu en bas de l'écran : **Brosse** (fine couche régulière), **Gonfler** (la surface avance le long de sa normale), **Pincer** (la matière se rassemble et monte : arête, pli), **Pousser** (déplace la matière dans le sens du geste), **Sillon** (trait fin creusé), **Combler** (remplit creux et trous sans toucher aux bosses). Ils ont chacun leur taille et leur force, la symétrie, le stylet et Ctrl (inverse) |
| Navigation | un doigt sur le fond = orbite, deux doigts = zoom + déplacement, double-touche = on s'approche |

**Pas de traînées dans la perspective.** Un trait ne peut pas « sauter » en profondeur (par exemple du bord de la sculpture au plateau
lointain) : chaque point est comparé au précédent (déplacement dans l'espace ≤ ~4 × ce que le doigt a parcouru à l'écran), le trait reste dans
une fenêtre de profondeur autour de l'endroit du premier appui, et les surfaces vues presque à plat (< ~7°) ne sont pas sculptées.
De même, un **pincement à deux doigts** n'ajoute plus de bosse parasite : si le deuxième doigt arrive moins d'une demi-seconde après le premier,
le geste du premier est annulé (sans entrer dans l'historique).

**Stylet** : à pression moyenne il se comporte exactement comme la souris ; la pression module ensuite la **force** (par défaut), la **taille**,
les deux ou rien (Options). Une paume posée juste après le stylet est ignorée, le bouton latéral du stylet fait tourner la vue, la gomme enlève.
Le curseur apparaît au survol : une bille translucide (le pinceau) et un **anneau posé sur la surface, orienté selon sa normale**, à la taille de l'empreinte.

## Formes de départ (bouton « Nouveau »)
30 formes classées en Bases (boule, œuf, plaque), Personnages (bonhomme de neige, personnage entier avec pieds, robot), Animaux (chat,
chien, lapin, ours, éléphant, cochon, poisson, poussin, tortue, grenouille, dinosaure, pingouin, hibou, escargot, chenille) et Objets (maison,
château, arbre, champignon, fusée, voiture, bateau, fleur, cupcake). Elles sont décrites par quelques primitives (sphères, capsules, cônes,
ellipsoïdes, boîtes arrondies, prismes) dans `js/starters.js` et se chargent en moins de 50 ms ; chacune donne une surface manifold.

**Surface vide** (premier choix de la fenêtre « Nouveau ») : on part du plateau seul et on pose tout soi-même. La fenêtre « Formes » s'ouvre
aussitôt ; « Formes » et « Importer » sont entourés tant que la surface est vide. On peut aussi dessiner directement avec « Ajouter ».
**Toutes les formes de départ se posent aussi comme des objets** depuis « Formes » (personnages, animaux, objets, œuf, plaque), à leur vraie
taille, à l'endroit cliqué, avec rotation / taille / hauteur réglables : on peut ainsi composer une scène (maison + arbre + chat…), au besoin
sur un plateau de 15 ou 20 cm. Chaque forme est construite à part dans un champ temporaire (~0,1 s) puis posée comme un maillage.
Par défaut, la copie « miroir » de la symétrie n'est posée que pour un objet placé sur la sculpture (yeux, oreilles…), pas sur le plateau.

## Zone de travail (Options)
Plateau de **10, 15 ou 20 cm**. La grille s'adapte pour garder la même finesse (≈ 1,27 mm : 80 → 119 → 159 voxels par axe en résolution
« Normale »), la caméra, l'ombre, la grille du plateau et les limites de déplacement aussi. La sculpture est conservée au centre, posée
sur le sol. Un grand plateau demande un appareil plus puissant : repasser en résolution « Éco » si ça ralentit.

## Interface adaptative
- **Toutes les dimensions sont en `rem`** : `app.js` règle la taille de base de la page selon l'écran (largeur, hauteur, orientation) et
  l'option « Taille de l'interface » (Petite / Normale / Grande / Très grande). Les boutons gardent des proportions et des cibles tactiles
  cohérentes de 812×375 (téléphone en paysage) à 1920×1080, en paysage comme en portrait.
- **Paysage** : outils à gauche (ou à droite, option), réglages de l'autre côté, navigation en haut à gauche, à côté des outils.
- **Portrait** : barre d'outils en bas (grille de 5, Formes et Importer à la fin), réglages repliés en haut à droite, navigation en haut à gauche.
- La sculpture est toujours recentrée dans la zone libre (`camera.setViewOffset`), en tenant compte des panneaux, du panneau de placement,
  de la barre des tampons et, à moitié, de la carte de navigation.
- Pendant le placement d'une forme, le panneau de placement (avec **Annuler / Poser** toujours visibles) remplace les réglages (paysage)
  ou monte au-dessus des outils (portrait).
- Icônes SVG de la même famille (aucune dépendance aux polices d'emoji), tampons et formes en emoji.
- Aucune animation ; `prefers-reduced-motion` respecté ; zones de sécurité (`env(safe-area-inset-*)`) pour les iPad.

## Rendu et fluidité
- **Surface** : champ de densité (grille 56 / 80 / 112 voxels par 10 cm) maillé par *marching tetrahedra* à l'aide d'une **table
  précalculée** des 256 configurations ; blocs de 16³ cellules reconstruits uniquement là où l'on sculpte.
- **Matériau « argile » matcap** : l'éclairage est cuit dans une texture générée au démarrage → une seule lecture de texture par pixel
  (le mode « Réaliste » garde le rendu PBR avec lumières).
- Plateau texturé (grille 1 cm, repères tous les 5 cm, zone de travail encadrée) ; ombre douce sous la sculpture ; curseur en anneau.
- **Gestes traités une fois par image** : les mouvements (avec tous les points intermédiaires du stylet) sont mis en file puis appliqués
  au début de l'image ; le coût ne dépend plus de la fréquence du périphérique.
- **Annuler / rétablir sans copie complète** : une copie « état validé » tenue à jour par zones sert d'« avant » ; chaque geste ne stocke que
  la zone modifiée (avant / après).
- **Tampons GPU réutilisés**, **résolution adaptative** (la netteté baisse par paliers jusqu'à 0,75× si l'image dépasse 30 ms), rendu à
  la demande (rien ne tourne quand on ne touche pas à l'écran), sauvegarde automatique (aussi à la fermeture de la page).
- **Export dans un Web Worker** : l'interface reste réactive pendant le calcul.

Mesures (Chromium, 1024×768, rendu réel, gestes synthétiques de 60 événements) :

| Scénario | Image médiane / p90 |
|---|---|
| « Ajouter », grille 80, sans symétrie | 1,8 / 3,1 ms |
| « Ajouter », grille 80, étoile ×6 | 3,7 / 4,8 ms |
| « Ajouter », grille 112, sans symétrie | 3,0 / 4,5 ms |
| « Ajouter », grille 112, étoile ×6 | 5,8 / 9,6 ms |
| Segment d'« Ajouter » avec contrôle de support, pinceau 7 / 12 / 25 | 0,04 / 0,17 / 3,2 ms |
| Changement de plateau 10 → 15 → 20 cm | 93 / 33 / 36 ms |
| Export (plateau 20 cm, château) : Standard / Dense / Ultra | 0,4 s / 1,0 s / 2,6 s |

## Impression 3D (garantie « manifold »)
- Surface toujours fermée (2 triangles par arête) ; plateau plat ; bords de grille vides.
- Export : retrait des petits débris flottants, rééchantillonnage (Dense ≈ ×2, Ultra ≈ ×3, plafonné à 200 / 240 voxels), adoucissement du
  champ puis **lissage de Taubin** des sommets (sans rétrécissement, dessous resté plat), puis **vérification** (arêtes orientées, volume).
  Le téléchargement n'est actif que si le test passe. Formats : STL binaire (Z vers le haut, posé à z = 0) et OBJ, à 3 / 5 / 8 / 12 cm.

## Options (icône en haut)
Tous les réglages sont **mémorisés sur l'ordinateur** et retrouvés à chaque ouverture ou rafraîchissement (plateau, résolution, affichage, symétrie,
stylet, etc.) ; ce sont eux qui font foi : si la sculpture enregistrée a une autre grille, elle est rééchantillonnée pour les respecter.
**Performances** : quatre préréglages (Très faible / Faible / Normal / Élevé) règlent d'un coup résolution (jusqu'à 40 voxels), affichage,
netteté de l'image et maillage d'export ; chaque option reste réglable ensuite. **Plateau** : 10 / 15 / 20 cm ou **taille libre de 6 à 40 cm**
(la finesse affichée dépend de la grille). Zone de travail · taille de l'interface · place des outils · résolution (Éco / Normale / Fine) · affichage (Éco : sans ombre, 1× / Normal /
Réaliste) · stylet (la pression change : rien / la force / la taille / les deux) · maillage d'export par défaut. Valeurs par défaut « Éco »
sur les appareils modestes (≤ 2 Go ou ≤ 2 cœurs).

## Sauvegarde
`localStorage` (`pate3d.v3`) : `N:L|données` (grille, plateau, champ compressé en RLE + base64) ; l'ancien format `N|données` est encore lu.
Une surface vide est une sauvegarde valide (elle est rechargée telle quelle). Au tout premier lancement, sans sauvegarde, l'application
démarre avec la boule. Les options sont dans `pate3d.opts`, les réglages d'outils dans `pate3d.tools`.

## Structure
- `index.html`, `css/style.css` — interface (icônes SVG en sprite, mise en page en rem)
- `js/clay.js` — champ voxel, pinceaux, étirement, rabot, voxelisation, mailleur (table), plateau variable, export + vérification
- `js/starters.js` — les 30 formes de départ (primitives)
- `js/exportWorker.js` — calcul de l'export hors du fil principal
- `js/io.js` — parseurs STL/OBJ, formes de base et motifs, écriture STL/OBJ
- `js/sound.js` — sons synthétisés
- `js/app.js` — scène Three.js, textures procédurales, gestes, navigation, placement, historique, options, export
