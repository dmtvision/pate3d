import Enums from 'misc/Enums';
import Export from 'files/Export';

export default class CustomUI {
  constructor(main) {
    this.main = main;
    this.initEvents();
  }

  initEvents() {
    const main = this.main;
    const sculpt = main.getSculptManager();

    // 1. Boutons d'outils
    const toolButtons = document.querySelectorAll('.tool[data-tool]');
    toolButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        toolButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const toolName = btn.dataset.tool;
        if (Enums.Tools[toolName] !== undefined) {
          sculpt.setToolIndex(Enums.Tools[toolName]);
        }
      });
    });

    // 2. Curseur Rayon / Taille
    const radiusSlider = document.getElementById('slider-radius');
    if (radiusSlider) {
      radiusSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        const label = document.getElementById('val-radius');
        if (label) label.textContent = val;
        sculpt.getCurrentTool().setRadius(val);
      });
    }

    // 3. Curseur Intensité / Force
    const intensitySlider = document.getElementById('slider-intensity');
    if (intensitySlider) {
      intensitySlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10) / 100;
        const label = document.getElementById('val-intensity');
        if (label) label.textContent = Math.round(val * 100) + '%';
        sculpt.getCurrentTool().setIntensity(val);
      });
    }

    // 4. Symétrie
    const mirrorBtn = document.getElementById('btn-mirror');
    if (mirrorBtn) {
      mirrorBtn.addEventListener('click', () => {
        const isSymmetric = !sculpt.getSymmetry();
        sculpt.setSymmetry(isSymmetric);
        mirrorBtn.classList.toggle('active', isSymmetric);
        main.render();
      });
    }

    // 5. Historique Undo / Redo
    const undoBtn = document.getElementById('btn-undo');
    if (undoBtn) {
      undoBtn.addEventListener('click', () => {
        main.getStates().undo();
        main.render();
      });
    }
    const redoBtn = document.getElementById('btn-redo');
    if (redoBtn) {
      redoBtn.addEventListener('click', () => {
        main.getStates().redo();
        main.render();
      });
    }

    // 6. Export STL pour l'impression 3D
    const exportBtn = document.getElementById('btn-export-stl');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const meshes = main.getMeshes();
        if (meshes.length > 0) {
          Export.exportSTL(meshes);
        }
      });
    }
  }
}