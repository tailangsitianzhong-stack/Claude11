import { createRandom, randomRange } from '../../../core/random';

/**
 * Dusk Colosseum の寸法（単位 m。床面の高さを 0 とする）。
 * ステージの寸法はすべてこのファイルだけに書く（見た目の調整・当たり判定のデータが同じ値を参照する）。
 */
export const COLOSSEUM = {
  /** 戦闘エリアの台座（床）の半径 */
  arenaRadius: 16,
  /** 戦闘の境界（ブロンズの象嵌）の半径 */
  boundaryRadius: 15,
  /** 象嵌の幅 */
  boundaryInlayWidth: 0.12,
  /** 台座の高さ（外の地面は -platformHeight） */
  platformHeight: 0.5,
  /** 中央の紋章の半径 */
  emblemRadius: 4,
  /** 位置の目安となる内側の円の半径 */
  accentRingRadius: 10,
  /** 外周の低い壁（A2-2）：内側の面の半径。外側の面は台座の端（arenaRadius）にそろえる */
  rimWallInnerRadius: 15.72,
  /** 低い壁の高さ（床から、ブロンズの縁取りの上端まで） */
  rimWallHeight: 0.6,
  /** 壁の上のブロンズの縁取りの厚さ */
  rimCapThickness: 0.06,
  /** 外周の段差（柱の並ぶ一段低い石の段）：外側の半径と、床からの下がり */
  terraceOuterRadius: 20,
  terraceDrop: 0.25,
  /** 柱（A2-2）。段差の上に立ち、高さは段差の面から柱頭の上端まで */
  pillarCount: 12,
  pillarRingRadius: 18,
  pillarHeight: 7.5,
  pillarDiameter: 1.1,
  /** 柱の並びの開始角（正面 +Z の真ん中に柱が来ないよう、間隔の半分ずらす） */
  pillarAngleOffsetDeg: 15,
  /** 観客席（A2-3） */
  standsInnerRadius: 24,
  standsOuterRadius: 36,
  /** 外壁（A2-3） */
  outerWallRadius: 38,
  outerWallHeight: 12,
  /** 外壁まで含めたステージ全体を包む球（A2-3 で観客席・外壁を作った後の全景の基準） */
  fullOverviewCenterY: 4,
  fullOverviewRadius: 40,
} as const;

/**
 * 確認用カメラの全景の基準（作成済みの部分を包む球）。
 * 工程が進むと広がる：A2-1 はアリーナ（半径16）＋余白、A2-2 は段差の外周（半径20）と柱の頂上（高さ約7.3）まで、
 * A2-3 以降は外壁まで（半径40）。包む範囲はテスト（colosseumLayout.test.ts）で確かめる。
 */
export const BUILT_OVERVIEW = {
  centerY: 3,
  radius: 20.6,
} as const;

/** 柱の中心の位置（上から見た x, z）。正確に等間隔 */
export function pillarPositions(): [number, number][] {
  const C = COLOSSEUM;
  const out: [number, number][] = [];
  for (let i = 0; i < C.pillarCount; i++) {
    const a = ((C.pillarAngleOffsetDeg + (360 / C.pillarCount) * i) * Math.PI) / 180;
    out.push([Math.sin(a) * C.pillarRingRadius, Math.cos(a) * C.pillarRingRadius]);
  }
  return out;
}

/** 床の石畳の1つの環（リング） */
export interface FloorRing {
  inner: number;
  outer: number;
  /** 円周方向の石の数（整数） */
  count: number;
  /** 石の並びの開始位置のずれ（石1個分を1とする） */
  phase: number;
  /** 0: 通常の石 / 1: 位置の目安の帯（半径10） / 2: 外周の縁石（境界の外） */
  type: 0 | 1 | 2;
  /** 石の長さを不均一にするゆらぎの周波数（整数。円周で継ぎ目が出ないように） */
  warpK: number;
  /** ゆらぎの振幅（石の単位。石の並びが逆転しない範囲） */
  warpAmp: number;
  /** 石ごとの色の乱数の種 */
  seed: number;
}

export const MAX_FLOOR_RINGS = 16;

/**
 * 石畳の環を決定的に生成する（シェーダーへ uniform 配列として渡す）。
 * - 紋章の外側（半径4）から境界（半径15）までを、幅 0.75〜1.25m の環で隙間なく埋める
 * - 半径10の位置に、目安の帯（幅0.4m）を入れる
 * - 境界の外側（15〜16）は縁石の環
 * - 石の長さは環ごとに 0.95〜1.45m を狙い、さらに環の中でゆらぎを与えて不均一にする
 */
export function generateFloorRings(seed = 20261110): FloorRing[] {
  const rand = createRandom(seed);
  const C = COLOSSEUM;
  const inlayHalf = C.boundaryInlayWidth / 2;
  const accentHalf = 0.2;
  const rings: FloorRing[] = [];

  const fill = (from: number, to: number): void => {
    const widths: number[] = [];
    let total = 0;
    while (total < to - from - 0.6) {
      const w = randomRange(rand, 0.75, 1.25);
      widths.push(w);
      total += w;
    }
    const scale = (to - from) / total;
    let r = from;
    for (const w of widths) {
      const inner = r;
      const outer = r + w * scale;
      rings.push(makeRing(inner, outer, 0, rand));
      r = outer;
    }
    rings[rings.length - 1]!.outer = to; // 浮動小数点の誤差を消す
  };

  fill(C.emblemRadius, C.accentRingRadius - accentHalf);
  rings.push(makeRing(C.accentRingRadius - accentHalf, C.accentRingRadius + accentHalf, 1, rand));
  fill(C.accentRingRadius + accentHalf, C.boundaryRadius - inlayHalf);
  // 象嵌の帯（boundaryRadius ± inlayHalf）はシェーダー側で描く。縁石はその外側から台座の端まで
  rings.push(makeRing(C.boundaryRadius + inlayHalf, C.arenaRadius, 2, rand));
  return rings;
}

function makeRing(inner: number, outer: number, type: 0 | 1 | 2, rand: () => number): FloorRing {
  const mid = (inner + outer) / 2;
  const targetLength = type === 1 ? randomRange(rand, 0.6, 0.8) : randomRange(rand, 0.95, 1.45);
  const count = Math.max(8, Math.round((2 * Math.PI * mid) / targetLength));
  const warpK = 1 + Math.floor(rand() * 3);
  // 並びが逆転しない条件：amp * 2πk / count < 1。余裕をもって 0.35 倍
  const warpAmp = (0.35 * count) / (2 * Math.PI * warpK);
  return { inner, outer, count, phase: rand(), type, warpK, warpAmp, seed: Math.floor(rand() * 1000) };
}
