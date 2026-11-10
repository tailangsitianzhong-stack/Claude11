import type { WebGLRenderer } from 'three';

/**
 * シェーダーのコンパイル失敗の検出（three.js の公開 API `renderer.debug.onShaderError` を使う）。
 *
 * - すべてのコンパイル失敗を、three.js 標準と同等の詳細（情報ログ）付きで console.error に出す（握りつぶさない）。
 * - 差し込み処理の目印（marker）を含むシェーダーが失敗した場合は、登録された処理（代わりのマテリアルへの切り替えなど）を呼ぶ。
 */
export interface ShaderErrorRecord {
  markers: string[];
  log: string;
}

export class ShaderErrorMonitor {
  readonly errors: ShaderErrorRecord[] = [];
  private readonly handlers = new Map<string, () => void>();

  constructor(renderer: WebGLRenderer) {
    renderer.debug.checkShaderErrors = true;
    renderer.debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
      const programLog = gl.getProgramInfoLog(program)?.trim() ?? '';
      const vertexLog = gl.getShaderInfoLog(vertexShader)?.trim() ?? '';
      const fragmentLog = gl.getShaderInfoLog(fragmentShader)?.trim() ?? '';
      const sources = `${gl.getShaderSource(vertexShader) ?? ''}\n${gl.getShaderSource(fragmentShader) ?? ''}`;
      const markers = [...this.handlers.keys()].filter((m) => sources.includes(m));
      const log = [programLog, vertexLog && `vertex: ${vertexLog}`, fragmentLog && `fragment: ${fragmentLog}`]
        .filter(Boolean)
        .join('\n');
      this.errors.push({ markers, log });
      console.error(
        `[ShaderErrorMonitor] シェーダーのコンパイルに失敗しました${markers.length ? `（${markers.join(', ')}）` : ''}\n${log}`,
      );
      for (const m of markers) this.handlers.get(m)?.();
    };
  }

  /** 目印を含むシェーダーが失敗したときの処理を登録する（同じ目印は上書き）。解除関数を返す */
  onFailure(marker: string, handler: () => void): () => void {
    this.handlers.set(marker, handler);
    return () => {
      if (this.handlers.get(marker) === handler) this.handlers.delete(marker);
    };
  }
}
