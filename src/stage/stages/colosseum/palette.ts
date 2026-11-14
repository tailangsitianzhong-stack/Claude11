/**
 * Dusk Colosseum の色と質感（sRGB の16進数）。
 *
 * 方針：ステージは暖色・中程度の彩度、床は中間の明るさ、背景ほど暗く・かすませる。
 * キャラクター（A3）が最も高い彩度になるよう、ステージ側の彩度は抑える。
 */
export const PALETTE = {
  floor: {
    stoneA: '#CDBE9C', // 明るい砂岩
    stoneB: '#B5A383', // やや暗い砂岩
    stoneDark: '#8C7B66', // 放射状の帯石
    accent: '#9C7A62', // 半径10の目安の帯（赤みのある石）
    rim: '#7E604C', // 境界の外の縁石
    joint: '#4F453A', // 目地
    bronze: '#B8864A', // 象嵌
    emblemBg: '#4A4038', // 紋章の地（ブロンズが映えるよう暗い灰褐色）
  },
  platformSide: '#8F7D66',
  rimWall: '#A39276', // 外周の低い壁
  terrace: '#8C7C67', // 外周の段差（柱の並ぶ段）
  pillar: '#C4B496', // 柱（床より少し明るい砂岩）
  stands: '#9E8D74', // 観客席（アリーナより少し暗く、背景へ沈める）
  outerWall: '#A99780', // 外壁
  outerGround: '#5A5048',
  scaleReference: '#A9B4C2',
  /** 遠景の影絵（A2-3）。地平線の色へのかすみは farView.ts で重ねる */
  farView: { hills: '#3E3448', city: '#2C2840' },
  light: {
    sun: '#FFD9B5', // 夕日：赤くなりすぎないよう、暖かい白に寄せる（夕暮れ感は空・背景・補助光で出す）
    hemiSky: '#9AA6D6',
    hemiGround: '#6B5E52',
    fill: '#8FA8FF',
  },
  /** 空（A2-3 の空のドームと環境マップで共通）。霧の色は地平線の色にそろえる */
  envSky: { zenith: '#2A2E55', horizon: '#E8A070', ground: '#4A3A30' },
} as const;

/** 質感 */
export const MATERIAL = {
  floorRoughness: 0.85,
  bronzeRoughness: 0.42,
  // 金属感を上げすぎると、上から見たときに暗い天頂が映り込んで黒ずむため控えめにする
  bronzeMetalness: 0.55,
  jointRoughness: 0.95,
} as const;
