/**
 * 描画バッファ（HDR / MSAA）の組み合わせのフォールバック順を決める（純粋なロジック。テスト対象）。
 *
 * 試す順番（要求された MSAA が 0 の場合は「MSAAあり」の候補を飛ばす）：
 *   1. HDR + MSAA
 *   2. HDR（MSAAなし）
 *   3. 8bit + MSAA   … RGBA8 の MSAA は WebGL2 の必須機能なので、ここまで来たら HDR が原因とみなす
 *   4. 8bit（MSAAなし）
 *   5. すべて失敗 → null（呼び出し側でエラーを表示する）
 *
 * 一度失敗した組み合わせは記録し、画質を切り替えても再び試さない。
 */

export interface BufferConfig {
  hdr: boolean;
  msaaSamples: number;
}

export interface BufferFailure {
  config: BufferConfig;
  reason: string;
}

function keyOf(c: BufferConfig): string {
  return `${c.hdr ? 'hdr' : 'ldr'}:${c.msaaSamples > 0 ? 'msaa' : 'nomsaa'}`;
}

export function describeConfig(c: BufferConfig): string {
  return `${c.hdr ? 'HDR' : '8bit'}${c.msaaSamples > 0 ? ` + MSAA ×${c.msaaSamples}` : '（MSAAなし）'}`;
}

export class RenderTargetFallback {
  private readonly failedKeys = new Set<string>();
  private readonly failureLog: BufferFailure[] = [];

  /** @param hdrAvailable HDR用の拡張機能（EXT_color_buffer_half_float / _float）があるか */
  constructor(readonly hdrAvailable: boolean) {}

  /** 要求された MSAA サンプル数に対し、まだ失敗していない最良の組み合わせを返す */
  resolve(requestedMsaa: number): BufferConfig | null {
    for (const c of this.candidates(requestedMsaa)) {
      if (!this.failedKeys.has(keyOf(c))) return c;
    }
    return null;
  }

  markFailed(config: BufferConfig, reason: string): void {
    this.failedKeys.add(keyOf(config));
    this.failureLog.push({ config: { ...config }, reason });
  }

  hasFailed(config: BufferConfig): boolean {
    return this.failedKeys.has(keyOf(config));
  }

  get failures(): readonly BufferFailure[] {
    return this.failureLog;
  }

  private candidates(requestedMsaa: number): BufferConfig[] {
    const msaa = Math.max(0, Math.floor(requestedMsaa));
    const list: BufferConfig[] = [];
    for (const hdr of this.hdrAvailable ? [true, false] : [false]) {
      if (msaa > 0) list.push({ hdr, msaaSamples: msaa });
      list.push({ hdr, msaaSamples: 0 });
    }
    return list;
  }
}
