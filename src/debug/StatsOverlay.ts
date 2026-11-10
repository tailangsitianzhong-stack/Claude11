import type { RenderStats } from '../render/RenderPipeline';
import type { QualityState } from '../platform/QualityManager';
import { presetForLevel, PRESET_LABELS } from '../platform/QualitySettings';

/**
 * 画面左上の統計表示（FPS・フレーム時間・描画コール数・画質）。
 * 0.5秒ごとに集計して更新する（毎フレームDOMを書き換えない）。
 */
export class StatsOverlay {
  private readonly el: HTMLDivElement;
  private frames = 0;
  private elapsed = 0;
  private worstMs = 0;
  private fps = 0;
  private avgMs = 0;
  private worst = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'stats-overlay';
    this.el.setAttribute('data-testid', 'stats');
    parent.appendChild(this.el);
  }

  setVisible(v: boolean): void {
    this.el.style.display = v ? '' : 'none';
  }

  frame(frameDt: number, stats: RenderStats, quality: QualityState): void {
    if (frameDt <= 0) return;
    this.frames++;
    this.elapsed += frameDt;
    this.worstMs = Math.max(this.worstMs, frameDt * 1000);
    if (this.elapsed < 0.5) return;

    this.fps = this.frames / this.elapsed;
    this.avgMs = (this.elapsed / this.frames) * 1000;
    this.worst = this.worstMs;
    this.frames = 0;
    this.elapsed = 0;
    this.worstMs = 0;

    const preset = presetForLevel(quality.level);
    const q = quality.settings;
    this.el.textContent = [
      `FPS ${this.fps.toFixed(0)}  (${this.avgMs.toFixed(1)}ms / 最大 ${this.worst.toFixed(1)}ms)`,
      `描画コール ${stats.drawCalls}  ポリゴン ${stats.triangles.toLocaleString()}`,
      `画質 段階${quality.level}${preset ? `（${PRESET_LABELS[preset]}）` : ''}  上限 ${quality.frameRateMode}fps`,
      `解像度 ${stats.bufferWidth}×${stats.bufferHeight} (×${stats.pixelRatio.toFixed(2)})`,
      `MSAA ×${stats.msaaSamples}  影 ${q.shadowMapSize}  Bloom ${stats.bloom ? 'ON' : 'OFF'}  ${stats.hdr ? 'HDR' : '8bit'}`,
    ].join('\n');
  }
}
