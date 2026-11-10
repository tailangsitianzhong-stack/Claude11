import { describe, expect, it } from 'vitest';
import { fitDistance } from '../src/debug/DevCamera';

describe('確認用カメラ：全景の距離', () => {
  const R = 40; // 外壁まで含めた半径（A2-3 以降）

  it('横長の画面では縦の視野角で決まる', () => {
    const d = fitDistance(R, 45, 16 / 9);
    expect(d).toBeCloseTo(R / Math.sin((22.5 * Math.PI) / 180), 6);
  });

  it('縦長の画面（スマホの縦）では横の視野角で決まり、距離が長くなる', () => {
    const portrait = fitDistance(R, 45, 390 / 844);
    const landscape = fitDistance(R, 45, 844 / 390);
    expect(portrait).toBeGreaterThan(landscape);
    // 横の視野角に球が収まっていること
    const hfov = 2 * Math.atan(Math.tan((22.5 * Math.PI) / 180) * (390 / 844));
    expect(R / portrait).toBeCloseTo(Math.sin(hfov / 2), 6);
  });

  it('外壁（半径38、高さ12）を含む球が、どの縦横比でも収まる距離になる', () => {
    for (const aspect of [0.46, 0.75, 1, 1.78, 2.17]) {
      const d = fitDistance(R, 45, aspect);
      expect(d).toBeGreaterThan(R);
      expect(d).toBeLessThan(400); // 遠くの描画範囲（far=3000）に十分収まる
    }
  });
});
