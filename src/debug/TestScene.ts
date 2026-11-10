import {
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  type Object3D,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { QualityLevelSettings } from '../platform/QualitySettings';
import { applyShadowQuality } from '../render/shadows';

/**
 * チェックポイントA1 専用の仮シーン（A2 でアリーナに置き換える）。
 *
 * 確認する内容：
 * - 描画パイプライン（MSAA・HDR・Bloom・トーンマッピング・影）が正しく動くこと
 * - 画質の段階を切り替えたとき、各設定が反映されること
 * - 身長1.8mの基準ブロックで、単位（1 = 1m）とカメラの距離感を確認すること
 */
export class TestScene {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly sun: DirectionalLight;
  private readonly spinner: Object3D;
  private readonly pillars: Mesh[] = [];
  private readonly decorations = new Group();
  private time = 0;

  constructor(domElement: HTMLElement) {
    const scene = this.scene;
    scene.background = new Color('#8fa6c4');
    scene.fog = new Fog('#8fa6c4', 30, 90);

    this.camera = new PerspectiveCamera(50, 1, 0.1, 200);
    this.camera.position.set(6.5, 3.2, 8.5);

    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.target.set(0, 1.0, 0);
    this.controls.enableDamping = true;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 40;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.update();

    // --- ライト ---
    const hemi = new HemisphereLight('#cfe0ff', '#6b5a48', 1.1);
    scene.add(hemi);

    this.sun = new DirectionalLight('#fff1dc', 2.6);
    this.sun.position.set(-8, 14, 6);
    this.sun.castShadow = true;
    const cam = this.sun.shadow.camera;
    cam.left = -12;
    cam.right = 12;
    cam.top = 12;
    cam.bottom = -12;
    cam.near = 1;
    cam.far = 40;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    scene.add(this.sun, this.sun.target);

    // 背後からの補助光（リムライトの代わり。A3でシェーダーのリムライトを追加する）
    const back = new DirectionalLight('#9cc4ff', 0.8);
    back.position.set(6, 6, -10);
    scene.add(back);

    // --- 床 ---
    const floor = new Mesh(
      new CircleGeometry(12, 64),
      new MeshStandardMaterial({ color: '#b3a58c', roughness: 0.85 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // --- 身長1.8mの基準ブロック（キャラクターの大きさの目安） ---
    const refMat = new MeshStandardMaterial({ color: '#2f9e9a', roughness: 0.6 });
    const ref = new Mesh(new RoundedBoxGeometry(0.5, 1.8, 0.3, 3, 0.03), refMat);
    ref.position.set(0, 0.9, 0);
    ref.castShadow = ref.receiveShadow = true;
    scene.add(ref);

    // --- 回転するブロック（描画が動いていることの確認・MSAAの効果確認） ---
    const spinner = new Mesh(
      new RoundedBoxGeometry(0.6, 0.6, 0.6, 3, 0.04),
      new MeshStandardMaterial({ color: '#d9663f', roughness: 0.55 }),
    );
    spinner.position.set(-2, 0.9, 1);
    spinner.castShadow = true;
    scene.add(spinner);
    this.spinner = spinner;

    // --- 発光体（Bloom の確認：明るさ1を超える発光） ---
    const orb = new Mesh(
      new IcosahedronGeometry(0.25, 2),
      new MeshStandardMaterial({ color: '#000000', emissive: '#ffb347', emissiveIntensity: 4 }),
    );
    orb.position.set(2, 1.4, 0.5);
    scene.add(orb);

    // --- 柱（ステージの影の確認） ---
    const pillarMat = new MeshStandardMaterial({ color: '#8e8577', roughness: 0.8 });
    const pillarGeo = new CylinderGeometry(0.45, 0.55, 5, 16);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const p = new Mesh(pillarGeo, pillarMat);
      p.position.set(Math.cos(a) * 9, 2.5, Math.sin(a) * 9);
      p.castShadow = p.receiveShadow = true;
      scene.add(p);
      this.pillars.push(p);
    }

    // --- 背景の装飾（密度の切り替え確認） ---
    const decoMat = new MeshStandardMaterial({ color: '#7c8aa3', roughness: 0.9 });
    const decoGeo = new RoundedBoxGeometry(1.2, 1, 1.2, 1, 0.05);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const d = new Mesh(decoGeo, decoMat);
      d.position.set(Math.cos(a) * 18, 0.5 + (i % 3) * 0.6, Math.sin(a) * 18);
      d.scale.y = 1 + (i % 3);
      this.decorations.add(d);
    }
    scene.add(this.decorations);
  }

  applyQuality(s: QualityLevelSettings): void {
    applyShadowQuality(this.sun, s);
    for (const p of this.pillars) p.castShadow = s.stageShadows;
    // 背景の密度：reduced では一つおきに非表示
    this.decorations.children.forEach((c, i) => {
      c.visible = s.backgroundDensity === 'full' || i % 2 === 0;
    });
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.time += dt;
    this.spinner.rotation.y = this.time * 0.8;
    this.spinner.rotation.x = Math.sin(this.time * 0.5) * 0.4;
  }

  /** 描画フレームごとに呼ぶ（カメラ操作の慣性） */
  updateView(): void {
    this.controls.update();
  }
}
