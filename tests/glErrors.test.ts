import { describe, expect, it } from 'vitest';
import {
  GL_CONTEXT_LOST_WEBGL,
  GL_INVALID_ENUM,
  GL_INVALID_FRAMEBUFFER_OPERATION as IFO,
  GL_INVALID_OPERATION,
  GL_INVALID_VALUE,
  GL_NO_ERROR,
  GL_OUT_OF_MEMORY,
  PostValidationTracker,
  classifyGlErrors,
  drainGlErrors,
  glErrorName,
} from '../src/render/glErrors';
import { POST_FAILURE_CONFIRM_FRAMES } from '../src/render/RenderPipeline';

/** getError() の代わり：与えた順にエラーを返し、最後は NO_ERROR */
function errorQueue(codes: number[]): () => number {
  const q = [...codes];
  return () => q.shift() ?? GL_NO_ERROR;
}

describe('GL エラーの読み出し（drainGlErrors）', () => {
  it('NO_ERROR まで全種類を読み出し、重複は除く', () => {
    expect(drainGlErrors(errorQueue([GL_INVALID_ENUM, IFO, GL_INVALID_ENUM, GL_OUT_OF_MEMORY]))).toEqual([
      GL_INVALID_ENUM,
      IFO,
      GL_OUT_OF_MEMORY,
    ]);
  });

  it('エラーがなければ空', () => {
    expect(drainGlErrors(errorQueue([]))).toEqual([]);
  });

  it('コンテキスト喪失は描画の失敗ではないので、そこで止める', () => {
    expect(drainGlErrors(errorQueue([IFO, GL_CONTEXT_LOST_WEBGL, GL_INVALID_ENUM]))).toEqual([IFO]);
  });

  it('読み出し回数の上限がある（無限ループしない）', () => {
    let n = 0;
    const always = () => {
      n++;
      return GL_INVALID_VALUE;
    };
    expect(drainGlErrors(always, 16)).toEqual([GL_INVALID_VALUE]);
    expect(n).toBe(16);
  });

  it('エラー名', () => {
    expect(glErrorName(IFO)).toBe('INVALID_FRAMEBUFFER_OPERATION');
    expect(glErrorName(0x1234)).toBe('0x1234');
  });
});

describe('GL エラーの分類（classifyGlErrors）', () => {
  it('INVALID_FRAMEBUFFER_OPERATION だけがバッファの失敗の根拠になる', () => {
    expect(classifyGlErrors([IFO])).toEqual({ bufferFailureEvidence: true, unrelated: [] });
    for (const code of [GL_INVALID_ENUM, GL_INVALID_VALUE, GL_INVALID_OPERATION, GL_OUT_OF_MEMORY]) {
      expect(classifyGlErrors([code])).toEqual({ bufferFailureEvidence: false, unrelated: [code] });
    }
  });

  it('同時に起きた無関係なエラーも、ログ用に残す', () => {
    expect(classifyGlErrors([GL_INVALID_OPERATION, IFO, GL_OUT_OF_MEMORY])).toEqual({
      bufferFailureEvidence: true,
      unrelated: [GL_INVALID_OPERATION, GL_OUT_OF_MEMORY],
    });
  });
});

describe('描画後の検査の判定（PostValidationTracker）', () => {
  const tracker = () => new PostValidationTracker(POST_FAILURE_CONFIRM_FRAMES);

  it('連続回数の既定値は2', () => {
    expect(POST_FAILURE_CONFIRM_FRAMES).toBe(2);
  });

  it('① INVALID_ENUM が1フレームだけ → フォールバックしない（検証を終える）', () => {
    expect(tracker().evaluate([GL_INVALID_ENUM]).kind).toBe('unrelatedOnly');
  });

  it('② INVALID_ENUM が毎フレーム続いても → 一度もフォールバックしない', () => {
    const t = tracker();
    for (let i = 0; i < 10; i++) expect(t.evaluate([GL_INVALID_ENUM]).kind).toBe('unrelatedOnly');
    expect(t.currentStreak).toBe(0);
  });

  it('③ INVALID_OPERATION（シェーダーの失敗など）→ フォールバックしない', () => {
    const t = tracker();
    expect(t.evaluate([GL_INVALID_OPERATION]).kind).toBe('unrelatedOnly');
    expect(t.evaluate([GL_INVALID_OPERATION]).kind).toBe('unrelatedOnly');
  });

  it('④ OUT_OF_MEMORY → バッファの組み合わせの失敗として扱わない', () => {
    const t = tracker();
    expect(t.evaluate([GL_OUT_OF_MEMORY])).toEqual({ kind: 'unrelatedOnly', unrelated: [GL_OUT_OF_MEMORY] });
    expect(t.evaluate([GL_OUT_OF_MEMORY]).kind).toBe('unrelatedOnly');
  });

  it('⑤ INVALID_FRAMEBUFFER_OPERATION が1フレームだけ → 再確認（フォールバックしない）→ 次がエラーなしなら合格', () => {
    const t = tracker();
    expect(t.evaluate([IFO])).toMatchObject({ kind: 'retry', streak: 1 });
    expect(t.evaluate([]).kind).toBe('ok');
    expect(t.currentStreak).toBe(0);
  });

  it('⑥ INVALID_FRAMEBUFFER_OPERATION が2フレーム連続 → バッファの失敗', () => {
    const t = tracker();
    expect(t.evaluate([IFO]).kind).toBe('retry');
    expect(t.evaluate([IFO])).toMatchObject({ kind: 'bufferFailure', streak: 2 });
    expect(t.currentStreak).toBe(0); // 次の組み合わせの検証は0から
  });

  it('無関係なエラーが同時に出ていても、INVALID_FRAMEBUFFER_OPERATION の連続で判定し、無関係なものはログ用に返す', () => {
    const t = tracker();
    expect(t.evaluate([GL_INVALID_ENUM, IFO])).toMatchObject({ kind: 'retry', unrelated: [GL_INVALID_ENUM] });
    expect(t.evaluate([IFO, GL_OUT_OF_MEMORY])).toMatchObject({ kind: 'bufferFailure', unrelated: [GL_OUT_OF_MEMORY] });
  });

  it('INVALID_FRAMEBUFFER_OPERATION の間に無関係なエラーだけのフレームが入ると、連続回数は0に戻る', () => {
    const t = tracker();
    expect(t.evaluate([IFO]).kind).toBe('retry');
    expect(t.evaluate([GL_INVALID_ENUM]).kind).toBe('unrelatedOnly');
    expect(t.evaluate([IFO]).kind).toBe('retry');
  });

  it('組み合わせを変更したとき（reset）は連続回数を0に戻す', () => {
    const t = tracker();
    t.evaluate([IFO]);
    t.reset();
    expect(t.evaluate([IFO]).kind).toBe('retry');
  });
});
