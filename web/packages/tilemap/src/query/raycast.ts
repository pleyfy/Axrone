import { KEY_MAX, KEY_MIN, type PackedTileWord } from '../types/brands';
import type { LayerReference, LayerSpec } from '../types/layers';
import type { ProjectionSpec } from '../types/projection';
import type { TilemapEngine } from '../engine/tilemap-engine';
import { floorTile, worldToGrid, worldToTile } from './projection';

export type TileSolidPredicate = (word: PackedTileWord) => boolean;

/** Default solid test: any non-empty tile blocks the query. */
export const isSolidTileWord: TileSolidPredicate = (word) =>
    (word as unknown as number) !== 0;

export interface TileRaycastHit {
    hit: boolean;
    gridX: number;
    gridY: number;
    word: PackedTileWord;
    /** Parameter along `origin + direction * t`; `0` at the origin. */
    time: number;
    /** World distance from the origin to the hit point. */
    distance: number;
    worldX: number;
    worldY: number;
    /** World-space unit normal of the entered tile face. */
    normalX: number;
    normalY: number;
}

export const createRaycastHit = (): TileRaycastHit => ({
    hit: false,
    gridX: 0,
    gridY: 0,
    word: 0 as PackedTileWord,
    time: 0,
    distance: 0,
    worldX: 0,
    worldY: 0,
    normalX: 0,
    normalY: 0,
});

export interface RaycastOptions {
    /** World-space limit; defaults to infinity. */
    readonly maxDistance?: number;
    readonly isSolid?: TileSolidPredicate;
}

export const tileFaceNormal = (
    projection: ProjectionSpec,
    gridNormalX: number,
    gridNormalY: number
): { normalX: number; normalY: number } => {
    const halfWidth = projection.tileWidth / 2;
    const halfHeight = projection.tileHeight / 2;
    let normalX: number;
    let normalY: number;
    switch (projection.kind) {
        case 'isometric':
            normalX = halfHeight * (gridNormalX - gridNormalY);
            normalY = halfWidth * (gridNormalX + gridNormalY);
            break;
        case 'staggered-isometric':
            if ((projection.staggerAxis ?? 'y') === 'x') {
                normalX = gridNormalX / halfWidth;
                normalY = gridNormalY / projection.tileHeight;
            } else {
                normalX = gridNormalX / projection.tileWidth;
                normalY = gridNormalY / halfHeight;
            }
            break;
        case 'orthogonal':
        default:
            normalX = gridNormalX / projection.tileWidth;
            normalY = gridNormalY / projection.tileHeight;
            break;
    }
    const length = Math.hypot(normalX, normalY);
    if (length === 0) return { normalX: 0, normalY: 0 };
    return { normalX: normalX / length, normalY: normalY / length };
};

/** Direction of the world vector in continuous grid space (affine part only). */
const gridDirection = (
    projection: ProjectionSpec,
    directionX: number,
    directionY: number
): { gridX: number; gridY: number } => {
    const base = worldToGrid(projection, 0, 0);
    const tip = worldToGrid(projection, directionX, directionY);
    return { gridX: tip.gridX - base.gridX, gridY: tip.gridY - base.gridY };
};

const fillHit = (
    hit: TileRaycastHit,
    projection: ProjectionSpec,
    originX: number,
    originY: number,
    directionX: number,
    directionY: number,
    tileX: number,
    tileY: number,
    word: PackedTileWord,
    time: number,
    gridNormalX: number,
    gridNormalY: number
): true => {
    const normal = tileFaceNormal(projection, gridNormalX, gridNormalY);
    hit.hit = true;
    hit.gridX = tileX;
    hit.gridY = tileY;
    hit.word = word;
    hit.time = time;
    hit.distance = Math.hypot(directionX, directionY) * time;
    hit.worldX = originX + directionX * time;
    hit.worldY = originY + directionY * time;
    hit.normalX = normal.normalX;
    hit.normalY = normal.normalY;
    return true;
};

const clearHit = (hit: TileRaycastHit): false => {
    hit.hit = false;
    hit.gridX = 0;
    hit.gridY = 0;
    hit.word = 0 as PackedTileWord;
    hit.time = 0;
    hit.distance = 0;
    hit.worldX = 0;
    hit.worldY = 0;
    hit.normalX = 0;
    hit.normalY = 0;
    return false;
};

/**
 * Grid-space DDA for orthogonal and isometric projections. Both transforms are
 * affine, so a straight world ray stays straight and the parameter `t` is
 * preserved between world and grid space.
 */
const raycastAffine = <L extends readonly LayerSpec[]>(
    engine: TilemapEngine<L>,
    layer: LayerReference<L>,
    projection: ProjectionSpec,
    originX: number,
    originY: number,
    directionX: number,
    directionY: number,
    timeLimit: number,
    isSolid: TileSolidPredicate,
    out: TileRaycastHit
): boolean => {
    const origin = worldToGrid(projection, originX, originY);
    const direction = gridDirection(projection, directionX, directionY);
    if (direction.gridX === 0 && direction.gridY === 0) return clearHit(out);

    let tileX = floorTile(origin.gridX);
    let tileY = floorTile(origin.gridY);
    if (tileX < KEY_MIN || tileX > KEY_MAX || tileY < KEY_MIN || tileY > KEY_MAX) {
        return clearHit(out);
    }

    const stepX = direction.gridX > 0 ? 1 : direction.gridX < 0 ? -1 : 0;
    const stepY = direction.gridY > 0 ? 1 : direction.gridY < 0 ? -1 : 0;
    const deltaX = stepX === 0 ? Infinity : Math.abs(1 / direction.gridX);
    const deltaY = stepY === 0 ? Infinity : Math.abs(1 / direction.gridY);

    // A ray that starts exactly on a boundary and heads negative is already
    // inside the lower cell; the first boundary behind it must be skipped.
    let maxX =
        stepX === 0
            ? Infinity
            : stepX > 0
              ? (tileX + 1 - origin.gridX) / direction.gridX
              : (tileX - origin.gridX) / direction.gridX;
    let maxY =
        stepY === 0
            ? Infinity
            : stepY > 0
              ? (tileY + 1 - origin.gridY) / direction.gridY
              : (tileY - origin.gridY) / direction.gridY;
    if (stepX < 0 && maxX === 0) {
        tileX -= 1;
        maxX = deltaX;
    }
    if (stepY < 0 && maxY === 0) {
        tileY -= 1;
        maxY = deltaY;
    }

    const startWord = engine.readAt(layer, tileX, tileY);
    if (isSolid(startWord)) {
        return fillHit(
            out,
            projection,
            originX,
            originY,
            directionX,
            directionY,
            tileX,
            tileY,
            startWord,
            0,
            0,
            0
        );
    }

    for (let step = 0; step < 1_000_000; step++) {
        const time = Math.min(maxX, maxY);
        if (!(time <= timeLimit)) break;
        let gridNormalX = 0;
        let gridNormalY = 0;
        if (maxX <= maxY) {
            tileX += stepX;
            maxX += deltaX;
            gridNormalX = -stepX;
        } else {
            tileY += stepY;
            maxY += deltaY;
            gridNormalY = -stepY;
        }
        if (tileX < KEY_MIN || tileX > KEY_MAX || tileY < KEY_MIN || tileY > KEY_MAX) {
            break;
        }
        const word = engine.readAt(layer, tileX, tileY);
        if (!isSolid(word)) continue;
        return fillHit(
            out,
            projection,
            originX,
            originY,
            directionX,
            directionY,
            tileX,
            tileY,
            word,
            time,
            gridNormalX,
            gridNormalY
        );
    }
    return clearHit(out);
};

/**
 * World-space traversal for staggered isometric maps. Row (or column) offsets
 * change the affine mapping at every band, so the traversal works with world
 * boundary lines and re-derives the tile after each crossing.
 */
const raycastStaggered = <L extends readonly LayerSpec[]>(
    engine: TilemapEngine<L>,
    layer: LayerReference<L>,
    projection: ProjectionSpec,
    originX: number,
    originY: number,
    directionX: number,
    directionY: number,
    timeLimit: number,
    isSolid: TileSolidPredicate,
    out: TileRaycastHit
): boolean => {
    const originGridX = projection.originX ?? 0;
    const originGridY = projection.originY ?? 0;
    const halfWidth = projection.tileWidth / 2;
    const halfHeight = projection.tileHeight / 2;
    const axisX = (projection.staggerAxis ?? 'y') === 'x';
    const start = worldToTile(projection, originX, originY);
    if (
        start.gridX < KEY_MIN ||
        start.gridX > KEY_MAX ||
        start.gridY < KEY_MIN ||
        start.gridY > KEY_MAX
    ) {
        return clearHit(out);
    }
    const startWord = engine.readAt(layer, start.gridX, start.gridY);
    if (isSolid(startWord)) {
        return fillHit(
            out,
            projection,
            originX,
            originY,
            directionX,
            directionY,
            start.gridX,
            start.gridY,
            startWord,
            0,
            0,
            0
        );
    }

    const parity = (coordinate: number): number => {
        const floored = Math.floor(coordinate);
        const bit = floored & 1;
        return (projection.staggerIndex ?? 'odd') === 'odd' ? bit : 1 - bit;
    };

    let time = 0;
    const nextBoundary = (coordinate: number, direction: number): number => {
        if (direction > 0) return Math.floor(coordinate) + 1;
        return Number.isInteger(coordinate)
            ? coordinate - 1
            : Math.floor(coordinate);
    };
    for (let step = 0; step < 1_000_000; step++) {
        const worldX = originX + directionX * time;
        const worldY = originY + directionY * time;
        const localX = worldX - originGridX;
        const localY = worldY - originGridY;
        let timeBand: number;
        let timeColumn: number;
        if (axisX) {
            const gridX = localX / halfWidth;
            const bandBoundary =
                originGridX + nextBoundary(gridX, directionX) * halfWidth;
            timeBand =
                directionX === 0 ? Infinity : (bandBoundary - originX) / directionX;
            const gridY = localY / projection.tileHeight - 0.5 * parity(gridX);
            const nextGridY = nextBoundary(gridY, directionY);
            const columnBoundary =
                originGridY +
                (nextGridY + 0.5 * parity(gridX)) * projection.tileHeight;
            timeColumn =
                directionY === 0 ? Infinity : (columnBoundary - originY) / directionY;
        } else {
            const gridY = localY / halfHeight;
            const bandBoundary =
                originGridY + nextBoundary(gridY, directionY) * halfHeight;
            timeBand =
                directionY === 0 ? Infinity : (bandBoundary - originY) / directionY;
            const gridX = localX / projection.tileWidth - 0.5 * parity(gridY);
            const nextGridX = nextBoundary(gridX, directionX);
            const rowBoundary =
                originGridX +
                (nextGridX + 0.5 * parity(gridY)) * projection.tileWidth;
            timeColumn =
                directionX === 0 ? Infinity : (rowBoundary - originX) / directionX;
        }
        const nextTime = Math.min(timeBand, timeColumn);
        if (!Number.isFinite(nextTime) || nextTime > timeLimit) break;
        if (nextTime <= time + 1e-12) break;
        const enteredBand = timeBand <= timeColumn;
        time = nextTime;

        const sampleTime = time + 1e-9;
        const sample = worldToTile(
            projection,
            originX + directionX * sampleTime,
            originY + directionY * sampleTime
        );
        if (
            sample.gridX < KEY_MIN ||
            sample.gridX > KEY_MAX ||
            sample.gridY < KEY_MIN ||
            sample.gridY > KEY_MAX
        ) {
            break;
        }
        const word = engine.readAt(layer, sample.gridX, sample.gridY);
        if (!isSolid(word)) continue;
        // A band crossing is a row boundary on axis `y` and a column boundary
        // on axis `x`; the other candidate is the perpendicular face.
        const crossedAlongX = enteredBand ? axisX : !axisX;
        const gridNormalX = crossedAlongX ? -Math.sign(directionX) : 0;
        const gridNormalY = crossedAlongX ? 0 : -Math.sign(directionY);
        return fillHit(
            out,
            projection,
            originX,
            originY,
            directionX,
            directionY,
            sample.gridX,
            sample.gridY,
            word,
            time,
            gridNormalX,
            gridNormalY
        );
    }
    return clearHit(out);
};

/**
 * Casts a world-space ray against non-empty tiles of one layer.
 *
 * The direction vector need not be normalized; `time` is measured in units of
 * that vector and `distance` is world units. A ray that starts inside a solid
 * tile reports `time = 0` with that tile's word. Zero direction or a
 * non-positive `maxDistance` returns no hit.
 */
export const raycastTilemap = <L extends readonly LayerSpec[]>(
    engine: TilemapEngine<L>,
    layer: LayerReference<L>,
    originX: number,
    originY: number,
    directionX: number,
    directionY: number,
    options: RaycastOptions = {},
    out: TileRaycastHit = createRaycastHit()
): boolean => {
    const length = Math.hypot(directionX, directionY);
    const maxDistance = options.maxDistance ?? Infinity;
    if (!(length > 0) || !(maxDistance > 0)) return clearHit(out);
    const timeLimit = Number.isFinite(maxDistance) ? maxDistance / length : Infinity;
    const isSolid = options.isSolid ?? isSolidTileWord;
    const projection = engine.projection;
    if (projection.kind === 'staggered-isometric') {
        return raycastStaggered(
            engine,
            layer,
            projection,
            originX,
            originY,
            directionX,
            directionY,
            timeLimit,
            isSolid,
            out
        );
    }
    return raycastAffine(
        engine,
        layer,
        projection,
        originX,
        originY,
        directionX,
        directionY,
        timeLimit,
        isSolid,
        out
    );
};
