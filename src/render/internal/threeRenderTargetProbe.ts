import { REVISION, type WebGLRenderTarget, type WebGLRenderer } from 'three';

/**
 * RenderTarget のフレームバッファ完全性の検査（three.js の内部実装に依存する処理を、このファイルだけに隔離する）。
 *
 * ■ 内部実装への依存（three.js 0.187.0 / REVISION '187' で確認）
 *   - `renderer.properties`：WebGLRenderer の公開プロパティだが、中身は three.js 内部の管理情報。
 *   - `properties.get(renderTarget).__webglFramebuffer`：解決先（または MSAA なしの描画先）のフレームバッファ。
 *   - `properties.get(renderTarget).__webglMultisampledFramebuffer`：MSAA 用のフレームバッファ（samples > 0 の場合）。
 *   いずれも three.js 0.187.0 の src/renderers/webgl/WebGLTextures.js（setupRenderTarget）で作られる。
 *   公開 API の `renderer.setRenderTarget()` では MSAA 用の側しかバインドされず、
 *   解決先（HDR テクスチャ側）を描画前に検査する公開 API は無いため、内部の値を読み取る。
 *
 * ■ three.js の状態キャッシュとの関係
 *   three.js の WebGLState は `currentBoundFramebuffers` にバインド状態をキャッシュしている。
 *   `FRAMEBUFFER` / `DRAW_FRAMEBUFFER` のキャッシュは描画先の判断に使われるため、ここでは一切触れない。
 *   検査は `READ_FRAMEBUFFER` だけにバインドして `checkFramebufferStatus(READ_FRAMEBUFFER)` で行い、
 *   検査後は READ_FRAMEBUFFER を検査前の値に正確に戻す。
 *   （three.js は READ_FRAMEBUFFER を使う直前に必ず自分でバインドし、使用後に null に戻すため、
 *     実際のバインドを元に戻せばキャッシュとの関係は検査前と同一になる）
 *
 * ■ 将来のバージョン変更時の注意
 *   - three.js を更新したら、上記の内部プロパティ名が変わっていないか確認すること。
 *   - 内部プロパティが見つからない場合、この検査は「判定不能」を返し、
 *     呼び出し側は描画後の GL エラー検査（公開 API の範囲）だけで判定する。誤って「成功」とはみなさない。
 */

/** 内部実装を確認した three.js のリビジョン */
export const VERIFIED_THREE_REVISION = '187';

export type ProbeResult =
  | { kind: 'ok' }
  | { kind: 'incomplete'; problems: string[] }
  /** 内部構造が想定と異なり、検査できなかった */
  | { kind: 'unavailable'; reason: string };

const FRAMEBUFFER_STATUS_NAMES: Record<number, string> = {
  0x8cd6: 'INCOMPLETE_ATTACHMENT',
  0x8cd7: 'INCOMPLETE_MISSING_ATTACHMENT',
  0x8cd9: 'INCOMPLETE_DIMENSIONS',
  0x8cdd: 'UNSUPPORTED',
  0x8d56: 'INCOMPLETE_MULTISAMPLE',
};

interface RenderTargetInternals {
  __webglFramebuffer?: unknown;
  __webglMultisampledFramebuffer?: unknown;
}

/**
 * 指定した RenderTarget を（公開 API の initRenderTarget で）確保し、フレームバッファの完全性を調べる。
 * three.js の DRAW / FRAMEBUFFER のバインド状態とキャッシュは変更しない。
 */
export function probeRenderTargets(renderer: WebGLRenderer, targets: readonly WebGLRenderTarget[]): ProbeResult {
  const gl = renderer.getContext() as WebGL2RenderingContext;

  // 公開 API：未確保なら確保する（内部で FRAMEBUFFER をバインドし、最後に null に戻す。キャッシュも一致する）
  for (const rt of targets) renderer.initRenderTarget(rt);

  // 内部の管理情報からフレームバッファを集める
  const framebuffers: { label: string; fb: WebGLFramebuffer }[] = [];
  for (const rt of targets) {
    if (!renderer.properties.has(rt)) {
      return { kind: 'unavailable', reason: `three.js r${REVISION}: RenderTarget の管理情報が見つからない` };
    }
    const internals = renderer.properties.get(rt) as RenderTargetInternals;
    const resolve = internals.__webglFramebuffer;
    const msaa = internals.__webglMultisampledFramebuffer;
    if (!(resolve instanceof WebGLFramebuffer)) {
      return { kind: 'unavailable', reason: `three.js r${REVISION}: __webglFramebuffer の形式が想定と異なる` };
    }
    const name = rt.texture.name || 'RenderTarget';
    if (rt.samples > 0) {
      if (!(msaa instanceof WebGLFramebuffer)) {
        return { kind: 'unavailable', reason: `three.js r${REVISION}: __webglMultisampledFramebuffer が見つからない` };
      }
      framebuffers.push({ label: `${name}(MSAA)`, fb: msaa });
    }
    framebuffers.push({ label: `${name}(解決先)`, fb: resolve });
  }

  // READ_FRAMEBUFFER だけを使って検査し、検査前の値に戻す
  const previousRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  const problems: string[] = [];
  try {
    for (const { label, fb } of framebuffers) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
      const status = gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        problems.push(`${label} ${FRAMEBUFFER_STATUS_NAMES[status] ?? `0x${status.toString(16).toUpperCase()}`}`);
      }
    }
  } finally {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousRead);
  }
  return problems.length === 0 ? { kind: 'ok' } : { kind: 'incomplete', problems };
}
