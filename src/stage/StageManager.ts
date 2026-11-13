import type { QualityLevelSettings } from '../platform/QualitySettings';
import type { StageContext, StageDefinition, StageInstance } from './StageDefinition';

/** RenderPipeline のうち、ステージ管理が使う機能（テストで差し替えられるように最小限にする） */
export interface StagePipelineHooks {
  onContextLost(listener: () => void): () => void;
  onContextRestored(listener: () => void): () => void;
}

/**
 * ステージの読み込み・切り替え・破棄と、画質・コンテキスト復帰の転送。
 * 一度に存在するステージは1つだけ。
 */
export class StageManager {
  private stage: StageInstance | null = null;
  private quality: Readonly<QualityLevelSettings>;
  private readonly unsubscribeLost: () => void;
  private readonly unsubscribeRestore: () => void;
  private disposed = false;

  constructor(
    private readonly context: Omit<StageContext, 'quality'>,
    pipeline: StagePipelineHooks,
    initialQuality: Readonly<QualityLevelSettings>,
  ) {
    this.quality = initialQuality;
    // 登録は StageManager ごとに1回だけ（ステージを切り替えても登録し直さない）
    this.unsubscribeLost = pipeline.onContextLost(() => this.stage?.releaseGpuResources());
    this.unsubscribeRestore = pipeline.onContextRestored(() => this.stage?.regenerateGpuResources());
  }

  get current(): StageInstance | null {
    return this.stage;
  }

  load(definition: StageDefinition): StageInstance {
    if (this.disposed) throw new Error('StageManager は破棄済みです');
    this.stage?.dispose();
    this.stage = null;
    const stage = definition.create({ ...this.context, quality: this.quality });
    stage.applyQuality(this.quality);
    this.stage = stage;
    return stage;
  }

  applyQuality(settings: Readonly<QualityLevelSettings>): void {
    this.quality = settings;
    this.stage?.applyQuality(settings);
  }

  update(dt: number): void {
    this.stage?.update(dt);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeLost();
    this.unsubscribeRestore();
    this.stage?.dispose();
    this.stage = null;
  }
}
