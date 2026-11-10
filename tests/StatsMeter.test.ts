import { describe, expect, it } from 'vitest';
import { CHANGE_WARMUP_SEC, FrameStatsMeter, STARTUP_WARMUP_SEC } from '../src/debug/StatsOverlay';
import { readDevicePixelRatio } from '../src/platform/ViewportManager';

const F = 1 / 60;

describe('FrameStatsMeter（ウォームアップの除外）', () => {
  it('起動時の情報は通常の統計とは別に保持する', () => {
    const m = new FrameStatsMeter();
    m.recordStartup(5200, 4800);
    expect(m.startupMs).toBe(5200);
    expect(m.firstFrameMs).toBe(4800);
    expect(m.warmingUp).toBe('起動直後');
  });

  it('ウォームアップ中の遅いフレームは通常のFPS統計に含めず、最大値だけ別に記録する', () => {
    const m = new FrameStatsMeter();
    m.recordStartup(1000, 900);
    m.push(0.4); // シェーダー準備などの遅いフレーム
    m.push(0.3);
    for (let t = 0; t < STARTUP_WARMUP_SEC; t += F) m.push(F);
    expect(m.warmingUp).toBeNull();
    expect(m.lastWarmupMaxMs).toBeCloseTo(400, 5);
    for (let i = 0; i < 60; i++) m.push(F);
    expect(m.result).not.toBeNull();
    expect(m.result!.fps).toBeCloseTo(60, 0);
    expect(m.result!.maxMs).toBeLessThan(17);
  });

  it('画質変更でウォームアップをやり直し、それまでの集計途中の値は捨てる', () => {
    const m = new FrameStatsMeter();
    m.recordStartup(1000, 10);
    for (let t = 0; t < STARTUP_WARMUP_SEC + 1; t += F) m.push(F);
    m.beginWarmup('画質変更', CHANGE_WARMUP_SEC);
    expect(m.warmingUp).toBe('画質変更');
    m.push(0.2);
    for (let t = 0; t < CHANGE_WARMUP_SEC; t += F) m.push(F);
    expect(m.warmingUp).toBeNull();
    for (let i = 0; i < 40; i++) m.push(F);
    expect(m.result!.maxMs).toBeLessThan(17);
  });

  it('経過時間0のフレーム（初回）は無視する', () => {
    const m = new FrameStatsMeter();
    expect(m.push(0)).toBe(false);
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
