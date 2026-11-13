import { Color, MeshStandardMaterial, Vector4, type Texture } from 'three';
import { installShaderPatch, type ShaderPatch } from '../../../render/internal/threeShaderPatch';
import { COLOSSEUM, MAX_FLOOR_RINGS, type FloorRing } from './layout';
import { MATERIAL, PALETTE } from './palette';

/**
 * 戦闘エリアの床：同心円状の石畳・放射状の帯石・中央の紋章・境界のブロンズ象嵌を、
 * ワールド座標から手続き的に描く（画像を使わない。どの距離でも目地がくっきりし、メモリも使わない）。
 *
 * アンチエイリアス：
 *   画素1つが床の上で何 m に当たるか（fp = |fwidth(xz)|）を求め、
 *   - 目地・象嵌の縁は、幅 fp の範囲でなめらかに切り替える（smoothstep）
 *   - 目地が画素より細くなったら、線の幅を画素の大きさに広げる代わりに濃さを「本来の幅 / 画素の大きさ」に下げる
 *     → 遠くでも目地の総量（平均の明るさ）が変わらず、ちらつかず、急に消えない
 *   - 石が画素に対して小さくなったら、石ごとの色のばらつきを平均色へ寄せる（遠景のちらつき防止）
 *   - 細かな質感のノイズはミップマップ付きの画像から読む（分岐の外で読み、微分が正しく計算されるようにする）
 */

export const FLOOR_SHADER_MARKER = 'ARENA_FLOOR_PATTERN_v1';

const GLSL_DECLARATIONS = /* glsl */ `
varying vec3 vArenaPos;
uniform vec4 uArenaRing[${MAX_FLOOR_RINGS}];
uniform vec4 uArenaRingInfo[${MAX_FLOOR_RINGS}];
uniform int uArenaRingCount;
uniform vec4 uArenaGeom; // 紋章の半径, 境界の半径, 象嵌の半幅, 台座の半径
uniform sampler2D uArenaNoise;
uniform float uArenaDetail;
uniform vec3 uArenaStoneA;
uniform vec3 uArenaStoneB;
uniform vec3 uArenaStoneDark;
uniform vec3 uArenaAccent;
uniform vec3 uArenaRim;
uniform vec3 uArenaJoint;
uniform vec3 uArenaBronze;
uniform vec3 uArenaEmblemBg;

vec3 arenaCol;
float arenaRough;
float arenaMetal;

// 再現性のあるハッシュ（sin を使わない。精度の低い端末でも安定）
float arenaHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// 中心からの距離 d の線（本来の半幅 w）の被覆率。画素(fp)より細い線は、幅を広げて濃さを下げる
float arenaLine(float d, float w, float fp) {
  float jw = max(w, fp);
  return (1.0 - smoothstep(jw - fp, jw + fp, d)) * (w / jw);
}

// 中心 c・半幅 h の帯の被覆率（縁を fp でなめらかに）
float arenaBand(float x, float c, float h, float fp) {
  return 1.0 - smoothstep(h - fp, h + fp, abs(x - c));
}

// 目地の近くを少し暗くする（石の角の陰影）。遠景では平均値に寄せる
float arenaEdgeShade(float d, float w, float fp) {
  float ao = mix(0.80, 1.0, smoothstep(w, w + 0.08, d));
  return mix(ao, 0.94, smoothstep(0.015, 0.06, fp));
}

void arenaFloorPattern(vec2 p) {
  const float TAU = 6.28318530718;
  float r = length(p);
  float a = atan(p.y, p.x);

  // 分岐の外で微分とテクスチャを計算する（分岐内では微分が未定義になるため）
  float fp = max(length(fwidth(p)), 1e-4);
  vec3 nz = texture(uArenaNoise, p * 0.37).rgb;
  vec3 nzL = texture(uArenaNoise, p * 0.045).rgb;
  float grain = mix(1.0, 0.86 + 0.28 * nz.r, uArenaDetail) * (0.92 + 0.16 * nz.g);
  float mottle = 0.9 + 0.2 * nzL.b;

  float emblemR = uArenaGeom.x;
  float boundaryR = uArenaGeom.y;
  float inlayH = uArenaGeom.z;
  float arenaR = uArenaGeom.w;

  vec3 stone = uArenaStoneA;
  vec3 stoneAvg = uArenaStoneA;
  float rough = 0.85;
  float d = 1000.0;      // 最も近い目地までの距離（m）
  float varFade = 1.0;   // 石ごとの色のばらつきの強さ
  float bronze = 0.0;    // ブロンズの被覆率
  float groove = 0.0;    // 象嵌の縁の溝

  if (r < emblemR) {
    // ---------------- 中央の紋章 ----------------
    float wedges = 12.0;
    float ws = (a / TAU + 0.5) * wedges;
    float wid = mod(floor(ws), wedges);
    float wf = fract(ws);
    float h = arenaHash(vec2(wid, 71.0 + step(2.3, r)));
    stone = uArenaEmblemBg * (0.88 + 0.24 * h);
    stoneAvg = uArenaEmblemBg;
    d = min(min(wf, 1.0 - wf) * TAU * r / wedges, abs(r - 2.3));

    // 太陽：中心の円盤・内側の輪・16本の光線（長短交互）・外周の輪
    float rays = 16.0;
    float rs = (a / TAU + 0.5) * rays;
    float rid = mod(floor(rs), rays);
    float rl = fract(rs) - 0.5;
    float len = mod(rid, 2.0) < 0.5 ? 3.35 : 2.6;
    float t = clamp((r - 1.25) / (len - 1.25), 0.0, 1.0);
    float hw = 0.30 * (1.0 - t);
    float distRay = (hw - abs(rl)) * TAU * r / rays; // 光線の内側で正（m）
    float inRay = step(1.25, r) * step(r, len);
    float rayCov = inRay * smoothstep(-fp, fp, distRay);
    float disc = 1.0 - smoothstep(0.92 - fp, 0.92 + fp, r);
    float ring1 = arenaBand(r, 1.1, 0.06, fp);
    float ring2 = arenaBand(r, 3.78, 0.07, fp);
    bronze = max(max(disc, ring1), max(ring2, rayCov));

    float edge = min(abs(r - 0.92), min(abs(abs(r - 1.1) - 0.06), abs(abs(r - 3.78) - 0.07)));
    if (inRay > 0.5) edge = min(edge, abs(distRay));
    groove = arenaLine(edge, 0.012, fp);
    rough = 0.85 + 0.08 * h;
  } else if (r < arenaR) {
    // ---------------- 石畳の環 ----------------
    vec4 R = uArenaRing[0];
    vec4 I = uArenaRingInfo[0];
    float ringIndex = 0.0;
    for (int i = 0; i < ${MAX_FLOOR_RINGS}; i++) {
      if (i >= uArenaRingCount) break;
      R = uArenaRing[i];
      I = uArenaRingInfo[i];
      ringIndex = float(i);
      if (r < R.y) break;
    }
    float n = R.z;
    // 円周方向の位置（石1個 = 1）。ゆらぎ（周期 n の整数倍）で石の長さを不均一にする
    float s = (a / TAU + 0.5) * n + R.w;
    float ph = TAU * I.y * s / n + I.w;
    float sw = s + I.z * sin(ph);
    float dsw = 1.0 + I.z * TAU * I.y / n * cos(ph);
    float sid = mod(floor(sw), n);
    float sf = fract(sw);
    float arc = TAU * r / n;
    float dT = min(sf, 1.0 - sf) * arc / dsw;
    float dR = min(r - R.x, R.y - r);
    d = min(dT, dR);

    float h = arenaHash(vec2(sid, ringIndex * 13.0 + I.w));
    float h2 = arenaHash(vec2(sid + 17.0, ringIndex * 7.0 + 3.0));
    if (I.x < 0.5) {
      stone = mix(uArenaStoneA, uArenaStoneB, h);
      stoneAvg = mix(uArenaStoneA, uArenaStoneB, 0.5);
    } else if (I.x < 1.5) {
      stone = uArenaAccent * (0.9 + 0.2 * h);
      stoneAvg = uArenaAccent;
    } else {
      stone = uArenaRim * (0.88 + 0.24 * h);
      stoneAvg = uArenaRim;
    }
    stone *= 0.94 + 0.12 * h2;
    rough = 0.8 + 0.12 * h2;

    // 放射状の帯石（8方向、紋章から境界まで）
    if (r < boundaryR - inlayH && I.x < 1.5) {
      float sector = TAU / 8.0;
      float am = mod(a + sector * 0.5, sector) - sector * 0.5;
      float dl = abs(sin(am)) * r;
      float stripH = 0.15;
      if (dl < stripH + 0.05 && cos(am) > 0.0) {
        if (dl < stripH) {
          float seg = 0.9;
          float hs = arenaHash(vec2(floor(r / seg), floor((a + sector * 0.5) / sector) + 91.0));
          stone = uArenaStoneDark * (0.9 + 0.2 * hs);
          stoneAvg = uArenaStoneDark;
          float fs = fract(r / seg);
          d = min(stripH - dl, min(fs, 1.0 - fs) * seg);
        } else {
          d = min(d, dl - stripH);
        }
      }
    }

    // 境界のブロンズ象嵌（床と同じ面に埋め込み、縁に細い溝）
    bronze = arenaBand(r, boundaryR, inlayH, fp);
    groove = arenaLine(abs(abs(r - boundaryR) - inlayH), 0.012, fp) * (1.0 - bronze);
    varFade = 1.0 - smoothstep(0.1, 0.45, fp / min(arc, R.y - R.x));
  } else {
    stone = uArenaRim;
    stoneAvg = uArenaRim;
    varFade = 0.0;
  }

  vec3 col = mix(stoneAvg, stone, varFade) * grain * mottle;
  float jl = arenaLine(d, 0.016, fp);
  col *= arenaEdgeShade(d, 0.016, fp);
  col = mix(col, uArenaJoint * (0.9 + 0.2 * nz.g), jl);
  rough = mix(rough, ${MATERIAL.jointRoughness.toFixed(2)}, jl);

  vec3 bronzeCol = uArenaBronze * (0.8 + 0.35 * nz.r);
  col = mix(col, bronzeCol, bronze);
  rough = mix(rough, ${MATERIAL.bronzeRoughness.toFixed(2)} + 0.15 * nz.g, bronze);
  float metal = bronze * ${MATERIAL.bronzeMetalness.toFixed(2)};

  col = mix(col, uArenaJoint * 0.7, groove * 0.85);

  arenaCol = col;
  arenaRough = rough;
  arenaMetal = metal;
}
`;

export interface FloorMaterialSet {
  /** 模様付きの床（差し込みが失敗したら使わない） */
  patterned: MeshStandardMaterial;
  /** 差し込みなしの代わりの床（単色の石） */
  fallback: MeshStandardMaterial;
  setDetail(full: boolean): void;
  dispose(): void;
}

export function createFloorMaterials(
  rings: readonly FloorRing[],
  noise: Texture,
  onPatchFailed: (error: Error) => void,
): FloorMaterialSet {
  if (rings.length > MAX_FLOOR_RINGS) throw new Error(`床の環が多すぎます（${rings.length} > ${MAX_FLOOR_RINGS}）`);
  const F = PALETTE.floor;
  const ringData = Array.from({ length: MAX_FLOOR_RINGS }, (_, i) => {
    const g = rings[i];
    return g ? new Vector4(g.inner, g.outer, g.count, g.phase) : new Vector4(0, 0, 1, 0);
  });
  const ringInfo = Array.from({ length: MAX_FLOOR_RINGS }, (_, i) => {
    const g = rings[i];
    return g ? new Vector4(g.type, g.warpK, g.warpAmp, g.seed) : new Vector4();
  });
  const uniforms = {
    uArenaRing: { value: ringData },
    uArenaRingInfo: { value: ringInfo },
    uArenaRingCount: { value: rings.length },
    uArenaGeom: {
      value: new Vector4(COLOSSEUM.emblemRadius, COLOSSEUM.boundaryRadius, COLOSSEUM.boundaryInlayWidth / 2, COLOSSEUM.arenaRadius),
    },
    uArenaNoise: { value: noise },
    uArenaDetail: { value: 1 },
    uArenaStoneA: { value: new Color(F.stoneA) },
    uArenaStoneB: { value: new Color(F.stoneB) },
    uArenaStoneDark: { value: new Color(F.stoneDark) },
    uArenaAccent: { value: new Color(F.accent) },
    uArenaRim: { value: new Color(F.rim) },
    uArenaJoint: { value: new Color(F.joint) },
    uArenaBronze: { value: new Color(F.bronze) },
    uArenaEmblemBg: { value: new Color(F.emblemBg) },
  };

  const patch: ShaderPatch = {
    marker: FLOOR_SHADER_MARKER,
    uniforms,
    vertex: [
      { anchor: '#include <common>', code: 'varying vec3 vArenaPos;' },
      { anchor: '#include <begin_vertex>', code: 'vArenaPos = (modelMatrix * vec4(transformed, 1.0)).xyz;' },
    ],
    fragment: [
      { anchor: '#include <common>', code: GLSL_DECLARATIONS },
      { anchor: '#include <color_fragment>', code: 'arenaFloorPattern(vArenaPos.xz);\ndiffuseColor.rgb = arenaCol;' },
      { anchor: '#include <roughnessmap_fragment>', code: 'roughnessFactor = arenaRough;' },
      { anchor: '#include <metalnessmap_fragment>', code: 'metalnessFactor = arenaMetal;' },
    ],
  };

  const patterned = new MeshStandardMaterial({ color: 0xffffff, roughness: MATERIAL.floorRoughness, metalness: 0 });
  patterned.name = 'ColosseumFloor';
  installShaderPatch(patterned, patch, onPatchFailed);

  const fallback = new MeshStandardMaterial({
    color: new Color(F.stoneA).lerp(new Color(F.stoneB), 0.5),
    roughness: MATERIAL.floorRoughness,
    metalness: 0,
  });
  fallback.name = 'ColosseumFloorFallback';

  return {
    patterned,
    fallback,
    setDetail: (full) => {
      uniforms.uArenaDetail.value = full ? 1 : 0;
    },
    dispose: () => {
      patterned.dispose();
      fallback.dispose();
    },
  };
}
