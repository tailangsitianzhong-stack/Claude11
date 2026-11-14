import { describe, expect, it } from 'vitest';
import {
  BASE_QUALITY,
  MAX_QUALITY_LEVEL,
  PRESET_LEVELS,
  QUALITY_STEPS,
  clampQualityLevel,
  presetForLevel,
  settingsForLevel,
} from '../src/platform/QualitySettings';
import {
  DEFAULT_FRAME_RATE_MODE,
  DEFAULT_QUALITY_LEVEL,
  QualityManager,
  parseFps,
  parseLevel,
} from '../src/platform/QualityManager';

/** 負荷の目安：大きいほど重い（段階が上がるごとに単調に減ることを確認する） */
function cost(level: number): number[] {
  const s = settingsForLevel(level);
  return [
    s.pixelRatioCap,
    s.msaaSamples,
    s.shadowMapSize,
    s.shadowRadius,
    s.stageShadows ? 1 : 0,
    s.bloom ? 1 : 0,
    s.outline ? 1 : 0,
    s.backgroundDensity === 'full' ? 1 : 0,
  ];
}

describe('画質の段階', () => {
  it('段階は0〜9の10段階', () => {
    expect(MAX_QUALITY_LEVEL).toBe(9);
    expect(QUALITY_STEPS).toHaveLength(9);
  });

  it('段階0は基準設定と同じ', () => {
    expect(settingsForLevel(0)).toEqual(BASE_QUALITY);
  });

  it('段階が上がるごとに、どの項目も負荷が増えず、少なくとも1項目は減る', () => {
    for (let l = 1; l <= MAX_QUALITY_LEVEL; l++) {
      const prev = cost(l - 1);
      const cur = cost(l);
      cur.forEach((v, i) => expect(v).toBeLessThanOrEqual(prev[i]!));
      // 例外：段階9は、意図的に追加の負荷軽減がない段階（A3 で輪郭線を段階7からオフにしたため。
      // 新しい設定は追加しない。DESIGN_DECISIONS 9-6）
      if (l === 9) continue;
      expect(cur.some((v, i) => v < prev[i]!)).toBe(true);
    }
  });

  it('設計書どおりの順番で変更される', () => {
    expect(settingsForLevel(1).pixelRatioCap).toBe(1.5);
    expect(settingsForLevel(2).bloom).toBe(false);
    expect(settingsForLevel(3).shadowMapSize).toBe(1024);
    expect(settingsForLevel(4).msaaSamples).toBe(2);
    expect(settingsForLevel(5).pixelRatioCap).toBe(1.25);
    expect(settingsForLevel(6)).toMatchObject({ stageShadows: false, shadowMapSize: 512 });
    expect(settingsForLevel(7).backgroundDensity).toBe('reduced');
    expect(settingsForLevel(8)).toMatchObject({ pixelRatioCap: 1, msaaSamples: 0 });
    // A3：輪郭線は段階7からオフ（段階0〜6 はオン）
    for (let lv = 0; lv <= 6; lv++) expect(settingsForLevel(lv).outline).toBe(true);
    for (let lv = 7; lv <= 9; lv++) expect(settingsForLevel(lv).outline).toBe(false);
  });

  it('プリセット 高・中・低 は段階 0・3・7', () => {
    expect(PRESET_LEVELS).toEqual({ high: 0, medium: 3, low: 7 });
    expect(presetForLevel(3)).toBe('medium');
    expect(presetForLevel(4)).toBeNull();
  });

  it('範囲外の段階は丸める', () => {
    expect(clampQualityLevel(-3)).toBe(0);
    expect(clampQualityLevel(42)).toBe(9);
    expect(clampQualityLevel(Number.NaN)).toBe(0);
    expect(clampQualityLevel(2.6)).toBe(3);
  });

  it('settingsForLevel は呼ぶたびに独立したオブジェクトを返す（基準設定を書き換えない）', () => {
    const a = settingsForLevel(9);
    a.pixelRatioCap = 99;
    expect(settingsForLevel(9).pixelRatioCap).toBe(1);
    expect(BASE_QUALITY.pixelRatioCap).toBe(2);
  });
});

describe('URLパラメータの解釈', () => {
  it('quality', () => {
    expect(parseLevel('high')).toBe(0);
    expect(parseLevel('medium')).toBe(3);
    expect(parseLevel('low')).toBe(7);
    expect(parseLevel('5')).toBe(5);
    expect(parseLevel('99')).toBe(9);
    expect(parseLevel('abc')).toBeNull();
    expect(parseLevel('toString')).toBeNull(); // オブジェクトの組み込みプロパティ名を誤って受け付けない
    expect(parseLevel(null)).toBeNull();
  });

  it('fps', () => {
    expect(parseFps('30')).toBe(30);
    expect(parseFps('60')).toBe(60);
    expect(parseFps('45')).toBeNull();
  });
});

describe('QualityManager（A1：手動切り替えのみ）', () => {
  it('URLパラメータが無ければ固定の初期値（段階3・60fps）で始まる', () => {
    const q = QualityManager.fromUrl('');
    expect(DEFAULT_QUALITY_LEVEL).toBe(3);
    expect(q.state.level).toBe(DEFAULT_QUALITY_LEVEL);
    expect(q.state.frameRateMode).toBe(DEFAULT_FRAME_RATE_MODE);
  });

  it('URLパラメータで初期値を指定できる', () => {
    const q = QualityManager.fromUrl('?quality=low&fps=30');
    expect(q.state.level).toBe(7);
    expect(q.state.frameRateMode).toBe(30);
  });

  it('変更を通知し、同じ値への変更は通知しない', () => {
    const q = QualityManager.fromUrl('?quality=0');
    const seen: number[] = [];
    q.subscribe((s) => seen.push(s.level));
    q.setLevel(5);
    q.setLevel(5);
    q.setPreset('low');
    q.setFrameRateMode(30);
    expect(seen).toEqual([0, 5, 7, 7]);
    expect(q.state.frameRateMode).toBe(30);
  });
});
