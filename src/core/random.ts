/**
 * 再現性のある疑似乱数（mulberry32）。
 * ステージの模様など「毎回同じ見た目」にしたい手続き生成に使う（Math.random は使わない）。
 */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomRange(rand: () => number, min: number, max: number): number {
  return min + (max - min) * rand();
}
