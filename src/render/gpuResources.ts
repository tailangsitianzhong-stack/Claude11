import type { LightShadow, Material, Object3D, Texture } from 'three';

/**
 * WebGL コンテキスト喪失時の GPU 資源の解放。
 *
 * 背景：
 * three.js はコンテキスト復帰時に内部の管理情報を作り直すが、喪失前に作られた
 * RenderTarget・影マップ・テクスチャ・ジオメトリ・シェーダーには「古い管理情報」が
 * dispose の処理として結び付いたまま残る。復帰後にそれらを dispose すると、
 * 喪失前のコンテキストの GL オブジェクトを削除しようとして
 * `INVALID_OPERATION: delete: object does not belong to this context` が発生する。
 *
 * 対策：
 * コンテキストを失った時点（GL の呼び出しが何もしない状態）で、把握しているすべての
 * GPU 資源を dispose して古い管理情報との結び付きを解消しておく。
 * three.js の資源は dispose 後も再利用でき、復帰後の最初の描画で新しいコンテキストに作り直される。
 *
 * 注意：シーンに含まれていない資源（非表示のプール・キャッシュなど）は、所有者が同様に解放すること。
 */

export function disposeMaterial(material: Material): void {
  for (const value of Object.values(material)) {
    if (value && typeof value === 'object' && (value as Texture).isTexture) (value as Texture).dispose();
  }
  material.dispose();
}

/** シーン内の GPU 資源（ジオメトリ・マテリアル・テクスチャ・影マップ）を解放する */
export function releaseSceneGpuResources(root: Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as Object3D & { geometry?: { dispose(): void }; material?: Material | Material[] };
    mesh.geometry?.dispose();
    if (Array.isArray(mesh.material)) mesh.material.forEach(disposeMaterial);
    else if (mesh.material) disposeMaterial(mesh.material);

    const light = obj as Object3D & { isLight?: boolean; shadow?: LightShadow };
    if (light.isLight && light.shadow) {
      light.shadow.map?.dispose();
      light.shadow.map = null;
    }
  });

  const scene = root as Object3D & { background?: unknown; environment?: unknown };
  for (const t of [scene.background, scene.environment]) {
    if (t && typeof t === 'object' && (t as Texture).isTexture) (t as Texture).dispose();
  }
}
