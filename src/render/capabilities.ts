import { HalfFloatType, WebGLRenderTarget, type WebGLRenderer } from 'three';
import { probeRenderTargets } from './internal/threeRenderTargetProbe';

/**
 * HalfFloat（HDR）の RenderTarget に描画できるか。
 * PMREM（環境マップの生成）は内部で HalfFloat の RenderTarget に描画するため、生成前に確認する。
 * 拡張機能（EXT_color_buffer_half_float / _float）の有無に加え、4×4 の試験用バッファで実際に完全なフレームバッファになるかを調べる。
 * 検査ができない場合（three.js の内部構造の変更）は、拡張機能の有無で判断する。
 */
export function canRenderToHalfFloat(renderer: WebGLRenderer): boolean {
  const ext = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
  if (!ext) return false;
  const rt = new WebGLRenderTarget(4, 4, { type: HalfFloatType, depthBuffer: false });
  rt.texture.name = 'HalfFloatProbe';
  try {
    const result = probeRenderTargets(renderer, [rt]);
    return result.kind !== 'incomplete';
  } finally {
    rt.dispose();
  }
}
