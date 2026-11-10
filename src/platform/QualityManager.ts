import {
  MAX_QUALITY_LEVEL,
  PRESET_LEVELS,
  clampQualityLevel,
  settingsForLevel,
  type FrameRateMode,
  type QualityLevelSettings,
  type QualityPreset,
} from './QualitySettings';

/**
 * 画質の現在値を保持し、変更を各システムへ通知する。
 *
 * A1 の範囲：手動の画質プリセット・段階・30fpsモードの切り替えのみ。
 * 次の機能は D2 で実装する（設計は docs/DESIGN_DECISIONS.md に記録）。
 *   - フレーム時間の計測による自動調整、30fpsモードの提案
 *   - 画質設定の保存と次回起動時の読み込み
 *   - 端末に応じた初期画質の推定
 */

/**
 * 初期画質（明示的な固定値）。
 * PC・スマホ共通で「中」（段階3）から始める。必要に応じて URL パラメータや開発パネルで変更する。
 */
export const DEFAULT_QUALITY_LEVEL = PRESET_LEVELS.medium;
export const DEFAULT_FRAME_RATE_MODE: FrameRateMode = 60;

export interface QualityState {
  level: number;
  frameRateMode: FrameRateMode;
  settings: Readonly<QualityLevelSettings>;
}

export type QualityListener = (state: QualityState) => void;

export class QualityManager {
  private level: number;
  private frameRateMode: FrameRateMode;
  private settings: QualityLevelSettings;
  private readonly listeners = new Set<QualityListener>();

  constructor(initial: { level: number; frameRateMode: FrameRateMode }) {
    this.level = clampQualityLevel(initial.level);
    this.frameRateMode = initial.frameRateMode;
    this.settings = settingsForLevel(this.level);
  }

  /**
   * 初期値の決定：
   * 1. URLパラメータ（?quality=high|medium|low|0〜9, ?fps=30|60）— 確認・テスト用
   * 2. 固定の初期値（DEFAULT_QUALITY_LEVEL / DEFAULT_FRAME_RATE_MODE）
   */
  static fromUrl(search: string): QualityManager {
    const params = new URLSearchParams(search);
    return new QualityManager({
      level: parseLevel(params.get('quality')) ?? DEFAULT_QUALITY_LEVEL,
      frameRateMode: parseFps(params.get('fps')) ?? DEFAULT_FRAME_RATE_MODE,
    });
  }

  get state(): QualityState {
    return { level: this.level, frameRateMode: this.frameRateMode, settings: this.settings };
  }

  get maxLevel(): number {
    return MAX_QUALITY_LEVEL;
  }

  setLevel(level: number): void {
    const next = clampQualityLevel(level);
    if (next === this.level) return;
    this.level = next;
    this.settings = settingsForLevel(next);
    this.emit();
  }

  setPreset(preset: QualityPreset): void {
    this.setLevel(PRESET_LEVELS[preset]);
  }

  /** 30fpsモードの手動切り替え */
  setFrameRateMode(mode: FrameRateMode): void {
    if (mode === this.frameRateMode) return;
    this.frameRateMode = mode;
    this.emit();
  }

  /** 登録時に現在値で一度呼び出す */
  subscribe(listener: QualityListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const state = this.state;
    for (const l of this.listeners) l(state);
  }
}

export function parseLevel(raw: string | null): number | null {
  if (raw === null || raw === '') return null;
  if (Object.prototype.hasOwnProperty.call(PRESET_LEVELS, raw)) return PRESET_LEVELS[raw as QualityPreset];
  const n = Number(raw);
  return Number.isFinite(n) ? clampQualityLevel(n) : null;
}

export function parseFps(raw: string | null): FrameRateMode | null {
  if (raw === '30') return 30;
  if (raw === '60') return 60;
  return null;
}
