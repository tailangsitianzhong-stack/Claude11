import type { RenderStats } from '../render/RenderPipeline';
import type { QualityState } from '../platform/QualityManager';
import { presetForLevel, PRESET_LABELS } from '../platform/QualitySettings';

/**
 * 画面左上の統計表示。
 *
 * 計測を4つに分けて表示する（どれも隠さない）：
 * - 起動：ページの読み込み開始から最初の描画が終わるまでの時間と、最初のフレームの処理時間
 * - 準備期間：起動直後・画質変更直後・タブ復帰直後など。シェーダーやバッファの準備を含むため、
 *   通常の FPS 統計には含めず、その間の最大フレーム時間だけを別に表示する。
 *   「一定時間 かつ 一定フレーム数」の両方を満たすまで続く（GPU の初回処理の停止を取りこぼさないため）
 * - 長い停止：準備期間の後に起きた、極端に長いフレーム（1秒以上、または直近の通常フレームの中央値の10倍以上）。
 *   通常の FPS には含めず、回数と最大時間を必ず表示する
 * - 通常：上記を除いたフレームの FPS・平均・最大フレーム時間。
 *   「0.5秒以上 かつ 10フレーム以上」たまるごとに集計する（FPS = 1000 ÷ 平均フレーム時間）
 *
 * D2（画質の自動調整）では、通常の統計（result）を性能の判断に使い、長い停止（stalls）は
 * シェーダーの準備などの一時的な停止として別に扱う（停止だけで画質を下げない）。
 */

/** 準備期間の終了条件（時間とフレーム数の両方を満たしたら終了） */
export interface WarmupSpec {
  seconds: number;
  frames: number;
}
/** 起動直後の準備期間 */
export const STARTUP_WARMUP: Readonly<WarmupSpec> = Object.freeze({ seconds: 1.0, frames: 30 });
/** 画質変更・画面サイズ変更・タブ復帰の直後の準備期間 */
export const CHANGE_WARMUP: Readonly<WarmupSpec> = Object.freeze({ seconds: 0.5, frames: 15 });

/** 通常の統計の集計窓（両方を満たしたら集計する） */
export const WINDOW_MIN_SEC = 0.5;
export const WINDOW_MIN_FRAMES = 10;

/** 時間の比較の許容誤差（秒）。1/60 を30回足すと 0.5 にわずかに届かない、といった浮動小数点の誤差を吸収する */
const TIME_EPSILON = 1e-9;

/** 長い停止の判定 */
export const STALL_ABSOLUTE_MS = 1000;
export const STALL_MEDIAN_FACTOR = 10;
/** 中央値による判定に必要な、直近の通常フレームの数（足りなければ 1秒以上 の条件だけを使う） */
export const STALL_MEDIAN_MIN_SAMPLES = 10;
/** 中央値の計算に使う直近の通常フレームの数 */
export const STALL_MEDIAN_HISTORY = 30;

export interface FrameWindowResult {
  fps: number;
  avgMs: number;
  maxMs: number;
  frames: number;
}

export interface StallStats {
  count: number;
  maxMs: number;
  lastMs: number;
}

/** FPS の表示：10未満は小数第1位まで、10以上は整数 */
export function formatFps(fps: number): string {
  return fps < 9.95 ? fps.toFixed(1) : fps.toFixed(0);
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** 計測ロジック（DOM・実時間に依存しない。フレーム時間を与えて動かす。テスト対象） */
export class FrameStatsMeter {
  /** ページ読み込み開始から最初の描画完了まで（ms） */
  startupMs: number | null = null;
  /** 最初のフレームの処理時間（ms） */
  firstFrameMs: number | null = null;

  private warmupSecLeft = 0;
  private warmupFramesLeft = 0;
  private warmupReason: string | null = null;
  private warmupMax = 0;
  /** 直近の準備期間中の最大フレーム時間（ms） */
  lastWarmupMaxMs = 0;

  private frames = 0;
  private elapsed = 0;
  private worst = 0;
  private readonly recentNormalMs: number[] = [];
  private readonly stallStats: StallStats = { count: 0, maxMs: 0, lastMs: 0 };

  /** 直近の通常の統計（準備期間・長い停止を除く）。まだ無ければ null */
  result: FrameWindowResult | null = null;

  recordStartup(startupMs: number, firstFrameMs: number): void {
    this.startupMs = startupMs;
    this.firstFrameMs = firstFrameMs;
    this.beginWarmup('起動直後', STARTUP_WARMUP);
  }

  /**
   * 準備期間を開始する。集計途中の通常の統計と、中央値の履歴はリセットする（速度が変わる可能性があるため）。
   * 準備期間中に重ねて呼ばれた場合は、残り時間・残りフレーム数の長い方を採る。
   */
  beginWarmup(reason: string, spec: Readonly<WarmupSpec>): void {
    if (this.warmupReason === null) this.warmupMax = 0;
    this.warmupSecLeft = Math.max(this.warmupSecLeft, spec.seconds);
    this.warmupFramesLeft = Math.max(this.warmupFramesLeft, spec.frames);
    this.warmupReason = reason;
    this.frames = 0;
    this.elapsed = 0;
    this.worst = 0;
    this.recentNormalMs.length = 0;
  }

  get warmingUp(): string | null {
    return this.warmupReason;
  }

  /** 長い停止の統計（回数・最大・直近）。準備期間中の停止は含まない */
  get stalls(): Readonly<StallStats> {
    return this.stallStats;
  }

  /** 中央値による停止の判定に使える、直近の通常フレームの中央値（足りなければ null） */
  get normalMedianMs(): number | null {
    return this.recentNormalMs.length >= STALL_MEDIAN_MIN_SAMPLES ? median(this.recentNormalMs) : null;
  }

  /** そのフレーム時間が「長い停止」に当たるか */
  isStall(frameMs: number): boolean {
    if (frameMs >= STALL_ABSOLUTE_MS) return true;
    const med = this.normalMedianMs;
    return med !== null && frameMs >= med * STALL_MEDIAN_FACTOR;
  }

  /** 1フレームを記録する（frameDt は秒）。表示を更新すべき変化があれば true */
  push(frameDt: number): boolean {
    if (!(frameDt > 0)) return false;
    const ms = frameDt * 1000;

    if (this.warmupReason !== null) {
      this.warmupSecLeft -= frameDt;
      this.warmupFramesLeft -= 1;
      this.warmupMax = Math.max(this.warmupMax, ms);
      if (this.warmupSecLeft <= TIME_EPSILON && this.warmupFramesLeft <= 0) {
        this.warmupSecLeft = 0;
        this.warmupFramesLeft = 0;
        this.warmupReason = null;
        this.lastWarmupMaxMs = this.warmupMax;
        this.result = null;
        return true;
      }
      return false;
    }

    if (this.isStall(ms)) {
      this.stallStats.count++;
      this.stallStats.maxMs = Math.max(this.stallStats.maxMs, ms);
      this.stallStats.lastMs = ms;
      return true;
    }

    this.recentNormalMs.push(ms);
    if (this.recentNormalMs.length > STALL_MEDIAN_HISTORY) this.recentNormalMs.shift();
    this.frames++;
    this.elapsed += frameDt;
    this.worst = Math.max(this.worst, ms);
    if (this.elapsed < WINDOW_MIN_SEC - TIME_EPSILON || this.frames < WINDOW_MIN_FRAMES) return false;
    this.result = {
      fps: this.frames / this.elapsed,
      avgMs: (this.elapsed / this.frames) * 1000,
      maxMs: this.worst,
      frames: this.frames,
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

  /** notes：ステージなど描画パイプライン以外からの注意書き（代わりの床・環境マップなし など） */
  frame(frameDt: number, stats: RenderStats, quality: QualityState, notes: readonly string[] = []): void {
    const updated = this.meter.push(frameDt);
    this.sinceDraw += Math.max(frameDt, 0);
    // 集計が更新されたとき、またはウォームアップ中は 0.25 秒ごとに表示を更新する
    if (!updated && this.sinceDraw < 0.25) return;
    this.sinceDraw = 0;
    this.el.textContent = this.compose(stats, quality, notes);
  }

  private compose(stats: RenderStats, quality: QualityState, notes: readonly string[]): string {
    const m = this.meter;
    const preset = presetForLevel(quality.level);
    const q = quality.settings;
    const lines: string[] = [];

    const warm = m.warmingUp;
    if (warm) {
      lines.push(`FPS 計測準備中（${warm}）`);
    } else if (m.result) {
      const r = m.result;
      lines.push(`FPS ${formatFps(r.fps)}  (平均 ${r.avgMs.toFixed(1)}ms / 最大 ${r.maxMs.toFixed(1)}ms)`);
    } else {
      lines.push('FPS 計測中…');
    }
    // 長い停止は通常の FPS から除外しているため、起きたことを必ず表示する
    const st = m.stalls;
    lines.push(st.count > 0 ? `停止 ${st.count}回（最大 ${(st.maxMs / 1000).toFixed(1)}s）` : '停止 なし');
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
    for (const n of notes) lines.push(n);
    return lines.join('\n');
  }
}
