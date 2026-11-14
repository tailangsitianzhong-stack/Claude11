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

  const params = new URLSearchParams(location.search);
  // ビューアー（A4）：開発サーバーのときだけ ?mode=viewer で起動する。本番ビルドでは import.meta.env.DEV が false になり、
  // この分岐とビューアーのコードはビルドに含まれない
  if (import.meta.env.DEV && params.get('mode') === 'viewer') {
    const { startViewer } = await import('./viewer/ViewerApp');
    await startViewer(container, (message) => showFatal(container, message));
    return;
  }

  const game = new Game(container, { onFatal: (message) => showFatal(container, message) });
  game.start();

  if (params.get('stats') === '0') game.stats.setVisible(false);
  // 確認用カメラの視点（?view=front|oblique|top|close）
  const view = params.get('view');
  if (view && (VIEW_PRESETS as readonly string[]).includes(view)) game.devCamera.applyPreset(view as ViewPreset);
  // 開発用の項目（持たないステージでは、ステージの調整・?scale=1 は何もしない）
  const stageDev = game.stages.current?.dev;
  // 大きさの目安（開発・検証用。通常は表示しない）を表示する（?scale=1）
  if (params.get('scale') === '1') stageDev?.controls.setScaleReferenceVisible(true);

  // 自動テスト・デバッグ用の参照
  const debugGlobals = window as unknown as { __game?: Game; __devPanel?: GUI };
  debugGlobals.__game = game;

  // 開発パネル・キャラクターの確認用（A4 CP1 から開発サーバー限定。本番ビルドでは ?debug=1 を付けても読み込まない）
  if (import.meta.env.DEV) {
    // キャラクターの確認用（開発・検証専用）：?pose=extreme（極端な姿勢）、?silhouette=1（シルエット）
    if (params.get('pose') === 'extreme' || params.get('silhouette') === '1') {
      const checks = await import('./debug/characterChecks');
      for (const body of [game.player, game.dummy]) {
        if (params.get('pose') === 'extreme') body.applyPoseDeg(checks.EXTREME_POSE);
        if (params.get('silhouette') === '1') checks.setSilhouette(body, true);
      }
    }
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
