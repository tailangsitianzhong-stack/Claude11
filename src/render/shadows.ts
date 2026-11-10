import type { DirectionalLight } from 'three';
import type { QualityLevelSettings } from '../platform/QualitySettings';

/** 画質設定に合わせて太陽光の影マップを更新する */
export function applyShadowQuality(light: DirectionalLight, s: QualityLevelSettings): void {
  const shadow = light.shadow;
  shadow.radius = s.shadowRadius;
  if (shadow.mapSize.x !== s.shadowMapSize) {
    shadow.mapSize.set(s.shadowMapSize, s.shadowMapSize);
    // 解像度の変更は影マップの作り直しが必要。null にすると次の描画で再生成される
    shadow.map?.dispose();
    shadow.map = null;
  }
}
