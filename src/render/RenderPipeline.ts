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
  type TextureDataType,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { QualityLevelSettings } from '../platform/QualitySettings';
import type { ViewportSize } from '../platform/ViewportManager';

/**
 * 描画の経路を一本化したパイプライン。
 *
 *   シーン → RenderPass（MSAA付きの描画バッファ）→ [UnrealBloomPass] → OutputPass（トーンマッピング・sRGB変換）→ 画面
 *
 * - canvas 側の antialias は作成後に変更できないため false とし、MSAA は描画バッファ側（samples）で行う。
 * - HDR（HalfFloat）の描画バッファが使えない端末では 8bit に切り替える。
 */

export interface RenderStats {
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  pixelRatio: number;
  bufferWidth: number;
  bufferHeight: number;
  msaaSamples: number;
  hdr: boolean;
  bloom: boolean;
}

export class RenderPipeline {
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly outputPass: OutputPass;
  private readonly hdr: boolean;

  private viewport: ViewportSize = { width: 1, height: 1 };
  private pixelRatioCap = 2;
  private msaaSamples = 0;
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

    this.hdr =
      r.extensions.has('EXT_color_buffer_half_float') || r.extensions.has('EXT_color_buffer_float');
    const type: TextureDataType = this.hdr ? HalfFloatType : UnsignedByteType;

    const target = new WebGLRenderTarget(1, 1, { type, samples: 0 });
    this.composer = new EffectComposer(r, target);

    // 描画対象は setView() で設定する
    this.renderPass = new RenderPass(new Scene(), new PerspectiveCamera());
    this.bloomPass = new UnrealBloomPass(
      new Vector2(1, 1),
      0.32, // 強さ：Phase 1 は控えめ（将来の必殺技演出で強める）
      0.45, // 広がり
      this.hdr ? 1.0 : 0.95, // しきい値：HDRでは明るさ1を超える発光部分だけが光る
    );
    this.outputPass = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.outputPass);

    this.canvas.addEventListener('webglcontextlost', (e) => {
      // preventDefault しないと復帰イベントが来ない
      e.preventDefault();
      this.contextLost = true;
      console.warn('[RenderPipeline] WebGLコンテキストが失われました。復帰を待ちます。');
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      console.info('[RenderPipeline] WebGLコンテキストが復帰しました。');
    });
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
    this.bloomPass.enabled = s.bloom;
    if (s.msaaSamples !== this.msaaSamples) {
      this.msaaSamples = s.msaaSamples;
      for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
        rt.samples = s.msaaSamples;
        // サンプル数の変更はバッファの作り直しが必要。dispose 後、次の描画で自動的に再生成される
        rt.dispose();
      }
    }
    this.applySize();
  }

  render(): void {
    if (this.contextLost) return;
    this.renderer.info.reset();
    this.composer.render();
  }

  get pixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, this.pixelRatioCap);
  }

  get stats(): RenderStats {
    const info = this.renderer.info;
    const pr = this.pixelRatio;
    return {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      pixelRatio: pr,
      bufferWidth: Math.floor(this.viewport.width * pr),
      bufferHeight: Math.floor(this.viewport.height * pr),
      msaaSamples: this.msaaSamples,
      hdr: this.hdr,
      bloom: this.bloomPass.enabled,
    };
  }

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
