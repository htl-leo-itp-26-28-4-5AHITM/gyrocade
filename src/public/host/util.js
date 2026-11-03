import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// Floating name label. The empty .rank span is filled in by games that rank players.
// data-player lets the host rename it when a player rejoins under another name.
export function createNameTag({ id, name, color }) {
  const element = document.createElement('div');
  element.className = 'name-tag';
  element.dataset.player = id;
  element.style.color = color;
  const rank = document.createElement('span');
  rank.className = 'rank';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = name;
  element.append(rank, label);
  return new CSS2DObject(element);
}

// Frees GPU resources and label elements of everything below root.
export function disposeTree(root) {
  root.traverse((obj) => {
    obj.geometry?.dispose();
    const materials = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
      material.dispose();
    }
    if (obj.isCSS2DObject) obj.element.remove();
  });
}
