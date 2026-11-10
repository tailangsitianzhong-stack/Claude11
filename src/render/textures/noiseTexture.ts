import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, RepeatWrapping, UnsignedByteType } from 'three';
import { createRandom } from '../../core/random';

/**
 * 継ぎ目なく繰り返せる値ノイズ（value noise）の画像を手続き的に作る（外部の画像は使わない）。
 * R: 細かいノイズ（格子32）、G: 中くらい（格子8）、B: 粗い（格子4）、A: 255。
 * ミップマップを使うので、遠くで縮小されてもちらつかない。
 */
export function createTileableNoiseData(size = 256, seed = 7): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  const layers = [32, 8, 4].map((cells, i) => latticeNoise(size, cells, seed + i * 101));
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = layers[0]![i]!;
    data[i * 4 + 1] = layers[1]![i]!;
    data[i * 4 + 2] = layers[2]![i]!;
    data[i * 4 + 3] = 255;
  }
  return data;
}

function latticeNoise(size: number, cells: number, seed: number): Uint8Array {
  const rand = createRandom(seed);
  const lattice = new Float32Array(cells * cells).map(() => rand());
  const out = new Uint8Array(size * size);
  const at = (x: number, y: number) => lattice[(((y % cells) + cells) % cells) * cells + (((x % cells) + cells) % cells)]!;
  const fade = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fade(fx - x0);
      const ty = fade(fy - y0);
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
      out[y * size + x] = Math.round((a + (b - a) * ty) * 255);
    }
  }
  return out;
}

export function createNoiseTexture(size = 256, seed = 7): DataTexture {
  const tex = new DataTexture(createTileableNoiseData(size, seed), size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.name = 'TileableNoise';
  tex.needsUpdate = true;
  return tex;
}
