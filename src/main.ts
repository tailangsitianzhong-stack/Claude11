import './styles.css';
import type GUI from 'lil-gui';
import { Game } from './core/Game';
import { isWebGL2Available } from './platform/webgl';
import { VIEW_PRESETS, type ViewPreset } from './debug/DevCamera';

function showFatal(container: HTMLElement, message: string): void {
  const el = document.createElement('div');
  el.className = 'fatal-message';
  el.setAttribute('data-testid', 'fatal');
  el.textContent = message;
  container.appendChild(el);
}

async function boot(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('#app が見つかりません');

  if (!isWebGL2Available()) {
    showFatal(
      container,
      'このブラウザは WebGL2 に対応していないため、ゲームを表示できません。\n' +
        '最新の Chrome / Edge / Safari でお試しください。',
    );
    return;
  }

  const game = new Game(container, { onFatal: (message) => showFatal(container, message) });
  game.start();

  const params = new URLSearchParams(location.search);
  if (params.get('stats') === '0') game.stats.setVisible(false);
  // 確認用カメラの視点（?view=front|oblique|top|close）
  const view = params.get('view');
  if (view && (VIEW_PRESETS as readonly string[]).includes(view)) game.devCamera.applyPreset(view as ViewPreset);
  // 開発用の項目（持たないステージでは、ステージの調整・?scale=0 は何もしない）
  const stageDev = game.stages.current?.dev;
  // 大きさの目安を隠す（?scale=0）
  if (params.get('scale') === '0') stageDev?.controls.setScaleReferenceVisible(false);

  // 自動テスト・デバッグ用の参照
  const debugGlobals = window as unknown as { __game?: Game; __devPanel?: GUI };
  debugGlobals.__game = game;

  if (import.meta.env.DEV || params.get('debug') === '1') {
    const { createDevPanel } = await import('./debug/DevPanel');
    debugGlobals.__devPanel = await createDevPanel(game.quality, {
      onToggleStats: (v) => game.stats.setVisible(v),
      camera: { apply: (p) => game.devCamera.applyPreset(p) },
      stage: stageDev?.controls,
    });
  }
}

boot().catch((err: unknown) => {
  console.error(err);
});
