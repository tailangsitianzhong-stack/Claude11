import { describe, expect, it } from 'vitest';
import { REVISION, ShaderLib } from 'three';
import { applyInsertions, ShaderPatchError, VERIFIED_THREE_REVISION } from '../src/render/internal/threeShaderPatch';

/**
 * three.js の更新で、床の模様の差し込み先（アンカー）が無くなっていないかを、実際の ShaderLib に対して検査する。
 * MeshStandardMaterial は ShaderLib.standard（meshphysical）を使う。onBeforeCompile の時点では #include は未展開。
 */
describe('シェーダーの差し込み（three.js の内部仕様への依存）', () => {
  const anchorsVertex = ['#include <common>', '#include <begin_vertex>'];
  const anchorsFragment = ['#include <common>', '#include <color_fragment>', '#include <roughnessmap_fragment>', '#include <metalnessmap_fragment>'];

  it('確認済みのバージョンと一致する', () => {
    expect(REVISION).toBe(VERIFIED_THREE_REVISION);
  });

  it('MeshStandardMaterial のシェーダーに、すべての差し込み先がある', () => {
    for (const a of anchorsVertex) expect(ShaderLib.standard.vertexShader).toContain(a);
    for (const a of anchorsFragment) expect(ShaderLib.standard.fragmentShader).toContain(a);
  });

  it('差し込みは、アンカーの直後に1回だけ入る', () => {
    const out = applyInsertions(ShaderLib.standard.fragmentShader, [{ anchor: '#include <color_fragment>', code: '// INSERTED' }], 'fragment');
    expect(out.split('// INSERTED').length - 1).toBe(1);
    expect(out).toContain('#include <color_fragment>\n// INSERTED');
  });

  it('アンカーが無い場合は ShaderPatchError（呼び出し側が単色の床に切り替える）', () => {
    expect(() => applyInsertions('void main() {}', [{ anchor: '#include <color_fragment>', code: 'x' }], 'fragment')).toThrow(ShaderPatchError);
  });
});
