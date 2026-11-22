import { AnimationValidationError } from './errors';

interface Point2D {
    readonly x: number;
    readonly y: number;
}

interface Triangle {
    readonly a: number;
    readonly b: number;
    readonly c: number;
}

const DISTANCE_EPSILON_SQ = 1e-12;

const cross = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number =>
    (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

const inCircumcircle = (p: Point2D, a: Point2D, b: Point2D, c: Point2D): boolean => {
    const ax = a.x - p.x;
    const ay = a.y - p.y;
    const bx = b.x - p.x;
    const by = b.y - p.y;
    const cx = c.x - p.x;
    const cy = c.y - p.y;
    const determinant =
        (ax * ax + ay * ay) * (bx * cy - cx * by) -
        (bx * bx + by * by) * (ax * cy - cx * ay) +
        (cx * cx + cy * cy) * (ax * by - bx * ay);
    const orientation = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    return orientation >= 0 ? determinant > 1e-12 : determinant < -1e-12;
};

/** Builds a flat triangle index list for freeform 2D blends. */
export const buildDelaunayTriangles = (points: readonly Point2D[]): Int32Array => {
    const count = points.length;
    if (count < 3) {
        return new Int32Array(0);
    }

    for (let i = 0; i < count; i += 1) {
        for (let j = i + 1; j < count; j += 1) {
            const dx = points[i]!.x - points[j]!.x;
            const dy = points[i]!.y - points[j]!.y;
            if (dx * dx + dy * dy <= DISTANCE_EPSILON_SQ) {
                throw new AnimationValidationError(
                    `Freeform blend points ${i} and ${j} coincide`
                );
            }
        }
    }

    let minX = points[0]!.x;
    let maxX = minX;
    let minY = points[0]!.y;
    let maxY = minY;
    for (let i = 1; i < count; i += 1) {
        minX = Math.min(minX, points[i]!.x);
        maxX = Math.max(maxX, points[i]!.x);
        minY = Math.min(minY, points[i]!.y);
        maxY = Math.max(maxY, points[i]!.y);
    }

    const centerX = (minX + maxX) * 0.5;
    const centerY = (minY + maxY) * 0.5;
    const radius = Math.max(maxX - minX, maxY - minY) + 2;
    const span = radius * 32;

    const vertices: Point2D[] = [
        ...points,
        { x: centerX - span, y: centerY - radius },
        { x: centerX, y: centerY + span },
        { x: centerX + span, y: centerY - radius },
    ];

    let triangles: Triangle[] = [{ a: count, b: count + 1, c: count + 2 }];

    for (let p = 0; p < count; p += 1) {
        const point = points[p]!;
        const bad: Triangle[] = [];
        const edges = new Map<string, { a: number; b: number; count: number }>();

        for (const triangle of triangles) {
            if (!inCircumcircle(point, vertices[triangle.a]!, vertices[triangle.b]!, vertices[triangle.c]!)) {
                continue;
            }
            bad.push(triangle);
            for (const [a, b] of [
                [triangle.a, triangle.b],
                [triangle.b, triangle.c],
                [triangle.c, triangle.a],
            ] as const) {
                const key = a < b ? `${a}:${b}` : `${b}:${a}`;
                const edge = edges.get(key);
                if (edge) {
                    edge.count += 1;
                } else {
                    edges.set(key, { a: Math.min(a, b), b: Math.max(a, b), count: 1 });
                }
            }
        }

        if (bad.length === 0) {
            continue;
        }

        const badSet = new Set(bad);
        triangles = triangles.filter((triangle) => !badSet.has(triangle));
        for (const edge of edges.values()) {
            if (edge.count === 1) {
                triangles.push({ a: edge.a, b: edge.b, c: p });
            }
        }
    }

    const result: number[] = [];
    for (const triangle of triangles) {
        if (triangle.a >= count || triangle.b >= count || triangle.c >= count) {
            continue;
        }
        const area = cross(
            vertices[triangle.a]!.x,
            vertices[triangle.a]!.y,
            vertices[triangle.b]!.x,
            vertices[triangle.b]!.y,
            vertices[triangle.c]!.x,
            vertices[triangle.c]!.y
        );
        if (Math.abs(area) <= 1e-9) {
            continue;
        }
        result.push(triangle.a);
        if (area > 0) {
            result.push(triangle.b, triangle.c);
        } else {
            result.push(triangle.c, triangle.b);
        }
    }

    return Int32Array.from(result);
};
