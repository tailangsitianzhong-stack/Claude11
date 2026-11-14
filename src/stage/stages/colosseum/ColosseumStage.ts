import { Color, Fog, Scene, Vector3, type InstancedMesh, type Mesh, type WebGLRenderTarget } from 'three';
import type { QualityLevelSettings } from '../../../platform/QualitySettings';
import { canRenderToHalfFloat } from '../../../render/capabilities';
import { releaseSceneGpuResources } from '../../../render/gpuResources';
import { createNoiseTexture } from '../../../render/textures/noiseTexture';
import { createScaleReference } from '../../../debug/ScaleReference';
import type {
  StageContext,
  StageDefinition,
  StageDevHooks,
  StageGameplayData,
  StageInstance,
  StageViewData,
} from '../../StageDefinition';
import { buildArena } from './buildArena';
import { buildOuterWall } from './buildOuterWall';
import { buildPillars } from './buildPillars';
import { Braziers, fireDetailFor } from './braziers';
import { buildRim } from './buildRim';
import { buildStands } from './buildStands';
import { createFloorMaterials, FLOOR_SHADER_MARKER, type FloorMaterialSet } from './floorMaterial';
import { BUILT_OVERVIEW, COLOSSEUM, generateFloorRings } from './layout';
import { ArenaLights, createEnvironmentMap } from './lighting';
import { PALETTE } from './palette';

export type FloorMode = 'patterned' | 'fallback';

/** 環境光（Hemisphere）の強さ。環境マップを使えない端末では、全体が暗くならないよう少し強める */
const HEMI_INTENSITY = 0.9;
const HEMI_INTENSITY_WITHOUT_ENV = 1.15;

/**
 * Dusk Colosseum（A2-1：床・台座・基本の照明・環境マップ・大きさの目安。A2-2：外周・柱）。
 * A2-2 の CP2 でかがり火を追加。A2-3：観客席・外壁（CP1）。空・遠景・霧（CP2）、バナー（CP3）は後の工程で追加する。
 */
export class ColosseumStage implements StageInstance {
  readonly id = 'dusk-colosseum';
  readonly name = 'Dusk Colosseum';
  readonly scene = new Scene();
  readonly gameplay: StageGameplayData;
  readonly view: StageViewData;
  readonly lights: ArenaLights;
  readonly scaleReference: InstancedMesh;
  readonly dev: StageDevHooks = {
    notes: () => {
      const notes: string[] = [];
      if (this.floorFallbackReason) notes.push(`床: 単色（${this.floorFallbackReason}）`);
      if (this.environmentNote) notes.push(`環境マップ: なし（${this.environmentNote}）`);
      return notes;
    },
    controls: {
      getSun: () => this.lights.sunAngles,
      setSun: (angles) => this.lights.setSun(angles),
      setScaleReferenceVisible: (visible) => {
        this.scaleReference.visible = visible;
      },
      floorMode: () => (this.floorModeValue === 'patterned' ? '石畳の模様（シェーダー）' : '単色（代わりの床）'),
    },
  };

  private readonly floor: Mesh;
  /** 画質で影の有無を切り替えるステージの物（柱・外周の壁・かがり火の台） */
  private readonly stageShadowCasters: Mesh[];
  private readonly braziers = new Braziers();
  private readonly floorMaterials: FloorMaterialSet;
  private readonly noise = createNoiseTexture();
  private envTarget: WebGLRenderTarget | null = null;
  private floorModeValue: FloorMode = 'patterned';
  private floorFallbackReason: string | null = null;
  private environmentNote: string | null = null;
  private readonly unregisterShaderHandler: () => void;
  private disposed = false;

  constructor(private readonly context: StageContext) {
    const scene = this.scene;
    scene.name = this.name;
    // A2-1 の仮の背景色と霧（A2-3 で空のドーム・遠景に置き換える）
    scene.background = new Color(PALETTE.background);
    scene.fog = new Fog(PALETTE.fog, 70, 320);

    this.floorMaterials = createFloorMaterials(generateFloorRings(), this.noise, (error) =>
      this.useFallbackFloor(`シェーダーの差し込みに失敗: ${error.message}`),
    );
    const arena = buildArena(this.floorMaterials.patterned);
    this.floor = arena.floor;
    scene.add(arena.floor, arena.platformSide, arena.outerGround);
    const rim = buildRim();
    const pillars = buildPillars();
    scene.add(rim.wall, rim.cap, rim.terrace, pillars.stone, pillars.bands);
    scene.add(...this.braziers.meshes);
    // 観客席・外壁（A2-3）：影の範囲の外なので、影の切り替え（stageShadowCasters）の対象にしない
    scene.add(buildStands(), buildOuterWall());
    this.stageShadowCasters = [rim.wall, rim.cap, pillars.stone, pillars.bands, ...this.braziers.shadowCasters];

    // 模様のシェーダーのコンパイルに失敗したら、単色の床に切り替える（エラーは ShaderErrorMonitor が出力済み）
    this.unregisterShaderHandler = context.shaderErrors.onFailure(FLOOR_SHADER_MARKER, () =>
      this.useFallbackFloor('シェーダーのコンパイルに失敗'),
    );
    // 床の模様はワールド座標（最大 16m）で 3cm 程度の目地を描くため、highp 精度が必要
    if (context.renderer.capabilities.precision !== 'highp') {
      this.useFallbackFloor(`この端末のシェーダー精度（${context.renderer.capabilities.precision}）では模様を描けない`);
    }

    this.lights = new ArenaLights(scene);
    this.scaleReference = createScaleReference(PALETTE.scaleReference);
    scene.add(this.scaleReference);

    this.createEnvironment();

    this.gameplay = {
      boundary: { shape: 'circle', radius: COLOSSEUM.boundaryRadius, behavior: 'wall' },
      spawnPoints: [new Vector3(0, 0, -5), new Vector3(0, 0, 5)],
      floorHeight: 0,
    };
    this.view = {
      overviewCenter: new Vector3(0, BUILT_OVERVIEW.centerY, 0),
      overviewRadius: BUILT_OVERVIEW.radius,
      minCameraHeight: 0.3,
    };
  }

  get floorMode(): FloorMode {
    return this.floorModeValue;
  }

  update(dt: number): void {
    this.braziers.update(dt);
  }

  applyQuality(s: Readonly<QualityLevelSettings>): void {
    this.lights.applyQuality(s);
    // 低画質（段階6以降）では柱・壁の影を落とさない（設計書 1-3：影はキャラクターのみ）
    for (const m of this.stageShadowCasters) m.castShadow = s.stageShadows;
    // かがり火の演出（高：細かい揺らぎ・光だまり／中：揺らぎを1段に／低：さらに光だまりを省く）
    this.braziers.applyDetail(fireDetailFor(s));
    // 低画質（背景の密度を下げる段階以降）では、床の細かな質感のノイズを省く
    this.floorMaterials.setDetail(s.backgroundDensity === 'full');
  }

  releaseGpuResources(): void {
    // 環境マップ（PMREM = WebGLCubeRenderTarget）は、テクスチャから RenderTarget をたどれないため、所有者が解放する
    this.envTarget?.dispose();
    this.envTarget = null;
    this.scene.environment = null;
    // シーンの走査では見つからない資源：シェーダーの uniform のノイズ画像と、使っていない方の床のマテリアル。
    // どちらも dispose 後に使われれば、新しいコンテキストで自動的に作り直される（画像はデータを再アップロード）。
    this.noise.dispose();
    this.floorMaterials.patterned.dispose();
    this.floorMaterials.fallback.dispose();
  }

  regenerateGpuResources(): void {
    if (this.disposed) return;
    this.createEnvironment();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unregisterShaderHandler();
    // ステージが所有し、シーンの走査では見つからない資源（環境マップ・ノイズ・使っていない方の床のマテリアル）
    this.releaseGpuResources();
    // シーン内の資源（ジオメトリ・マテリアル・InstancedMesh・影マップ）はコンテキスト喪失時と同じ共通の処理で解放する
    releaseSceneGpuResources(this.scene);
  }

  /** 環境マップを作る（作り直す場合は古いものを先に解放する） */
  private createEnvironment(): void {
    this.envTarget?.dispose();
    this.envTarget = null;
    // PMREM は HalfFloat の RenderTarget に描画する。描画できない端末では作らず、環境光を少し強めて補う
    if (!canRenderToHalfFloat(this.context.renderer)) {
      this.scene.environment = null;
      this.lights.hemi.intensity = HEMI_INTENSITY_WITHOUT_ENV;
      if (this.environmentNote === null) {
        console.info('[ColosseumStage] この端末は HDR のバッファに描画できないため、環境マップを使わずに描画します。');
      }
      this.environmentNote = 'HDR描画に非対応のため環境マップなし';
      return;
    }
    this.envTarget = createEnvironmentMap(this.context.renderer);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.55;
    this.lights.hemi.intensity = HEMI_INTENSITY;
    this.environmentNote = null;
  }

  private useFallbackFloor(reason: string): void {
    if (this.floorModeValue === 'fallback') return;
    this.floorModeValue = 'fallback';
    this.floorFallbackReason = reason;
    this.floor.material = this.floorMaterials.fallback;
    console.warn(`[ColosseumStage] 床の模様を使わず、単色の床に切り替えました（${reason}）。`);
  }
}

export const DuskColosseum: StageDefinition = {
  id: 'dusk-colosseum',
  name: 'Dusk Colosseum',
  create: (context) => new ColosseumStage(context),
};
