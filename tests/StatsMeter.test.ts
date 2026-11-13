import { describe, expect, it } from 'vitest';
import {
  CHANGE_WARMUP,
  FrameStatsMeter,
  STALL_ABSOLUTE_MS,
  STALL_MEDIAN_FLOOR_MS,
  STARTUP_WARMUP,
  WINDOW_MIN_FRAMES,
  formatFps,
} from '../src/debug/StatsOverlay';
import { createRandom } from '../src/core/random';
import { readDevicePixelRatio } from '../src/platform/ViewportManager';

/**
 * フレーム時間（秒）を直接与えて動かす。実時間には依存しない。乱数は種を固定（再現可能）。
 */
const F60 = 1 / 60;

function feed(m: FrameStatsMeter, dt: number, n: number): void {
  for (let i = 0; i < n; i++) m.push(dt);
}

/** 起動直後の準備期間を、通常のフレームで終わらせる */
function startAndFinishWarmup(m: FrameStatsMeter, dt = F60): void {
  m.recordStartup(300, 150);
  let guard = 0;
  while (m.warmingUp && guard++ < 10000) m.push(dt);
}

/** 平均 fps、ばらつき ±jitter の通常フレームを n 個（種固定の乱数） */
function jitteredFrames(fps: number, jitter: number, n: number, seed: number): number[] {
  const rand = createRandom(seed);
  return Array.from({ length: n }, () => (1 / fps) * (1 + (rand() * 2 - 1) * jitter));
}

/** 不変条件：FPS = 1000 ÷ 平均フレーム時間、内訳の合計が投入したフレームと一致 */
function expectConsistent(m: FrameStatsMeter): void {
  if (m.result) expect(m.result.fps * m.result.avgMs).toBeCloseTo(1000, 6);
  const t = m.totals;
  expect(t.stallFrames).toBe(m.stalls.count);
  expect(t.stallMs).toBeCloseTo(m.stalls.totalMs, 6);
}

describe('① 1秒以上のフレーム', () => {
  it('1秒以上は、中央値の履歴がなくても常に停止として除外する（従来の定義を維持）', () => {
    const m = new FrameStatsMeter();
    startAndFinishWarmup(m);
    m.push(STALL_ABSOLUTE_MS / 1000);
    feed(m, F60, 40);
    m.push(7.6);
    feed(m, F60, 40);
    expect(m.stalls).toMatchObject({ count: 2, maxMs: 7600 });
    expect(m.stalls.totalMs).toBeCloseTo(8600, 6);
    expect(m.totals).toMatchObject({ stallFrames: 2, normalFrames: 80 });
    expect(m.result!.maxMs).toBeLessThan(17);
    expectConsistent(m);
  });

  it('1秒以上のフレームが2回続いても、どちらも停止のまま（速さの変化とはみなさない）', () => {
    const m = new FrameStatsMeter();
    startAndFinishWarmup(m);
    feed(m, F60, 20);
    m.push(1.5);
    m.push(1.4);
    feed(m, F60, 20);
    expect(m.stalls.count).toBe(2);
    expect(m.totals.speedChanges).toBe(0);
  });
});

describe('② 250ms 未満は、中央値の10倍以上でも停止にしない', () => {
  it('60fps（中央値 16.7ms）で 200ms のフレーム → 停止にしない（通常の統計に入る）', () => {
    const m = new FrameStatsMeter();
    startAndFinishWarmup(m);
    feed(m, F60, 20);
    expect(m.isMedianSuspect(200)).toBe(false);
    expect(m.isMedianSuspect(STALL_MEDIAN_FLOOR_MS)).toBe(true);
    m.push(0.2);
    feed(m, F60, 20);
    expect(m.stalls.count).toBe(0);
    expect(m.totals.normalFrames).toBe(41);
  });

  it('前回の不具合の再現：速いフレーム（16ms）の直後に本来の速さ（約90〜280ms）へ戻っても、停止と誤判定しない', () => {
    const m = new FrameStatsMeter();
    startAndFinishWarmup(m);
    feed(m, 0.016, 20);
    const slow = jitteredFrames(1 / 0.0884, 0.5, 120, 11); // 平均 88.4ms、44〜133ms
    // 集計窓ごとに、窓に入ったフレームの実際の平均と、表示の平均が一致することを確かめる
    let windowFrames: number[] = [];
    let last = m.result;
    let checkedWindows = 0;
    for (const dt of slow) {
      m.push(dt);
      windowFrames.push(dt);
      if (m.result !== last) {
        const avg = (windowFrames.reduce((a, b) => a + b, 0) / windowFrames.length) * 1000;
        if (checkedWindows > 0) expect(m.result!.avgMs).toBeCloseTo(avg, 6); // 最初の窓は速いフレームを含むため除く
        expect(m.result!.frames).toBe(checkedWindows > 0 ? windowFrames.length : m.result!.frames);
        windowFrames = [];
        last = m.result;
        checkedWindows++;
      }
    }
    expect(m.stalls.count).toBe(0);
    expect(checkedWindows).toBeGreaterThan(5);
    expect(m.result!.fps).toBeLessThan(20);
    expectConsistent(m);
  });
});

describe('③④ 単発の停止と、普段の速さの変化', () => {
  it('③ 単発の長いフレーム（60fps 中の 400ms）は停止として除外する', () => {
    const m = new FrameStatsMeter();
    startAndFinishWarmup(m);
    feed(m, F60, 20);
    m.push(0.4); // 停止の疑い（保留）
    expect(m.totals.pendingFrames).toBe(1);
    m.push(F60); // 続かなかった → 単発の停止
    expect(m.totals.pendingFrames).toBe(0);
    expect(m.stalls).toMatchObject({ count: 1, lastMs: 400 });
    feed(m, F60, 30);
    expect(m.result!.maxMs).toBeLessThan(17);
    expectConsistent(m);
  });

  it('④ 同程度の長いフレームが続いたら、普段の速さの変化として通常の統計に戻す（60fps → 約3fps）', () => {
    const m = new FrameStatsMeter();
    startAndFinishWarmup(m);
    feed(m, F60, 20);
    m.push(0.3);
    m.push(0.32); // 同程度 → 速さの変化
    expect(m.stalls.count).toBe(0);
    expect(m.totals.speedChanges).toBe(1);
    expect(m.totals.normalFrames).toBe(22);
    feed(m, 0.31, 30);
    expect(m.stalls.count).toBe(0);
    expect(m.result!.avgMs).toBeCloseTo(310, 0);
  });

  it('④-2 停止の疑い（300ms）の次が 250ms 未満（200ms）でも、1/2〜2倍の範囲内なら速さの変化として通常の統計に戻す', () => {
    const m = new FrameStatsMeter();
    startAndFinishWarmup(m);
    feed(m, F60, 20); // 直前の通常フレームは約16.7ms
    const before = m.totals;
    expect(m.normalMedianMs).toBeCloseTo(16.667, 2);

    m.push(0.3); // 停止の疑い（中央値の10倍以上・250ms 以上）
    expect(m.totals.pendingFrames).toBe(1);
    m.push(0.2); // 300ms と 200ms は 1/2〜2倍の範囲内 → 速さの変化

    // 停止は0回、2フレームとも通常の統計に加算される
    expect(m.stalls.count).toBe(0);
    expect(m.totals).toMatchObject({ stallFrames: 0, pendingFrames: 0, speedChanges: 1 });
    expect(m.totals.normalFrames).toBe(before.normalFrames + 2);
    expect(m.totals.normalMs).toBeCloseTo(before.normalMs + 300 + 200, 6);

    // 中央値の履歴は新しい速さでやり直されている（2フレームだけ → まだ中央値の判定には使わない）
    expect(m.normalMedianMs).toBeNull();

    // その後 200ms 前後のフレームが続いても、停止と誤判定しない
    for (const dt of jitteredFrames(5, 0.3, 60, 21)) m.push(dt);
    expect(m.stalls.count).toBe(0);
    expect(m.normalMedianMs).toBeGreaterThan(150);
    expect(m.normalMedianMs).toBeLessThan(250);

    // FPS = 1000 ÷ 平均フレーム時間 が成り立つ
    expect(m.result).not.toBeNull();
    expect(m.result!.fps * m.result!.avgMs).toBeCloseTo(1000, 6);
    expect(m.result!.fps).toBeGreaterThan(3.5);
    expect(m.result!.fps).toBeLessThan(7);
    expectConsistent(m);
  });

  it('長さが大きく違うフレームが続いた場合は、どちらも単発の停止（1/2〜2倍の範囲外）', () => {
    const m = new FrameStatsMeter();
    startAndFinishWarmup(m);
    feed(m, F60, 20);
    m.push(0.3);
    m.push(0.9); // 3倍：同程度ではない → 0.3 は単発の停止、0.9 は新たな疑い
    m.push(F60); // 0.9 も単発の停止
    expect(m.stalls.count).toBe(2);
    expect(m.totals.speedChanges).toBe(0);
  });

  it('⑤ 速さが変わった後も FPS = 1000 ÷ 平均フレーム時間 が成り立ち、新しい速さで集計される', () => {
    const m = new FrameStatsMeter();
    startAndFinishWarmup(m);
    feed(m, F60, 30);
    for (const dt of jitteredFrames(4, 0.15, 60, 5)) m.push(dt); // 60fps → 約4fps（250ms 前後）
    expect(m.stalls.count).toBe(0);
    expect(m.result!.fps).toBeGreaterThan(3);
    expect(m.result!.fps).toBeLessThan(5);
    expectConsistent(m);
  });
});

describe('⑥ 低 FPS の環境で停止の判定が過剰に起きない', () => {
  for (const fps of [5, 10, 15, 30, 60]) {
    it(`約${fps}fps（ばらつき ±40%、600フレーム）で停止 0回、表示は実際の平均と一致`, () => {
      const m = new FrameStatsMeter();
      startAndFinishWarmup(m, 1 / fps);
      const frames = jitteredFrames(fps, 0.4, 600, fps);
      for (const dt of frames) m.push(dt);
      expect(m.stalls.count).toBe(0);
      expect(m.totals.normalFrames).toBe(600);
      const sumMs = frames.reduce((a, b) => a + b, 0) * 1000;
      expect(m.totals.normalMs).toBeCloseTo(sumMs, 6);
      expect(m.result!.fps).toBeGreaterThan(fps * 0.75);
      expect(m.result!.fps).toBeLessThan(fps * 1.35);
      expectConsistent(m);
    });
  }

  it('約30fps の中の単発の 400ms は停止として検出される（中央値 33ms の10倍・250ms 以上）', () => {
    const m = new FrameStatsMeter();
    startAndFinishWarmup(m, 1 / 30);
    for (const dt of jitteredFrames(30, 0.2, 30, 3)) m.push(dt);
    m.push(0.4);
    for (const dt of jitteredFrames(30, 0.2, 30, 4)) m.push(dt);
    expect(m.stalls.count).toBe(1);
  });

  it('約5fps（中央値 200ms）では、中央値の条件は 2秒以上になるため、1秒以上の条件だけが効く', () => {
    const m = new FrameStatsMeter();
    startAndFinishWarmup(m, 0.2);
    feed(m, 0.2, 20);
    expect(m.isMedianSuspect(900)).toBe(false);
    m.push(0.9); // 遅いが停止ではない（通常の最大値として表示される）
    m.push(1.2); // 1秒以上は停止
    feed(m, 0.2, 20);
    expect(m.stalls.count).toBe(1);
  });
});

describe('準備期間', () => {
  it('⑦ 起動後25フレーム目の長い停止（8秒）は準備期間中の停止として扱い、通常の統計にも停止の回数にも入れない', () => {
    const m = new FrameStatsMeter();
    m.recordStartup(300, 150);
    feed(m, F60, 24);
    m.push(8.0);
    expect(m.warmingUp).toBe('起動直後');
    feed(m, F60, 5);
    expect(m.warmingUp).toBeNull();
    expect(m.lastWarmupMaxMs).toBeCloseTo(8000, 6);
    expect(m.stalls.count).toBe(0);
    expect(m.totals.normalFrames).toBe(0);
    feed(m, F60, 60);
    expect(m.result!.maxMs).toBeLessThan(17);
  });

  it('起動時は「1秒以上 かつ 30フレーム以上」、変更後は「0.5秒以上 かつ 15フレーム以上」で終わる', () => {
    expect(STARTUP_WARMUP).toEqual({ seconds: 1, frames: 30 });
    expect(CHANGE_WARMUP).toEqual({ seconds: 0.5, frames: 15 });
    const slow = new FrameStatsMeter();
    slow.recordStartup(300, 150);
    feed(slow, 0.2, 29);
    expect(slow.warmingUp).toBe('起動直後');
    slow.push(0.2);
    expect(slow.warmingUp).toBeNull();
    slow.beginWarmup('画質変更', CHANGE_WARMUP);
    feed(slow, 0.2, 14);
    expect(slow.warmingUp).toBe('画質変更');
    slow.push(0.2);
    expect(slow.warmingUp).toBeNull();
  });

  it('⑧ タブ非表示 → 復帰：準備期間からやり直し、中央値の履歴と集計途中の値は新しくなる。保留中の疑いは単発の停止として確定する', () => {
    const m = new FrameStatsMeter();
    startAndFinishWarmup(m);
    feed(m, F60, 60);
    m.push(0.4); // 停止の疑い（保留中）でタブが隠れた
    m.beginWarmup('タブ復帰', CHANGE_WARMUP);
    expect(m.stalls.count).toBe(1);
    expect(m.normalMedianMs).toBeNull();
    expect(m.push(0)).toBe(false); // 復帰直後のフレーム（経過時間0）は無視
    feed(m, 0.05, 15); // 復帰後は 20fps
    expect(m.warmingUp).toBeNull();
    feed(m, 0.05, 20);
    expect(m.result!.fps).toBeCloseTo(20, 6);
    expect(m.stalls.count).toBe(1);
  });
});

describe('表示と不変条件', () => {
  it('⑨ 10未満は小数第1位、10以上は整数', () => {
    expect(formatFps(0.14)).toBe('0.1');
    expect(formatFps(4.93)).toBe('4.9');
    expect(formatFps(9.9)).toBe('9.9');
    expect(formatFps(10)).toBe('10');
    expect(formatFps(59.6)).toBe('60');
  });

  it('200ms のフレームでも、10フレーム以上ためてから集計する', () => {
    const m = new FrameStatsMeter();
    startAndFinishWarmup(m, 0.2);
    feed(m, 0.2, WINDOW_MIN_FRAMES - 1);
    expect(m.result).toBeNull();
    m.push(0.2);
    expect(m.result).toMatchObject({ frames: 10 });
  });

  it('⑩ すべての条件（5/10/15/30/60fps、単発の停止、1秒以上の停止、速さの変化）で FPS = 1000 ÷ 平均 と内訳の整合が成り立つ', () => {
    const rand = createRandom(99);
    for (const fps of [5, 10, 15, 30, 60]) {
      const m = new FrameStatsMeter();
      startAndFinishWarmup(m, 1 / fps);
      let pushedAfterWarmup = 0;
      for (let i = 0; i < 800; i++) {
        let dt = (1 / fps) * (0.7 + rand() * 0.6);
        if (i % 97 === 50) dt = 1.3; // 1秒以上
        if (i % 131 === 70) dt = Math.max(0.3, (10 / fps) * 1.2); // 単発の長いフレーム
        if (i === 400) dt = 1 / (fps / 3); // ここから速さが 1/3 に変わる（以降も遅いまま）
        if (i > 400) dt = (3 / fps) * (0.85 + rand() * 0.3);
        m.push(dt);
        pushedAfterWarmup++;
        if (m.result) expect(m.result.fps * m.result.avgMs).toBeCloseTo(1000, 6);
      }
      const t = m.totals;
      expect(t.normalFrames + t.stallFrames + t.pendingFrames).toBe(pushedAfterWarmup);
      expect(t.stallFrames).toBe(m.stalls.count);
      expect(m.stalls.count).toBeGreaterThan(0); // 1秒以上の停止は必ず数えられている
    }
  });

  it('経過時間が0・負・NaN のフレームは無視する', () => {
    const m = new FrameStatsMeter();
    expect(m.push(0)).toBe(false);
    expect(m.push(-1)).toBe(false);
    expect(m.push(Number.NaN)).toBe(false);
  });

  it('起動時の情報は通常の統計とは別に保持する', () => {
    const m = new FrameStatsMeter();
    m.recordStartup(5200, 4800);
    expect(m.startupMs).toBe(5200);
    expect(m.firstFrameMs).toBe(4800);
    expect(m.warmingUp).toBe('起動直後');
  });
});

describe('readDevicePixelRatio', () => {
  it('不正な値は1として扱う', () => {
    expect(readDevicePixelRatio(undefined)).toBe(1);
    expect(readDevicePixelRatio(0)).toBe(1);
    expect(readDevicePixelRatio(Number.NaN)).toBe(1);
    expect(readDevicePixelRatio(2.625)).toBe(2.625);
  });
});
