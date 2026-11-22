import type { ProjectionSpec } from '../types/projection';

/** A point in continuous grid space; integer values address tile centers/corners. */
export interface GridPoint {
    readonly gridX: number;
    readonly gridY: number;
}

/** A point in world space (pixels). */
export interface WorldPoint {
    readonly worldX: number;
    readonly worldY: number;
}

/**
 * Projection math shared by the engine, renderer and queries.
 *
 * Every conversion treats grid coordinates as continuous: `gridToWorld(3, 4)`
 * is the world position of tile `(3, 4)`'s anchor, while `worldToGrid` returns
 * fractional grid coordinates and `worldToTile` floors them to a tile index.
 *
 * Orthogonal and isometric transforms are affine. Staggered isometric is
 * piecewise affine: the half-tile offset of a row (axis `y`) or column (axis
 * `x`) is chosen from the containing row/column, so `gridToWorld` and
 * `worldToGrid` round-trip exactly for integral coordinates, including
 * negatives.
 */

const originXOf = (projection: ProjectionSpec): number =>
    projection.originX ?? 0;

const originYOf = (projection: ProjectionSpec): number =>
    projection.originY ?? 0;

/** `1` when the given row/column is shifted by half a tile, else `0`. */
export const staggerOffset = (
    projection: ProjectionSpec,
    coordinate: number
): number => {
    // Bitwise parity is defined for negatives too: -1 & 1 === 1.
    const parity = Math.floor(coordinate) & 1;
    return (projection.staggerIndex ?? 'odd') === 'odd'
        ? parity
        : 1 - parity;
};

export const gridToWorld = (
    projection: ProjectionSpec,
    gridX: number,
    gridY: number
): WorldPoint => {
    const originX = originXOf(projection);
    const originY = originYOf(projection);
    const halfWidth = projection.tileWidth / 2;
    const halfHeight = projection.tileHeight / 2;
    switch (projection.kind) {
        case 'isometric':
            return {
                worldX: originX + (gridX - gridY) * halfWidth,
                worldY: originY + (gridX + gridY) * halfHeight,
            };
        case 'staggered-isometric':
            if ((projection.staggerAxis ?? 'y') === 'x') {
                // Columns are half a tile apart; odd/even columns shift down.
                return {
                    worldX: originX + gridX * halfWidth,
                    worldY:
                        originY +
                        gridY * projection.tileHeight +
                        staggerOffset(projection, gridX) * halfHeight,
                };
            }
            // Rows are half a tile apart; odd/even rows shift right.
            return {
                worldX:
                    originX +
                    gridX * projection.tileWidth +
                    staggerOffset(projection, gridY) * halfWidth,
                worldY: originY + gridY * halfHeight,
            };
        case 'orthogonal':
        default:
            return {
                worldX: originX + gridX * projection.tileWidth,
                worldY: originY + gridY * projection.tileHeight,
            };
    }
};

export const worldToGrid = (
    projection: ProjectionSpec,
    worldX: number,
    worldY: number
): GridPoint => {
    const localX = worldX - originXOf(projection);
    const localY = worldY - originYOf(projection);
    const halfWidth = projection.tileWidth / 2;
    const halfHeight = projection.tileHeight / 2;
    switch (projection.kind) {
        case 'isometric': {
            const difference = localX / halfWidth;
            const sum = localY / halfHeight;
            return {
                gridX: (difference + sum) / 2,
                gridY: (sum - difference) / 2,
            };
        }
        case 'staggered-isometric':
            if ((projection.staggerAxis ?? 'y') === 'x') {
                const gridX = localX / halfWidth;
                return {
                    gridX,
                    gridY:
                        localY / projection.tileHeight -
                        staggerOffset(projection, gridX) * 0.5,
                };
            }
            {
                const gridY = localY / halfHeight;
                return {
                    gridX:
                        localX / projection.tileWidth -
                        staggerOffset(projection, gridY) * 0.5,
                    gridY,
                };
            }
        case 'orthogonal':
        default:
            return {
                gridX: localX / projection.tileWidth,
                gridY: localY / projection.tileHeight,
            };
    }
};

/** Floors continuous grid coordinates to the containing tile index. */
export const worldToTile = (
    projection: ProjectionSpec,
    worldX: number,
    worldY: number
): GridPoint => {
    const point = worldToGrid(projection, worldX, worldY);
    return {
        gridX: floorTile(point.gridX),
        gridY: floorTile(point.gridY),
    };
};

/** `Math.floor` that never returns `-0` for coordinates near the origin. */
export const floorTile = (value: number): number => {
    const floored = Math.floor(value);
    return floored === 0 ? 0 : floored;
};

/** Convenience: does this projection need the half-tile stagger offsets? */
export const isStaggeredProjection = (projection: ProjectionSpec): boolean =>
    projection.kind === 'staggered-isometric';
