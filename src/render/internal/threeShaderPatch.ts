import { REVISION, type Material, type WebGLProgramParametersWithUniforms } from 'three';

/**
 * three.js 標準マテリアルのシェーダーへ処理を差し込む（onBeforeCompile）。
 * three.js の内部実装（シェーダーの部品名・変数名）に依存する処理を、このファイルだけに隔離する。
 *
 * ■ 依存している内部仕様（three.js 0.187.0 / REVISION '187' で確認。MeshStandardMaterial = meshphysical シェーダー）
 *   頂点シェーダー：  `#include <common>`、`#include <begin_vertex>`（変数 `transformed`）、`modelMatrix`
 *   フラグメント：    `#include <common>`、`#include <color_fragment>`（変数 `diffuseColor`）、
 *                     `#include <roughnessmap_fragment>`（変数 `roughnessFactor`）、
 *                     `#include <metalnessmap_fragment>`（変数 `metalnessFactor`）
 *   A3（キャラクター）で追加：
 *     MeshStandardMaterial のフラグメント：`#include <lights_fragment_end>`、変数 `normal`・`vViewPosition`・
 *       `totalEmissiveRadiance`（リムライト。tests/characterLook.test.ts で検査）
 *     MeshBasicMaterial の頂点シェーダー：`#include <common>`、`#include <begin_vertex>`（変数 `transformed`）、属性 `normal`
 *       （輪郭線の膨らみ）
 *   GLSL 3.00 ES（WebGL2）。`varying` は three.js が in/out に置き換える。`fwidth` は標準で使える。
 *
 * ■ 安全策
 *   - 差し込み先（アンカー）が見つからない場合は ShaderPatchError を投げる。呼び出し側は差し込みなしのマテリアルに切り替える。
 *   - 差し込んだシェーダーには目印（marker）のコメントを入れる。コンパイルに失敗したとき、
 *     ShaderErrorMonitor（src/render/shaderErrors.ts）が目印で発生元を特定できる。
 *
 * ■ three.js を更新するときの注意
 *   - 上記の部品名・変数名が変わっていないか、ShaderLib の meshphysical.glsl.js で確認する。
 *   - tests/threeShaderPatch.test.ts が、実際の ShaderLib に対してアンカーの存在を検査する。
 *   - 確認後に VERIFIED_THREE_REVISION を更新する。
 */

export const VERIFIED_THREE_REVISION = '187';

export class ShaderPatchError extends Error {
  constructor(message: string) {
    super(`[ShaderPatch] three.js r${REVISION}: ${message}`);
    this.name = 'ShaderPatchError';
  }
}

export interface ShaderInsertion {
  /** 差し込み先の `#include <...>` 行 */
  anchor: string;
  /** アンカーの直後に挿入するコード */
  code: string;
}

export interface ShaderPatch {
  /** 目印（コンパイル失敗時の発生元の特定とキャッシュキーに使う） */
  marker: string;
  uniforms: Record<string, { value: unknown }>;
  vertex: ShaderInsertion[];
  fragment: ShaderInsertion[];
}

/** シェーダーのソースに差し込む（純粋な文字列処理。テスト対象） */
export function applyInsertions(source: string, insertions: readonly ShaderInsertion[], stage: string): string {
  let out = source;
  for (const ins of insertions) {
    if (!out.includes(ins.anchor)) {
      throw new ShaderPatchError(`${stage} シェーダーに差し込み先 "${ins.anchor}" が見つかりません`);
    }
    out = out.replace(ins.anchor, `${ins.anchor}\n${ins.code}`);
  }
  return out;
}

/**
 * マテリアルに差し込みを設定する。実際の差し込みはコンパイル時（onBeforeCompile）に行われる。
 * 差し込みに失敗した場合は onPatchFailed が呼ばれ、差し込みなしのシェーダーでコンパイルされる。
 */
export function installShaderPatch(material: Material, patch: ShaderPatch, onPatchFailed: (error: Error) => void): void {
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    try {
      const vertex = applyInsertions(shader.vertexShader, patch.vertex, 'vertex');
      const fragment = applyInsertions(shader.fragmentShader, patch.fragment, 'fragment');
      Object.assign(shader.uniforms, patch.uniforms);
      shader.vertexShader = `// ${patch.marker}\n${vertex}`;
      shader.fragmentShader = `// ${patch.marker}\n${fragment}`;
    } catch (error) {
      onPatchFailed(error instanceof Error ? error : new Error(String(error)));
    }
  };
  material.customProgramCacheKey = () => patch.marker;
}
