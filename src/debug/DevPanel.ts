import type GUI from 'lil-gui';
import type { QualityManager } from '../platform/QualityManager';
import type { StageDevHooks } from '../stage/StageDefinition';
import { VIEW_PRESET_LABELS, VIEW_PRESETS, type ViewPreset } from './DevCamera';
import {
  MAX_QUALITY_LEVEL,
  PRESET_LABELS,
  QUALITY_STEPS,
  presetForLevel,
  type FrameRateMode,
  type QualityPreset,
} from '../platform/QualitySettings';

/**
 * 開発用の設定パネル（lil-gui）。
 * 開発サーバーのときだけ読み込む（本番ビルドには含めない。?debug=1 でも開かない）。
 */
export interface DevPanelOptions {
  onToggleStats: (visible: boolean) => void;
  /** 確認用カメラ（A2） */
  camera?: { apply(preset: ViewPreset): void };
  /** ステージの確認・調整（A2） */
  stage?: StageDevHooks['controls'];
}

export async function createDevPanel(quality: QualityManager, options: DevPanelOptions): Promise<GUI> {
  const { default: GUIClass } = await import('lil-gui');
  const gui = new GUIClass({ title: '開発パネル' });

  const presetNames: Record<string, QualityPreset | 'custom'> = {
    [`${PRESET_LABELS.high}（段階0）`]: 'high',
    [`${PRESET_LABELS.medium}（段階3）`]: 'medium',
    [`${PRESET_LABELS.low}（段階7）`]: 'low',
    カスタム: 'custom',
  };

  const model = {
    preset: (presetForLevel(quality.state.level) ?? 'custom') as QualityPreset | 'custom',
    level: quality.state.level,
    fps: String(quality.state.frameRateMode),
    change: '',
    stats: true,
  };

  const folder = gui.addFolder('画質');
  const presetCtrl = folder
    .add(model, 'preset', presetNames)
    .name('プリセット')
    .onChange((v: QualityPreset | 'custom') => {
      if (v !== 'custom') quality.setPreset(v);
    });
  const levelCtrl = folder
    .add(model, 'level', 0, MAX_QUALITY_LEVEL, 1)
    .name('段階 (0=最高)')
    .onChange((v: number) => quality.setLevel(v));
  const changeCtrl = folder.add(model, 'change').name('この段階の変更').disable();
  folder
    .add(model, 'fps', { '60fps': '60', '30fpsモード': '30' })
    .name('フレームレート')
    .onChange((v: string) => quality.setFrameRateMode(Number(v) as FrameRateMode));

  gui
    .add(model, 'stats')
    .name('統計表示')
    .onChange((v: boolean) => options.onToggleStats(v));

  if (options.camera) {
    const cam = options.camera;
    const camFolder = gui.addFolder('確認用カメラ（開発用）');
    const actions = Object.fromEntries(VIEW_PRESETS.map((p) => [p, () => cam.apply(p)])) as Record<ViewPreset, () => void>;
    for (const p of VIEW_PRESETS) camFolder.add(actions, p).name(VIEW_PRESET_LABELS[p]);
  }

  if (options.stage) {
    const st = options.stage;
    const stageFolder = gui.addFolder('ステージ');
    const sun = { ...st.getSun() };
    stageFolder
      .add(sun, 'elevationDeg', 10, 80, 1)
      .name('太陽の仰角（°）')
      .onChange(() => st.setSun({ ...sun }));
    stageFolder
      .add(sun, 'azimuthDeg', 0, 360, 1)
      .name('太陽の方位（°）')
      .onChange(() => st.setSun({ ...sun }));
    const vis = { scale: st.scaleReferenceVisible(), floor: st.floorMode() };
    stageFolder
      .add(vis, 'scale')
      .name('大きさの目安（1.8m）')
      .onChange((v: boolean) => st.setScaleReferenceVisible(v));
    stageFolder.add(vis, 'floor').name('床の描画方式').disable();
  }

  quality.subscribe((state) => {
    model.level = state.level;
    model.preset = presetForLevel(state.level) ?? 'custom';
    model.fps = String(state.frameRateMode);
    model.change = state.level === 0 ? '（基準）' : QUALITY_STEPS[state.level - 1]!.label;
    levelCtrl.updateDisplay();
    presetCtrl.updateDisplay();
    changeCtrl.updateDisplay();
  });

  // スマホの縦画面では最初は閉じておく
  if (window.innerWidth < 600) gui.close();
  return gui;
}
