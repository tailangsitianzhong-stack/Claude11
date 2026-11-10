import './styles.css';
import { Game } from './core/Game';
import { isWebGL2Available } from './platform/webgl';

function showFatal(container: HTMLElement, message: string): void {
  const el = document.createElement('div');
  el.className = 'fatal-message';
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

  const game = new Game(container);
  game.start();

  const params = new URLSearchParams(location.search);
  if (params.get('stats') === '0') game.stats.setVisible(false);
  if (import.meta.env.DEV || params.get('debug') === '1') {
    const { createDevPanel } = await import('./debug/DevPanel');
    await createDevPanel(game.quality, { onToggleStats: (v) => game.stats.setVisible(v) });
  }

  // 自動テスト・デバッグ用の参照
  (window as unknown as { __game?: Game }).__game = game;
}

boot().catch((err: unknown) => {
  console.error(err);
});
