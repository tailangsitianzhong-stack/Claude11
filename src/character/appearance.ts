import { BackSide, BufferAttribute, Color, Mesh, MeshBasicMaterial, MeshStandardMaterial, type BufferGeometry } from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { installShaderPatch, type ShaderPatch } from '../render/internal/threeShaderPatch';

/**
 * キャラクターの見た目（A3 CP2）：色・頂点の色の簡易陰影・リムライト・輪郭線。
 * 色・強さ・太さは CP2 の提案値（DESIGN_DECISIONS 9-4）。
 */

/** 部位の色の割り当て先 */
export type ColorSlot = 'skin' | 'primary' | 'secondary' | 'accent' | 'boots';

export interface Appearance {
  colors: Record<ColorSlot, string>;
}

/** 体型A（操作キャラクター）：青の衣と金の飾り。アリーナ（彩度を抑えた暖色）より彩度を高く */
export const APPEARANCE_A: Appearance = {
  colors: { skin: '#E3A47E', primary: '#2F6BD8', secondary: '#24489A', accent: '#E8B23A', boots: '#3B2C26' },
};

/** 体型B（ダミー）：赤の衣と金の飾り（体型A と見分けやすい色） */
export const APPEARANCE_B: Appearance = {
  colors: { skin: '#D99674', primary: '#C8352C', secondary: '#8E2420', accent: '#E8B23A', boots: '#3B2C26' },
};

/** 部位の名前（bodyMeshes.ts）→ 色の割り当て先 */
export function colorSlotOf(partName: string): ColorSlot {
  const base = partName.replace(/_(L|R)$/, '');
  switch (base) {
    case 'head':
    case 'neck':
    case 'hand':
    case 'thumb':
      return 'skin';
    case 'chest':
    case 'waist':
    case 'thigh':
      return 'primary';
    case 'upperArm':
    case 'forearm':
    case 'shin':
      return 'secondary';
    case 'shoulderBlock':
    case 'kneeCap':
      return 'accent';
    case 'foot':
      return 'boots';
    default:
      return 'primary';
  }
}

/** 簡易の陰影（AO）：部位の下側と関節の付近（上端）を暗くする（提案値：下端 0.70、上端 0.88、中ほど 1.0） */
export const AO = { bottom: 0.7, top: 0.88 } as const;

/** 頂点の色 = 部位の色 × 陰影 */
export function applyPartColor(geometry: BufferGeometry, color: Color): void {
  const pos = geometry.getAttribute('position');
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    yMin = Math.min(yMin, pos.getY(i));
    yMax = Math.max(yMax, pos.getY(i));
  }
  const h = Math.max(yMax - yMin, 1e-6);
  const colors = new Float32Array(pos.count * 3);
  const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
    return t * t * (3 - 2 * t);
  };
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - yMin) / h; // 0 = 下端、1 = 上端
    const ao = AO.bottom + (1 - AO.bottom) * smooth(0, 0.35, t) - (1 - AO.top) * smooth(0.8, 1, t);
    colors[i * 3] = color.r * ao;
    colors[i * 3 + 1] = color.g * ao;
    colors[i * 3 + 2] = color.b * ao;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
}

export const CHARACTER_RIM_MARKER = 'CHARACTER_RIM_v1';
export const CHARACTER_OUTLINE_MARKER = 'CHARACTER_OUTLINE_v1';

/** リムライトの提案値（夕暮れの空に合わせた暖色。ライトは増やさない） */
export const RIM = { color: '#FFC9A0', strength: 0.35, power: 3.0 } as const;
/** 輪郭線の提案値（太さは体の表面から外へ m） */
export const OUTLINE = { color: '#1E1618', width: 0.012 } as const;

/**
 * 体のマテリアル：MeshStandardMaterial（粗さ 0.62、金属感 0）。色は頂点の色。
 * リムライト：照明の計算の後に、輪郭ほど明るくなる項（フレネル項）を自己発光に足す（threeShaderPatch）。
 */
export function createBodyMaterial(name: string, onPatchFailed: (e: Error) => void): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0, vertexColors: true });
  material.name = name;
  const patch: ShaderPatch = {
    marker: CHARACTER_RIM_MARKER,
    uniforms: {
      uRimColor: { value: new Color(RIM.color) },
      uRimStrength: { value: RIM.strength },
      uRimPower: { value: RIM.power },
    },
    vertex: [],
    fragment: [
      { anchor: '#include <common>', code: 'uniform vec3 uRimColor;\nuniform float uRimStrength;\nuniform float uRimPower;' },
      {
        anchor: '#include <lights_fragment_end>',
        // normal：視点の座標の法線、vViewPosition：表面からカメラへの向き（three.js の meshphysical の変数）
        code: `{
  float rimDot = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
  totalEmissiveRadiance += uRimColor * (uRimStrength * pow(rimDot, uRimPower));
}`,
      },
    ],
  };
  installShaderPatch(material, patch, onPatchFailed);
  // 確認・調整用（開発・検証）：リムライトの強さなどをあとから変えられるよう、uniform を残す
  material.userData.rimUniforms = patch.uniforms;
  return material;
}

/** 輪郭線のマテリアル：裏面だけを、法線の方向へ少し膨らませて単色で描く（インバーテッドハル） */
export function createOutlineMaterial(name: string, onPatchFailed: (e: Error) => void): MeshBasicMaterial {
  const material = new MeshBasicMaterial({ color: OUTLINE.color, side: BackSide });
  material.name = name;
  const patch: ShaderPatch = {
    marker: CHARACTER_OUTLINE_MARKER,
    uniforms: { uOutlineWidth: { value: OUTLINE.width } },
    vertex: [
      { anchor: '#include <common>', code: 'uniform float uOutlineWidth;' },
      { anchor: '#include <begin_vertex>', code: 'transformed += normalize(normal) * uOutlineWidth;' },
    ],
    fragment: [],
  };
  installShaderPatch(material, patch, onPatchFailed);
  return material;
}

/**
 * 輪郭線の形：部位と同じ形で、角の継ぎ目で頂点をまとめて法線をなめらかにする
 * （面ごとに法線が違うと、膨らませたときに角にすき間ができるため）。
 */
export function createOutlineGeometry(geometry: BufferGeometry): BufferGeometry {
  const g = geometry.clone();
  for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
  const merged = mergeVertices(g, 1e-4);
  g.dispose();
  merged.computeVertexNormals();
  return merged;
}

/** 輪郭線のメッシュ（影は落とさない） */
export function createOutlineMesh(source: Mesh, material: MeshBasicMaterial): Mesh {
  const mesh = new Mesh(createOutlineGeometry(source.geometry), material);
  mesh.name = `${source.name}_outline`;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}
