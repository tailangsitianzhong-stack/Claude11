/**
 * WebGL のエラーの読み取りと分類（純粋なロジック。単体テストの対象）。
 *
 * 描画後の検査（RenderPipeline.postvalidate）では、HDR / MSAA の描画バッファの組み合わせが使えないことの根拠として
 * **INVALID_FRAMEBUFFER_OPERATION（不完全なフレームバッファへの描画・読み書き）だけ**を使う。
 * 使えない形式のバッファは「不完全なフレームバッファ」として現れるため。
 * INVALID_ENUM / INVALID_VALUE / INVALID_OPERATION / OUT_OF_MEMORY は、シェーダーの失敗やほかの描画処理など、
 * バッファ以外の原因でも発生するため、フォールバックの根拠にしない（種類をログに出す）。
 */

export const GL_NO_ERROR = 0;
export const GL_INVALID_ENUM = 0x0500;
export const GL_INVALID_VALUE = 0x0501;
export const GL_INVALID_OPERATION = 0x0502;
export const GL_OUT_OF_MEMORY = 0x0505;
export const GL_INVALID_FRAMEBUFFER_OPERATION = 0x0506;
export const GL_CONTEXT_LOST_WEBGL = 0x9242;

export const GL_ERROR_NAMES: Readonly<Record<number, string>> = {
  [GL_INVALID_ENUM]: 'INVALID_ENUM',
  [GL_INVALID_VALUE]: 'INVALID_VALUE',
  [GL_INVALID_OPERATION]: 'INVALID_OPERATION',
  [GL_OUT_OF_MEMORY]: 'OUT_OF_MEMORY',
  [GL_INVALID_FRAMEBUFFER_OPERATION]: 'INVALID_FRAMEBUFFER_OPERATION',
  [GL_CONTEXT_LOST_WEBGL]: 'CONTEXT_LOST_WEBGL',
};

export function glErrorName(code: number): string {
  return GL_ERROR_NAMES[code] ?? `0x${code.toString(16).toUpperCase()}`;
}

/**
 * 溜まっている GL エラーをすべて読み出す。
 * WebGL はエラーの種類ごとにフラグを1つ持ち、getError() は呼ぶたびに1つずつ返してフラグを下ろす（順番は実装依存）。
 * そのため、同時に複数の種類が起きていても、NO_ERROR が返るまで読めば全種類を取得できる。
 * コンテキスト喪失（CONTEXT_LOST_WEBGL）は描画の失敗ではないため、そこで読み出しをやめる。
 * 返り値は重複を除いた、読み出した順のエラーコード。
 */
export function drainGlErrors(getError: () => number, max = 16): number[] {
  const codes: number[] = [];
  for (let i = 0; i < max; i++) {
    const code = getError();
    if (code === GL_NO_ERROR || code === GL_CONTEXT_LOST_WEBGL) break;
    if (!codes.includes(code)) codes.push(code);
  }
  return codes;
}

export interface GlErrorClassification {
  /** 描画バッファの失敗の根拠になるエラー（INVALID_FRAMEBUFFER_OPERATION）があるか */
  bufferFailureEvidence: boolean;
  /** バッファの失敗の根拠にしないエラー（ログに出すだけ） */
  unrelated: number[];
}

export function classifyGlErrors(codes: readonly number[]): GlErrorClassification {
  return {
    bufferFailureEvidence: codes.includes(GL_INVALID_FRAMEBUFFER_OPERATION),
    unrelated: codes.filter((c) => c !== GL_INVALID_FRAMEBUFFER_OPERATION),
  };
}

export type PostValidationVerdict =
  /** エラーなし：検証を終える */
  | { kind: 'ok' }
  /** バッファの失敗の根拠が1回だけ：次のフレームで再確認する（検証を続ける） */
  | { kind: 'retry'; streak: number; unrelated: number[] }
  /** バッファの失敗の根拠が連続した：現在の組み合わせを失敗とみなす */
  | { kind: 'bufferFailure'; streak: number; unrelated: number[] }
  /** バッファの失敗の根拠ではないエラーだけ：フォールバックせずに検証を終える（エラーはログに出す） */
  | { kind: 'unrelatedOnly'; unrelated: number[] };

/**
 * 描画後の検査の判定（連続回数の管理）。
 * INVALID_FRAMEBUFFER_OPERATION が confirmFrames 回連続した場合だけ、バッファの組み合わせの失敗とみなす。
 * 途中でエラーなし、または無関係なエラーだけのフレームがあれば、連続回数は0に戻る。
 */
export class PostValidationTracker {
  private streak = 0;

  constructor(readonly confirmFrames: number) {}

  get currentStreak(): number {
    return this.streak;
  }

  /** 組み合わせを変更したとき・検証をやり直すときに呼ぶ */
  reset(): void {
    this.streak = 0;
  }

  evaluate(codes: readonly number[]): PostValidationVerdict {
    if (codes.length === 0) {
      this.streak = 0;
      return { kind: 'ok' };
    }
    const { bufferFailureEvidence, unrelated } = classifyGlErrors(codes);
    if (!bufferFailureEvidence) {
      this.streak = 0;
      return { kind: 'unrelatedOnly', unrelated };
    }
    this.streak++;
    if (this.streak < this.confirmFrames) return { kind: 'retry', streak: this.streak, unrelated };
    const streak = this.streak;
    this.streak = 0;
    return { kind: 'bufferFailure', streak, unrelated };
  }
}
