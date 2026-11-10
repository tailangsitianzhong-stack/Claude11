/**
 * 固定間隔（既定60Hz）のゲーム処理と、可変間隔の描画を分離するループ（A1 の基盤）。
 *
 * - update(dt) は常に固定の dt で呼ばれる（決定的な挙動・将来のオンライン対戦の土台）。
 * - render(frameDt) は描画フレームごとに呼ばれる。
 * - フレームレート上限（30fpsモード）を手動で設定できる。
 *
 * ティック間の描画補間（alpha）は B2 で実装する。
 * FixedStepAccumulator は端数の時間（accumulator）を保持しているので、
 * B2 では `accumulator / fixedDt` を補間係数として返す形で拡張できる。
 */

export interface FixedStepResult {
  /** このフレームで実行するティック数 */
  steps: number;
  /** 処理が追いつかず切り捨てた時間（秒） */
  droppedTime: number;
}

/** 経過時間を固定間隔のティックに分割する（純粋なロジック。テスト対象） */
export class FixedStepAccumulator {
  private accumulator = 0;

  constructor(
    readonly fixedDt: number,
    /** 1フレームで実行する最大ティック数（処理落ちの連鎖を防ぐ） */
    readonly maxSteps: number,
    /** 1フレームの経過時間の上限（タブ復帰時などの巨大な値を切り詰める） */
    readonly maxFrameTime = 0.25,
  ) {}

  advance(frameTime: number): FixedStepResult {
    const clamped = Math.min(Math.max(frameTime, 0), this.maxFrameTime);
    this.accumulator += clamped;

    let steps = Math.floor(this.accumulator / this.fixedDt + 1e-9);
    let droppedTime = Math.max(frameTime, 0) - clamped;
    if (steps > this.maxSteps) {
      droppedTime += (steps - this.maxSteps) * this.fixedDt;
      steps = this.maxSteps;
      // 実行しきれない分は捨てる（追いつこうとして処理落ちが連鎖するのを防ぐ）
      this.accumulator = this.accumulator % this.fixedDt;
    } else {
      this.accumulator -= steps * this.fixedDt;
    }
    if (this.accumulator < 0) this.accumulator = 0;

    return { steps, droppedTime };
  }

  reset(): void {
    this.accumulator = 0;
  }
}

/**
 * 描画フレームレートの上限。
 * 画面の更新(rAF)のうち、前回描画から十分な時間が経っていないものを読み飛ばす。
 */
export class FrameLimiter {
  private lastRenderTime: number | null = null;
  private minInterval = 0;

  /** 上限なしは null */
  setMaxFps(fps: number | null): void {
    this.minInterval = fps && fps > 0 ? 1000 / fps : 0;
  }

  /**
   * このrAFで描画すべきか。
   * 画面の更新間隔の揺らぎを考慮し、2msの許容幅を持たせる（30fps上限が20fpsに落ちるのを防ぐ）。
   */
  shouldRender(nowMs: number): boolean {
    if (this.lastRenderTime === null || this.minInterval === 0) {
      this.lastRenderTime = nowMs;
      return true;
    }
    if (nowMs - this.lastRenderTime >= this.minInterval - 2) {
      this.lastRenderTime = nowMs;
      return true;
    }
    return false;
  }

  reset(): void {
    this.lastRenderTime = null;
  }
}

export interface GameLoopCallbacks {
  /** 固定間隔のゲーム処理 */
  update(dt: number): void;
  /** 描画（frameDt: 前回描画からの実時間[秒]。初回は 0） */
  render(frameDt: number): void;
}

export class GameLoop {
  readonly fixedDt: number;
  private readonly accumulator: FixedStepAccumulator;
  private readonly limiter = new FrameLimiter();
  private rafId: number | null = null;
  private lastTime: number | null = null;

  constructor(
    private readonly callbacks: GameLoopCallbacks,
    options: { tickRate?: number; maxStepsPerFrame?: number } = {},
  ) {
    this.fixedDt = 1 / (options.tickRate ?? 60);
    this.accumulator = new FixedStepAccumulator(this.fixedDt, options.maxStepsPerFrame ?? 5);
  }

  setMaxFps(fps: number | null): void {
    this.limiter.setMaxFps(fps);
  }

  start(): void {
    if (this.rafId !== null) return;
    this.lastTime = null;
    this.limiter.reset();
    this.accumulator.reset();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  get running(): boolean {
    return this.rafId !== null;
  }

  private readonly frame = (now: number): void => {
    this.rafId = requestAnimationFrame(this.frame);
    if (!this.limiter.shouldRender(now)) return;

    const frameDt = this.lastTime === null ? 0 : (now - this.lastTime) / 1000;
    this.lastTime = now;

    const { steps } = this.accumulator.advance(frameDt);
    for (let i = 0; i < steps; i++) this.callbacks.update(this.fixedDt);
    this.callbacks.render(frameDt);
  };
}
