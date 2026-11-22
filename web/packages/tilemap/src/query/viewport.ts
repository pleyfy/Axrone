import { KEY_MAX, KEY_MIN, type PackedTileWord } from '../types/brands';
import type { LayerReference, LayerSpec } from '../types/layers';
import type { ProjectionSpec } from '../types/projection';
import type { TilemapEngine } from '../engine/tilemap-engine';
import {
    floorTile,
    isStaggeredProjection,
    worldToGrid,
} from './projection';

/** A half-open rectangle in grid space: `[x, x + width)`. */
export interface GridRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** A half-open rectangle in world space (pixels). */
export interface WorldRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export type ViewportTileVisitor = (
    gridX: number,
    gridY: number,
    word: PackedTileWord
) => void;

/** Clamps a grid rectangle to the addressable grid range. */
export const clampGridRect = (rect: GridRect): GridRect => {
    if (rect.width <= 0 || rect.height <= 0) {
        return { x: 0, y: 0, width: 0, height: 0 };
    }
    const startX = Math.max(KEY_MIN, Math.trunc(rect.x));
    const startY = Math.max(KEY_MIN, Math.trunc(rect.y));
    const endX = Math.min(KEY_MAX + 1, Math.trunc(rect.x + rect.width));
    const endY = Math.min(KEY_MAX + 1, Math.trunc(rect.y + rect.height));
    if (endX <= startX || endY <= startY) {
        return { x: 0, y: 0, width: 0, height: 0 };
    }
    return {
        x: startX,
        y: startY,
        width: endX - startX,
        height: endY - startY,
    };
};

/**
 * Conservative grid rectangle covering a world-space camera rectangle.
 *
 * Orthogonal and isometric transforms are affine, so the four camera corners
 * bound the covered tiles exactly. Staggered isometric is piecewise affine and
 * the half-tile offset can add one column or row that no corner names; those
 * bounds get a one-tile margin so a viewport scan never clips a visible tile.
 */
export const viewportGridBounds = (
    projection: ProjectionSpec,
    camera: WorldRect
): GridRect => {
    const corners = [
        worldToGrid(projection, camera.x, camera.y),
        worldToGrid(projection, camera.x + camera.width, camera.y),
        worldToGrid(projection, camera.x, camera.y + camera.height),
        worldToGrid(
            projection,
            camera.x + camera.width,
            camera.y + camera.height
        ),
    ];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const corner of corners) {
        minX = Math.min(minX, floorTile(corner.gridX));
        minY = Math.min(minY, floorTile(corner.gridY));
        maxX = Math.max(maxX, floorTile(corner.gridX));
        maxY = Math.max(maxY, floorTile(corner.gridY));
    }
    const margin = isStaggeredProjection(projection) ? 1 : 0;
    return clampGridRect({
        x: minX - margin,
        y: minY - margin,
        width: maxX - minX + 1 + margin * 2,
        height: maxY - minY + 1 + margin * 2,
    });
};

/**
 * Visits every non-empty tile in a grid-space rectangle in row-major order.
 * The rectangle is clamped to the addressable grid. Returns the visited count.
 */
export const visitViewportTiles = <L extends readonly LayerSpec[]>(
    engine: TilemapEngine<L>,
    layer: LayerReference<L>,
    rect: GridRect,
    visit: ViewportTileVisitor
): number => {
    const bounds = clampGridRect(rect);
    let count = 0;
    for (let gridY = bounds.y; gridY < bounds.y + bounds.height; gridY++) {
        for (let gridX = bounds.x; gridX < bounds.x + bounds.width; gridX++) {
            const word = engine.readAt(layer, gridX, gridY);
            if (word === 0) continue;
            visit(gridX, gridY, word);
            count++;
        }
    }
    return count;
};

/**
 * Growable, allocation-stable buffer of viewport tiles. `gridXs`, `gridYs` and
 * `words` are valid up to `count`; `reset()` keeps the arrays for the next
 * frame.
 */
export class ViewportTileBuffer {
    #gridXs = new Int32Array(256);
    #gridYs = new Int32Array(256);
    #words = new Uint32Array(256);
    #count = 0;

    get count(): number {
        return this.#count;
    }

    get gridXs(): Int32Array {
        return this.#gridXs;
    }

    get gridYs(): Int32Array {
        return this.#gridYs;
    }

    get words(): Uint32Array {
        return this.#words;
    }

    reset(): void {
        this.#count = 0;
    }

    push(gridX: number, gridY: number, word: PackedTileWord): void {
        if (this.#count === this.#gridXs.length) {
            const capacity = this.#count * 2;
            const gridXs = new Int32Array(capacity);
            gridXs.set(this.#gridXs);
            const gridYs = new Int32Array(capacity);
            gridYs.set(this.#gridYs);
            const words = new Uint32Array(capacity);
            words.set(this.#words);
            this.#gridXs = gridXs;
            this.#gridYs = gridYs;
            this.#words = words;
        }
        this.#gridXs[this.#count] = gridX;
        this.#gridYs[this.#count] = gridY;
        this.#words[this.#count] = word as unknown as number;
        this.#count++;
    }
}

/**
 * Extracts the non-empty tiles of a grid-space rectangle into `out` (or a new
 * buffer). Reuse the returned buffer across frames to stay allocation-free.
 */
export const extractViewportInstances = <L extends readonly LayerSpec[]>(
    engine: TilemapEngine<L>,
    layer: LayerReference<L>,
    rect: GridRect,
    out?: ViewportTileBuffer
): ViewportTileBuffer => {
    const buffer = out ?? new ViewportTileBuffer();
    buffer.reset();
    visitViewportTiles(engine, layer, rect, (gridX, gridY, word) =>
        buffer.push(gridX, gridY, word)
    );
    return buffer;
};
