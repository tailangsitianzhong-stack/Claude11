import { describe, expect, it } from 'vitest';
import { RenderTargetFallback, describeConfig } from '../src/render/renderTargetFallback';

describe('描画バッファのフォールバック順', () => {
  it('HDR対応・MSAA要求ありなら HDR+MSAA → HDR → 8bit+MSAA → 8bit → null の順', () => {
    const fb = new RenderTargetFallback(true);
    const seen: string[] = [];
    for (;;) {
      const c = fb.resolve(4);
      if (!c) break;
      seen.push(describeConfig(c));
      fb.markFailed(c, 'test');
    }
    expect(seen).toEqual(['HDR + MSAA ×4', 'HDR（MSAAなし）', '8bit + MSAA ×4', '8bit（MSAAなし）']);
    expect(fb.resolve(4)).toBeNull();
    expect(fb.failures).toHaveLength(4);
  });

  it('MSAA要求なしなら HDR → 8bit の順', () => {
    const fb = new RenderTargetFallback(true);
    expect(fb.resolve(0)).toEqual({ hdr: true, msaaSamples: 0 });
    fb.markFailed({ hdr: true, msaaSamples: 0 }, 'x');
    expect(fb.resolve(0)).toEqual({ hdr: false, msaaSamples: 0 });
  });

  it('HDR非対応の端末では最初から8bit', () => {
    const fb = new RenderTargetFallback(false);
    expect(fb.resolve(4)).toEqual({ hdr: false, msaaSamples: 4 });
    expect(fb.resolve(0)).toEqual({ hdr: false, msaaSamples: 0 });
  });

  it('失敗した組み合わせは画質を切り替えても再び選ばない', () => {
    const fb = new RenderTargetFallback(true);
    fb.markFailed({ hdr: true, msaaSamples: 4 }, 'MSAA不可');
    // 段階4（MSAA×2）に切り替えても、HDR+MSAA は失敗済みとして扱う
    expect(fb.resolve(2)).toEqual({ hdr: true, msaaSamples: 0 });
    // MSAAを要求しない段階では HDR のまま
    expect(fb.resolve(0)).toEqual({ hdr: true, msaaSamples: 0 });
  });

  it('HDRそのものが失敗したら、MSAAの有無にかかわらず8bitを使う', () => {
    const fb = new RenderTargetFallback(true);
    fb.markFailed({ hdr: true, msaaSamples: 4 }, 'x');
    fb.markFailed({ hdr: true, msaaSamples: 0 }, 'x');
    expect(fb.resolve(4)).toEqual({ hdr: false, msaaSamples: 4 });
    expect(fb.resolve(0)).toEqual({ hdr: false, msaaSamples: 0 });
  });
});
