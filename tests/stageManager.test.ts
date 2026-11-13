import { describe, expect, it } from 'vitest';
import { Scene, Vector3 } from 'three';
import { StageManager } from '../src/stage/StageManager';
import type { StageDefinition, StageInstance } from '../src/stage/StageDefinition';
import { settingsForLevel } from '../src/platform/QualitySettings';

function fakePipeline() {
  const listeners = new Set<() => void>();
  const lostListeners = new Set<() => void>();
  return {
    listeners,
    lostListeners,
    onContextLost(l: () => void) {
      lostListeners.add(l);
      return () => lostListeners.delete(l);
    },
    onContextRestored(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    lose() {
      for (const l of [...lostListeners]) l();
    },
    restore() {
      for (const l of [...listeners]) l();
    },
  };
}

function fakeDefinition(log: string[]): StageDefinition {
  let n = 0;
  return {
    id: 'fake',
    name: 'Fake',
    create: () => {
      const id = ++n;
      const stage: StageInstance = {
        id: 'fake',
        name: `Fake${id}`,
        scene: new Scene(),
        gameplay: { boundary: { shape: 'circle', radius: 15, behavior: 'wall' }, spawnPoints: [], floorHeight: 0 },
        view: { overviewCenter: new Vector3(), overviewRadius: 18, minCameraHeight: 0.3 },
        update: () => log.push(`update${id}`),
        applyQuality: (s) => log.push(`quality${id}:${s.shadowMapSize}`),
        releaseGpuResources: () => log.push(`release${id}`),
        regenerateGpuResources: () => log.push(`regen${id}`),
        dispose: () => log.push(`dispose${id}`),
      };
      return stage;
    },
  };
}

const ctx = { renderer: {} as never, shaderErrors: {} as never };

describe('StageManager', () => {
  it('コンテキスト復帰の通知は1回だけ登録し、ステージを切り替えても増えない', () => {
    const p = fakePipeline();
    const log: string[] = [];
    const m = new StageManager(ctx, p, settingsForLevel(0));
    const def = fakeDefinition(log);
    m.load(def);
    m.load(def);
    m.load(def);
    expect(p.listeners.size).toBe(1);
    expect(p.lostListeners.size).toBe(1);
    p.lose();
    p.restore();
    expect(log.filter((l) => l.startsWith('release') || l.startsWith('regen'))).toEqual(['release3', 'regen3']); // 現在のステージだけ
  });

  it('切り替え時に前のステージを破棄し、画質を反映する', () => {
    const p = fakePipeline();
    const log: string[] = [];
    const m = new StageManager(ctx, p, settingsForLevel(3));
    const def = fakeDefinition(log);
    m.load(def);
    m.load(def);
    expect(log).toEqual(['quality1:1024', 'dispose1', 'quality2:1024']);
    m.applyQuality(settingsForLevel(9));
    expect(log.at(-1)).toBe('quality2:512');
  });

  it('破棄すると通知の登録を解除し、ステージも破棄する。その後の復帰通知では何もしない', () => {
    const p = fakePipeline();
    const log: string[] = [];
    const m = new StageManager(ctx, p, settingsForLevel(0));
    m.load(fakeDefinition(log));
    m.dispose();
    expect(p.listeners.size).toBe(0);
    expect(p.lostListeners.size).toBe(0);
    expect(log).toContain('dispose1');
    p.restore();
    expect(log.filter((l) => l.startsWith('regen'))).toHaveLength(0);
    expect(() => m.load(fakeDefinition(log))).toThrow();
    m.dispose(); // 2回目は何もしない
  });

  it('復帰の処理が複数回呼ばれても、毎回現在のステージの作り直しだけを行う', () => {
    const p = fakePipeline();
    const log: string[] = [];
    const m = new StageManager(ctx, p, settingsForLevel(0));
    m.load(fakeDefinition(log));
    for (let i = 0; i < 3; i++) {
      p.lose();
      p.restore();
    }
    expect(log.filter((l) => l.startsWith('release') || l.startsWith('regen'))).toEqual([
      'release1', 'regen1', 'release1', 'regen1', 'release1', 'regen1',
    ]);
  });
});
