import { GameLoop } from './GameLoop';
import { RenderPipeline } from '../render/RenderPipeline';
import { ViewportManager } from '../platform/ViewportManager';
import { QualityManager } from '../platform/QualityManager';
import { CHANGE_WARMUP_SEC, StatsOverlay } from '../debug/StatsOverlay';
import { TestScene } from '../debug/TestScene';

/**
 * ゲーム全体の組み立て役。
 * A1 では描画パイプライン・画質・ループ・仮シーンをつなぐだけ。
 * A2 以降で StageManager・キャラクター・入力・カメラをここに接続する。
 */
export class Game {
  readonly quality: QualityManager;
  readonly viewport: ViewportManager;
  readonly pipeline: RenderPipeline;
  readonly loop: GameLoop;
  readonly stats: StatsOverlay;
  /** 仮シーン（A2 でアリーナに置き換えて削除する） */
  private readonly view: TestScene;
  private firstFrameDone = false;

  constructor(container: HTMLElement, options: { onFatal: (message: string) => void }) {
    this.quality = QualityManager.fromUrl(location.search);
    this.viewport = new ViewportManager(container);
    this.pipeline = new RenderPipeline(container);
    this.view = new TestScene(this.pipeline.canvas);
    this.pipeline.setView(this.view.scene, this.view.camera);
    this.stats = new StatsOverlay(container);

    this.loop = new GameLoop({
      update: (dt) => this.view.update(dt),
      render: (frameDt) => {
        this.viewport.pollDevicePixelRatio(frameDt);
        this.view.updateView();
        if (!this.firstFrameDone) {
          // 初回フレーム（シェーダーの準備などを含む）の時間は通常の統計とは別に記録する
          const t0 = performance.now();
          this.pipeline.render();
          const t1 = performance.now();
          this.firstFrameDone = true;
          this.stats.meter.recordStartup(t1, t1 - t0);
        } else {
          this.pipeline.render();
        }
        this.stats.frame(frameDt, this.pipeline.stats, this.quality.state);
      },
    });

    this.pipeline.onFatal((message) => {
      this.loop.stop();
      options.onFatal(message);
    });

    let initialViewport = true;
    this.viewport.subscribe((size) => {
      this.view.setAspect(size.width / size.height);
      this.pipeline.setViewport(size);
      if (!initialViewport) this.stats.meter.beginWarmup('画面サイズ変更', CHANGE_WARMUP_SEC);
      initialViewport = false;
    });

    let initialQuality = true;
    this.quality.subscribe((state) => {
      this.pipeline.applyQuality(state.settings);
      this.view.applyQuality(state.settings);
      this.loop.setMaxFps(state.frameRateMode === 30 ? 30 : null);
      if (!initialQuality) this.stats.meter.beginWarmup('画質変更', CHANGE_WARMUP_SEC);
      initialQuality = false;
    });

    // タブが非表示の間はループを止める（復帰時の巨大な経過時間は GameLoop 側でも切り詰める）
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.loop.stop();
      } else {
        this.loop.start();
        this.stats.meter.beginWarmup('タブ復帰', CHANGE_WARMUP_SEC);
      }
    });
  }

  start(): void {
    this.loop.start();
  }
}
