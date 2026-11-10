import { describe, expect, it } from 'vitest';
import { FixedStepAccumulator, FrameLimiter } from '../src/core/GameLoop';

const DT = 1 / 60;

describe('FixedStepAccumulator', () => {
  it('60Hzの描画では毎フレーム1ティック', () => {
    const acc = new FixedStepAccumulator(DT, 5);
    let total = 0;
    for (let i = 0; i < 120; i++) total += acc.advance(DT).steps;
    expect(total).toBe(120);
  });

  it('30fpsの描画では毎フレーム2ティック（ゲームの進み方は変わらない）', () => {
    const acc = new FixedStepAccumulator(DT, 5);
    let total = 0;
    for (let i = 0; i < 60; i++) total += acc.advance(1 / 30).steps;
    expect(total).toBe(120);
  });

  it('120Hzの描画では2フレームに1ティックになり、alphaで補間できる', () => {
    const acc = new FixedStepAccumulator(DT, 5);
    const r1 = acc.advance(1 / 120);
    expect(r1.steps).toBe(0);
    expect(r1.alpha).toBeCloseTo(0.5, 5);
    const r2 = acc.advance(1 / 120);
    expect(r2.steps).toBe(1);
    expect(r2.alpha).toBeCloseTo(0, 5);
  });

  it('1フレームのティック数は上限で打ち切り、余りを捨てる', () => {
    const acc = new FixedStepAccumulator(DT, 5);
    const r = acc.advance(0.2); // 12ティック分
    expect(r.steps).toBe(5);
    expect(r.droppedTime).toBeGreaterThan(0);
    // 次のフレームは通常どおり
    expect(acc.advance(DT).steps).toBe(1);
  });

  it('タブ復帰などの巨大な経過時間は切り詰める', () => {
    const acc = new FixedStepAccumulator(DT, 100, 0.25);
    const r = acc.advance(10);
    expect(r.steps).toBe(15);
    expect(r.droppedTime).toBeCloseTo(9.75, 5);
  });

  it('負の経過時間は無視する', () => {
    const acc = new FixedStepAccumulator(DT, 5);
    expect(acc.advance(-1).steps).toBe(0);
  });
});

describe('FrameLimiter', () => {
  it('上限なしなら毎回描画する', () => {
    const lim = new FrameLimiter();
    let n = 0;
    for (let i = 0; i < 60; i++) if (lim.shouldRender(i * 16.667)) n++;
    expect(n).toBe(60);
  });

  it('60Hzの画面で30fps上限なら半分だけ描画する', () => {
    const lim = new FrameLimiter();
    lim.setMaxFps(30);
    let n = 0;
    for (let i = 0; i < 60; i++) if (lim.shouldRender(i * 16.667)) n++;
    expect(n).toBe(30);
  });

  it('画面の更新間隔が揺らいでも30fps上限が20fpsに落ちない', () => {
    const lim = new FrameLimiter();
    lim.setMaxFps(30);
    let n = 0;
    let t = 0;
    for (let i = 0; i < 60; i++) {
      t += i % 2 === 0 ? 16.2 : 17.1; // 揺らぎ
      if (lim.shouldRender(t)) n++;
    }
    expect(n).toBeGreaterThanOrEqual(29);
  });

  it('120Hzの画面で30fps上限なら4回に1回描画する', () => {
    const lim = new FrameLimiter();
    lim.setMaxFps(30);
    let n = 0;
    for (let i = 0; i < 120; i++) if (lim.shouldRender(i * 8.333)) n++;
    expect(n).toBe(30);
  });
});
