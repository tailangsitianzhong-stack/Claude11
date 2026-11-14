import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Color, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Scene } from 'three';
import { releaseSceneGpuResources } from '../src/render/gpuResources';

function sceneWithInstancedMesh() {
  const scene = new Scene();
  const instanced = new InstancedMesh(new BoxGeometry(), new MeshStandardMaterial(), 3);
  instanced.setMatrixAt(1, new Matrix4().makeTranslation(1, 2, 3));
  instanced.setColorAt(0, new Color(1, 0, 0)); // instanceColor も作る
  const plain = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  scene.add(instanced, plain);
  return { scene, instanced, plain };
}

describe('シーンの GPU 資源の解放（releaseSceneGpuResources）', () => {
  it('InstancedMesh を解放の対象にする（インスタンスの行列・色のバッファも解放の通知が出る）', () => {
    const { scene, instanced, plain } = sceneWithInstancedMesh();
    const meshDispose = vi.fn();
    const matrixDispose = vi.fn();
    const colorDispose = vi.fn();
    instanced.addEventListener('dispose', meshDispose);
    instanced.instanceMatrix.addEventListener('dispose', matrixDispose);
    instanced.instanceColor!.addEventListener('dispose', colorDispose);
    const geometryDispose = vi.spyOn(instanced.geometry, 'dispose');
    const materialDispose = vi.spyOn(instanced.material as MeshStandardMaterial, 'dispose');
    const plainGeometryDispose = vi.spyOn(plain.geometry, 'dispose');

    releaseSceneGpuResources(scene);

    expect(meshDispose).toHaveBeenCalledTimes(1);
    expect(matrixDispose).toHaveBeenCalledTimes(1);
    expect(colorDispose).toHaveBeenCalledTimes(1);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(plainGeometryDispose).toHaveBeenCalledTimes(1);
  });

  it('2回続けて解放しても例外にならず、インスタンスのデータは残る（次の描画で作り直せる）', () => {
    const { scene, instanced } = sceneWithInstancedMesh();
    expect(() => {
      releaseSceneGpuResources(scene);
      releaseSceneGpuResources(scene);
    }).not.toThrow();
    const m = new Matrix4();
    instanced.getMatrixAt(1, m);
    expect(m.elements[12]).toBe(1);
    expect(m.elements[13]).toBe(2);
    expect(m.elements[14]).toBe(3);
    expect(instanced.count).toBe(3);
    expect(instanced.parent).toBe(scene);
  });
});
