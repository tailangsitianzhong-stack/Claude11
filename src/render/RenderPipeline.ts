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
import { probeRenderTargets } from './internal/threeRenderTargetProbe';
import { drainGlErrors, glErrorName, GL_OUT_OF_MEMORY, PostValidationTracker } from './glErrors';

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
export type ContextRestoredListener = () => void;
export type ContextLostListener = () => void;

/** Bloom のしきい値（輝度）。applyBufferConfig のコメントを参照 */
export const BLOOM_THRESHOLD_HDR = 1.0;
export const BLOOM_THRESHOLD_8BIT = 0.8;

/**
 * 描画後の検査で、INVALID_FRAMEBUFFER_OPERATION が何フレーム連続したら、バッファの組み合わせの失敗とみなすか。
 * それ以外の GL エラーはフォールバックの根拠にしない（render/glErrors.ts）。
 */
export const POST_FAILURE_CONFIRM_FRAMES = 2;

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
  private readonly restoredListeners = new Set<ContextRestoredListener>();
  private readonly lostListeners = new Set<ContextLostListener>();

  private viewport: ViewportSize = { width: 1, height: 1, devicePixelRatio: 1 };
  private pixelRatioCap = 2;
  private requestedMsaa = 0;
  /** 現在の描画バッファの組み合わせ（null = 使える組み合わせが無い） */
  private active: BufferConfig | null = null;
  private needsValidation = true;
  private fatalMessage: string | null = null;
  private contextLost = false;
  private probeUnavailableWarned = false;
  /** 描画後の検査の判定（INVALID_FRAMEBUFFER_OPERATION の連続回数） */
  private readonly postValidation = new PostValidationTracker(POST_FAILURE_CONFIRM_FRAMES);
  /** 一度ログに出した GL エラーの種類（同じ警告を毎回出さないため） */
  private readonly reportedGlErrors = new Set<string>();

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

    this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
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

  /**
   * WebGL コンテキストの喪失を知らせる（A2 で追加）。
   * シーンに含まれない GPU 資源や、テクスチャから RenderTarget をたどれない資源（PMREM の環境マップ = WebGLCubeRenderTarget など）は、
   * 所有者がこの時点（GL の呼び出しが何もしない状態）で解放する。復帰後に解放すると、古いコンテキストの GL オブジェクトを削除しようとして警告が出る。
   * 同じ関数を何度登録しても1回として扱う（Set）。戻り値の関数で登録を解除する。
   */
  onContextLost(listener: ContextLostListener): () => void {
    this.lostListeners.add(listener);
    return () => {
      this.lostListeners.delete(listener);
    };
  }

  /**
   * WebGL コンテキストの復帰を知らせる（A2 で追加）。
   * GPU 上で描いて作る資源（PMREM の環境マップなど）は再アップロードで復元できないため、所有者が作り直す。
   * 同じ関数を何度登録しても1回として扱う（Set）。戻り値の関数で登録を解除する。
   * 呼び出し時点で three.js の管理情報は作り直し済みで、描画バッファは次の描画で再検証される。
   */
  onContextRestored(listener: ContextRestoredListener): () => void {
    this.restoredListeners.add(listener);
    return () => {
      this.restoredListeners.delete(listener);
    };
  }

  render(): void {
    if (this.contextLost || this.fatalMessage) return;
    const gl = this.renderer.getContext();
    const validating = this.needsValidation;
    if (validating) {
      // ① 描画の前に：バッファを確保してフレームバッファの完全性を調べ、使えない組み合わせは描画せずに落とす
      if (!this.prevalidate()) return;
      // 検証の対象をこのフレームの描画に限るため、それ以前から残っているエラーを読み出しておく。
      // 読み出したエラーは捨てずにログに出す（バッファの判定には使わない）。getError は同期待ちが発生するため検証フレームだけで使う
      const earlier = drainGlErrors(() => gl.getError());
      if (earlier.length > 0) this.logUnrelatedGlErrors(earlier, '描画前から残っていた');
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
    this.postValidation.reset();
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
    // Bloom のしきい値（輝度）。
    // HDR：明るさ 1.0 を超える発光部分だけが光る。
    // 8bit：各色が 1.0 で切り詰められるため、強い発光でも輝度は 1.0 未満になりうる
    //       （例：発光色 #ffb347 ×4 → (1, 1, 0.24) → 輝度 約0.945）。発光体が光るよう 0.8 に下げる。
    this.bloomPass.threshold = c.hdr ? BLOOM_THRESHOLD_HDR : BLOOM_THRESHOLD_8BIT;
  }

  private bloomTargets(): WebGLRenderTarget[] {
    const b = this.bloomPass;
    return [b.renderTargetBright, ...b.renderTargetsHorizontal, ...b.renderTargetsVertical];
  }

  /**
   * 描画前の検証。現在の組み合わせのバッファを確保してフレームバッファの完全性を調べ、
   * 失敗したら次の組み合わせへ落として再試行する。描画してよければ true。
   * 検査は internal/threeRenderTargetProbe.ts に隔離（three.js の DRAW 側の状態とキャッシュは変更しない）。
   */
  private prevalidate(): boolean {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (this.fatalMessage || !this.active) return false;
      const result = probeRenderTargets(this.renderer, this.validationTargets());
      if (result.kind === 'ok') return true;
      if (result.kind === 'unavailable') {
        // three.js の内部構造が想定と異なる：事前検査は諦め、描画後の GL エラー検査（postvalidate）だけで判定する
        if (!this.probeUnavailableWarned) {
          this.probeUnavailableWarned = true;
          console.warn(`[RenderPipeline] 描画前のバッファ検査を省略します（${result.reason}）。描画後の検査で判定します。`);
        }
        return true;
      }
      this.reportFailure(result.problems.join(', '));
    }
    return !this.fatalMessage && this.active !== null;
  }

  /**
   * 描画後の検証。
   * - INVALID_FRAMEBUFFER_OPERATION（不完全なフレームバッファ）が **2フレーム連続** したときだけ、
   *   現在の HDR / MSAA の組み合わせを失敗とみなして次へ落とす。1回目は次のフレームで再確認する。
   * - INVALID_ENUM / INVALID_VALUE / INVALID_OPERATION / OUT_OF_MEMORY は、バッファ以外の原因でも起きるため
   *   フォールバックの根拠にしない。種類をログに出し（同じ種類は1回だけ）、フォールバックせずに検証を終える。
   * 判定のロジックは render/glErrors.ts（PostValidationTracker）にあり、単体テストで検証している。
   */
  private postvalidate(): void {
    const gl = this.renderer.getContext();
    const codes = drainGlErrors(() => gl.getError());
    const verdict = this.postValidation.evaluate(codes);
    switch (verdict.kind) {
      case 'ok':
        this.needsValidation = false;
        return;
      case 'unrelatedOnly':
        this.logUnrelatedGlErrors(verdict.unrelated, '描画後');
        this.needsValidation = false; // フォールバックせずに検証を終える
        return;
      case 'retry':
        if (verdict.unrelated.length > 0) this.logUnrelatedGlErrors(verdict.unrelated, '描画後');
        console.info('[RenderPipeline] 描画後に INVALID_FRAMEBUFFER_OPERATION を検出しました。次のフレームで再確認します。');
        return; // needsValidation は true のまま
      case 'bufferFailure':
        if (verdict.unrelated.length > 0) this.logUnrelatedGlErrors(verdict.unrelated, '描画後');
        this.reportFailure(`GLエラー INVALID_FRAMEBUFFER_OPERATION（${verdict.streak}フレーム連続）`);
        return;
    }
  }

  /** バッファの失敗の根拠にしない GL エラーをログに出す（握りつぶさない。同じ種類は1回だけ） */
  private logUnrelatedGlErrors(codes: readonly number[], when: string): void {
    const fresh = codes.map(glErrorName).filter((name) => !this.reportedGlErrors.has(name));
    if (fresh.length === 0) return;
    for (const name of fresh) this.reportedGlErrors.add(name);
    const memory = codes.includes(GL_OUT_OF_MEMORY) ? ' OUT_OF_MEMORY はメモリ不足の可能性があります（D2 の画質の自動調整で扱う予定）。' : '';
    console.warn(
      `[RenderPipeline] ${when}に GL エラー ${fresh.join(', ')} を検出しました。描画バッファとは無関係の可能性があるため、HDR/MSAA のフォールバックの根拠にはしません。${memory}（同じ種類のエラーは以後表示しません）`,
    );
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

  private readonly handleContextLost = (e: Event): void => {
    // preventDefault しないと復帰イベントが来ない（three.js 側でも呼ばれる）
    e.preventDefault();
    this.contextLost = true;
    console.warn('[RenderPipeline] WebGLコンテキストが失われました。GPU資源を解放して復帰を待ちます。');
    // 喪失中（GL の呼び出しが何もしない状態）に、喪失前の資源をすべて解放しておく。
    // 復帰後に解放すると、古いコンテキストの GL オブジェクトを削除しようとして警告が出るため。
    this.composer.dispose(); // renderTarget1/2 とコピー用パス
    for (const pass of this.composer.passes) pass.dispose(); // Bloom の作業バッファ・各パスのマテリアル
    releaseSceneGpuResources(this.renderPass.scene); // ジオメトリ・マテリアル・テクスチャ・影マップ
    for (const l of [...this.lostListeners]) {
      try {
        l();
      } catch (error) {
        console.error('[RenderPipeline] コンテキスト喪失時の処理でエラーが発生しました', error);
      }
    }
  };

  private readonly handleContextRestored = (): void => {
    this.contextLost = false;
    // 新しいコンテキストで同じ組み合わせが使えるとは限らないため、次の描画で再検証する
    this.needsValidation = true;
    console.info('[RenderPipeline] WebGLコンテキストが復帰しました。次の描画で資源を作り直します。');
    for (const l of [...this.restoredListeners]) {
      try {
        l();
      } catch (error) {
        // 1つの処理の失敗で他の資源の作り直しを止めない（エラーは隠さず出力する）
        console.error('[RenderPipeline] コンテキスト復帰後の処理でエラーが発生しました', error);
      }
    }
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
