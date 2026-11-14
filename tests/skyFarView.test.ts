import { describe, expect, it } from 'vitest';
import { Box3 } from 'three';
import { SKY_DOME_RADIUS, SkyDome, createSkyMaterial } from '../src/stage/stages/colosseum/sky';
import { FarView, createCityGeometry, createHillsGeometry } from '../src/stage/stages/colosseum/farView';
import { DEFAULT_SUN, sunDirection } from '../src/stage/stages/colosseum/lighting';
import { DEV_CAMERA_FOV, fitDistance } from '../src/debug/DevCamera';
import { BUILT_OVERVIEW } from '../src/stage/stages/colosseum/layout';

describe('空のドーム（A2-3 CP2）', () => {
  it('霧の影響を受けず、奥行き情報を書き込まず、最初に描く', () => {
    const dome = new SkyDome();
    const mat = dome.mesh.material as ReturnType<typeof createSkyMaterial>;
    expect(mat.fog).toBe(false);
    expect(mat.depthWrite).toBe(false);
    expect(dome.mesh.renderOrder).toBeLessThan(0);
    expect(dome.mesh.frustumCulled).toBe(false);
  });

  it('太陽の明るみは初期値（方位300°）で、太陽の向きの変更に追従する', () => {
    const dome = new SkyDome();
    const mat = dome.mesh.material as ReturnType<typeof createSkyMaterial>;
    expect(DEFAULT_SUN.azimuthDeg).toBe(300);
    expect(mat.uniforms.uSunDir.value.distanceTo(sunDirection(DEFAULT_SUN))).toBeLessThan(1e-9);
    dome.setSun({ elevationDeg: 20, azimuthDeg: 90 });
    expect(mat.uniforms.uSunDir.value.distanceTo(sunDirection({ elevationDeg: 20, azimuthDeg: 90 }))).toBeLessThan(1e-9);
  });

  it('ドームは全景のカメラ（縦長の画面を含む）より十分遠く、描画範囲（3000m）の内側', () => {
    const farthestCamera = fitDistance(BUILT_OVERVIEW.radius, DEV_CAMERA_FOV, 0.46) * 1.25; // 最大距離
    expect(SKY_DOME_RADIUS).toBeGreaterThan(farthestCamera * 3);
    expect(SKY_DOME_RADIUS).toBeLessThan(3000);
  });
});

describe('遠景（A2-3 CP2）', () => {
  it('丘（半径700）と街（半径1000）は十分に離れていて、ドームの内側', () => {
    const r = (b: Box3) => Math.max(b.max.x, b.max.z, -b.min.x, -b.min.z);
    const hills = createHillsGeometry();
    const city = createCityGeometry();
    hills.computeBoundingBox();
    city.computeBoundingBox();
    expect(r(hills.boundingBox!)).toBeCloseTo(700, 0);
    expect(r(city.boundingBox!)).toBeLessThanOrEqual(1000.01);
    expect(r(city.boundingBox!)).toBeLessThan(SKY_DOME_RADIUS);
    expect(hills.boundingBox!.min.y).toBeCloseTo(-0.5, 6); // 地面から立ち上がる
    expect(city.boundingBox!.min.y).toBeCloseTo(-0.5, 6);
  });

  it('背景の密度：通常は丘と街の2重、下げた段階では丘だけ', () => {
    const f = new FarView();
    f.applyDensity(true);
    expect([f.hills.visible, f.city.visible]).toEqual([true, true]);
    f.applyDensity(false);
    expect([f.hills.visible, f.city.visible]).toEqual([true, false]);
  });

  it('遠景は影を落とさず受けもしない', () => {
    for (const m of new FarView().meshes) {
      expect(m.castShadow).toBe(false);
      expect(m.receiveShadow).toBe(false);
    }
  });
});
