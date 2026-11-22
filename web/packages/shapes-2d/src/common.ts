import type { IVec2Like } from '@axrone/numeric';
import { GEOMETRIC_EPSILON, clamp, clamp01 } from "@axrone/numeric";
import { Fnv1a32 } from '@axrone/hash';
import type {
    GradientSpread,
    ShapeApproximationOptions,
    ShapeBounds,
    ShapeFingerprint,
    ShapePointInput,
} from './types';
import { PaintValidationError, ShapeValidationError } from './errors';

export const EPSILON = GEOMETRIC_EPSILON;
export const TAU = Math.PI * 2;
export const DEFAULT_CURVE_TOLERANCE = 0.25;
export const DEFAULT_MIN_CURVE_SEGMENTS = 16;
export const DEFAULT_MAX_CURVE_SEGMENTS = 128;
export const DEFAULT_GRADIENT_LOOKUP_SIZE = 256;
export const DEFAULT_REGISTRY_MAX_SHAPES = 2048;
export const DEFAULT_REGISTRY_MAX_COMPILED = 4096;

export const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

export const normalizeNumberKey = (value: number): string =>
    Object.is(value, -0) ? '0' : `${value}`;

export const assertFiniteNumber = (value: unknown, name: string): number => {
    if (!isFiniteNumber(value)) {
        throw new ShapeValidationError(`${name} must be a finite number`);
    }
    return value;
};

export const assertPositiveNumber = (value: unknown, name: string): number => {
    const normalized = assertFiniteNumber(value, name);
    if (normalized <= 0) {
        throw new ShapeValidationError(`${name} must be greater than 0`);
    }
    return normalized;
};

export const assertNonNegativeNumber = (value: unknown, name: string): number => {
    const normalized = assertFiniteNumber(value, name);
    if (normalized < 0) {
        throw new ShapeValidationError(`${name} must be greater than or equal to 0`);
    }
    return normalized;
};

export const toPoint = (value: ShapePointInput, name: string): Readonly<IVec2Like> => {
    if (Array.isArray(value)) {
        if (value.length < 2) {
            throw new ShapeValidationError(`${name} must have at least two numeric values`);
        }

        return Object.freeze({
            x: assertFiniteNumber(value[0], `${name}[0]`),
            y: assertFiniteNumber(value[1], `${name}[1]`),
        });
    }

    if (value && typeof value === 'object' && 'x' in value && 'y' in value) {
        const x = assertFiniteNumber(value.x, `${name}.x`);
        const y = assertFiniteNumber(value.y, `${name}.y`);
        if (Object.isFrozen(value) && (value as { x: unknown }).x === x && (value as { y: unknown }).y === y) {
            return value as Readonly<IVec2Like>;
        }
        return Object.freeze({ x, y });
    }

    throw new ShapeValidationError(`${name} must be a point-like value`);
};

export const createBounds = (
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
): ShapeBounds => {
    const safeMinX = Math.min(minX, maxX);
    const safeMaxX = Math.max(minX, maxX);
    const safeMinY = Math.min(minY, maxY);
    const safeMaxY = Math.max(minY, maxY);

    return Object.freeze({
        minX: safeMinX,
        minY: safeMinY,
        maxX: safeMaxX,
        maxY: safeMaxY,
        width: safeMaxX - safeMinX,
        height: safeMaxY - safeMinY,
        centerX: (safeMinX + safeMaxX) * 0.5,
        centerY: (safeMinY + safeMaxY) * 0.5,
    });
};

export const expandBounds = (bounds: ShapeBounds, amount: number): ShapeBounds =>
    createBounds(
        bounds.minX - amount,
        bounds.minY - amount,
        bounds.maxX + amount,
        bounds.maxY + amount
    );

export const pointInBounds = (bounds: ShapeBounds, point: Readonly<IVec2Like>): boolean =>
    point.x >= bounds.minX - EPSILON &&
    point.x <= bounds.maxX + EPSILON &&
    point.y >= bounds.minY - EPSILON &&
    point.y <= bounds.maxY + EPSILON;

export const distanceSquared = (
    ax: number,
    ay: number,
    bx: number,
    by: number
): number => {
    const dx = bx - ax;
    const dy = by - ay;
    return dx * dx + dy * dy;
};

export const distance = (ax: number, ay: number, bx: number, by: number): number =>
    Math.sqrt(distanceSquared(ax, ay, bx, by));

export const distanceToSegmentSquared = (
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number
): number => {
    const abx = bx - ax;
    const aby = by - ay;
    const abLengthSquared = abx * abx + aby * aby;

    if (abLengthSquared <= EPSILON) {
        return distanceSquared(px, py, ax, ay);
    }

    const t = clamp(((px - ax) * abx + (py - ay) * aby) / abLengthSquared, 0, 1);
    const cx = ax + abx * t;
    const cy = ay + aby * t;
    return distanceSquared(px, py, cx, cy);
};

export const polygonSignedArea = (points: ArrayLike<number>): number => {
    const count = Math.floor(points.length / 2);
    let area = 0;

    for (let index = 0; index < count; index++) {
        const current = index * 2;
        const next = ((index + 1) % count) * 2;
        area += points[current] * points[next + 1] - points[current + 1] * points[next];
    }

    return area * 0.5;
};

export const polygonAbsoluteArea = (points: ArrayLike<number>): number =>
    Math.abs(polygonSignedArea(points));

export const polygonPerimeter = (points: ArrayLike<number>): number => {
    const count = Math.floor(points.length / 2);
    if (count < 2) {
        return 0;
    }

    let perimeter = 0;
    for (let index = 0; index < count; index++) {
        const current = index * 2;
        const next = ((index + 1) % count) * 2;
        perimeter += Math.hypot(
            (points[next] as number) - (points[current] as number),
            (points[next + 1] as number) - (points[current + 1] as number)
        );
    }
    return perimeter;
};

export const polygonCentroid = (points: ArrayLike<number>): Readonly<IVec2Like> => {
    const count = Math.floor(points.length / 2);
    if (count === 0) {
        return Object.freeze({ x: 0, y: 0 });
    }

    let cx = 0;
    let cy = 0;
    let signedAreaTimesSix = 0;

    for (let index = 0; index < count; index++) {
        const current = index * 2;
        const next = ((index + 1) % count) * 2;
        const x0 = points[current] as number;
        const y0 = points[current + 1] as number;
        const x1 = points[next] as number;
        const y1 = points[next + 1] as number;
        const cross = x0 * y1 - x1 * y0;
        cx += (x0 + x1) * cross;
        cy += (y0 + y1) * cross;
        signedAreaTimesSix += cross;
    }

    if (Math.abs(signedAreaTimesSix) <= EPSILON) {
        let sx = 0;
        let sy = 0;
        for (let index = 0; index < count; index++) {
            sx += points[index * 2] as number;
            sy += points[index * 2 + 1] as number;
        }
        return Object.freeze({ x: sx / count, y: sy / count });
    }

    return Object.freeze({
        x: cx / (signedAreaTimesSix * 3),
        y: cy / (signedAreaTimesSix * 3),
    });
};

export const polygonBounds = (points: ArrayLike<number>): ShapeBounds => {
    const count = Math.floor(points.length / 2);
    if (count === 0) {
        return createBounds(0, 0, 0, 0);
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let index = 0; index < count; index++) {
        const x = points[index * 2] as number;
        const y = points[index * 2 + 1] as number;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }

    return createBounds(minX, minY, maxX, maxY);
};

export const pointInConvexPolygon = (
    points: ArrayLike<number>,
    point: Readonly<IVec2Like>
): boolean => {
    const count = Math.floor(points.length / 2);
    if (count < 3) {
        return false;
    }

    const winding = polygonSignedArea(points) >= 0 ? 1 : -1;

    for (let index = 0; index < count; index++) {
        const current = index * 2;
        const next = ((index + 1) % count) * 2;
        const edgeX = (points[next] as number) - (points[current] as number);
        const edgeY = (points[next + 1] as number) - (points[current + 1] as number);
        const pointX = point.x - (points[current] as number);
        const pointY = point.y - (points[current + 1] as number);
        const cross = edgeX * pointY - edgeY * pointX;

        if (cross * winding < -EPSILON) {
            return false;
        }
    }

    return true;
};

export const pointInPolygon = (
    points: ArrayLike<number>,
    point: Readonly<IVec2Like>
): boolean => {
    const count = Math.floor(points.length / 2);
    if (count < 3) {
        return false;
    }

    let inside = false;
    let j = count - 1;

    for (let i = 0; i < count; i++) {
        const xi = points[i * 2] as number;
        const yi = points[i * 2 + 1] as number;
        const xj = points[j * 2] as number;
        const yj = points[j * 2 + 1] as number;

        const intersects =
            yi > point.y !== yj > point.y &&
            point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || EPSILON) + xi;
        if (intersects) {
            inside = !inside;
        }
        j = i;
    }

    return inside;
};

export const isConvexPolygon = (points: ArrayLike<number>): boolean => {
    const count = Math.floor(points.length / 2);
    if (count < 3) {
        return false;
    }

    let sign = 0;
    for (let index = 0; index < count; index++) {
        const a = index * 2;
        const b = ((index + 1) % count) * 2;
        const c = ((index + 2) % count) * 2;
        const ax = points[a] as number;
        const ay = points[a + 1] as number;
        const bx = points[b] as number;
        const by = points[b + 1] as number;
        const cx = points[c] as number;
        const cy = points[c + 1] as number;
        const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
        if (Math.abs(cross) <= EPSILON) {
            continue;
        }
        const currentSign = cross > 0 ? 1 : -1;
        if (sign === 0) {
            sign = currentSign;
        } else if (sign !== currentSign) {
            return false;
        }
    }

    return sign !== 0;
};

export const isSimplePolygon = (points: ArrayLike<number>): boolean => {
    const count = Math.floor(points.length / 2);
    if (count < 3) {
        return false;
    }

    for (let i = 0; i < count; i++) {
        const a1 = i * 2;
        const a2 = ((i + 1) % count) * 2;
        for (let j = i + 1; j < count; j++) {
            const b1 = j * 2;
            const b2 = ((j + 1) % count) * 2;
            if (i === 0 && j === count - 1) continue;
            if (j === i + 1) continue;
            if (
                segmentsIntersect(
                    points[a1] as number,
                    points[a1 + 1] as number,
                    points[a2] as number,
                    points[a2 + 1] as number,
                    points[b1] as number,
                    points[b1 + 1] as number,
                    points[b2] as number,
                    points[b2 + 1] as number
                )
            ) {
                return false;
            }
        }
    }
    return true;
};

const segmentsIntersect = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
    dx: number,
    dy: number
): boolean => {
    const r1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const r2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    const r3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
    const r4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);

    if (((r1 > 0 && r2 < 0) || (r1 < 0 && r2 > 0)) && ((r3 > 0 && r4 < 0) || (r3 < 0 && r4 > 0))) {
        return true;
    }

    if (Math.abs(r1) <= EPSILON && onSegment(ax, ay, cx, cy, bx, by)) return true;
    if (Math.abs(r2) <= EPSILON && onSegment(ax, ay, dx, dy, bx, by)) return true;
    if (Math.abs(r3) <= EPSILON && onSegment(cx, cy, ax, ay, dx, dy)) return true;
    if (Math.abs(r4) <= EPSILON && onSegment(cx, cy, bx, by, dx, dy)) return true;

    return false;
};

const onSegment = (
    px: number,
    py: number,
    qx: number,
    qy: number,
    rx: number,
    ry: number
): boolean =>
    Math.min(px, rx) - EPSILON <= qx &&
    qx <= Math.max(px, rx) + EPSILON &&
    Math.min(py, ry) - EPSILON <= qy &&
    qy <= Math.max(py, ry) + EPSILON;

export const pointInPolygonWithHoles = (
    outer: ArrayLike<number>,
    holes: ReadonlyArray<ArrayLike<number>>,
    point: Readonly<IVec2Like>
): boolean => {
    if (!pointInPolygon(outer, point)) {
        return false;
    }
    for (let i = 0; i < holes.length; i++) {
        if (pointInPolygon(holes[i] as ArrayLike<number>, point)) {
            return false;
        }
    }
    return true;
};

export const pointToPolygonEdgeDistance = (
    points: ArrayLike<number>,
    point: Readonly<IVec2Like>
): number => {
    const count = Math.floor(points.length / 2);
    if (count < 2) {
        return Infinity;
    }

    let minDistanceSquared = Infinity;
    for (let i = 0; i < count; i++) {
        const a = i * 2;
        const b = ((i + 1) % count) * 2;
        const d = distanceToSegmentSquared(
            point.x,
            point.y,
            points[a] as number,
            points[a + 1] as number,
            points[b] as number,
            points[b + 1] as number
        );
        if (d < minDistanceSquared) {
            minDistanceSquared = d;
        }
    }
    return Math.sqrt(minDistanceSquared);
};

export const removeCollinearVertices = (points: ArrayLike<number>): Float32Array => {
    const count = Math.floor(points.length / 2);
    if (count < 3) {
        return new Float32Array(points);
    }

    const result: number[] = [];
    for (let i = 0; i < count; i++) {
        const a = i * 2;
        const b = ((i + 1) % count) * 2;
        const c = ((i + 2) % count) * 2;
        const ax = points[a] as number;
        const ay = points[a + 1] as number;
        const bx = points[b] as number;
        const by = points[b + 1] as number;
        const cx = points[c] as number;
        const cy = points[c + 1] as number;
        const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
        if (Math.abs(cross) > EPSILON) {
            result.push(bx, by);
        }
    }

    return result.length === points.length
        ? new Float32Array(points)
        : new Float32Array(result);
};

export const deduplicateVertices = (points: ArrayLike<number>, epsilon: number = EPSILON): Float32Array => {
    const count = Math.floor(points.length / 2);
    if (count < 2) {
        return new Float32Array(points);
    }

    const epsilonSq = epsilon * epsilon;
    const result: number[] = [points[0] as number, points[1] as number];
    for (let i = 1; i < count; i++) {
        const x = points[i * 2] as number;
        const y = points[i * 2 + 1] as number;
        const lastX = result[result.length - 2] as number;
        const lastY = result[result.length - 1] as number;
        if ((x - lastX) * (x - lastX) + (y - lastY) * (y - lastY) > epsilonSq) {
            result.push(x, y);
        }
    }

    const firstX = result[0] as number;
    const firstY = result[1] as number;
    const lastX = result[result.length - 2] as number;
    const lastY = result[result.length - 1] as number;
    if (
        (firstX - lastX) * (firstX - lastX) + (firstY - lastY) * (firstY - lastY) <=
        epsilonSq
    ) {
        result.length -= 2;
    }

    return new Float32Array(result);
};

export const isPointInTriangle = (
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number
): boolean => {
    const d1 = sign(px, py, ax, ay, bx, by);
    const d2 = sign(px, py, bx, by, cx, cy);
    const d3 = sign(px, py, cx, cy, ax, ay);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
};

const sign = (
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number
): number => (px - bx) * (ay - by) - (ax - bx) * (py - by);

export const triangulateEarClipping = (
    points: ArrayLike<number>
): Uint16Array | Uint32Array => {
    const initialCount = Math.floor(points.length / 2);
    if (initialCount < 3) {
        return new Uint16Array(0);
    }

    const working = new Float32Array(points.length);
    const reversed = polygonSignedArea(points) < -EPSILON;
    if (reversed) {
        working.set(normalizeContourOrientation(new Float32Array(points), true));
    } else {
        working.set(points);
    }
    const vertexIds = new Uint32Array(initialCount);
    if (reversed) {
        vertexIds[0] = 0;
        for (let i = 1; i < initialCount; i++) {
            vertexIds[i] = initialCount - i;
        }
    } else {
        for (let i = 0; i < initialCount; i++) {
            vertexIds[i] = i;
        }
    }
    let vertexCount = initialCount;
    const indices: number[] = [];
    const useUint32 = initialCount > 65535;
    const maxIterations = vertexCount * vertexCount + 1;
    let iterations = 0;

    while (vertexCount > 3 && iterations++ < maxIterations) {
        let earFound = false;

        for (let i = 0; i < vertexCount; i++) {
            const a = i;
            const b = (i + 1) % vertexCount;
            const c = (i + 2) % vertexCount;

            const ax = working[a * 2] as number;
            const ay = working[a * 2 + 1] as number;
            const bx = working[b * 2] as number;
            const by = working[b * 2 + 1] as number;
            const cx = working[c * 2] as number;
            const cy = working[c * 2 + 1] as number;

            const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
            if (cross <= EPSILON) {
                continue;
            }

            let isEar = true;
            for (let j = 0; j < vertexCount; j++) {
                if (j === a || j === b || j === c) continue;
                const px = working[j * 2] as number;
                const py = working[j * 2 + 1] as number;
                if (isPointInTriangle(px, py, ax, ay, bx, by, cx, cy)) {
                    isEar = false;
                    break;
                }
            }

            if (!isEar) continue;

            indices.push(vertexIds[a] as number, vertexIds[b] as number, vertexIds[c] as number);
            working[b * 2] = working[c * 2] as number;
            working[b * 2 + 1] = working[c * 2 + 1] as number;
            vertexIds[b] = vertexIds[c] as number;
            for (let k = c; k < vertexCount - 1; k++) {
                working[k * 2] = working[(k + 1) * 2] as number;
                working[k * 2 + 1] = working[(k + 1) * 2 + 1] as number;
                vertexIds[k] = vertexIds[k + 1] as number;
            }
            vertexCount--;
            earFound = true;
            break;
        }

        if (!earFound) {
            break;
        }
    }

    if (vertexCount !== 3) {
        throw new ShapeValidationError(
            `Polygon triangulation failed with ${vertexCount} vertices remaining; ring may be degenerate`
        );
    }

    indices.push(vertexIds[0] as number, vertexIds[1] as number, vertexIds[2] as number);

    return useUint32 ? new Uint32Array(indices) : new Uint16Array(indices);
};

export interface TriangulatedPolygonWithHoles {
    readonly positions: Float32Array;
    readonly indices: Uint16Array | Uint32Array;
}

/**
 * Triangulates a polygon with holes into a triangle mesh. Holes are bridged
 * into the outer boundary with zero-width keyhole seams (Eberly's bridge
 * search as implemented in mapbox/earcut, MIT) and the merged ring is ear
 * clipped — a typed-array port of earcut's linked-list core (filterPoints,
 * isEar, cureLocalIntersections, splitEarcut), minus its z-order hashing.
 * Outer ring is normalized to CCW and holes to CW; indices reference the
 * returned positions buffer.
 */
export const triangulatePolygonWithHoles = (
    outer: Float32Array,
    holes: ReadonlyArray<Float32Array>
): TriangulatedPolygonWithHoles => {
    const outerCount = Math.floor(outer.length / 2);
    if (outerCount < 3) {
        throw new ShapeValidationError(
            'Polygon outer ring must contain at least 3 vertices for triangulation'
        );
    }

    const outerRing =
        polygonSignedArea(outer) < -EPSILON
            ? normalizeContourOrientation(outer, true)
            : outer;

    const holeRings = holes.map((hole) => {
        if (Math.floor(hole.length / 2) < 3) {
            throw new ShapeValidationError(
                'Polygon hole ring must contain at least 3 vertices for triangulation'
            );
        }
        if (Math.abs(polygonSignedArea(hole)) <= EPSILON) {
            throw new ShapeValidationError('Polygon hole ring is degenerate (zero area)');
        }
        return polygonSignedArea(hole) > EPSILON
            ? normalizeContourOrientation(hole, false)
            : hole;
    });

    // Positions buffer in normalized ring order; vertex ids are buffer offsets.
    const holeVertexTotal = holeRings.reduce((sum, hole) => sum + hole.length / 2, 0);
    const originalCount = outerCount + holeVertexTotal;
    const positions = new Float32Array(originalCount * 2);
    positions.set(outerRing, 0);
    let bufferOffset = outerCount;
    for (const hole of holeRings) {
        positions.set(hole, bufferOffset * 2);
        bufferOffset += hole.length / 2;
    }

    // Flat typed-array node pool standing in for earcut's linked Node objects.
    // Capacity: one node per source vertex + 2 seam duplicates per bridge +
    // headroom for the splitEarcut fallback (2 nodes per diagonal split).
    const nodeCapacity = 2 * originalCount + 4 * holeRings.length;
    const nodeX = new Float64Array(nodeCapacity);
    const nodeY = new Float64Array(nodeCapacity);
    const nodePrev = new Int32Array(nodeCapacity);
    const nodeNext = new Int32Array(nodeCapacity);
    const nodeVertex = new Int32Array(nodeCapacity);
    let nodeCount = 0;

    const addNode = (x: number, y: number, vertex: number): number => {
        if (nodeCount >= nodeCapacity) {
            throw new ShapeValidationError(
                'Polygon triangulation exceeded its internal node pool; rings may be degenerate'
            );
        }
        const id = nodeCount++;
        nodeX[id] = x;
        nodeY[id] = y;
        nodeVertex[id] = vertex;
        return id;
    };

    const pointsEqual = (a: number, b: number): boolean =>
        nodeX[a] === nodeX[b] && nodeY[a] === nodeY[b];

    // Negated shoelace cross product (earcut convention): negative = left turn.
    const areaOf = (p: number, q: number, r: number): number =>
        ((nodeY[q] as number) - (nodeY[p] as number)) *
            ((nodeX[r] as number) - (nodeX[q] as number)) -
        ((nodeX[q] as number) - (nodeX[p] as number)) *
            ((nodeY[r] as number) - (nodeY[q] as number));

    const insertAfter = (last: number, x: number, y: number, vertex: number): number => {
        const p = addNode(x, y, vertex);
        const next = nodeNext[last] as number;
        nodeNext[p] = next;
        nodePrev[p] = last;
        nodePrev[next] = p;
        nodeNext[last] = p;
        return p;
    };

    const removeNodeAt = (p: number): void => {
        const prev = nodePrev[p] as number;
        const next = nodeNext[p] as number;
        nodeNext[prev] = next;
        nodePrev[next] = prev;
    };

    let filteredOut = false;

    // Remove collinear or coincident nodes: a full fixpoint sweep when end
    // equals start, otherwise heal only the dirty window up to end.
    const filterPoints = (start: number, endIn: number): number => {
        const full = endIn === start;
        let end = endIn;
        let p = start;
        let again: boolean;
        do {
            again = false;
            if (
                p !== nodeNext[p] &&
                (pointsEqual(p, nodeNext[p] as number) ||
                    areaOf(nodePrev[p] as number, p, nodeNext[p] as number) === 0)
            ) {
                if (full || p === end) {
                    end = nodePrev[p] as number;
                }
                filteredOut = true;
                removeNodeAt(p);
                p = nodePrev[p] as number;
                again = true;
            } else if (full || p !== end) {
                p = nodeNext[p] as number;
                again = !full;
            }
        } while (again || p !== end);
        return end;
    };

    // Boundary-inclusive triangle containment (earcut's pointInTriangle).
    const pointInTriangleInclusive = (
        ax: number,
        ay: number,
        bx: number,
        by: number,
        cx: number,
        cy: number,
        px: number,
        py: number
    ): boolean =>
        (cx - px) * (ay - py) >= (ax - px) * (cy - py) &&
        (ax - px) * (by - py) >= (bx - px) * (ay - py) &&
        (bx - px) * (cy - py) >= (cx - px) * (by - py);

    // For collinear points p, q, r: does q lie on segment pr?
    const onSegment = (p: number, q: number, r: number): boolean =>
        (nodeX[q] as number) <= Math.max(nodeX[p] as number, nodeX[r] as number) &&
        (nodeX[q] as number) >= Math.min(nodeX[p] as number, nodeX[r] as number) &&
        (nodeY[q] as number) <= Math.max(nodeY[p] as number, nodeY[r] as number) &&
        (nodeY[q] as number) >= Math.min(nodeY[p] as number, nodeY[r] as number);

    const segmentsIntersectNodes = (
        p1: number,
        q1: number,
        p2: number,
        q2: number,
        includeBoundary: boolean
    ): boolean => {
        const o1 = areaOf(p1, q1, p2);
        const o2 = areaOf(p1, q1, q2);
        const o3 = areaOf(p2, q2, p1);
        const o4 = areaOf(p2, q2, q1);

        if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) {
            return true;
        }

        if (!includeBoundary) {
            return false;
        }

        if (o1 === 0 && onSegment(p1, p2, q1)) return true;
        if (o2 === 0 && onSegment(p1, q2, q1)) return true;
        if (o3 === 0 && onSegment(p2, p1, q2)) return true;
        if (o4 === 0 && onSegment(p2, q1, q2)) return true;
        return false;
    };

    // Is the diagonal a->b locally inside the polygon at both endpoints?
    const locallyInside = (a: number, b: number): boolean =>
        areaOf(nodePrev[a] as number, a, nodeNext[a] as number) < 0
            ? areaOf(a, b, nodeNext[a] as number) >= 0 &&
              areaOf(a, nodePrev[a] as number, b) >= 0
            : areaOf(a, b, nodePrev[a] as number) < 0 ||
              areaOf(a, nodeNext[a] as number, b) < 0;

    const middleInside = (a: number, b: number): boolean => {
        let p = a;
        let inside = false;
        const px = ((nodeX[a] as number) + (nodeX[b] as number)) / 2;
        const py = ((nodeY[a] as number) + (nodeY[b] as number)) / 2;
        do {
            const n = nodeNext[p] as number;
            if (
                ((nodeY[p] as number) > py) !== ((nodeY[n] as number) > py) &&
                px <
                    (((nodeX[n] as number) - (nodeX[p] as number)) *
                        (py - (nodeY[p] as number))) /
                        ((nodeY[n] as number) - (nodeY[p] as number)) +
                        (nodeX[p] as number)
            ) {
                inside = !inside;
            }
            p = n;
        } while (p !== a);
        return inside;
    };

    // Does the diagonal a-b intersect any other ring segment?
    const intersectsPolygon = (a: number, b: number): boolean => {
        const minX = Math.min(nodeX[a] as number, nodeX[b] as number);
        const maxX = Math.max(nodeX[a] as number, nodeX[b] as number);
        const minY = Math.min(nodeY[a] as number, nodeY[b] as number);
        const maxY = Math.max(nodeY[a] as number, nodeY[b] as number);

        let p = a;
        do {
            const n = nodeNext[p] as number;
            if (
                ((nodeX[p] as number) > maxX && (nodeX[n] as number) > maxX) ||
                ((nodeX[p] as number) < minX && (nodeX[n] as number) < minX) ||
                ((nodeY[p] as number) > maxY && (nodeY[n] as number) > maxY) ||
                ((nodeY[p] as number) < minY && (nodeY[n] as number) < minY)
            ) {
                p = n;
                continue;
            }
            if (
                nodeVertex[p] !== nodeVertex[a] &&
                nodeVertex[n] !== nodeVertex[a] &&
                nodeVertex[p] !== nodeVertex[b] &&
                nodeVertex[n] !== nodeVertex[b] &&
                segmentsIntersectNodes(p, n, a, b, true)
            ) {
                return true;
            }
            p = n;
        } while (p !== a);
        return false;
    };

    const isValidDiagonal = (a: number, b: number): boolean => {
        const zeroLength =
            pointsEqual(a, b) &&
            areaOf(nodePrev[a] as number, a, nodeNext[a] as number) > 0 &&
            areaOf(nodePrev[b] as number, b, nodeNext[b] as number) > 0;
        return (
            nodeVertex[nodeNext[a] as number] !== nodeVertex[b] &&
            (zeroLength ||
                (locallyInside(a, b) &&
                    locallyInside(b, a) &&
                    (areaOf(nodePrev[a] as number, a, nodePrev[b] as number) !== 0 ||
                        areaOf(a, nodePrev[b] as number, b) !== 0))) &&
            !intersectsPolygon(a, b) &&
            (zeroLength || middleInside(a, b))
        );
    };

    // Link two ring vertices with a zero-width bridge (duplicating both).
    const splitPolygon = (a: number, b: number): number => {
        const a2 = addNode(nodeX[a] as number, nodeY[a] as number, nodeVertex[a] as number);
        const b2 = addNode(nodeX[b] as number, nodeY[b] as number, nodeVertex[b] as number);
        const an = nodeNext[a] as number;
        const bp = nodePrev[b] as number;

        nodeNext[a] = b;
        nodePrev[b] = a;

        nodeNext[a2] = an;
        nodePrev[an] = a2;

        nodeNext[b2] = a2;
        nodePrev[a2] = b2;

        nodeNext[bp] = b2;
        nodePrev[b2] = bp;

        return b2;
    };

    const getLeftmost = (start: number): number => {
        let p = start;
        let leftmost = start;
        do {
            if (
                (nodeX[p] as number) < (nodeX[leftmost] as number) ||
                ((nodeX[p] as number) === (nodeX[leftmost] as number) &&
                    (nodeY[p] as number) < (nodeY[leftmost] as number))
            ) {
                leftmost = p;
            }
            p = nodeNext[p] as number;
        } while (p !== start);
        return leftmost;
    };

    const compareXYSlope = (a: number, b: number): number =>
        (nodeX[a] as number) - (nodeX[b] as number) ||
        (nodeY[a] as number) - (nodeY[b] as number) ||
        ((nodeY[nodeNext[a] as number] as number) - (nodeY[a] as number)) /
            ((nodeX[nodeNext[a] as number] as number) - (nodeX[a] as number)) -
            ((nodeY[nodeNext[b] as number] as number) - (nodeY[b] as number)) /
                ((nodeX[nodeNext[b] as number] as number) - (nodeX[b] as number));

    // Whether the sector at vertex m contains the sector at vertex p.
    const sectorContainsSector = (m: number, p: number): boolean =>
        areaOf(nodePrev[m] as number, m, nodePrev[p] as number) < 0 &&
        areaOf(nodeNext[p] as number, m, nodeNext[m] as number) < 0;

    // Eberly's hole bridge search: cast a leftward ray from the hole's leftmost
    // vertex, take the crossed ring segment's lesser-x endpoint as the seed,
    // then refine to the best vertex inside the seed triangle.
    const findHoleBridge = (hole: number, ringNode: number): number | null => {
        const hx = nodeX[hole] as number;
        const hy = nodeY[hole] as number;
        let qx = -Infinity;
        let m: number | null = null;

        if (pointsEqual(hole, ringNode)) {
            return ringNode;
        }

        let p = ringNode;
        do {
            const py = nodeY[p] as number;
            const n = nodeNext[p] as number;
            const ny = nodeY[n] as number;
            if (hy <= py && hy >= ny && ny !== py) {
                const x =
                    (nodeX[p] as number) +
                    ((hy - py) * ((nodeX[n] as number) - (nodeX[p] as number))) / (ny - py);
                if (x <= hx && x > qx) {
                    qx = x;
                    m = (nodeX[p] as number) < (nodeX[n] as number) ? p : n;
                    if (x === hx) {
                        return m;
                    }
                }
            }
            p = n;
        } while (p !== ringNode);

        if (m === null) {
            return null;
        }

        const mx = nodeX[m] as number;
        const my = nodeY[m] as number;
        let tanMin = Infinity;

        p = ringNode;
        do {
            const px = nodeX[p] as number;
            const py = nodeY[p] as number;
            if (
                hx >= px &&
                px >= mx &&
                hx !== px &&
                pointInTriangleInclusive(
                    hy < my ? hx : qx,
                    hy,
                    mx,
                    my,
                    hy < my ? qx : hx,
                    hy,
                    px,
                    py
                )
            ) {
                const tan = Math.abs(hy - py) / (hx - px);
                const tJunction =
                    py === hy &&
                    (nodeY[nodeNext[p] as number] as number) === hy &&
                    (nodeX[nodeNext[p] as number] as number) > hx;
                if (
                    (locallyInside(p, hole) || tJunction) &&
                    (tan < tanMin ||
                        (tan === tanMin &&
                            (px > mx || (px === mx && sectorContainsSector(m, p)))))
                ) {
                    m = p;
                    tanMin = tan;
                }
            }
            p = nodeNext[p] as number;
        } while (p !== ringNode);

        return m;
    };

    const eliminateHole = (hole: number, ringNode: number): number => {
        const bridge = findHoleBridge(hole, ringNode);
        if (bridge === null) {
            throw new ShapeValidationError(
                'Polygon hole triangulation failed: no bridge between hole and outer ring'
            );
        }
        const bridgeReverse = splitPolygon(bridge, hole);
        filterPoints(bridgeReverse, nodeNext[bridgeReverse] as number);
        return filterPoints(bridge, nodeNext[bridge] as number);
    };

    // Build the outer ring (CCW traversal in storage order).
    const outerFirst = addNode(positions[0] as number, positions[1] as number, 0);
    nodeNext[outerFirst] = outerFirst;
    nodePrev[outerFirst] = outerFirst;
    let ringLast = outerFirst;
    for (let i = 1; i < outerCount; i++) {
        ringLast = insertAfter(
            ringLast,
            positions[i * 2] as number,
            positions[i * 2 + 1] as number,
            i
        );
    }

    // Build each hole as its own CW-traversed ring, then bridge the holes into
    // the merged ring left to right (earcut's elimination order).
    const holeQueue: number[] = [];
    let holeVertexBase = outerCount;
    for (const hole of holeRings) {
        const holeCount = hole.length / 2;
        const holeFirst = addNode(hole[0] as number, hole[1] as number, holeVertexBase);
        nodeNext[holeFirst] = holeFirst;
        nodePrev[holeFirst] = holeFirst;
        let holeLast = holeFirst;
        for (let k = 1; k < holeCount; k++) {
            holeLast = insertAfter(
                holeLast,
                hole[k * 2] as number,
                hole[k * 2 + 1] as number,
                holeVertexBase + k
            );
        }
        holeQueue.push(getLeftmost(holeFirst));
        holeVertexBase += holeCount;
    }
    holeQueue.sort(compareXYSlope);

    let merged = outerFirst;
    for (const holeNode of holeQueue) {
        merged = eliminateHole(holeNode, merged);
    }
    const mergedRing = filterPoints(merged, merged);


    // Ear clipping over the merged ring (earcut fallback ladder).
    const indices: number[] = [];

    // Is the candidate ear a valid convex triangle with no reflex/collinear
    // vertex inside it? Boundary-inclusive containment matches earcut.
    const isEar = (ear: number): boolean => {
        const a = nodePrev[ear] as number;
        const c = nodeNext[ear] as number;
        const ax = nodeX[a] as number;
        const ay = nodeY[a] as number;
        const bx = nodeX[ear] as number;
        const by = nodeY[ear] as number;
        const cx = nodeX[c] as number;
        const cy = nodeY[c] as number;
        const x0 = Math.min(ax, bx, cx);
        const y0 = Math.min(ay, by, cy);
        const x1 = Math.max(ax, bx, cx);
        const y1 = Math.max(ay, by, cy);

        let p = nodeNext[c] as number;
        while (p !== a) {
            if (
                (nodeX[p] as number) >= x0 &&
                (nodeX[p] as number) <= x1 &&
                (nodeY[p] as number) >= y0 &&
                (nodeY[p] as number) <= y1 &&
                !(ax === nodeX[p] && ay === nodeY[p]) &&
                pointInTriangleInclusive(ax, ay, bx, by, cx, cy, nodeX[p] as number, nodeY[p] as number) &&
                areaOf(nodePrev[p] as number, p, nodeNext[p] as number) >= 0
            ) {
                return false;
            }
            p = nodeNext[p] as number;
        }
        return true;
    };

    // Cure small local self-intersections introduced by the keyhole seams.
    const cureLocalIntersections = (start: number): number => {
        let p = start;
        let cured = false;
        do {
            const a = nodePrev[p] as number;
            const pNext = nodeNext[p] as number;
            const b = nodeNext[pNext] as number;

            if (
                segmentsIntersectNodes(a, p, pNext, b, false) &&
                locallyInside(a, b) &&
                locallyInside(b, a)
            ) {
                indices.push(nodeVertex[a] as number, nodeVertex[p] as number, nodeVertex[b] as number);
                removeNodeAt(p);
                removeNodeAt(pNext);
                p = start = b;
                cured = true;
            }
            p = nodeNext[p] as number;
        } while (p !== start);
        return cured ? filterPoints(p, p) : p;
    };

    // Try splitting the polygon into two along a valid diagonal and ear-clip
    // each half independently — the last-resort fallback for weakly-simple
    // rings that cannot be ear-clipped as a single loop.
    function splitEarcut(start: number): void {
        let a = start;
        do {
            let b = nodeNext[nodeNext[a] as number] as number;
            while (b !== nodePrev[a] as number) {
                if (nodeVertex[a] !== nodeVertex[b] && isValidDiagonal(a, b)) {
                    const c = splitPolygon(a, b);
                    a = filterPoints(a, nodeNext[a] as number);
                    const cFixed = filterPoints(c, nodeNext[c] as number);
                    earcutLinked(a);
                    earcutLinked(cFixed);
                    return;
                }
                b = nodeNext[b] as number;
            }
            a = nodeNext[a] as number;
        } while (a !== start);
    }

    // Main ear slicing loop: slice convex ears one by one, with a fallback
    // ladder (filterPoints → cureLocalIntersections → splitEarcut) that
    // handles the weakly-simple keyhole ring produced by hole bridging.
    function earcutLinked(earStart: number): void {
        let ear = earStart;
        let stop = ear;
        let cured = false;

        while (nodePrev[ear] !== nodeNext[ear]) {
            const prev = nodePrev[ear] as number;
            const next = nodeNext[ear] as number;

            if (areaOf(prev, ear, next) < 0 && isEar(ear)) {
                indices.push(nodeVertex[prev] as number, nodeVertex[ear] as number, nodeVertex[next] as number);
                removeNodeAt(ear);
                ear = next;
                stop = next;
                continue;
            }

            ear = next;

            if (ear === stop) {
                filteredOut = false;
                ear = filterPoints(ear, ear);
                if (filteredOut) {
                    stop = ear;
                    continue;
                }
                if (!cured) {
                    ear = cureLocalIntersections(ear);
                    stop = ear;
                    cured = true;
                    continue;
                }
                splitEarcut(ear);
                break;
            }
        }
    }

    earcutLinked(mergedRing);


    for (let i = 0; i < indices.length; i++) {
        if (indices[i] as number < 0 || (indices[i] as number) >= originalCount) {
            throw new ShapeValidationError(
                'Polygon with holes triangulation produced an out-of-range vertex index'
            );
        }
    }

    const useUint32 = originalCount > 65535;
    return {
        positions,
        indices: useUint32 ? new Uint32Array(indices) : new Uint16Array(indices),
    };
};

export const normalizeContourOrientation = (
    contour: Float32Array,
    ccw: boolean = true
): Float32Array => {
    const area = polygonSignedArea(contour);
    const isCcw = area >= 0;
    if (isCcw === ccw) {
        return contour;
    }

    const reversed = new Float32Array(contour.length);
    const count = contour.length / 2;

    for (let index = 0; index < count; index++) {
        const source = ((count - index) % count) * 2;
        const target = index * 2;
        reversed[target] = contour[source] as number;
        reversed[target + 1] = contour[source + 1] as number;
    }

    return reversed;
};

export const pointsToFloat32 = (points: ReadonlyArray<Readonly<IVec2Like>>): Float32Array => {
    const buffer = new Float32Array(points.length * 2);
    for (let i = 0; i < points.length; i++) {
        buffer[i * 2] = (points[i] as Readonly<IVec2Like>).x;
        buffer[i * 2 + 1] = (points[i] as Readonly<IVec2Like>).y;
    }
    return buffer;
};

export const float32ToPoints = (contour: Float32Array): Readonly<IVec2Like>[] => {
    const count = contour.length / 2;
    const points: Readonly<IVec2Like>[] = new Array(count);
    for (let i = 0; i < count; i++) {
        points[i] = Object.freeze({
            x: contour[i * 2] as number,
            y: contour[i * 2 + 1] as number,
        });
    }
    return points;
};

export const toIndexArray = (
    indices: readonly number[],
    vertexCount: number
): Uint16Array | Uint32Array =>
    vertexCount <= 65535 ? new Uint16Array(indices) : new Uint32Array(indices);

export const approximateCurveSegments = (
    radiusX: number,
    radiusY: number,
    options: ShapeApproximationOptions = {}
): number => {
    const tolerance = Math.max(options.curveTolerance ?? DEFAULT_CURVE_TOLERANCE, EPSILON);
    const minSegments = Math.max(3, Math.floor(options.minCurveSegments ?? DEFAULT_MIN_CURVE_SEGMENTS));
    const maxSegments = Math.max(
        minSegments,
        Math.floor(options.maxCurveSegments ?? DEFAULT_MAX_CURVE_SEGMENTS)
    );
    const radius = Math.max(Math.abs(radiusX), Math.abs(radiusY));

    if (radius <= EPSILON) {
        return minSegments;
    }

    const ratio = clamp(1 - tolerance / radius, -1, 1);
    const theta = Math.max(EPSILON, 2 * Math.acos(ratio));
    const segments = Math.ceil(TAU / theta);
    return clamp(segments, minSegments, maxSegments);
};

export const applyGradientSpread = (value: number, spread: GradientSpread): number => {
    if (!Number.isFinite(value)) {
        throw new PaintValidationError('Gradient sample value must be finite');
    }

    switch (spread) {
        case 'pad':
            return clamp01(value);
        case 'repeat': {
            const normalized = value % 1;
            return normalized < 0 ? normalized + 1 : normalized;
        }
        case 'reflect': {
            const wrapped = Math.abs(value % 2);
            return wrapped > 1 ? 2 - wrapped : wrapped;
        }
        default:
            return clamp01(value);
    }
};

export const hashString = (value: string): string => {
    const h = new Fnv1a32();
    h.updateString(value);
    return h.digestHex();
};

export const formatPointKey = (point: Readonly<IVec2Like>): string =>
    `${normalizeNumberKey(point.x)},${normalizeNumberKey(point.y)}`;
