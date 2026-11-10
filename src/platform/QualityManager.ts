import {
  MAX_QUALITY_LEVEL,
  PRESET_LEVELS,
  clampQualityLevel,
  settingsForLevel,
  type FrameRateMode,
  type QualityLevelSettings,
  type QualityPreset,
} from './QualitySettings';
import { storage } from './storage';

/**
 * 画質の現在値を保持し、変更を各システムへ通知する。
 *
 * チェックポイントA1 では手動設定のみ。
 * 自動調整（フレーム時間の計測・ヒステリシス・30fpsモードの提案）は D2 で追加する。
 */

export interface QualityState {
  level: number;
  frameRateMode: FrameRateMode;
  settings: Readonly<QualityLevelSettings>;
}

export type QualityListener = (state: QualityState) => void;

const STORAGE_KEY = 'arena.quality.v1';

interface StoredQuality {
  level: number;
  frameRateMode: FrameRateMode;
}

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
   * 初期値の決定（優先順）：
   * 1. URLパラメータ（?quality=high|medium|low|0〜9, ?fps=30|60）
   * 2. 前回保存した値
   * 3. 端末からの推定（主な入力が指の端末は「中」、それ以外は「高」）
   */
  static fromEnvironment(search: string = location.search): QualityManager {
    const params = new URLSearchParams(search);
    const stored = readStored();

    let level: number | null = parseLevel(params.get('quality'));
    if (level === null && stored) level = stored.level;
    if (level === null) level = isCoarsePointerDevice() ? PRESET_LEVELS.medium : PRESET_LEVELS.high;

    let fps: FrameRateMode | null = parseFps(params.get('fps'));
    if (fps === null && stored) fps = stored.frameRateMode;
    if (fps === null) fps = 60;

    return new QualityManager({ level, frameRateMode: fps });
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
    this.persist();
    this.emit();
  }

  setPreset(preset: QualityPreset): void {
    this.setLevel(PRESET_LEVELS[preset]);
  }

  /** 30fpsモードは手動でも選べる（設計 第4版 追加修正①） */
  setFrameRateMode(mode: FrameRateMode): void {
    if (mode === this.frameRateMode) return;
    this.frameRateMode = mode;
    this.persist();
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

  private persist(): void {
    const value: StoredQuality = { level: this.level, frameRateMode: this.frameRateMode };
    storage.set(STORAGE_KEY, JSON.stringify(value));
  }
}

export function parseLevel(raw: string | null): number | null {
  if (raw === null || raw === '') return null;
  if (raw in PRESET_LEVELS) return PRESET_LEVELS[raw as QualityPreset];
  const n = Number(raw);
  return Number.isFinite(n) ? clampQualityLevel(n) : null;
}

export function parseFps(raw: string | null): FrameRateMode | null {
  if (raw === '30') return 30;
  if (raw === '60') return 60;
  return null;
}

function readStored(): StoredQuality | null {
  const raw = storage.get(STORAGE_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredQuality>;
    if (typeof v.level !== 'number') return null;
    const fps = v.frameRateMode === 30 ? 30 : 60;
    return { level: clampQualityLevel(v.level), frameRateMode: fps };
  } catch {
    return null;
  }
}

function isCoarsePointerDevice(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}
