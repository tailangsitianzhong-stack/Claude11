import { BufferAttribute, Color, CylinderGeometry, Mesh, MeshStandardMaterial, Object3D, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { taperedBox } from './bodyMeshes';

/**
 * ダミーの剣（A3 CP2。寸法・形・色は提案値。DESIGN_DECISIONS 9-4）。
 *
 * 剣の座標：握りの中心が原点、+Y が刃の向き（武器のソケット weapon_* の +Y と一致させる）。
 *   柄頭   y −0.085 〜 −0.06   直径 0.045
 *   握り   y −0.06  〜 +0.06   直径 0.034（拳の中）
 *   鍔     y +0.06  〜 +0.09   0.18 × 0.035（横に長い）
 *   刃     y +0.09  〜 +0.84   幅 0.07 → 先 0.017、厚さ 0.012（A3 CP3 で幅を 0.05 → 0.07 に調整）
 * 剣自体のソケット：weapon_base（刃の根元 y +0.09）、weapon_tip（刃の先端 y +0.84）。将来の攻撃判定はこの2点の線分で作る。
 */
export const SWORD = {
  bladeBase: 0.09,
  bladeTip: 0.84,
  bladeWidth: 0.07,
  bladeThickness: 0.012,
  colors: { blade: '#C9CFD8', guard: '#D9A63A', grip: '#4A2F22' },
} as const;

function colored(g: BufferGeometry, hex: string): BufferGeometry {
  const c = new Color(hex);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new BufferAttribute(arr, 3));
  return g;
}

export function createSwordGeometry(): BufferGeometry {
  const S = SWORD;
  const blade = taperedBox({
    w: S.bladeWidth,
    d: S.bladeThickness,
    y0: S.bladeBase,
    y1: S.bladeTip,
    bevel: 0.004,
  });
  // 刃の先を細くする（先端の幅は刃の幅の 0.24 倍）
  const pos = blade.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - S.bladeBase) / (S.bladeTip - S.bladeBase);
    if (t > 0.8) pos.setX(i, pos.getX(i) * (1 - 0.76 * ((t - 0.8) / 0.2)));
  }
  blade.computeVertexNormals();
  const guard = taperedBox({ w: 0.18, d: 0.035, y0: 0.06, y1: 0.09, bevel: 0.008 });
  const grip = new CylinderGeometry(0.017, 0.017, 0.12, 12);
  const pommel = new CylinderGeometry(0.0225, 0.0225, 0.025, 12);
  pommel.translate(0, -0.0725, 0);
  const parts = [colored(blade, S.colors.blade), colored(guard, S.colors.guard), colored(grip, S.colors.grip), colored(pommel, S.colors.guard)];
  // 結合のため属性をそろえる（位置・法線・色）
  for (const p of parts) for (const name of Object.keys(p.attributes)) if (!['position', 'normal', 'color'].includes(name)) p.deleteAttribute(name);
  const indexed = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const merged = mergeGeometries(indexed);
  for (const p of [...parts, ...indexed]) p.dispose();
  if (!merged) throw new Error('剣の形状を結合できませんでした');
  return merged;
}

export interface DummySword {
  root: Object3D;
  mesh: Mesh;
  sockets: { weapon_base: Object3D; weapon_tip: Object3D };
}

/** 剣：鋼の刃（金属感 0.35・粗さ 0.50。CP3 で調整）、金の鍔・柄頭、革の握り。色は頂点の色 */
export function createDummySword(): DummySword {
  const root = new Object3D();
  root.name = 'DummySword';
  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.35, vertexColors: true });
  material.name = 'DummySword';
  const mesh = new Mesh(createSwordGeometry(), material);
  mesh.name = 'swordBody';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  const base = new Object3D();
  base.name = 'socket_weapon_base';
  base.position.set(0, SWORD.bladeBase, 0);
  const tip = new Object3D();
  tip.name = 'socket_weapon_tip';
  tip.position.set(0, SWORD.bladeTip, 0);
  root.add(base, tip);
  return { root, mesh, sockets: { weapon_base: base, weapon_tip: tip } };
}
