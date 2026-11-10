import { GameLoop } from './GameLoop';
import { RenderPipeline } from '../render/RenderPipeline';
import { ViewportManager } from '../platform/ViewportManager';
import { QualityManager } from '../platform/QualityManager';
import { StatsOverlay } from '../debug/StatsOverlay';
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
  private readonly view: TestScene;

  constructor(container: HTMLElement) {
    this.quality = QualityManager.fromEnvironment();
    this.viewport = new ViewportManager(container);

    this.pipeline = new RenderPipeline(container);
    // 仮シーン（A2 でアリーナに置き換える）。カメラ操作は canvas に対して行う
    this.view = new TestScene(this.pipeline.canvas);
    this.pipeline.setView(this.view.scene, this.view.camera);

    this.stats = new StatsOverlay(container);

    this.loop = new GameLoop({
      update: (dt) => this.view.update(dt),
      render: (_alpha, frameDt) => {
        this.view.updateView();
        this.pipeline.render();
        this.stats.frame(frameDt, this.pipeline.stats, this.quality.state);
      },
    });

    this.viewport.subscribe((size) => {
      this.view.setAspect(size.width / size.height);
      this.pipeline.setViewport(size);
    });

    this.quality.subscribe((state) => {
      this.pipeline.applyQuality(state.settings);
      this.view.applyQuality(state.settings);
      this.loop.setMaxFps(state.frameRateMode === 30 ? 30 : null);
    });

    // タブが非表示の間はループを止める（復帰時の巨大な経過時間は GameLoop 側でも切り詰める）
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.loop.stop();
      else this.loop.start();
    });
  }

  start(): void {
    this.loop.start();
  }
}
