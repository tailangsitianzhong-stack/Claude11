import { describe, expect, it } from 'vitest';
import { Box3, Color, Matrix4, Vector3 } from 'three';
import { BANNER, Banners, bannerAnglesDeg, createBannerGeometry } from '../src/stage/stages/colosseum/banners';
import { COLOSSEUM, STANDS_TOP_Y } from '../src/stage/stages/colosseum/layout';
import { PALETTE } from '../src/stage/stages/colosseum/palette';

describe('バナー（A2-3 CP3）', () => {
  it('18枚、区画の境目（柱）のうち1つおき（20°おき）。先頭の9枚も1つおき（40°おき）', () => {
    const a = bannerAnglesDeg();
    expect(a).toHaveLength(18);
    const sorted = [...a].sort((x, y) => x - y);
    for (let i = 0; i < sorted.length; i++) {
      expect(sorted[i]! % 10).toBeCloseTo(5, 9); // 区画の境目（5° + 10°×i）
      if (i > 0) expect(sorted[i]! - sorted[i - 1]!).toBeCloseTo(20, 9);
    }
    const first9 = a.slice(0, 9).sort((x, y) => x - y);
    for (let i = 1; i < 9; i++) expect(first9[i]! - first9[i - 1]!).toBeCloseTo(40, 9);
  });

  it('大きさ：幅1.6m・長さ4.4m（下端の三角を含めて）、回廊の床より上、外壁の上端より下', () => {
    const g = createBannerGeometry();
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.max.x - b.min.x).toBeCloseTo(BANNER.width, 6);
    expect(b.max.y).toBeCloseTo(0, 6);
    expect(-b.min.y).toBeCloseTo(BANNER.length, 6);
    expect(BANNER.top - BANNER.length).toBeGreaterThan(STANDS_TOP_Y + 0.3);
    expect(BANNER.top).toBeLessThan(COLOSSEUM.outerWallHeight - 0.28); // 上端の蛇腹の下
  });

  it('外壁の内側の面より内側（戦闘エリアの側）に垂らし、表は中心を向く', () => {
    const banners = new Banners();
    const m = new Matrix4();
    for (let i = 0; i < banners.mesh.count; i++) {
      banners.mesh.getMatrixAt(i, m);
      const p = new Vector3().setFromMatrixPosition(m);
      expect(Math.hypot(p.x, p.z)).toBeLessThan(COLOSSEUM.outerWallInnerRadius * Math.cos(Math.PI / COLOSSEUM.archBayCount) + 0.01);
      const facing = new Vector3(0, 0, 1).transformDirection(m);
      expect(facing.dot(new Vector3(-p.x, 0, -p.z).normalize())).toBeGreaterThan(0.999);
    }
    const box = new Box3().setFromObject(banners.mesh);
    expect(Math.max(box.max.x, box.max.z, -box.min.x, -box.min.z)).toBeLessThan(COLOSSEUM.outerWallInnerRadius);
  });

  it('色はブロンズ・深紅・群青の3色（減らした9枚にも3色がそろう）', () => {
    const banners = new Banners();
    const hexes = (n: number) => {
      const c = new Color();
      const set = new Set<string>();
      for (let i = 0; i < n; i++) {
        banners.mesh.getColorAt(i, c);
        set.add(c.getHexString());
      }
      return set;
    };
    const expected = new Set([PALETTE.banner.bronze, PALETTE.banner.crimson, PALETTE.banner.navy].map((h) => new Color(h).getHexString()));
    expect(hexes(18)).toEqual(expected);
    expect(hexes(9)).toEqual(expected);
  });

  it('背景の密度を下げた段階では9枚にして揺らさない（時間も進めない）。戻すと18枚で揺れる', () => {
    const banners = new Banners();
    banners.applyDensity(false);
    expect(banners.mesh.count).toBe(9);
    const t = banners.timeValue;
    banners.update(1);
    expect(banners.timeValue).toBe(t);
    banners.applyDensity(true);
    expect(banners.mesh.count).toBe(18);
    banners.update(1);
    expect(banners.timeValue).toBeCloseTo(t + 1, 9);
  });

  it('影は落とさず受けもしない', () => {
    const banners = new Banners();
    expect(banners.mesh.castShadow).toBe(false);
    expect(banners.mesh.receiveShadow).toBe(false);
  });
});
