import type { RenderStats } from '../render/RenderPipeline';
import type { QualityState } from '../platform/QualityManager';
import { presetForLevel, PRESET_LABELS } from '../platform/QualitySettings';

/**
 * 画面左上の統計表示。
 *
 * 計測を3つに分けて表示する：
 * - 起動：ページの読み込み開始から最初の描画が終わるまでの時間と、最初のフレームの処理時間
 *   （シェーダーの準備など。隠さずに別枠で表示する）
 * - ウォームアップ：起動直後・画質変更直後の一定時間。シェーダーやバッファの作り直しを含むため、
 *   通常の FPS 統計には含めず、その間の最大フレーム時間だけを別に表示する
 * - 通常：ウォームアップ後の FPS・平均・最大フレーム時間（0.5秒ごとに集計）
 */

/** 起動直後のウォームアップ（秒） */
export const STARTUP_WARMUP_SEC = 1.0;
/** 画質変更直後のウォームアップ（秒） */
export const CHANGE_WARMUP_SEC = 0.5;
const WINDOW_SEC = 0.5;

/** 計測ロジック（DOM に依存しない。テスト対象） */
export class FrameStatsMeter {
  /** ページ読み込み開始から最初の描画完了まで（ms） */
  startupMs: number | null = null;
  /** 最初のフレームの処理時間（ms） */
  firstFrameMs: number | null = null;

  private warmupRemaining = 0;
  private warmupReason: string | null = null;
  /** 直近のウォームアップ期間中の最大フレーム時間（ms） */
  lastWarmupMaxMs = 0;
  private warmupMax = 0;

  private frames = 0;
  private elapsed = 0;
  private worst = 0;
  /** 直近の集計結果（ウォームアップ後のみ。まだ無ければ null） */
  result: { fps: number; avgMs: number; maxMs: number } | null = null;

  recordStartup(startupMs: number, firstFrameMs: number): void {
    this.startupMs = startupMs;
    this.firstFrameMs = firstFrameMs;
    this.beginWarmup('起動直後', STARTUP_WARMUP_SEC);
  }

  /** ウォームアップを開始する（通常統計はリセットする） */
  beginWarmup(reason: string, seconds: number): void {
    this.warmupRemaining = Math.max(this.warmupRemaining, seconds);
    this.warmupReason = reason;
    this.warmupMax = 0;
    this.frames = 0;
    this.elapsed = 0;
    this.worst = 0;
  }

  get warmingUp(): string | null {
    return this.warmupRemaining > 0 ? this.warmupReason : null;
  }

  /** 1フレームを記録する。集計結果が更新されたら true */
  push(frameDt: number): boolean {
    if (frameDt <= 0) return false;
    if (this.warmupRemaining > 0) {
      this.warmupRemaining -= frameDt;
      this.warmupMax = Math.max(this.warmupMax, frameDt * 1000);
      if (this.warmupRemaining <= 0) {
        this.warmupRemaining = 0;
        this.lastWarmupMaxMs = this.warmupMax;
        this.result = null;
      }
      return false;
    }
    this.frames++;
    this.elapsed += frameDt;
    this.worst = Math.max(this.worst, frameDt * 1000);
    if (this.elapsed < WINDOW_SEC) return false;
    this.result = {
      fps: this.frames / this.elapsed,
      avgMs: (this.elapsed / this.frames) * 1000,
      maxMs: this.worst,
    };
    this.frames = 0;
    this.elapsed = 0;
    this.worst = 0;
    return true;
  }
}

export class StatsOverlay {
  private readonly el: HTMLDivElement;
  readonly meter = new FrameStatsMeter();
  private sinceDraw = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'stats-overlay';
    this.el.setAttribute('data-testid', 'stats');
    this.el.textContent = '起動中…';
    parent.appendChild(this.el);
  }

  setVisible(v: boolean): void {
    this.el.style.display = v ? '' : 'none';
  }

  frame(frameDt: number, stats: RenderStats, quality: QualityState): void {
    const updated = this.meter.push(frameDt);
    this.sinceDraw += Math.max(frameDt, 0);
    // 集計が更新されたとき、またはウォームアップ中は 0.25 秒ごとに表示を更新する
    if (!updated && this.sinceDraw < 0.25) return;
    this.sinceDraw = 0;
    this.el.textContent = this.compose(stats, quality);
  }

  private compose(stats: RenderStats, quality: QualityState): string {
    const m = this.meter;
    const preset = presetForLevel(quality.level);
    const q = quality.settings;
    const lines: string[] = [];

    const warm = m.warmingUp;
    if (warm) {
      lines.push(`FPS 計測準備中（${warm}）`);
    } else if (m.result) {
      const r = m.result;
      lines.push(`FPS ${r.fps.toFixed(0)}  (平均 ${r.avgMs.toFixed(1)}ms / 最大 ${r.maxMs.toFixed(1)}ms)`);
    } else {
      lines.push('FPS 計測中…');
    }
    if (m.startupMs !== null && m.firstFrameMs !== null) {
      lines.push(
        `起動 ${(m.startupMs / 1000).toFixed(2)}s（初回フレーム ${m.firstFrameMs.toFixed(0)}ms）` +
          (m.lastWarmupMaxMs > 0 ? `  準備期間の最大 ${m.lastWarmupMaxMs.toFixed(0)}ms` : ''),
      );
    }
    lines.push(`描画コール ${stats.drawCalls}  ポリゴン ${stats.triangles.toLocaleString()}`);
    lines.push(
      `画質 段階${quality.level}${preset ? `（${PRESET_LABELS[preset]}）` : ''}  上限 ${quality.frameRateMode}fps`,
    );
    lines.push(
      `解像度 ${stats.bufferWidth}×${stats.bufferHeight} (×${stats.pixelRatio.toFixed(2)}` +
        ` / 端末 ×${stats.devicePixelRatio.toFixed(2)})`,
    );
    const msaa =
      stats.msaaSamples === stats.requestedMsaa
        ? `MSAA ×${stats.msaaSamples}`
        : `MSAA ×${stats.msaaSamples}（要求 ×${stats.requestedMsaa}）`;
    lines.push(`${msaa}  影 ${q.shadowMapSize}  Bloom ${stats.bloom ? 'ON' : 'OFF'}  ${stats.hdr ? 'HDR' : '8bit'}`);
    if (stats.fallbackNote) lines.push(`バッファ: ${stats.fallbackNote}`);
    if (stats.bufferStatus === 'validating') lines.push('バッファ検証中…');
    if (stats.contextLost) lines.push('WebGLコンテキスト喪失中（復帰待ち）');
    return lines.join('\n');
  }
}
