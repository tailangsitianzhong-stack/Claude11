import { GameLoop } from './GameLoop';
import { RenderPipeline } from '../render/RenderPipeline';
import { ViewportManager } from '../platform/ViewportManager';
import { QualityManager } from '../platform/QualityManager';
import { CHANGE_WARMUP, StatsOverlay } from '../debug/StatsOverlay';
import { DevCamera } from '../debug/DevCamera';
import { ShaderErrorMonitor } from '../render/shaderErrors';
import { StageManager } from '../stage/StageManager';
import { DuskColosseum } from '../stage/stages/colosseum/ColosseumStage';
import { CharacterBody, STANDING_POSE } from '../character/CharacterBody';
import { APPEARANCE_A, APPEARANCE_B } from '../character/appearance';
import { BODY_A, BODY_B } from '../character/bodyProfile';
import { createDummySword } from '../character/dummySword';

/** 体型A（操作キャラクター）・体型B（ダミー）の位置（DESIGN_DECISIONS 9-3） */
const PLAYER_SPAWN = { x: 0, y: 0, z: 5 } as const;
const DUMMY_SPAWN = { x: 0, y: 0, z: -5 } as const;

/** 立ち姿で、位置に置き、アリーナの中心（もう1体の側）を向ける */
function standAt(body: CharacterBody, p: { x: number; y: number; z: number }): void {
  body.applyPoseDeg(STANDING_POSE);
  body.root.position.set(p.x, p.y, p.z);
  body.root.rotation.y = Math.atan2(-p.x, -p.z);
}

/**
 * ゲーム全体の組み立て役。
 * A2-1：描画パイプライン・画質・ループ・ステージ（Dusk Colosseum）・確認用カメラをつなぐ。
 * A3：キャラクターの身体（体型A・体型B のダミー）をアリーナに立たせる。入力（B1）・ゲームのカメラ（B3）は後の工程で接続する。
 */
export class Game {
  readonly quality: QualityManager;
  readonly viewport: ViewportManager;
  readonly pipeline: RenderPipeline;
  readonly loop: GameLoop;
  readonly stats: StatsOverlay;
  readonly shaderErrors: ShaderErrorMonitor;
  readonly stages: StageManager;
  /** 確認用カメラ（開発専用。ゲームのカメラは B3） */
  readonly devCamera: DevCamera;
  /** 操作キャラクターの身体（体型A。A3 では静止した立ち姿。動き・操作は B・C） */
  readonly player: CharacterBody;
  /** 操作しないダミー（体型B。ダミーの剣を右手に持つ） */
  readonly dummy: CharacterBody;
  private firstFrameDone = false;

  constructor(container: HTMLElement, options: { onFatal: (message: string) => void }) {
    this.quality = QualityManager.fromUrl(location.search);
    this.viewport = new ViewportManager(container);
    this.pipeline = new RenderPipeline(container);
    this.shaderErrors = new ShaderErrorMonitor(this.pipeline.renderer);
    this.stages = new StageManager(
      { renderer: this.pipeline.renderer, shaderErrors: this.shaderErrors },
      this.pipeline,
      this.quality.state.settings,
    );
    const stage = this.stages.load(DuskColosseum);
    // 体型A を (0, 0, 5)、体型B を (0, 0, -5) に、互いに向き合うように立たせる（DESIGN_DECISIONS 9-3）
    this.player = new CharacterBody(BODY_A, APPEARANCE_A);
    standAt(this.player, PLAYER_SPAWN);
    this.dummy = new CharacterBody(BODY_B, APPEARANCE_B);
    standAt(this.dummy, DUMMY_SPAWN);
    this.dummy.attach('weapon_R', createDummySword().root);
    stage.scene.add(this.player.root, this.dummy.root);
    this.devCamera = new DevCamera(this.pipeline.canvas, stage.view);
    this.pipeline.setView(stage.scene, this.devCamera.camera);
    this.stats = new StatsOverlay(container);

    this.loop = new GameLoop({
      update: (dt) => this.stages.update(dt),
      render: (frameDt) => {
        this.viewport.pollDevicePixelRatio(frameDt);
        this.devCamera.update();
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
        this.stats.frame(frameDt, this.pipeline.stats, this.quality.state, this.stageNotes());
      },
    });

    this.pipeline.onFatal((message) => {
      this.loop.stop();
      options.onFatal(message);
    });

    let initialViewport = true;
    this.viewport.subscribe((size) => {
      this.devCamera.setAspect(size.width / size.height);
      this.pipeline.setViewport(size);
      if (!initialViewport) this.stats.meter.beginWarmup('画面サイズ変更', CHANGE_WARMUP);
      initialViewport = false;
    });

    let initialQuality = true;
    this.quality.subscribe((state) => {
      this.pipeline.applyQuality(state.settings);
      this.stages.applyQuality(state.settings);
      this.player.applyQuality(state.settings);
      this.dummy.applyQuality(state.settings);
      this.loop.setMaxFps(state.frameRateMode === 30 ? 30 : null);
      if (!initialQuality) this.stats.meter.beginWarmup('画質変更', CHANGE_WARMUP);
      initialQuality = false;
    });

    // タブが非表示の間はループを止める（復帰時の巨大な経過時間は GameLoop 側でも切り詰める）
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.loop.stop();
      } else {
        this.loop.start();
        this.stats.meter.beginWarmup('タブ復帰', CHANGE_WARMUP);
      }
    });
  }

  /** 統計表示に出すステージの注意書き（開発用の項目を持たないステージでは出さない） */
  private stageNotes(): string[] {
    return this.stages.current?.dev?.notes() ?? [];
  }

  start(): void {
    this.loop.start();
  }
}
