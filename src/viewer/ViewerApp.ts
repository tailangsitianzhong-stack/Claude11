import { CircleGeometry, Color, Mesh, MeshStandardMaterial, Scene, type WebGLRenderTarget } from 'three';
import { CharacterBody, STANDING_POSE } from '../character/CharacterBody';
import { APPEARANCE_A, APPEARANCE_B } from '../character/appearance';
import { BODY_A, BODY_B } from '../character/bodyProfile';
import { createDummySword } from '../character/dummySword';
import { GameLoop } from '../core/GameLoop';
import { JOINT_LIMITS } from '../character/jointLimits';
import { JOINT_NAMES, type JointName } from '../character/skeleton';
import { setSilhouette } from '../debug/characterChecks';
import { DevCamera } from '../debug/DevCamera';
import { CHANGE_WARMUP, StatsOverlay } from '../debug/StatsOverlay';
import { PRESET_LABELS, presetForLevel, type QualityPreset } from '../platform/QualitySettings';
import { QualityManager } from '../platform/QualityManager';
import { ViewportManager } from '../platform/ViewportManager';
import { canRenderToHalfFloat } from '../render/capabilities';
import { releaseSceneGpuResources } from '../render/gpuResources';
import { RenderPipeline } from '../render/RenderPipeline';
import { ArenaLights } from '../stage/stages/colosseum/lighting';
import { createEnvironmentMap } from '../stage/stages/colosseum/sky';
import type { StageViewData } from '../stage/StageDefinition';
import {
  VIEWER_SELECTIONS,
  VIEWER_VIEW_LABELS,
  VIEWER_VIEWS,
  cameraPosition,
  characterPositions,
  framing,
  viewDistance,
  type ViewerSelection,
  type ViewerView,
} from './viewerLayout';
import {
  AXES,
  POSE_PRESET_LABELS,
  POSE_PRESET_NAMES,
  applyPosePreset,
  editableAxes,
  readJointDeg,
  setJointAxisDeg,
  type Axis,
  type Deg3,
  type PosePreset,
} from './viewerPose';

/**
 * ビューアー（A4 CP1。DESIGN_DECISIONS 10章）：開発サーバーのときだけ `?mode=viewer` で起動する（main.ts）。
 *
 * - アリーナは読み込まず、シンプルな背景と床面に、体型A・B を立たせる。
 * - キャラクターの描画・マテリアル・ライティングは既存の部品を使う（CharacterBody、ArenaLights、環境マップ、描画パイプライン）。
 *   ゲームと同じ部品なので、ビューアーでの見た目の確認結果がそのままゲームに反映される。
 * - CP1：キャラクターの選択（A・B・2体）、4つの視点、シルエット、画質の切り替え。
 * - CP2：関節のスライダー（回転の上限の範囲内）、姿勢のリセット、スマホの画面への対応、コンテキストの喪失・復帰。
 *
 * URL：`?mode=viewer&char=A|B|AB&view=front|side|oblique|top&silhouette=1&quality=…&stats=0&target=A|B&pose=rest|standing|extreme`
 */

/** 背景・床面の色（灰青の無地。キャラクターの色を判断しやすい中間の明るさ） */
const BACKGROUND = '#30343F';
const FLOOR = '#6F6C69';
const FLOOR_RADIUS = 4;
/** 環境光（Hemisphere）の強さ（ステージと同じ。環境マップを使えない端末では少し強める） */
const HEMI_INTENSITY = 0.9;
const HEMI_INTENSITY_WITHOUT_ENV = 1.15;

export class ViewerApp {
  readonly quality: QualityManager;
  readonly viewport: ViewportManager;
  readonly pipeline: RenderPipeline;
  readonly scene = new Scene();
  readonly lights: ArenaLights;
  readonly characters: { A: CharacterBody; B: CharacterBody };
  readonly camera: DevCamera;
  readonly stats: StatsOverlay;
  readonly loop: GameLoop;
  private readonly viewData: StageViewData;
  private envTarget: WebGLRenderTarget | null = null;
  private selectionValue: ViewerSelection = 'AB';
  private viewValue: ViewerView = 'front';
  private silhouetteValue = false;
  /** 関節を操作する体（1体の表示ではその体。2体の比較では選べる） */
  private targetValue: 'A' | 'B' = 'A';
  /** 極端な姿勢のリセットを選んだ体（1体の表示で、表示範囲を広げる。A4 CP2） */
  private readonly extremePose = { A: false, B: false };
  /** 表示の中身のずれ（px。setViewShift） */
  private readonly viewShift = { dx: 0, dy: 0 };

  constructor(container: HTMLElement, onFatal: (message: string) => void) {
    this.quality = QualityManager.fromUrl(location.search);
    this.viewport = new ViewportManager(container);
    this.pipeline = new RenderPipeline(container);

    const scene = this.scene;
    scene.name = 'Viewer';
    scene.background = new Color(BACKGROUND);
    const floorMat = new MeshStandardMaterial({ color: FLOOR, roughness: 0.92, metalness: 0 });
    floorMat.name = 'ViewerFloor';
    const floorGeo = new CircleGeometry(FLOOR_RADIUS, 64);
    floorGeo.rotateX(-Math.PI / 2);
    const floor = new Mesh(floorGeo, floorMat);
    floor.name = 'ViewerFloor';
    floor.receiveShadow = true;
    scene.add(floor);

    this.lights = new ArenaLights(scene);
    this.createEnvironment();
    // 環境マップ（PMREM）はシーンの走査で解放できないため、ステージと同じく喪失時に解放し、復帰後に作り直す
    this.pipeline.onContextLost(() => {
      this.releaseEnvironment();
      this.releaseInactiveMaterials();
    });
    this.pipeline.onContextRestored(() => this.createEnvironment());

    const a = new CharacterBody(BODY_A, APPEARANCE_A);
    const b = new CharacterBody(BODY_B, APPEARANCE_B);
    b.attach('weapon_R', createDummySword().root);
    for (const c of [a, b]) c.applyPoseDeg(STANDING_POSE);
    scene.add(a.root, b.root);
    this.characters = { A: a, B: b };

    const f = framing('AB');
    this.viewData = { overviewCenter: f.center, overviewRadius: f.radius, minCameraHeight: 0.05 };
    this.camera = new DevCamera(this.pipeline.canvas, this.viewData);
    this.pipeline.setView(scene, this.camera.camera);
    this.stats = new StatsOverlay(container);

    let firstFrame = true;
    this.loop = new GameLoop({
      update: () => {},
      render: (frameDt) => {
        this.viewport.pollDevicePixelRatio(frameDt);
        this.camera.update();
        if (firstFrame) {
          const t0 = performance.now();
          this.pipeline.render();
          const t1 = performance.now();
          firstFrame = false;
          this.stats.meter.recordStartup(t1, t1 - t0);
        } else {
          this.pipeline.render();
        }
        this.stats.frame(frameDt, this.pipeline.stats, this.quality.state, []);
      },
    });
    this.pipeline.onFatal((message) => {
      this.loop.stop();
      onFatal(message);
    });

    this.viewport.subscribe((size) => {
      this.applyViewShift(); // 画面の大きさが変わったら、ずれの基準の大きさも合わせる
      this.camera.setAspect(size.width / size.height);
      this.pipeline.setViewport(size);
      this.applyView();
    });
    let initialQuality = true;
    this.quality.subscribe((state) => {
      this.pipeline.applyQuality(state.settings);
      this.lights.applyQuality(state.settings);
      for (const c of [a, b]) c.applyQuality(state.settings);
      // シルエット表示中は輪郭線を出さない
      if (this.silhouetteValue) for (const c of [a, b]) setSilhouette(c, true);
      if (!initialQuality) this.stats.meter.beginWarmup('画質変更', CHANGE_WARMUP);
      initialQuality = false;
    });

    this.setSelection('AB');
  }

  get selection(): ViewerSelection {
    return this.selectionValue;
  }

  get view(): ViewerView {
    return this.viewValue;
  }

  get silhouette(): boolean {
    return this.silhouetteValue;
  }

  /** 表示するキャラクター（A・B・2体）。1体のときは中央に、2体のときは左右に並べる。どちらも正面（+Z）を向く */
  setSelection(sel: ViewerSelection): void {
    this.selectionValue = sel;
    if (sel !== 'AB') this.targetValue = sel;
    const pos = characterPositions(sel);
    for (const key of ['A', 'B'] as const) {
      const body = this.characters[key];
      const x = pos[key];
      body.root.visible = x !== null;
      if (x !== null) body.root.position.set(x, 0, 0);
    }
    this.updateFraming();
  }

  /** 表示範囲を合わせ直す（極端な姿勢を表示しているときだけ、1体の表示の範囲を広げる） */
  private updateFraming(): void {
    const sel = this.selectionValue;
    const f = framing(sel, sel !== 'AB' && this.extremePose[sel]);
    this.viewData.overviewCenter.copy(f.center);
    this.viewData.overviewRadius = f.radius;
    this.camera.setAspect(this.camera.camera.aspect); // 最大距離を表示範囲に合わせ直す
    this.applyView();
  }

  /**
   * 表示の中身を画面上で dx・dy（px。右・下が正）だけずらす（スマホで操作パネルを開いたとき。A4 CP2）。
   * カメラの投影だけをずらすので、描画の領域（canvas）の大きさは変わらない。0, 0 で元に戻す。
   */
  setViewShift(dx: number, dy: number): void {
    this.viewShift.dx = dx;
    this.viewShift.dy = dy;
    this.applyViewShift();
  }

  private applyViewShift(): void {
    const cam = this.camera.camera;
    const { dx, dy } = this.viewShift;
    if (dx === 0 && dy === 0) {
      if (cam.view?.enabled) cam.clearViewOffset();
      return;
    }
    const { width, height } = this.viewport.current;
    cam.setViewOffset(width, height, -dx, -dy, width, height);
  }

  setView(view: ViewerView): void {
    this.viewValue = view;
    this.applyView();
  }

  setSilhouette(on: boolean): void {
    this.silhouetteValue = on;
    for (const c of [this.characters.A, this.characters.B]) {
      setSilhouette(c, on);
      if (!on) c.applyQuality(this.quality.state.settings);
    }
  }

  get target(): 'A' | 'B' {
    return this.targetValue;
  }

  /** 関節を操作する体。1体の表示のときは表示中の体に固定する */
  setTarget(target: 'A' | 'B'): void {
    if (this.selectionValue !== 'AB') return;
    this.targetValue = target;
  }

  private get targetBody(): CharacterBody {
    return this.characters[this.targetValue];
  }

  /** 操作する体の関節の回転（度） */
  jointRotationDeg(joint: JointName): Deg3 {
    return readJointDeg(this.targetBody, joint);
  }

  /** 関節の1つの軸を設定する（上限の範囲に切り詰める）。数値でない入力は適用せず null を返す */
  setJointAxis(joint: JointName, axis: Axis, value: number): Deg3 | null {
    return setJointAxisDeg(this.targetBody, joint, axis, value);
  }

  /** 操作する体の姿勢をリセットする */
  resetPose(preset: PosePreset): void {
    applyPosePreset(this.targetBody, preset);
    const wasExtreme = this.extremePose[this.targetValue];
    this.extremePose[this.targetValue] = preset === 'extreme';
    if (this.selectionValue !== 'AB' && wasExtreme !== this.extremePose[this.targetValue]) this.updateFraming();
  }

  start(): void {
    this.loop.start();
  }

  private applyView(): void {
    const cam = this.camera.camera;
    const center = this.viewData.overviewCenter;
    const d = viewDistance(this.viewData.overviewRadius, cam.fov, cam.aspect);
    const pos = cameraPosition(this.viewValue, center, d);
    this.camera.controls.target.copy(center);
    cam.position.copy(pos);
    cam.lookAt(center);
    this.camera.controls.update();
  }

  private createEnvironment(): void {
    this.releaseEnvironment();
    const renderer = this.pipeline.renderer;
    if (!canRenderToHalfFloat(renderer)) {
      this.lights.hemi.intensity = HEMI_INTENSITY_WITHOUT_ENV;
      return;
    }
    this.envTarget = createEnvironmentMap(renderer);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.55;
    this.lights.hemi.intensity = HEMI_INTENSITY;
  }

  /**
   * コンテキストの喪失時：シルエットの切り替えでシーンから外れているマテリアル（シルエット中は元の体のマテリアル、
   * 通常の表示中はシルエットのマテリアル）も解放する。シーン内の資源は RenderPipeline が先に解放している。
   * 一時的に表示を入れ替えてシーンに入れ、共通の処理で解放してから元に戻す（GL の呼び出しが何もしない状態なので描画には影響しない）。
   */
  private releaseInactiveMaterials(): void {
    const bodies = [this.characters.A, this.characters.B];
    for (const c of bodies) setSilhouette(c, !this.silhouetteValue);
    for (const c of bodies) releaseSceneGpuResources(c.root);
    for (const c of bodies) {
      setSilhouette(c, this.silhouetteValue);
      if (!this.silhouetteValue) c.applyQuality(this.quality.state.settings);
    }
  }

  private releaseEnvironment(): void {
    this.envTarget?.dispose();
    this.envTarget = null;
    this.scene.environment = null;
  }
}

/** 狭い縦長の画面での操作パネルの高さの上限（画面の高さに対する比）と、パネルの外側の余白（px） */
const PORTRAIT_PANEL_MAX_HEIGHT = 0.5;
const PANEL_MARGIN = 8;

/** ビューアーの操作パネル（lil-gui。開発用） */
async function createViewerPanel(app: ViewerApp): Promise<import('lil-gui').default> {
  const { default: GUI } = await import('lil-gui');
  const gui = new GUI({ title: 'ビューアー（開発用）' });
  const labels: Record<ViewerSelection, string> = { A: '体型A', B: '体型B', AB: '2体を比較' };
  const model = {
    selection: app.selection as ViewerSelection,
    silhouette: app.silhouette,
    preset: (presetForLevel(app.quality.state.level) ?? 'medium') as QualityPreset,
  };
  gui
    .add(model, 'selection', Object.fromEntries(VIEWER_SELECTIONS.map((s) => [labels[s], s])))
    .name('キャラクター')
    .onChange((v: ViewerSelection) => {
      app.setSelection(v);
      refreshJoint();
    });
  const views = gui.addFolder('視点');
  const actions = Object.fromEntries(VIEWER_VIEWS.map((v) => [v, () => app.setView(v)])) as Record<ViewerView, () => void>;
  for (const v of VIEWER_VIEWS) views.add(actions, v).name(VIEWER_VIEW_LABELS[v]);
  gui
    .add(model, 'silhouette')
    .name('シルエット')
    .onChange((v: boolean) => app.setSilhouette(v));
  gui
    .add(model, 'preset', { [PRESET_LABELS.high]: 'high', [PRESET_LABELS.medium]: 'medium', [PRESET_LABELS.low]: 'low' })
    .name('画質')
    .onChange((v: QualityPreset) => app.quality.setPreset(v));

  // 関節のスライダー（A4 CP2）：範囲は回転の上限（JointLimits）。動かせない軸（範囲の幅が 0）は操作できない
  const joints = gui.addFolder('関節');
  const jm = { target: app.target, joint: 'shoulder_L' as JointName, x: 0, y: 0, z: 0 };
  const targetCtrl = joints
    .add(jm, 'target', { 体型A: 'A', 体型B: 'B' })
    .name('操作する体')
    .onChange((v: 'A' | 'B') => {
      app.setTarget(v);
      refreshJoint();
    });
  joints
    .add(jm, 'joint', JOINT_NAMES as unknown as JointName[])
    .name('関節')
    .onChange(() => refreshJoint());
  const axisCtrls = Object.fromEntries(
    AXES.map((axis) => [
      axis,
      joints
        .add(jm, axis, -180, 180, 1)
        .name(`${axis.toUpperCase()}（°）`)
        .onChange((v: number) => {
          const applied = app.setJointAxis(jm.joint, axis, v);
          // 上限で切り詰めた値・適用しなかった入力は、実際の値に表示を戻す
          refreshValues(applied ?? app.jointRotationDeg(jm.joint));
        }),
    ]),
  ) as Record<Axis, import('lil-gui').Controller>;
  const refreshValues = (deg: Deg3) => {
    for (const axis of AXES) {
      jm[axis] = Math.round(deg[axis] * 10) / 10;
      axisCtrls[axis].updateDisplay();
    }
  };
  const refreshJoint = () => {
    // 1体の表示では、操作する体 = 表示中の体
    jm.target = app.target;
    targetCtrl.updateDisplay();
    if (app.selection === 'AB') targetCtrl.enable();
    else targetCtrl.disable();
    const lim = JOINT_LIMITS[jm.joint];
    const movable = editableAxes(jm.joint);
    for (const axis of AXES) {
      axisCtrls[axis].min(lim[axis].min).max(lim[axis].max);
      axisCtrls[axis].enable(movable.includes(axis));
    }
    refreshValues(app.jointRotationDeg(jm.joint));
  };
  const resets = Object.fromEntries(
    POSE_PRESET_NAMES.map((p) => [
      p,
      () => {
        app.resetPose(p);
        refreshJoint();
      },
    ]),
  ) as Record<PosePreset, () => void>;
  const resetFolder = joints.addFolder('姿勢のリセット');
  for (const p of POSE_PRESET_NAMES) resetFolder.add(resets, p).name(POSE_PRESET_LABELS[p]);
  refreshJoint();

  // スマホの画面（A4 CP2）：表示の領域を狭めないよう、狭い画面では最初は閉じ、パネルの高さ・幅も抑える
  // 狭い画面：幅が 600px 未満、またはタッチ操作の端末で高さが 600px 未満（スマホの横向き）。PC の表示は対象にしない
  const isNarrow = () =>
    window.innerWidth < 600 || (window.innerHeight < 600 && window.matchMedia('(pointer: coarse)').matches);
  if (isNarrow()) gui.close();
  // 狭い画面でパネルを開いているあいだは、パネルに覆われない側へ表示の中身をずらす
  // （縦長：パネルの下へ。横長：パネルの左へ）。描画の領域は変えず、閉じれば元に戻す
  const layoutForPanel = () => {
    const el = gui.domElement;
    const portrait = window.innerHeight > window.innerWidth;
    if (!isNarrow()) {
      el.style.width = '';
      el.style.maxHeight = '';
      app.setViewShift(0, 0);
      return;
    }
    el.style.width = 'min(245px, 62vw)';
    el.style.maxHeight = portrait ? `${PORTRAIT_PANEL_MAX_HEIGHT * 100}%` : '';
    if (gui._closed) app.setViewShift(0, 0);
    else if (portrait) app.setViewShift(0, (window.innerHeight * PORTRAIT_PANEL_MAX_HEIGHT + PANEL_MARGIN) / 2);
    else app.setViewShift(-(el.getBoundingClientRect().width + PANEL_MARGIN) / 2, 0);
  };
  gui.onOpenClose(() => layoutForPanel());
  window.addEventListener('resize', layoutForPanel);
  layoutForPanel();
  return gui;
}

/** ビューアーを起動する（main.ts から、開発サーバーのときだけ呼ばれる） */
export async function startViewer(container: HTMLElement, onFatal: (message: string) => void): Promise<ViewerApp> {
  const app = new ViewerApp(container, onFatal);
  const params = new URLSearchParams(location.search);
  const sel = params.get('char');
  if (sel && (VIEWER_SELECTIONS as readonly string[]).includes(sel)) app.setSelection(sel as ViewerSelection);
  const view = params.get('view');
  if (view && (VIEWER_VIEWS as readonly string[]).includes(view)) app.setView(view as ViewerView);
  if (params.get('silhouette') === '1') app.setSilhouette(true);
  const target = params.get('target');
  if (target === 'A' || target === 'B') app.setTarget(target);
  const pose = params.get('pose');
  if (pose && (POSE_PRESET_NAMES as readonly string[]).includes(pose)) app.resetPose(pose as PosePreset);
  if (params.get('stats') === '0') app.stats.setVisible(false);
  app.start();
  const panel = await createViewerPanel(app);
  // 自動テスト・デバッグ用の参照
  const g = window as unknown as { __viewer?: ViewerApp; __viewerPanel?: unknown };
  g.__viewer = app;
  g.__viewerPanel = panel;
  return app;
}
