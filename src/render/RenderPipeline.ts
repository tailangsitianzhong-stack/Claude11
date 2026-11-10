import {
  HalfFloatType,
  NeutralToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
  type Camera,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { QualityLevelSettings } from '../platform/QualitySettings';
import type { ViewportSize } from '../platform/ViewportManager';
import { releaseSceneGpuResources } from './gpuResources';
import { RenderTargetFallback, describeConfig, type BufferConfig } from './renderTargetFallback';

/**
 * 描画の経路を一本化したパイプライン。
 *
 *   シーン → RenderPass（MSAA付きの描画バッファ）→ [UnrealBloomPass] → OutputPass（トーンマッピング・sRGB変換）→ 画面
 *
 * - canvas 側の antialias は作成後に変更できないため false とし、MSAA は描画バッファ側（samples）で行う。
 * - 描画バッファの組み合わせ（HDR / MSAA）は、初回描画で検証し、失敗したら順に落とす（renderTargetFallback.ts）。
 * - WebGL コンテキスト喪失時は GPU 資源を解放し、復帰後に作り直して再検証する（gpuResources.ts）。
 */

export interface RenderStats {
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  pixelRatio: number;
  devicePixelRatio: number;
  bufferWidth: number;
  bufferHeight: number;
  /** 画質設定が要求した MSAA サンプル数 */
  requestedMsaa: number;
  /** 実際に使っている MSAA サンプル数（フォールバック・端末の上限を反映） */
  msaaSamples: number;
  /** 実際に HDR バッファを使っているか */
  hdr: boolean;
  bloom: boolean;
  /** 描画バッファの検証状態 */
  bufferStatus: 'validating' | 'ok' | 'fatal';
  /** フォールバックが発生した場合の説明（なければ null） */
  fallbackNote: string | null;
  contextLost: boolean;
}

export type FatalListener = (message: string) => void;

const GL_ERROR_NAMES: Record<number, string> = {
  0x0500: 'INVALID_ENUM',
  0x0501: 'INVALID_VALUE',
  0x0502: 'INVALID_OPERATION',
  0x0505: 'OUT_OF_MEMORY',
  0x0506: 'INVALID_FRAMEBUFFER_OPERATION',
};

const FRAMEBUFFER_STATUS_NAMES: Record<number, string> = {
  0x8cd6: 'INCOMPLETE_ATTACHMENT',
  0x8cd7: 'INCOMPLETE_MISSING_ATTACHMENT',
  0x8cd9: 'INCOMPLETE_DIMENSIONS',
  0x8cdd: 'UNSUPPORTED',
  0x8d56: 'INCOMPLETE_MULTISAMPLE',
};

function hex(n: number): string {
  return `0x${n.toString(16).toUpperCase()}`;
}

/** 失敗理由の一覧を、画面表示用に先頭2件＋件数に要約する（詳細はコンソールに出力済み） */
function summarize(reason: string): string {
  const items = reason.split(', ');
  return items.length <= 2 ? reason : `${items.slice(0, 2).join(', ')} ほか${items.length - 2}件`;
}

export class RenderPipeline {
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly outputPass: OutputPass;
  private readonly fallback: RenderTargetFallback;
  private readonly fatalListeners = new Set<FatalListener>();

  private viewport: ViewportSize = { width: 1, height: 1, devicePixelRatio: 1 };
  private pixelRatioCap = 2;
  private requestedMsaa = 0;
  /** 現在の描画バッファの組み合わせ（null = 使える組み合わせが無い） */
  private active: BufferConfig | null = null;
  private needsValidation = true;
  private fatalMessage: string | null = null;
  private contextLost = false;

  constructor(container: HTMLElement) {
    this.renderer = new WebGLRenderer({
      antialias: false,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.canvas = this.renderer.domElement;
    container.appendChild(this.canvas);

    const r = this.renderer;
    r.outputColorSpace = SRGBColorSpace;
    r.toneMapping = NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    // PCFSoftShadowMap は three r18x で廃止。ぼかしは各ライトの shadow.radius で調整する
    r.shadowMap.type = PCFShadowMap;
    // EffectComposer は1フレームに複数回描画するため、統計は手動でリセットする
    r.info.autoReset = false;

    this.fallback = new RenderTargetFallback(
      r.extensions.has('EXT_color_buffer_half_float') || r.extensions.has('EXT_color_buffer_float'),
    );

    // バッファの種類とサンプル数は applyBufferConfig() で設定する
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 0 });
    target.texture.name = 'EffectComposer.rt1';
    this.composer = new EffectComposer(r, target);
    // 描画対象は setView() で設定する
    this.renderPass = new RenderPass(new Scene(), new PerspectiveCamera());
    this.bloomPass = new UnrealBloomPass(new Vector2(1, 1), 0.32, 0.45, 1.0);
    this.outputPass = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.outputPass);

    this.configureBuffers();

    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);
  }

  setView(scene: Scene, camera: Camera): void {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
  }

  setViewport(size: ViewportSize): void {
    this.viewport = size;
    this.applySize();
  }

  /** 描画パイプラインが担当する画質設定を反映する（影・背景・輪郭線は各システムが担当） */
  applyQuality(s: QualityLevelSettings): void {
    this.pixelRatioCap = s.pixelRatioCap;
    if (s.bloom && !this.bloomPass.enabled) this.needsValidation = true; // Bloom 用バッファも検証する
    this.bloomPass.enabled = s.bloom;
    this.requestedMsaa = s.msaaSamples;
    this.configureBuffers();
    this.applySize();
  }

  /** 描画できない状態になったときの通知（エラー表示用） */
  onFatal(listener: FatalListener): void {
    this.fatalListeners.add(listener);
    if (this.fatalMessage) listener(this.fatalMessage);
  }

  render(): void {
    if (this.contextLost || this.fatalMessage) return;
    const gl = this.renderer.getContext();
    const validating = this.needsValidation;
    if (validating) {
      // ① 描画の前に：バッファを確保してフレームバッファの完全性を調べ、使えない組み合わせは描画せずに落とす
      if (!this.prevalidate()) return;
      // 以前の GL エラーを読み捨てる（getError は同期待ちが発生するため検証フレームだけで使う）
      for (let i = 0; i < 16 && gl.getError() !== gl.NO_ERROR; i++);
    }
    this.renderer.info.reset();
    this.composer.render();
    // ② 初回描画の後に：GL エラーが出ていないか調べる
    if (validating && !this.contextLost) this.postvalidate();
  }

  get pixelRatio(): number {
    return Math.min(this.viewport.devicePixelRatio, this.pixelRatioCap);
  }

  get stats(): RenderStats {
    const info = this.renderer.info;
    const pr = this.pixelRatio;
    const a = this.active;
    const failures = this.fallback.failures;
    return {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      pixelRatio: pr,
      devicePixelRatio: this.viewport.devicePixelRatio,
      bufferWidth: Math.floor(this.viewport.width * pr),
      bufferHeight: Math.floor(this.viewport.height * pr),
      requestedMsaa: this.requestedMsaa,
      msaaSamples: a ? Math.min(a.msaaSamples, this.renderer.capabilities.maxSamples) : 0,
      hdr: a?.hdr ?? false,
      bloom: this.bloomPass.enabled,
      bufferStatus: this.fatalMessage ? 'fatal' : this.needsValidation ? 'validating' : 'ok',
      fallbackNote: !this.fallback.hdrAvailable
        ? 'HDR非対応のため8bit'
        : failures.length > 0
          ? `失敗: ${failures.map((f) => describeConfig(f.config)).join(' / ')}`
          : null,
      contextLost: this.contextLost,
    };
  }

  // ---------------------------------------------------------------------------
  // 描画バッファの構成と検証
  // ---------------------------------------------------------------------------

  /** 要求された MSAA に対して使う組み合わせを決め、変わっていればバッファを作り直す */
  private configureBuffers(): void {
    const next = this.fallback.resolve(this.requestedMsaa);
    if (!next) {
      this.fail(
        '描画用のバッファを作成できませんでした。\n' +
          'HDR / 8bit、MSAA あり / なし のすべての組み合わせで失敗しました。\n' +
          this.fallback.failures.map((f) => `・${describeConfig(f.config)}：${summarize(f.reason)}`).join('\n') +
          '\nブラウザや端末のOSを最新版に更新してお試しください。',
      );
      return;
    }
    const cur = this.active;
    if (cur && cur.hdr === next.hdr && cur.msaaSamples === next.msaaSamples) return;
    this.active = next;
    this.applyBufferConfig(next);
    this.needsValidation = true;
  }

  private applyBufferConfig(c: BufferConfig): void {
    const type = c.hdr ? HalfFloatType : UnsignedByteType;
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      rt.texture.type = type;
      rt.samples = c.msaaSamples;
      // 種類・サンプル数の変更はバッファの作り直しが必要。dispose 後、次の描画で自動的に再生成される
      rt.dispose();
    }
    for (const rt of this.bloomTargets()) {
      rt.texture.type = type;
      rt.dispose();
    }
    // 8bit ではしきい値 1.0 を超える値が存在しないため、少し下げる
    this.bloomPass.threshold = c.hdr ? 1.0 : 0.95;
  }

  private bloomTargets(): WebGLRenderTarget[] {
    const b = this.bloomPass;
    return [b.renderTargetBright, ...b.renderTargetsHorizontal, ...b.renderTargetsVertical];
  }

  /**
   * 描画前の検証。現在の組み合わせのバッファを確保してフレームバッファの完全性を調べ、
   * 失敗したら次の組み合わせへ落として再試行する。描画してよければ true。
   */
  private prevalidate(): boolean {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (this.fatalMessage || !this.active) return false;
      const targets = this.validationTargets();
      for (const rt of targets) this.renderer.initRenderTarget(rt);
      const problems = this.checkFramebuffers(targets);
      if (problems.length === 0) return true;
      this.reportFailure(problems.join(', '));
    }
    return !this.fatalMessage && this.active !== null;
  }

  /** 描画後の検証。GL エラーがあれば次の組み合わせへ落とす（次のフレームで再試行） */
  private postvalidate(): void {
    const gl = this.renderer.getContext();
    const errors: string[] = [];
    for (let i = 0; i < 16; i++) {
      const err = gl.getError();
      if (err === gl.NO_ERROR || err === gl.CONTEXT_LOST_WEBGL) break;
      errors.push(`GLエラー ${GL_ERROR_NAMES[err] ?? hex(err)}`);
    }
    if (errors.length === 0) {
      this.needsValidation = false;
      return;
    }
    this.reportFailure([...new Set(errors)].join(', '));
  }

  private reportFailure(reason: string): void {
    const failed = this.active;
    if (!failed) return;
    console.warn(
      `[RenderPipeline] 描画バッファ ${describeConfig(failed)} が使えません（${reason}）。設定を落として再試行します。`,
    );
    this.fallback.markFailed(failed, reason);
    this.configureBuffers();
  }

  /** 検証の対象：EffectComposer の2つのバッファと、Bloom が有効なら Bloom の作業バッファ */
  private validationTargets(): WebGLRenderTarget[] {
    const targets = [this.composer.renderTarget1, this.composer.renderTarget2];
    if (this.bloomPass.enabled) targets.push(...this.bloomTargets());
    return targets;
  }

  /** フレームバッファの完全性を調べる（MSAA 用と解決先の両方）。問題の一覧を返す */
  private checkFramebuffers(targets: WebGLRenderTarget[]): string[] {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const problems: string[] = [];
    const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    for (const rt of targets) {
      const props = this.renderer.properties.get(rt) as {
        __webglFramebuffer?: WebGLFramebuffer;
        __webglMultisampledFramebuffer?: WebGLFramebuffer;
      };
      for (const [label, fb] of [
        ['MSAA', props.__webglMultisampledFramebuffer],
        ['解決先', props.__webglFramebuffer],
      ] as const) {
        if (!fb) continue;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
          problems.push(`${rt.texture.name || 'RenderTarget'}(${label}) ${FRAMEBUFFER_STATUS_NAMES[status] ?? hex(status)}`);
        }
      }
    }
    // three.js の内部キャッシュと実際の束縛状態を一致させるため、元に戻す
    gl.bindFramebuffer(gl.FRAMEBUFFER, previous);
    return problems;
  }

  private fail(message: string): void {
    if (this.fatalMessage) return;
    this.fatalMessage = message;
    this.active = null;
    console.error(`[RenderPipeline] ${message}`);
    for (const l of this.fatalListeners) l(message);
  }

  // ---------------------------------------------------------------------------
  // WebGL コンテキストの喪失と復帰
  // ---------------------------------------------------------------------------

  private readonly onContextLost = (e: Event): void => {
    // preventDefault しないと復帰イベントが来ない（three.js 側でも呼ばれる）
    e.preventDefault();
    this.contextLost = true;
    console.warn('[RenderPipeline] WebGLコンテキストが失われました。GPU資源を解放して復帰を待ちます。');
    // 喪失中（GL の呼び出しが何もしない状態）に、喪失前の資源をすべて解放しておく。
    // 復帰後に解放すると、古いコンテキストの GL オブジェクトを削除しようとして警告が出るため。
    this.composer.dispose(); // renderTarget1/2 とコピー用パス
    for (const pass of this.composer.passes) pass.dispose(); // Bloom の作業バッファ・各パスのマテリアル
    releaseSceneGpuResources(this.renderPass.scene); // ジオメトリ・マテリアル・テクスチャ・影マップ
  };

  private readonly onContextRestored = (): void => {
    this.contextLost = false;
    // 新しいコンテキストで同じ組み合わせが使えるとは限らないため、次の描画で再検証する
    this.needsValidation = true;
    console.info('[RenderPipeline] WebGLコンテキストが復帰しました。次の描画で資源を作り直します。');
  };

  private applySize(): void {
    const { width, height } = this.viewport;
    const pr = this.pixelRatio;
    this.renderer.setPixelRatio(pr);
    // 第3引数 false: canvas の CSS サイズは styles.css（100%）に任せる
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(width, height);
  }
}
