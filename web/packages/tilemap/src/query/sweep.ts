import { KEY_MAX, KEY_MIN, type PackedTileWord } from '../types/brands';
import type { LayerReference, LayerSpec } from '../types/layers';
import type { ProjectionSpec } from '../types/projection';
import type { TilemapEngine } from '../engine/tilemap-engine';
import { worldToGrid } from './projection';
import {
    isSolidTileWord,
    tileFaceNormal,
    type TileSolidPredicate,
} from './raycast';

/** Axis-aligned box in world space. */
export interface TileAabb {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface TileSweepHit {
    collided: boolean;
    /** Parameter in `[0, 1]` along the requested delta. */
    time: number;
    gridX: number;
    gridY: number;
    word: PackedTileWord;
    /** Resolved top-left position after the sweep (with back-off). */
    x: number;
    y: number;
    normalX: number;
    normalY: number;
}

export const createSweepHit = (): TileSweepHit => ({
    collided: false,
    time: 0,
    gridX: 0,
    gridY: 0,
    word: 0 as PackedTileWord,
    x: 0,
    y: 0,
    normalX: 0,
    normalY: 0,
});

export const SWEEP_BACKOFF = 1e-5;

export interface SweepOptions {
    readonly isSolid?: TileSolidPredicate;
    /** World-space back-off on the resolved position; defaults to `1e-5`. */
    readonly backoff?: number;
}

interface GridBox {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
}

const gridBoxOf = (
    projection: ProjectionSpec,
    box: TileAabb
): GridBox => {
    const corners = [
        worldToGrid(projection, box.x, box.y),
        worldToGrid(projection, box.x + box.width, box.y),
        worldToGrid(projection, box.x, box.y + box.height),
        worldToGrid(
            projection,
            box.x + box.width,
            box.y + box.height
        ),
    ];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const corner of corners) {
        minX = Math.min(minX, corner.gridX);
        minY = Math.min(minY, corner.gridY);
        maxX = Math.max(maxX, corner.gridX);
        maxY = Math.max(maxY, corner.gridY);
    }
    // A staggered transform shifts by half a tile per band; when the box
    // spans more than one band, widen the perpendicular axis conservatively.
    if (projection.kind === 'staggered-isometric') {
        if ((projection.staggerAxis ?? 'y') === 'x') {
            if (Math.floor(minX) !== Math.floor(maxX)) {
                minY -= 0.5;
                maxY += 0.5;
            }
        } else if (Math.floor(minY) !== Math.floor(maxY)) {
            minX -= 0.5;
            maxX += 0.5;
        }
    }
    return { minX, minY, maxX, maxY };
};

const clearSweep = (
    out: TileSweepHit,
    box: TileAabb,
    deltaX: number,
    deltaY: number
): false => {
    out.collided = false;
    out.time = 0;
    out.gridX = 0;
    out.gridY = 0;
    out.word = 0 as PackedTileWord;
    out.x = box.x + deltaX;
    out.y = box.y + deltaY;
    out.normalX = 0;
    out.normalY = 0;
    return false;
};

/**
 * Sweeps a world-space AABB against non-empty tiles of one layer.
 *
 * The box and its delta are transformed into continuous grid space (a
 * conservative AABB for isometric and staggered projections), the sweep runs
 * against the grid there, and the resolved position and face normal are
 * reported in world space. A box that already overlaps a solid tile returns
 * `time = 0` with the minimum-translation normal and an unchanged position.
 * Zero delta returns no hit.
 */
export const sweepTilemapAabb = <L extends readonly LayerSpec[]>(
    engine: TilemapEngine<L>,
    layer: LayerReference<L>,
    box: TileAabb,
    deltaX: number,
    deltaY: number,
    options: SweepOptions = {},
    out: TileSweepHit = createSweepHit()
): boolean => {
    if (deltaX === 0 && deltaY === 0) return clearSweep(out, box, 0, 0);
    const projection = engine.projection;
    const isSolid = options.isSolid ?? isSolidTileWord;
    const backoff = options.backoff ?? SWEEP_BACKOFF;

    const gridBox = gridBoxOf(projection, box);
    const halfWidth = (gridBox.maxX - gridBox.minX) / 2;
    const halfHeight = (gridBox.maxY - gridBox.minY) / 2;
    const centerX = (gridBox.minX + gridBox.maxX) / 2;
    const centerY = (gridBox.minY + gridBox.maxY) / 2;
    const center = worldToGrid(
        projection,
        box.x + box.width / 2,
        box.y + box.height / 2
    );
    const moved = worldToGrid(
        projection,
        box.x + box.width / 2 + deltaX,
        box.y + box.height / 2 + deltaY
    );
    const velocityX = moved.gridX - center.gridX;
    const velocityY = moved.gridY - center.gridY;

    const minTileX = Math.max(
        KEY_MIN,
        Math.floor(
            Math.min(centerX - halfWidth, centerX + velocityX - halfWidth)
        )
    );
    const maxTileX = Math.min(
        KEY_MAX,
        Math.floor(Math.max(centerX + halfWidth, centerX + velocityX + halfWidth))
    );
    const minTileY = Math.max(
        KEY_MIN,
        Math.floor(
            Math.min(centerY - halfHeight, centerY + velocityY - halfHeight)
        )
    );
    const maxTileY = Math.min(
        KEY_MAX,
        Math.floor(Math.max(centerY + halfHeight, centerY + velocityY + halfHeight))
    );

    // Start-penetration: pick the smallest translation that separates the box.
    let penetration = Infinity;
    let penetrationX = 0;
    let penetrationY = 0;
    let penetrationTileX = 0;
    let penetrationTileY = 0;
    let penetrationWord = 0 as PackedTileWord;
    for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
        for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
            const word = engine.readAt(layer, tileX, tileY);
            if (!isSolid(word)) continue;
            const overlapLeft = gridBox.maxX - tileX;
            const overlapRight = tileX + 1 - gridBox.minX;
            const overlapTop = gridBox.maxY - tileY;
            const overlapBottom = tileY + 1 - gridBox.minY;
            if (
                overlapLeft <= 0 ||
                overlapRight <= 0 ||
                overlapTop <= 0 ||
                overlapBottom <= 0
            ) {
                continue;
            }
            const pushLeft = overlapLeft <= overlapRight;
            const pushUp = overlapTop <= overlapBottom;
            const candidateX = pushLeft ? overlapLeft : overlapRight;
            const candidateY = pushUp ? overlapTop : overlapBottom;
            const candidate = Math.min(candidateX, candidateY);
            if (candidate < penetration) {
                penetration = candidate;
                penetrationTileX = tileX;
                penetrationTileY = tileY;
                penetrationWord = word;
                if (candidateX <= candidateY) {
                    penetrationX = pushLeft ? -1 : 1;
                    penetrationY = 0;
                } else {
                    penetrationX = 0;
                    penetrationY = pushUp ? -1 : 1;
                }
            }
        }
    }
    if (penetration !== Infinity) {
        const normal = tileFaceNormal(
            projection,
            penetrationX,
            penetrationY
        );
        out.collided = true;
        out.time = 0;
        out.gridX = penetrationTileX;
        out.gridY = penetrationTileY;
        out.word = penetrationWord;
        out.x = box.x;
        out.y = box.y;
        out.normalX = normal.normalX;
        out.normalY = normal.normalY;
        return true;
    }

    let bestTime = Infinity;
    let bestTileX = 0;
    let bestTileY = 0;
    let bestWord = 0 as PackedTileWord;
    let bestNormalX = 0;
    let bestNormalY = 0;
    let bestAxis = 0;

    for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
        for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
            const word = engine.readAt(layer, tileX, tileY);
            if (!isSolid(word)) continue;
            const expandedMinX = tileX - halfWidth;
            const expandedMaxX = tileX + 1 + halfWidth;
            const expandedMinY = tileY - halfHeight;
            const expandedMaxY = tileY + 1 + halfHeight;

            let enterX = -Infinity;
            let enterY = -Infinity;
            let exitX = Infinity;
            let exitY = Infinity;
            if (velocityX === 0) {
                if (centerX < expandedMinX || centerX > expandedMaxX) continue;
            } else {
                const first = (expandedMinX - centerX) / velocityX;
                const second = (expandedMaxX - centerX) / velocityX;
                enterX = Math.min(first, second);
                exitX = Math.max(first, second);
            }
            if (velocityY === 0) {
                if (centerY < expandedMinY || centerY > expandedMaxY) continue;
            } else {
                const first = (expandedMinY - centerY) / velocityY;
                const second = (expandedMaxY - centerY) / velocityY;
                enterY = Math.min(first, second);
                exitY = Math.max(first, second);
            }
            const enter = Math.max(enterX, enterY);
            const exit = Math.min(exitX, exitY);
            if (enter > exit || exit < 0) continue;
            const time = Math.max(0, enter);
            if (time > 1) continue;
            const axis = enterX >= enterY ? 0 : 1;
            if (
                time < bestTime - 1e-12 ||
                (Math.abs(time - bestTime) <= 1e-12 &&
                    axis === 0 &&
                    bestAxis === 1)
            ) {
                bestTime = time;
                bestTileX = tileX;
                bestTileY = tileY;
                bestWord = word;
                bestAxis = axis;
                if (axis === 0) {
                    bestNormalX = velocityX > 0 ? -1 : 1;
                    bestNormalY = 0;
                } else {
                    bestNormalX = 0;
                    bestNormalY = velocityY > 0 ? -1 : 1;
                }
            }
        }
    }

    if (bestTime === Infinity) return clearSweep(out, box, deltaX, deltaY);

    const length = Math.hypot(deltaX, deltaY);
    const resolvedTime =
        bestTime <= 0 ? 0 : Math.max(0, bestTime - backoff / length);
    const normal = tileFaceNormal(projection, bestNormalX, bestNormalY);
    out.collided = true;
    out.time = bestTime;
    out.gridX = bestTileX;
    out.gridY = bestTileY;
    out.word = bestWord;
    out.x = box.x + deltaX * resolvedTime;
    out.y = box.y + deltaY * resolvedTime;
    out.normalX = normal.normalX;
    out.normalY = normal.normalY;
    return true;
};
