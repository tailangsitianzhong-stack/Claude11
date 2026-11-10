/**
 * 画質の段階（ラダー）定義。
 *
 * 段階0（最高）から1段階ずつ、見た目への影響が小さい順に負荷を下げる。
 * 自動調整（チェックポイントDで実装）は1段階ずつ移動し、
 * 手動設定の「高・中・低」はこのラダー上の特定の段階を指す。
 */

export type MsaaSamples = 0 | 2 | 4;
export type BackgroundDensity = 'full' | 'reduced';

export interface QualityLevelSettings {
  /** devicePixelRatio の上限 */
  pixelRatioCap: number;
  /** 描画バッファのMSAAサンプル数 */
  msaaSamples: MsaaSamples;
  /** 太陽光の影マップの解像度 */
  shadowMapSize: number;
  /** 影の輪郭のぼかし（PCFのサンプリング半径） */
  shadowRadius: number;
  /** ステージの柱などが影を落とすか（false ならキャラクターの影のみ） */
  stageShadows: boolean;
  /** Bloom の有無 */
  bloom: boolean;
  /** キャラクターの輪郭線 */
  outline: boolean;
  /** 背景の装飾の密度 */
  backgroundDensity: BackgroundDensity;
}

export interface QualityStep {
  /** この段階で何を変えたか（デバッグ表示用） */
  label: string;
  apply(s: QualityLevelSettings): void;
}

export const BASE_QUALITY: Readonly<QualityLevelSettings> = Object.freeze({
  pixelRatioCap: 2.0,
  msaaSamples: 4,
  shadowMapSize: 2048,
  shadowRadius: 3,
  stageShadows: true,
  bloom: true,
  outline: true,
  backgroundDensity: 'full',
});

/** 段階1〜9で順に適用する変更（設計書 1-3 の表と同じ順） */
export const QUALITY_STEPS: readonly QualityStep[] = [
  { label: '描画倍率の上限 2.0→1.5', apply: (s) => void (s.pixelRatioCap = 1.5) },
  { label: 'Bloom オフ', apply: (s) => void (s.bloom = false) },
  { label: '影 2048→1024', apply: (s) => void ((s.shadowMapSize = 1024), (s.shadowRadius = 2)) },
  { label: 'MSAA ×4→×2', apply: (s) => void (s.msaaSamples = 2) },
  { label: '描画倍率 1.5→1.25', apply: (s) => void (s.pixelRatioCap = 1.25) },
  {
    label: '柱の影オフ（キャラクターのみ・512）',
    apply: (s) => void ((s.stageShadows = false), (s.shadowMapSize = 512), (s.shadowRadius = 1)),
  },
  { label: '背景の密度を下げる', apply: (s) => void (s.backgroundDensity = 'reduced') },
  { label: '描画倍率 1.0・MSAA オフ', apply: (s) => void ((s.pixelRatioCap = 1.0), (s.msaaSamples = 0)) },
  { label: '輪郭線オフ', apply: (s) => void (s.outline = false) },
];

/** 最も低い画質の段階（= 9） */
export const MAX_QUALITY_LEVEL = QUALITY_STEPS.length;

export type QualityPreset = 'high' | 'medium' | 'low';

/** 手動設定のプリセットとラダー上の段階の対応 */
export const PRESET_LEVELS: Readonly<Record<QualityPreset, number>> = Object.freeze({
  high: 0,
  medium: 3,
  low: 7,
});

export const PRESET_LABELS: Readonly<Record<QualityPreset, string>> = Object.freeze({
  high: '高',
  medium: '中',
  low: '低',
});

export function clampQualityLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.min(Math.max(Math.round(level), 0), MAX_QUALITY_LEVEL);
}

/** 段階 level の設定を計算する（段階0から順に変更を積み重ねる） */
export function settingsForLevel(level: number): QualityLevelSettings {
  const clamped = clampQualityLevel(level);
  const s: QualityLevelSettings = { ...BASE_QUALITY };
  for (let i = 0; i < clamped; i++) QUALITY_STEPS[i]!.apply(s);
  return s;
}

/** 段階に一致するプリセット名（一致しなければ null） */
export function presetForLevel(level: number): QualityPreset | null {
  for (const key of Object.keys(PRESET_LEVELS) as QualityPreset[]) {
    if (PRESET_LEVELS[key] === level) return key;
  }
  return null;
}

/** 描画のフレームレート上限。60: 通常 / 30: 30fpsモード */
export type FrameRateMode = 60 | 30;
