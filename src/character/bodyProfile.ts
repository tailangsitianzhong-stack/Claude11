/**
 * 体型プロファイル（A3。DESIGN_DECISIONS 9章）。
 *
 * 部位の寸法（幅×高さ×奥行、m）は設計案の表の値。高さは「関節から関節まで」の長さで、
 * 関節での重ね（子の部位が関節の反対側へはみ出す分）は含まない（bodyMeshes.ts で足す）。
 *
 * 「提案値」と書いた項目は設計案に数値がなく、CP1 で提案して承認を待つ値（9-4 の未確定事項）。
 */

export interface PartSize {
  /** 幅（x） */
  w: number;
  /** 高さ（y。関節から関節までの長さ） */
  h: number;
  /** 奥行（z） */
  d: number;
}

export interface BodyProfile {
  readonly id: string;
  /** 全高（足の裏から頭の上端まで） */
  readonly height: number;
  readonly head: PartSize;
  readonly neck: PartSize;
  readonly chest: PartSize;
  readonly waist: PartSize;
  readonly upperArm: PartSize;
  readonly forearm: PartSize;
  readonly hand: PartSize;
  readonly thigh: PartSize;
  readonly shin: PartSize;
  readonly foot: PartSize;
  /** 胸の台形：下側の幅（上側は chest.w） */
  readonly chestBottomWidth: number;
  /** 肩の関節を胸の側面からどれだけ内側に置くか */
  readonly shoulderInset: number;
  /** 肩の関節を胸の上端からどれだけ下に置くか（提案値。肩の高さ ≒ 1.38m になる値） */
  readonly shoulderDrop: number;
  /** 股関節の左右の間隔の半分（提案値。太ももの間に約3cmのすき間） */
  readonly hipHalfSpacing: number;
  /** 足首の関節から、かかと・つま先までの長さ（足の長さ = 合計） */
  readonly heel: number;
  readonly toe: number;
  /** 下側の太さの比率（上を 1 とする）。「上が太い」部位の先細り（提案値） */
  readonly taper: { upperArm: number; forearm: number; thigh: number; shin: number };
  /** 角の丸め（体・頭） */
  readonly bevelBody: number;
  readonly bevelHead: number;
}

/** 体型A：標準、全高 1.80m（操作キャラクター） */
export const BODY_A: BodyProfile = Object.freeze({
  id: 'A',
  height: 1.8,
  head: { w: 0.36, h: 0.34, d: 0.34 },
  neck: { w: 0.12, h: 0.08, d: 0.12 },
  chest: { w: 0.5, h: 0.36, d: 0.26 },
  // 腰の幅は正式値 0.42m（9-4：部位の寸法表を優先）
  waist: { w: 0.42, h: 0.18, d: 0.24 },
  upperArm: { w: 0.15, h: 0.3, d: 0.15 },
  forearm: { w: 0.14, h: 0.27, d: 0.14 },
  hand: { w: 0.13, h: 0.13, d: 0.11 },
  thigh: { w: 0.19, h: 0.4, d: 0.19 },
  shin: { w: 0.16, h: 0.38, d: 0.17 },
  foot: { w: 0.17, h: 0.09, d: 0.28 },
  chestBottomWidth: 0.44,
  shoulderInset: 0.03,
  shoulderDrop: 0.03,
  hipHalfSpacing: 0.11,
  heel: 0.08,
  toe: 0.2,
  taper: { upperArm: 0.85, forearm: 0.9, thigh: 0.8, shin: 0.82 },
  bevelBody: 0.025,
  bevelHead: 0.05,
});

/** 関節の高さ・位置（立った状態、足の裏 y=0、正面 +Z、左 +X）。体型の寸法から計算する */
export interface BodyLayout {
  ankleY: number;
  kneeY: number;
  hipJointY: number;
  /** 腰の部位の下端・上端（= 胸の下端） */
  waistBottomY: number;
  chestBottomY: number;
  chestTopY: number;
  shoulderY: number;
  shoulderX: number;
  elbowY: number;
  wristY: number;
  /** 頭の下端（頭の上端 = 全高） */
  headBottomY: number;
  hipX: number;
}

export function computeLayout(p: BodyProfile): BodyLayout {
  const ankleY = p.foot.h;
  const kneeY = ankleY + p.shin.h;
  const hipJointY = kneeY + p.thigh.h;
  const chestBottomY = hipJointY + p.waist.h;
  const chestTopY = chestBottomY + p.chest.h;
  const shoulderY = chestTopY - p.shoulderDrop;
  const elbowY = shoulderY - p.upperArm.h;
  return {
    ankleY,
    kneeY,
    hipJointY,
    waistBottomY: hipJointY,
    chestBottomY,
    chestTopY,
    shoulderY,
    shoulderX: p.chest.w / 2 - p.shoulderInset,
    elbowY,
    wristY: elbowY - p.forearm.h,
    headBottomY: p.height - p.head.h,
    hipX: p.hipHalfSpacing,
  };
}

/**
 * 体型B（A3 CP2）：操作しないダミー。全高 1.72m、肩幅 ×0.88、腰の幅 ×1.04、手足の太さ ×0.93（9-2）。
 *
 * 体型A からの作り方（倍率の割り当ては CP2 の提案値。9-4）：
 * - 縦の長さ（各部位の高さ・肩の下げ）は全高の比（1.72 / 1.80）で縮める。股関節・肩の高さも同じ比で下がる
 * - 頭・首・手・足は、全高の比で全体を縮める（形の比率は体型A と同じ）
 * - 肩幅：胸の幅（上・下とも）と肩の関節の内側への寄せを ×0.88
 * - 腰の幅：腰の部位の幅と股関節の左右の間隔を ×1.04
 * - 手足の太さ：上腕・前腕・太もも・下腿の幅と奥行を ×0.93
 * - 胸・腰の奥行は全高の比。角の丸めは体型A と同じ
 */
export function createBodyB(a: BodyProfile = BODY_A): BodyProfile {
  const k = 1.72 / a.height;
  const all = (p: PartSize): PartSize => ({ w: p.w * k, h: p.h * k, d: p.d * k });
  const limb = (p: PartSize): PartSize => ({ w: p.w * 0.93, h: p.h * k, d: p.d * 0.93 });
  return Object.freeze({
    ...a,
    id: 'B',
    height: 1.72,
    head: all(a.head),
    neck: all(a.neck),
    chest: { w: a.chest.w * 0.88, h: a.chest.h * k, d: a.chest.d * k },
    waist: { w: a.waist.w * 1.04, h: a.waist.h * k, d: a.waist.d * k },
    upperArm: limb(a.upperArm),
    forearm: limb(a.forearm),
    hand: all(a.hand),
    thigh: limb(a.thigh),
    shin: limb(a.shin),
    foot: all(a.foot),
    chestBottomWidth: a.chestBottomWidth * 0.88,
    shoulderInset: a.shoulderInset * 0.88,
    shoulderDrop: a.shoulderDrop * k,
    hipHalfSpacing: a.hipHalfSpacing * 1.04,
    heel: a.heel * k,
    toe: a.toe * k,
    taper: { ...a.taper },
  });
}

/** 体型B（ダミー） */
export const BODY_B: BodyProfile = createBodyB();
