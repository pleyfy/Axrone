import { Vec3, Vec4, Mat4 } from '@axrone/numeric';
import type { LineTextureMode, LineAlignment } from './components/line-renderer';
import type { TrailAlignment, TrailTextureMode } from './components/trail-renderer';

/**
 * Packed vertex layout (9 floats / 36 bytes):
 *   [0..2]  position (vec3)  -> attribute location 0
 *   [3..4]  uv (vec2)        -> attribute location 2
 *   [5..8]  color rgba (vec4)-> attribute location 3
 */
export const LINE_VERTEX_FLOATS = 9;
export const LINE_VERTEX_STRIDE_BYTES = LINE_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;

const _tmpSegmentDir = { x: 0, y: 0, z: 0 };
const _tmpViewDir = { x: 0, y: 0, z: 0 };
const _tmpSideDir = { x: 0, y: 0, z: 0 };
const _tmpLocalZ = { x: 0, y: 0, z: 0 };
const _tmpLocalX = { x: 0, y: 0, z: 0 };

export interface LineRibbonInput {
    readonly positions: ReadonlyArray<Vec3>;
    readonly startWidth: number;
    readonly endWidth: number;
    readonly widthCurve: ReadonlyArray<number>;
    readonly startColor: Vec4;
    readonly endColor: Vec4;
    readonly colorGradientStops: ReadonlyArray<{ position: number; color: Vec4 }>;
    readonly textureMode: LineTextureMode;
    readonly alignment: LineAlignment;
    readonly textureScaleX: number;
    readonly textureScaleY: number;
    readonly loop: boolean;
    readonly useWorldSpace: boolean;
    readonly worldMatrix: Mat4 | null;
}

export interface TrailRibbonInput {
    readonly positions: ReadonlyArray<Vec3>;
    readonly startWidth: number;
    readonly endWidth: number;
    readonly widthCurve: ReadonlyArray<number>;
    readonly colorGradientStops: ReadonlyArray<{ position: number; color: Vec4 }>;
    readonly textureMode: TrailTextureMode;
    readonly alignment: TrailAlignment;
    readonly textureScaleX: number;
    readonly textureScaleY: number;
    readonly worldMatrix: Mat4 | null;
}

export interface LineRibbonResult {
    readonly vertexData: Float32Array;
    readonly indexData: Uint16Array;
    readonly vertexCount: number;
    readonly indexCount: number;
}

function computeWidth(
    t: number,
    startWidth: number,
    endWidth: number,
    widthCurve: ReadonlyArray<number>
): number {
    const clampedT = Math.max(0, Math.min(1, t));

    if (widthCurve.length >= 2) {
        const curveT = clampedT * (widthCurve.length - 1);
        const index = Math.floor(curveT);
        const fraction = curveT - index;
        const a = widthCurve[index] ?? 1;
        const b = widthCurve[Math.min(index + 1, widthCurve.length - 1)] ?? 1;
        const curveValue = a + (b - a) * fraction;
        return startWidth + (endWidth - startWidth) * curveValue;
    }

    return startWidth + (endWidth - startWidth) * clampedT;
}

function computeColor(
    t: number,
    startColor: Vec4,
    endColor: Vec4,
    gradientStops: ReadonlyArray<{ position: number; color: Vec4 }>
): { r: number; g: number; b: number; a: number } {
    const clampedT = Math.max(0, Math.min(1, t));

    if (gradientStops.length >= 2) {
        let lower = gradientStops[0]!;
        let upper = gradientStops[gradientStops.length - 1]!;

        for (let i = 0; i < gradientStops.length - 1; i++) {
            const current = gradientStops[i]!;
            const next = gradientStops[i + 1]!;
            if (clampedT >= current.position && clampedT <= next.position) {
                lower = current;
                upper = next;
                break;
            }
        }

        const range = upper.position - lower.position;
        const fraction = range > 0 ? (clampedT - lower.position) / range : 0;
        const lc = lower.color;
        const uc = upper.color;

        return {
            r: lc.x + (uc.x - lc.x) * fraction,
            g: lc.y + (uc.y - lc.y) * fraction,
            b: lc.z + (uc.z - lc.z) * fraction,
            a: lc.w + (uc.w - lc.w) * fraction,
        };
    }

    return {
        r: startColor.x + (endColor.x - startColor.x) * clampedT,
        g: startColor.y + (endColor.y - startColor.y) * clampedT,
        b: startColor.z + (endColor.z - startColor.z) * clampedT,
        a: startColor.w + (endColor.w - startColor.w) * clampedT,
    };
}

function computeViewAlignedSide(
    px: number, py: number, pz: number,
    nx: number, ny: number, nz: number,
    camX: number, camY: number, camZ: number
): { sx: number; sy: number; sz: number } {
    const segDx = nx - px;
    const segDy = ny - py;
    const segDz = nz - pz;
    const segLen = Math.sqrt(segDx * segDx + segDy * segDy + segDz * segDz);

    if (segLen < 1e-8) {
        return { sx: 1, sy: 0, sz: 0 };
    }

    const invSegLen = 1 / segLen;
    const sdx = segDx * invSegLen;
    const sdy = segDy * invSegLen;
    const sdz = segDz * invSegLen;

    const vdx = camX - px;
    const vdy = camY - py;
    const vdz = camZ - pz;
    const vLen = Math.sqrt(vdx * vdx + vdy * vdy + vdz * vdz);

    if (vLen < 1e-8) {
        return { sx: 1, sy: 0, sz: 0 };
    }

    const invVLen = 1 / vLen;
    const vdxN = vdx * invVLen;
    const vdyN = vdy * invVLen;
    const vdzN = vdz * invVLen;

    const cx = sdy * vdzN - sdz * vdyN;
    const cy = sdz * vdxN - sdx * vdzN;
    const cz = sdx * vdyN - sdy * vdxN;
    const cLen = Math.sqrt(cx * cx + cy * cy + cz * cz);

    if (cLen < 1e-8) {
        return { sx: 1, sy: 0, sz: 0 };
    }

    const invCLen = 1 / cLen;
    return { sx: cx * invCLen, sy: cy * invCLen, sz: cz * invCLen };
}

function computeTransformZSide(
    worldMatrix: Mat4 | null
): { sx: number; sy: number; sz: number } {
    if (!worldMatrix) {
        return { sx: 0, sy: 0, sz: 1 };
    }

    const m = worldMatrix.data;
    let zx = m[8] ?? 0;
    let zy = m[9] ?? 0;
    let zz = m[10] ?? 0;
    const zLen = Math.sqrt(zx * zx + zy * zy + zz * zz);

    if (zLen < 1e-8) {
        return { sx: 0, sy: 0, sz: 1 };
    }

    const invZLen = 1 / zLen;
    return { sx: zx * invZLen, sy: zy * invZLen, sz: zz * invZLen };
}

function computeLocalSide(
    worldMatrix: Mat4 | null
): { sx: number; sy: number; sz: number } {
    if (!worldMatrix) {
        return { sx: 1, sy: 0, sz: 0 };
    }

    const m = worldMatrix.data;
    let xx = m[0] ?? 1;
    let xy = m[1] ?? 0;
    let xz = m[2] ?? 0;
    const xLen = Math.sqrt(xx * xx + xy * xy + xz * xz);

    if (xLen < 1e-8) {
        return { sx: 1, sy: 0, sz: 0 };
    }

    const invXLen = 1 / xLen;
    return { sx: xx * invXLen, sy: xy * invXLen, sz: xz * invXLen };
}

function computeUV(
    segmentIndex: number,
    cumulativeLength: number,
    totalLength: number,
    segmentCount: number,
    textureMode: LineTextureMode | TrailTextureMode,
    textureScaleX: number,
    textureScaleY: number,
    side: number
): { u: number; v: number } {
    let u: number;

    switch (textureMode) {
        case 'tile':
            u = cumulativeLength * textureScaleX;
            break;
        case 'distribute-per-segment':
            u = segmentCount > 1 ? segmentIndex / (segmentCount - 1) : 0;
            u *= textureScaleX;
            break;
        case 'repeat-per-segment':
            u = segmentIndex * textureScaleX;
            break;
        case 'stretch':
        default:
            u = totalLength > 0 ? (cumulativeLength / totalLength) * textureScaleX : 0;
            break;
    }

    const v = side === -1 ? 0 : textureScaleY;

    return { u, v };
}

function writeVertex(
    data: Float32Array,
    vertexIndex: number,
    x: number, y: number, z: number,
    u: number, v: number,
    r: number, g: number, b: number, a: number
): void {
    const offset = vertexIndex * LINE_VERTEX_FLOATS;
    data[offset] = x;
    data[offset + 1] = y;
    data[offset + 2] = z;
    data[offset + 3] = u;
    data[offset + 4] = v;
    data[offset + 5] = r;
    data[offset + 6] = g;
    data[offset + 7] = b;
    data[offset + 8] = a;
}

/**
 * Builds a ribbon triangle mesh from line/trail positions.
 *
 * For N points → (N-1) segments → 4*(N-1) vertices, 6*(N-1) indices
 * (2 triangles per segment as indexed triangles, not triangle strip,
 *  for compatibility with the engine's TRIANGLES topology).
 *
 * Allocates exact-fit typed arrays per call — treat the result as
 * transient and upload it directly instead of copying it again.
 */
export function buildLineRibbon(
    input: LineRibbonInput,
    cameraPosition: Vec3
): LineRibbonResult {
    const positions = input.positions;
    const pointCount = positions.length;

    if (pointCount < 2) {
        return {
            vertexData: new Float32Array(0),
            indexData: new Uint16Array(0),
            vertexCount: 0,
            indexCount: 0,
        };
    }

    const loop = input.loop && pointCount > 2;
    const segmentCount = loop ? pointCount : pointCount - 1;
    const vertexCount = segmentCount * 4;
    const indexCount = segmentCount * 6;

    const vertexData = new Float32Array(vertexCount * LINE_VERTEX_FLOATS);
    const indexData = new Uint16Array(indexCount);

    const totalLength = computeTotalLength(positions, loop);

    const camX = cameraPosition.x;
    const camY = cameraPosition.y;
    const camZ = cameraPosition.z;

    let fixedSideX = 0, fixedSideY = 0, fixedSideZ = 0;
    let useFixedSide = false;

    if (input.alignment === 'transform-z' || input.alignment === 'local') {
        const side = input.alignment === 'transform-z'
            ? computeTransformZSide(input.worldMatrix)
            : computeLocalSide(input.worldMatrix);
        fixedSideX = side.sx;
        fixedSideY = side.sy;
        fixedSideZ = side.sz;
        useFixedSide = true;
    }

    let cumulativeLength = 0;

    for (let seg = 0; seg < segmentCount; seg++) {
        const i0 = seg;
        const i1 = (seg + 1) % pointCount;
        const p0 = positions[i0]!;
        const p1 = positions[i1]!;

        const segLength = Vec3.distance(p0, p1);
        const t0 = totalLength > 0 ? cumulativeLength / totalLength : 0;
        const t1 = totalLength > 0 ? (cumulativeLength + segLength) / totalLength : 1;

        const width0 = computeWidth(t0, input.startWidth, input.endWidth, input.widthCurve);
        const width1 = computeWidth(t1, input.startWidth, input.endWidth, input.widthCurve);
        const color0 = computeColor(t0, input.startColor, input.endColor, input.colorGradientStops);
        const color1 = computeColor(t1, input.startColor, input.endColor, input.colorGradientStops);

        let sideX: number, sideY: number, sideZ: number;

        if (useFixedSide) {
            sideX = fixedSideX;
            sideY = fixedSideY;
            sideZ = fixedSideZ;
        } else {
            const side = computeViewAlignedSide(
                p0.x, p0.y, p0.z,
                p1.x, p1.y, p1.z,
                camX, camY, camZ
            );
            sideX = side.sx;
            sideY = side.sy;
            sideZ = side.sz;
        }

        const halfWidth0 = width0 * 0.5;
        const halfWidth1 = width1 * 0.5;

        const uv0Left = computeUV(seg, cumulativeLength, totalLength, segmentCount, input.textureMode, input.textureScaleX, input.textureScaleY, -1);
        const uv0Right = computeUV(seg, cumulativeLength, totalLength, segmentCount, input.textureMode, input.textureScaleX, input.textureScaleY, 1);
        const uv1Left = computeUV(seg + 1, cumulativeLength + segLength, totalLength, segmentCount, input.textureMode, input.textureScaleX, input.textureScaleY, -1);
        const uv1Right = computeUV(seg + 1, cumulativeLength + segLength, totalLength, segmentCount, input.textureMode, input.textureScaleX, input.textureScaleY, 1);

        const baseVertex = seg * 4;

        writeVertex(vertexData, baseVertex,
            p0.x - sideX * halfWidth0, p0.y - sideY * halfWidth0, p0.z - sideZ * halfWidth0,
            uv0Left.u, uv0Left.v,
            color0.r, color0.g, color0.b, color0.a
        );
        writeVertex(vertexData, baseVertex + 1,
            p0.x + sideX * halfWidth0, p0.y + sideY * halfWidth0, p0.z + sideZ * halfWidth0,
            uv0Right.u, uv0Right.v,
            color0.r, color0.g, color0.b, color0.a
        );
        writeVertex(vertexData, baseVertex + 2,
            p1.x + sideX * halfWidth1, p1.y + sideY * halfWidth1, p1.z + sideZ * halfWidth1,
            uv1Right.u, uv1Right.v,
            color1.r, color1.g, color1.b, color1.a
        );
        writeVertex(vertexData, baseVertex + 3,
            p1.x - sideX * halfWidth1, p1.y - sideY * halfWidth1, p1.z - sideZ * halfWidth1,
            uv1Left.u, uv1Left.v,
            color1.r, color1.g, color1.b, color1.a
        );

        const indexBase = seg * 6;
        indexData[indexBase] = baseVertex;
        indexData[indexBase + 1] = baseVertex + 1;
        indexData[indexBase + 2] = baseVertex + 2;
        indexData[indexBase + 3] = baseVertex;
        indexData[indexBase + 4] = baseVertex + 2;
        indexData[indexBase + 5] = baseVertex + 3;

        cumulativeLength += segLength;
    }

    return {
        vertexData,
        indexData,
        vertexCount,
        indexCount,
    };
}

/**
 * Builds a ribbon mesh for TrailRenderer.
 * Simpler than LineRenderer: no loop, no startColor/endColor (uses gradient only).
 */
export function buildTrailRibbon(
    input: TrailRibbonInput,
    cameraPosition: Vec3
): LineRibbonResult {
    const positions = input.positions;
    const pointCount = positions.length;

    if (pointCount < 2) {
        return {
            vertexData: new Float32Array(0),
            indexData: new Uint16Array(0),
            vertexCount: 0,
            indexCount: 0,
        };
    }

    const segmentCount = pointCount - 1;
    const vertexCount = segmentCount * 4;
    const indexCount = segmentCount * 6;

    const vertexData = new Float32Array(vertexCount * LINE_VERTEX_FLOATS);
    const indexData = new Uint16Array(indexCount);

    const totalLength = computeTotalLength(positions, false);

    const camX = cameraPosition.x;
    const camY = cameraPosition.y;
    const camZ = cameraPosition.z;

    let fixedSideX = 0, fixedSideY = 0, fixedSideZ = 0;
    let useFixedSide = false;

    if (input.alignment === 'transform-z' || input.alignment === 'local') {
        const side = input.alignment === 'transform-z'
            ? computeTransformZSide(input.worldMatrix)
            : computeLocalSide(input.worldMatrix);
        fixedSideX = side.sx;
        fixedSideY = side.sy;
        fixedSideZ = side.sz;
        useFixedSide = true;
    }

    let cumulativeLength = 0;

    for (let seg = 0; seg < segmentCount; seg++) {
        const p0 = positions[seg]!;
        const p1 = positions[seg + 1]!;

        const segLength = Vec3.distance(p0, p1);
        const t0 = totalLength > 0 ? cumulativeLength / totalLength : 0;
        const t1 = totalLength > 0 ? (cumulativeLength + segLength) / totalLength : 1;

        const width0 = computeWidth(t0, input.startWidth, input.endWidth, input.widthCurve);
        const width1 = computeWidth(t1, input.startWidth, input.endWidth, input.widthCurve);
        const color0 = computeColor(t0, Vec4.ONE, Vec4.ONE, input.colorGradientStops);
        const color1 = computeColor(t1, Vec4.ONE, Vec4.ONE, input.colorGradientStops);

        let sideX: number, sideY: number, sideZ: number;

        if (useFixedSide) {
            sideX = fixedSideX;
            sideY = fixedSideY;
            sideZ = fixedSideZ;
        } else {
            const side = computeViewAlignedSide(
                p0.x, p0.y, p0.z,
                p1.x, p1.y, p1.z,
                camX, camY, camZ
            );
            sideX = side.sx;
            sideY = side.sy;
            sideZ = side.sz;
        }

        const halfWidth0 = width0 * 0.5;
        const halfWidth1 = width1 * 0.5;

        const uv0Left = computeUV(seg, cumulativeLength, totalLength, segmentCount, input.textureMode, input.textureScaleX, input.textureScaleY, -1);
        const uv0Right = computeUV(seg, cumulativeLength, totalLength, segmentCount, input.textureMode, input.textureScaleX, input.textureScaleY, 1);
        const uv1Left = computeUV(seg + 1, cumulativeLength + segLength, totalLength, segmentCount, input.textureMode, input.textureScaleX, input.textureScaleY, -1);
        const uv1Right = computeUV(seg + 1, cumulativeLength + segLength, totalLength, segmentCount, input.textureMode, input.textureScaleX, input.textureScaleY, 1);

        const baseVertex = seg * 4;

        writeVertex(vertexData, baseVertex,
            p0.x - sideX * halfWidth0, p0.y - sideY * halfWidth0, p0.z - sideZ * halfWidth0,
            uv0Left.u, uv0Left.v,
            color0.r, color0.g, color0.b, color0.a
        );
        writeVertex(vertexData, baseVertex + 1,
            p0.x + sideX * halfWidth0, p0.y + sideY * halfWidth0, p0.z + sideZ * halfWidth0,
            uv0Right.u, uv0Right.v,
            color0.r, color0.g, color0.b, color0.a
        );
        writeVertex(vertexData, baseVertex + 2,
            p1.x + sideX * halfWidth1, p1.y + sideY * halfWidth1, p1.z + sideZ * halfWidth1,
            uv1Right.u, uv1Right.v,
            color1.r, color1.g, color1.b, color1.a
        );
        writeVertex(vertexData, baseVertex + 3,
            p1.x - sideX * halfWidth1, p1.y - sideY * halfWidth1, p1.z - sideZ * halfWidth1,
            uv1Left.u, uv1Left.v,
            color1.r, color1.g, color1.b, color1.a
        );

        const indexBase = seg * 6;
        indexData[indexBase] = baseVertex;
        indexData[indexBase + 1] = baseVertex + 1;
        indexData[indexBase + 2] = baseVertex + 2;
        indexData[indexBase + 3] = baseVertex;
        indexData[indexBase + 4] = baseVertex + 2;
        indexData[indexBase + 5] = baseVertex + 3;

        cumulativeLength += segLength;
    }

    return {
        vertexData,
        indexData,
        vertexCount,
        indexCount,
    };
}

function computeTotalLength(positions: ReadonlyArray<Vec3>, loop: boolean): number {
    if (positions.length < 2) {
        return 0;
    }

    let length = 0;
    for (let i = 0; i < positions.length - 1; i++) {
        length += Vec3.distance(positions[i]!, positions[i + 1]!);
    }

    if (loop && positions.length > 2) {
        length += Vec3.distance(positions[positions.length - 1]!, positions[0]!);
    }

    return length;
}
