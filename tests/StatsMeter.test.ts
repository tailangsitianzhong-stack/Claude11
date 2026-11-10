import { describe, expect, it } from 'vitest';
import {
  CHANGE_WARMUP,
  FrameStatsMeter,
  STALL_ABSOLUTE_MS,
  STARTUP_WARMUP,
  WINDOW_MIN_FRAMES,
  formatFps,
} from '../src/debug/StatsOverlay';
import { readDevicePixelRatio } from '../src/platform/ViewportManager';

/**
 * フレーム時間（秒）を直接与えて動かす。実時間には依存しない。
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

describe('準備期間', () => {
  it('① 起動後25フレーム目に長い停止（8秒）が起きても、準備期間中の停止として扱う（通常の統計・停止の回数に入らない）', () => {
    const m = new FrameStatsMeter();
    m.recordStartup(300, 150);
    feed(m, F60, 24);
    m.push(8.0); // 25フレーム目：8秒の停止（経過時間は1秒を超えるが、フレーム数が30に満たない）
    expect(m.warmingUp).toBe('起動直後');
    feed(m, F60, 5); // 30フレーム目で準備期間が終わる
    expect(m.warmingUp).toBeNull();
    expect(m.lastWarmupMaxMs).toBeCloseTo(8000, 6);
    expect(m.stalls.count).toBe(0);
    feed(m, F60, 60);
    expect(m.result!.maxMs).toBeLessThan(17);
  });

  it('② 起動時の準備期間は「1秒以上 かつ 30フレーム以上」で終わる', () => {
    // 速いフレーム：30フレームでは0.5秒しか経たない → 1秒（60フレーム）まで続く
    const fast = new FrameStatsMeter();
    fast.recordStartup(300, 150);
    feed(fast, F60, 59);
    expect(fast.warmingUp).toBe('起動直後');
    fast.push(F60);
    expect(fast.warmingUp).toBeNull();
    // 遅いフレーム（0.2秒）：1秒は5フレームで経つが、30フレームまで続く
    const slow = new FrameStatsMeter();
    slow.recordStartup(300, 150);
    feed(slow, 0.2, 29);
    expect(slow.warmingUp).toBe('起動直後');
    slow.push(0.2);
    expect(slow.warmingUp).toBeNull();
    expect(STARTUP_WARMUP).toEqual({ seconds: 1, frames: 30 });
  });

  it('③ 画質変更・タブ復帰の準備期間は「0.5秒以上 かつ 15フレーム以上」で終わる', () => {
    expect(CHANGE_WARMUP).toEqual({ seconds: 0.5, frames: 15 });
    for (const reason of ['画質変更', 'タブ復帰']) {
      const m = new FrameStatsMeter();
      startAndFinishWarmup(m);
      m.beginWarmup(reason, CHANGE_WARMUP);
      feed(m, 0.1, 14); // 1.4秒経過・14フレーム → まだ
      expect(m.warmingUp).toBe(reason);
      m.push(0.1); // 15フレーム目
      expect(m.warmingUp).toBeNull();

      const fast = new FrameStatsMeter();
      startAndFinishWarmup(fast);
      fast.beginWarmup(reason, CHANGE_WARMUP);
      feed(fast, F60, 29); // 15フレームは超えたが0.483秒
      expect(fast.warmingUp).toBe(reason);
      fast.push(F60); // 0.5秒
      expect(fast.warmingUp).toBeNull();
    }
  });
});

describe('長い停止', () => {
  it('④ 準備期間の後の長い停止は、通常の FPS・平均・最大から除外される', () => {
    const m = new FrameStatsMeter();
    startAndFinishWarmup(m, 0.2);
    feed(m, 0.2, 5);
    m.push(7.5); // 停止
    feed(m, 0.2, 5);
    expect(m.result).not.toBeNull();
    expect(m.result!.avgMs).toBeCloseTo(200, 6);
    expect(m.result!.maxMs).toBeCloseTo(200, 6);
    expect(m.result!.fps).toBeCloseTo(5, 6);
  });

  it('⑤ 停止の回数・最大時間・直近の時間を記録する', () => {
    const m = new FrameStatsMeter();
    startAndFinishWarmup(m);
    m.push(1.2);
    feed(m, F60, 20);
    m.push(7.6);
    feed(m, F60, 20);
    m.push(2.0);
    expect(m.stalls).toEqual({ count: 3, maxMs: 7600, lastMs: 2000 });
  });

  it('1秒以上は、中央値の履歴がなくても停止とみなす', () => {
    const m = new FrameStatsMeter();
    startAndFinishWarmup(m);
    expect(m.normalMedianMs).toBeNull(); // 準備期間の終了直後は履歴がない
    expect(m.isStall(STALL_ABSOLUTE_MS)).toBe(true);
    expect(m.isStall(999)).toBe(false);
  });

  it('中央値の10倍以上は停止。ただし通常フレームが10個そろうまでは中央値で判定しない', () => {
    const m = new FrameStatsMeter();
    startAndFinishWarmup(m);
    feed(m, F60, 9);
    expect(m.isStall(200)).toBe(false); // 履歴が9個：中央値を使わない
    m.push(F60);
    expect(m.normalMedianMs).toBeCloseTo(16.667, 2);
    expect(m.isStall(200)).toBe(true); // 16.7ms × 10 = 167ms 以上
    expect(m.isStall(150)).toBe(false);
  });

  it('準備期間中の長いフレームは、停止の回数に入らない', () => {
    const m = new FrameStatsMeter();
    startAndFinishWarmup(m);
    m.beginWarmup('画質変更', CHANGE_WARMUP);
    m.push(3.0);
    feed(m, F60, 30);
    expect(m.stalls.count).toBe(0);
    expect(m.lastWarmupMaxMs).toBeCloseTo(3000, 6);
  });
});

describe('FPS の表示と集計', () => {
  it('⑥ 10未満は小数第1位まで表示する', () => {
    expect(formatFps(0.14)).toBe('0.1');
    expect(formatFps(4.93)).toBe('4.9');
    expect(formatFps(9.9)).toBe('9.9');
  });

  it('⑦ 10以上は整数で表示する', () => {
    expect(formatFps(10)).toBe('10');
    expect(formatFps(60)).toBe('60');
    expect(formatFps(59.6)).toBe('60');
  });

  it('⑧ 200ms 程度のフレームでも、10フレーム以上ためてから集計する（2〜3フレームで値を出さない）', () => {
    const m = new FrameStatsMeter();
    startAndFinishWarmup(m, 0.2);
    feed(m, 0.2, WINDOW_MIN_FRAMES - 1); // 1.8秒経過しても9フレーム
    expect(m.result).toBeNull();
    m.push(0.2);
    expect(m.result).toMatchObject({ frames: 10 });
    expect(m.result!.fps).toBeCloseTo(5, 6);
    // 値がばらつくフレーム（180〜280ms）でも、10フレーム単位で安定する
    const jitter = [0.18, 0.28, 0.2, 0.22, 0.19, 0.27, 0.21, 0.2, 0.25, 0.2];
    for (const dt of jitter) m.push(dt);
    expect(m.result!.avgMs).toBeCloseTo(220, 6);
  });

  it('60fps でも「0.5秒以上 かつ 10フレーム以上」で集計する', () => {
    const m = new FrameStatsMeter();
    startAndFinishWarmup(m);
    feed(m, F60, 29);
    expect(m.result).toBeNull();
    m.push(F60);
    expect(m.result!.fps).toBeCloseTo(60, 6);
  });

  it('⑨ FPS = 1000 ÷ 平均フレーム時間 が常に成り立つ', () => {
    const m = new FrameStatsMeter();
    startAndFinishWarmup(m);
    const seq = [0.016, 0.033, 0.05, 0.2, 0.011, 0.09, 0.3, 0.017, 0.12, 0.045];
    for (let i = 0; i < 200; i++) {
      m.push(seq[i % seq.length]!);
      if (m.result) expect(m.result.fps).toBeCloseTo(1000 / m.result.avgMs, 9);
    }
    expect(m.result).not.toBeNull();
  });

  it('⑩ タブ非表示 → 復帰：復帰後は準備期間からやり直し、非表示の間の時間は統計に入らない', () => {
    // Game は非表示でループを止め、復帰時に beginWarmup('タブ復帰') を呼ぶ。復帰直後のフレームの経過時間は 0（GameLoop が lastTime を消す）
    const m = new FrameStatsMeter();
    startAndFinishWarmup(m);
    feed(m, F60, 60);
    const before = m.result!;
    m.beginWarmup('タブ復帰', CHANGE_WARMUP);
    expect(m.push(0)).toBe(false); // 復帰直後のフレーム（経過時間0）は無視
    expect(m.warmingUp).toBe('タブ復帰');
    feed(m, F60, 30);
    expect(m.warmingUp).toBeNull();
    feed(m, F60, 30);
    expect(m.result!.fps).toBeCloseTo(before.fps, 6);
    expect(m.stalls.count).toBe(0);
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
