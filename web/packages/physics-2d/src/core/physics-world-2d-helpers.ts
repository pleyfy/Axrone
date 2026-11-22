import { clamp } from '@axrone/numeric';
import type { IVec2Like } from '@axrone/numeric';
export { clamp };

import type {
    BodyId,
    ShapeId,
    ConstraintId,
    ConstraintType,
    IMaterial,
    IMassData2D,
    Density,
    Friction,
    Restitution,
    Inertia,
    Mass,
} from '../types';
import { CollisionFilter } from '../types';

import type { BodyManager2D } from './body-manager';

export const STANDALONE_CONSTRAINT_ID_START = 1_000_000;
export const GEOMETRY_EPSILON = 1e-6;
export const POINT_QUERY_EPSILON = 1e-4;

export interface IAabb2D {
    readonly min: IVec2Like;
    readonly max: IVec2Like;
}

export interface IShapeFilter2D {
    readonly categoryBits: number;
    readonly maskBits: number;
    readonly groupIndex: number;
}

export interface IShapeDescriptor2D {
    readonly type: number;
    readonly bodyId: BodyId;
    readonly material: IMaterial;
    readonly isSensor: boolean;
    readonly filter: IShapeFilter2D;
    readonly userData: unknown;
    readonly center: IVec2Like | null;
    readonly radius: number | null;
    readonly halfWidth: number | null;
    readonly halfHeight: number | null;
    readonly rotation: number | null;
    readonly length: number | null;
    readonly vertices: readonly IVec2Like[] | null;
    readonly start: IVec2Like | null;
    readonly end: IVec2Like | null;
}

export interface IConstraintDescriptor2D {
    readonly storage: 'manager' | 'world';
    readonly type: ConstraintType;
    readonly bodyIdA: BodyId;
    readonly bodyIdB: BodyId;
    readonly collideConnected: boolean;
    enabled: boolean;
    readonly userData: unknown;
    readonly localAnchorA: IVec2Like | null;
    readonly localAnchorB: IVec2Like | null;
    readonly localAxisA: IVec2Like | null;
    readonly linearOffset: IVec2Like | null;
    readonly target: IVec2Like | null;
    readonly constraintIdA: ConstraintId | null;
    readonly constraintIdB: ConstraintId | null;
    readonly referenceAngle: number | null;
    readonly angularOffset: number | null;
    readonly length: number | null;
    readonly minLength: number | null;
    readonly maxLength: number | null;
    readonly stiffness: number | null;
    readonly damping: number | null;
    readonly lowerTranslation: number | null;
    readonly upperTranslation: number | null;
    readonly motorSpeed: number | null;
    readonly maxMotorTorque: number | null;
    readonly maxMotorForce: number | null;
    readonly maxForce: number | null;
    readonly maxTorque: number | null;
    readonly correctionFactor: number | null;
    readonly ratio: number | null;
}

export function cloneVec2(vector: Readonly<IVec2Like>): IVec2Like {
    return { x: vector.x, y: vector.y };
}

/**
 * Normalise a serialised 2D vector to `{x, y}`, accepting BOTH the Editor's
 * array form `[x, y]` and the engine's object form `{x, y}`.
 *
 * Non-finite components (NaN/Infinity/null/omitted) fall back to the given
 * defaults so a malformed scene value can never poison a body or shape.
 *
 * @see Joint2D.normalizeVec2Value — thin wrapper kept for subclass compatibility.
 */
export function normalizeVec2Like(
    value: unknown,
    fallbackX: number = 0,
    fallbackY: number = 0
): IVec2Like {
    if (Array.isArray(value) && value.length >= 2) {
        const x = value[0];
        const y = value[1];
        return {
            x: typeof x === 'number' && Number.isFinite(x) ? x : fallbackX,
            y: typeof y === 'number' && Number.isFinite(y) ? y : fallbackY,
        };
    }
    if (value && typeof value === 'object') {
        const v = value as Record<string, unknown>;
        const x = v.x;
        const y = v.y;
        return {
            x: typeof x === 'number' && Number.isFinite(x) ? x : fallbackX,
            y: typeof y === 'number' && Number.isFinite(y) ? y : fallbackY,
        };
    }
    return { x: fallbackX, y: fallbackY };
}

/**
 * Coerce a value coming from a deserialised scene document to a finite number,
 * preserving an explicit `Infinity` (used by break limits and max distances)
 * and falling back to `fallback` for null/NaN/garbage.
 */
export function finiteNumberOr(value: unknown, fallback: number): number {
    if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
    return value;
}

/**
 * Coerce a value from a deserialised scene document to a strictly finite
 * number. Unlike {@link finiteNumberOr}, `Infinity` is rejected: use this for
 * solver inputs (lengths, torques, damping) where an unbounded value would
 * poison the constraint.
 */
export function finiteOr(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Extract the planar (Z) angle in radians from a quaternion.
 *
 * Returns `0` for a degenerate/non-finite quaternion so a corrupted transform
 * can never inject NaN rotation into a physics body.
 */
export function quaternionToZRadians(
    w: number,
    x: number,
    y: number,
    z: number
): number {
    if (!Number.isFinite(w) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return 0;
    }
    const angle = Math.atan2(
        2 * (w * z + x * y),
        1 - 2 * (y * y + z * z)
    );
    return Number.isFinite(angle) ? angle : 0;
}

export function rotateVec2(vector: Readonly<IVec2Like>, angle: number): IVec2Like {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return {
        x: cosine * vector.x - sine * vector.y,
        y: sine * vector.x + cosine * vector.y,
    };
}

export function inverseRotateVec2(vector: Readonly<IVec2Like>, angle: number): IVec2Like {
    return rotateVec2(vector, -angle);
}

export function transformPoint2D(
    position: Readonly<IVec2Like>,
    rotation: number,
    localPoint: Readonly<IVec2Like>
): IVec2Like {
    const rotated = rotateVec2(localPoint, rotation);
    return {
        x: position.x + rotated.x,
        y: position.y + rotated.y,
    };
}

export function subtractVec2(a: Readonly<IVec2Like>, b: Readonly<IVec2Like>): IVec2Like {
    return { x: a.x - b.x, y: a.y - b.y };
}

export function dotVec2(a: Readonly<IVec2Like>, b: Readonly<IVec2Like>): number {
    return a.x * b.x + a.y * b.y;
}

export function crossVec2(a: Readonly<IVec2Like>, b: Readonly<IVec2Like>): number {
    return a.x * b.y - a.y * b.x;
}

export function lengthSquared(vector: Readonly<IVec2Like>): number {
    return dotVec2(vector, vector);
}

export function distanceSquared(a: Readonly<IVec2Like>, b: Readonly<IVec2Like>): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}


export function normalizeBounds(min: Readonly<IVec2Like>, max: Readonly<IVec2Like>): IAabb2D {
    return {
        min: {
            x: Math.min(min.x, max.x),
            y: Math.min(min.y, max.y),
        },
        max: {
            x: Math.max(min.x, max.x),
            y: Math.max(min.y, max.y),
        },
    };
}

export function intersectsAabb(a: IAabb2D, b: IAabb2D): boolean {
    return (
        a.min.x <= b.max.x &&
        a.max.x >= b.min.x &&
        a.min.y <= b.max.y &&
        a.max.y >= b.min.y
    );
}

export function cloneMaterial(material: IMaterial): IMaterial {
    return {
        friction: material.friction,
        restitution: material.restitution,
        density: material.density,
        ...(material.rollingFriction !== undefined
            ? { rollingFriction: material.rollingFriction }
            : {}),
        ...(material.spinningFriction !== undefined
            ? { spinningFriction: material.spinningFriction }
            : {}),
    };
}

export function toShapeMaterial(def: {
    readonly material?: IMaterial;
    readonly friction?: Friction;
    readonly restitution?: Restitution;
    readonly density?: Density;
}): IMaterial {
    if (def.material) {
        return cloneMaterial(def.material);
    }

    return {
        friction: (def.friction ?? 0.4) as Friction,
        restitution: (def.restitution ?? 0) as Restitution,
        density: (def.density ?? 1) as Density,
    };
}

export function toShapeFilter(def: {
    readonly filter?: {
        readonly categoryBits: number;
        readonly maskBits: number;
        readonly groupIndex: number;
    };
}): IShapeFilter2D {
    if (def.filter) {
        return {
            categoryBits: def.filter.categoryBits,
            maskBits: def.filter.maskBits,
            groupIndex: def.filter.groupIndex,
        };
    }

    return {
        categoryBits: CollisionFilter.Default,
        maskBits: CollisionFilter.All,
        groupIndex: 0,
    };
}

export function computePolygonCentroid(vertices: readonly Readonly<IVec2Like>[]): IVec2Like {
    let signedAreaTwice = 0;
    let centroidX = 0;
    let centroidY = 0;

    for (let index = 0; index < vertices.length; index++) {
        const current = vertices[index];
        const next = vertices[(index + 1) % vertices.length];
        const cross = crossVec2(current, next);
        signedAreaTwice += cross;
        centroidX += (current.x + next.x) * cross;
        centroidY += (current.y + next.y) * cross;
    }

    if (Math.abs(signedAreaTwice) <= GEOMETRY_EPSILON) {
        let averageX = 0;
        let averageY = 0;
        for (const vertex of vertices) {
            averageX += vertex.x;
            averageY += vertex.y;
        }

        return {
            x: averageX / vertices.length,
            y: averageY / vertices.length,
        };
    }

    return {
        x: centroidX / (3 * signedAreaTwice),
        y: centroidY / (3 * signedAreaTwice),
    };
}

export function computePolygonMassData(
    vertices: readonly Readonly<IVec2Like>[],
    density: Density
): IMassData2D {
    let signedAreaTwice = 0;
    let centroidX = 0;
    let centroidY = 0;
    let inertiaIntegral = 0;

    for (let index = 0; index < vertices.length; index++) {
        const current = vertices[index];
        const next = vertices[(index + 1) % vertices.length];
        const cross = crossVec2(current, next);
        signedAreaTwice += cross;
        centroidX += (current.x + next.x) * cross;
        centroidY += (current.y + next.y) * cross;

        const dotSum =
            current.x * current.x +
            current.x * next.x +
            next.x * next.x +
            current.y * current.y +
            current.y * next.y +
            next.y * next.y;
        inertiaIntegral += cross * dotSum;
    }

    const area = signedAreaTwice * 0.5;
    if (Math.abs(area) <= GEOMETRY_EPSILON) {
        return {
            mass: 0 as Mass,
            inverseMass: 0,
            inertia: 0 as Inertia,
            inverseInertia: 0,
            center: { x: 0, y: 0 },
        };
    }

    const center = {
        x: centroidX / (3 * signedAreaTwice),
        y: centroidY / (3 * signedAreaTwice),
    };

    const mass = Math.abs(area) * density;
    const inertiaAboutOrigin = Math.abs((density * inertiaIntegral) / 12);
    const inertia = Math.max(0, inertiaAboutOrigin - mass * lengthSquared(center));

    return {
        mass: mass as Mass,
        inverseMass: mass > GEOMETRY_EPSILON ? 1 / mass : 0,
        inertia: inertia as Inertia,
        inverseInertia: inertia > GEOMETRY_EPSILON ? 1 / inertia : 0,
        center,
    };
}

export function pointInPolygon(
    point: Readonly<IVec2Like>,
    vertices: readonly Readonly<IVec2Like>[]
): boolean {
    let inside = false;

    for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index++) {
        const current = vertices[index];
        const last = vertices[previous];
        const intersects =
            current.y > point.y !== last.y > point.y &&
            point.x <
                ((last.x - current.x) * (point.y - current.y)) / (last.y - current.y) + current.x;

        if (intersects) {
            inside = !inside;
        }
    }

    return inside;
}

export function distanceSquaredToSegment(
    point: Readonly<IVec2Like>,
    start: Readonly<IVec2Like>,
    end: Readonly<IVec2Like>
): number {
    const segment = subtractVec2(end, start);
    const segmentLengthSq = lengthSquared(segment);
    if (segmentLengthSq <= GEOMETRY_EPSILON) {
        return distanceSquared(point, start);
    }

    const projection = clamp(dotVec2(subtractVec2(point, start), segment) / segmentLengthSq, 0, 1);
    const closestPoint = {
        x: start.x + segment.x * projection,
        y: start.y + segment.y * projection,
    };
    return distanceSquared(point, closestPoint);
}

export function raycastSegment(
    origin: Readonly<IVec2Like>,
    direction: Readonly<IVec2Like>,
    start: Readonly<IVec2Like>,
    end: Readonly<IVec2Like>,
    maxFraction: number
): { hit: boolean; fraction: number; point: IVec2Like; normal: IVec2Like } {
    const edge = subtractVec2(end, start);
    const normal = { x: -edge.y, y: edge.x };
    const normalLength = Math.sqrt(lengthSquared(normal));

    if (normalLength <= GEOMETRY_EPSILON) {
        return {
            hit: false,
            fraction: Infinity,
            point: { x: 0, y: 0 },
            normal: { x: 0, y: 0 },
        };
    }

    normal.x /= normalLength;
    normal.y /= normalLength;

    const denominator = dotVec2(direction, normal);
    if (Math.abs(denominator) <= GEOMETRY_EPSILON) {
        return {
            hit: false,
            fraction: Infinity,
            point: { x: 0, y: 0 },
            normal: { x: 0, y: 0 },
        };
    }

    const fraction = dotVec2(subtractVec2(start, origin), normal) / denominator;
    if (fraction < 0 || fraction > maxFraction) {
        return {
            hit: false,
            fraction: Infinity,
            point: { x: 0, y: 0 },
            normal: { x: 0, y: 0 },
        };
    }

    const point = {
        x: origin.x + direction.x * fraction,
        y: origin.y + direction.y * fraction,
    };

    const edgeLengthSq = lengthSquared(edge);
    const edgeFraction =
        edgeLengthSq > GEOMETRY_EPSILON
            ? dotVec2(subtractVec2(point, start), edge) / edgeLengthSq
            : 0;

    if (edgeFraction < 0 || edgeFraction > 1) {
        return {
            hit: false,
            fraction: Infinity,
            point: { x: 0, y: 0 },
            normal: { x: 0, y: 0 },
        };
    }

    return {
        hit: true,
        fraction,
        point,
        normal,
    };
}

export function buildBoxVertices(
    center: Readonly<IVec2Like>,
    halfWidth: number,
    halfHeight: number,
    rotation: number
): readonly IVec2Like[] {
    const localVertices = [
        { x: -halfWidth, y: -halfHeight },
        { x: halfWidth, y: -halfHeight },
        { x: halfWidth, y: halfHeight },
        { x: -halfWidth, y: halfHeight },
    ];

    return localVertices.map((vertex) => {
        const rotated = rotateVec2(vertex, rotation);
        return {
            x: center.x + rotated.x,
            y: center.y + rotated.y,
        };
    });
}

export function getBodyWorldCenter(bodyManager: BodyManager2D, bodyId: BodyId): IVec2Like {
    const position = bodyManager.getPosition(bodyId);
    const rotation = bodyManager.getRotation(bodyId);
    const localCenter = bodyManager.getLocalCenter(bodyId);
    return transformPoint2D(position, rotation, localCenter);
}