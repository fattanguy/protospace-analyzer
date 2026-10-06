/* ProtoSpace Analyzer — the "3D model" tab: one viewer (js/viewer.js) showing the current Blender frame.
   Exposes window.PSModel3D for the classic page script (js/app.js). */
import { createViewer } from './viewer.js';

const root = document.getElementById('model3dViewer');
if (root) {
  window.PSModel3D = createViewer(root, { scopes: true, emptyText: 'Pick a Blender frame — from the Generator, the library or an exported file — to see its real 3D model.', onReady: () => window.dispatchEvent(new Event('psmodel-ready')) });
}
