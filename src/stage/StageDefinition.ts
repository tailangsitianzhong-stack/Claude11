import type { Scene, Vector3, WebGLRenderer } from 'three';
import type { QualityLevelSettings } from '../platform/QualitySettings';
import type { ShaderErrorMonitor } from '../render/shaderErrors';

/**
 * ステージの共通の約束事。
 * ステージごとの環境・照明・オブジェクトは、それぞれの StageInstance が所有し、独立して管理する。
 */

/** ステージ作成時に渡す描画環境 */
export interface StageContext {
  renderer: WebGLRenderer;
  shaderErrors: ShaderErrorMonitor;
  quality: Readonly<QualityLevelSettings>;
}

/**
 * ステージのゲーム上のデータ（A2 ではデータの定義のみ。境界・衝突の処理は B2／D1 で実装する）。
 */
export interface StageGameplayData {
  /** 戦闘の境界 */
  boundary: { shape: 'circle'; radius: number; behavior: 'wall' | 'ringOut' };
  /** 出現位置（床の上の点） */
  spawnPoints: readonly Vector3[];
  /** 歩ける床の高さ（A2 では平らな台座のみ） */
  floorHeight: number;
}

/**
 * 確認用カメラ（DevCamera）が使う情報。ゲームのカメラ（B3）の移動範囲とは別物。
 */
export interface StageViewData {
  /** 全景の注視点と、ステージ全体を包む球の半径（全景の距離の計算に使う） */
  overviewCenter: Vector3;
  overviewRadius: number;
  /** カメラが入ってよい最低の高さ（床・地面へのめり込み防止） */
  minCameraHeight: number;
}

export interface StageInstance {
  readonly id: string;
  readonly name: string;
  readonly scene: Scene;
  readonly gameplay: StageGameplayData;
  readonly view: StageViewData;
  /** 固定間隔のゲーム処理から呼ぶ（演出用のアニメーション） */
  update(dt: number): void;
  applyQuality(settings: Readonly<QualityLevelSettings>): void;
  /**
   * WebGL コンテキストを失った時点で呼ばれる。シーンのジオメトリ・マテリアル・テクスチャ・影マップは
   * RenderPipeline が解放するので、それ以外にステージが所有する GPU 資源（PMREM の環境マップなど）を解放する。
   */
  releaseGpuResources(): void;
  /**
   * WebGL コンテキスト復帰後に、GPU 上で描いて作る資源（PMREM の環境マップなど）を作り直す。
   * 何回呼ばれても資源が重複・リークしないこと（古いものがあれば先に解放する）。
   */
  regenerateGpuResources(): void;
  /** ステージの破棄（GPU 資源の解放・登録した処理の解除） */
  dispose(): void;
}

export interface StageDefinition {
  readonly id: string;
  readonly name: string;
  create(context: StageContext): StageInstance;
}
