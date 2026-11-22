import { describe, expect, it } from 'vitest';
import type { ProjectionSpec } from '../types/projection';
import {
    floorTile,
    gridToWorld,
    staggerOffset,
    worldToGrid,
    worldToTile,
} from '../query/projection';

const orthogonal: ProjectionSpec = {
    kind: 'orthogonal',
    tileWidth: 64,
    tileHeight: 32,
    originX: 13.5,
    originY: -7.25,
};

const isometric: ProjectionSpec = {
    kind: 'isometric',
    tileWidth: 64,
    tileHeight: 32,
    originX: 13.5,
    originY: -7.25,
};

const staggeredCases: readonly ProjectionSpec[] = [
    {
        kind: 'staggered-isometric',
        tileWidth: 64,
        tileHeight: 32,
        originX: 13.5,
        originY: -7.25,
        staggerAxis: 'y',
        staggerIndex: 'odd',
    },
    {
        kind: 'staggered-isometric',
        tileWidth: 64,
        tileHeight: 32,
        originX: 13.5,
        originY: -7.25,
        staggerAxis: 'y',
        staggerIndex: 'even',
    },
    {
        kind: 'staggered-isometric',
        tileWidth: 64,
        tileHeight: 32,
        originX: 13.5,
        originY: -7.25,
        staggerAxis: 'x',
        staggerIndex: 'odd',
    },
    {
        kind: 'staggered-isometric',
        tileWidth: 64,
        tileHeight: 32,
        originX: 13.5,
        originY: -7.25,
        staggerAxis: 'x',
        staggerIndex: 'even',
    },
];

const projections = [orthogonal, isometric, ...staggeredCases];

const sampledCoordinates = (): number[] => {
    const values: number[] = [];
    for (let value = -1000; value <= 1000; value += 23) values.push(value);
    values.push(-1000, -999, -1, 0, 1, 999, 1000);
    return values;
};

describe('projection round-trip', () => {
    for (const projection of projections) {
        const label = `${projection.kind} axis=${projection.staggerAxis ?? '-'} index=${projection.staggerIndex ?? '-'}`;
        it(`round-trips grid -> world -> grid for ${label}`, () => {
            const coordinates = sampledCoordinates();
            for (const gridX of coordinates) {
                for (const gridY of coordinates) {
                    const world = gridToWorld(projection, gridX, gridY);
                    const grid = worldToGrid(
                        projection,
                        world.worldX,
                        world.worldY
                    );
                    expect(grid.gridX).toBeCloseTo(gridX, 6);
                    expect(grid.gridY).toBeCloseTo(gridY, 6);
                }
            }
        });
    }
});

describe('orthogonal projection', () => {
    it('scales by tile size and applies the origin', () => {
        expect(gridToWorld(orthogonal, 0, 0)).toEqual({
            worldX: 13.5,
            worldY: -7.25,
        });
        expect(gridToWorld(orthogonal, 2, -3)).toEqual({
            worldX: 141.5,
            worldY: -103.25,
        });
    });

    it('floors negative world coordinates to the containing tile', () => {
        expect(worldToTile(orthogonal, 12.5, -8.25)).toEqual({
            gridX: -1,
            gridY: -1,
        });
        expect(worldToTile(orthogonal, 13.5, -7.25)).toEqual({
            gridX: 0,
            gridY: 0,
        });
        expect(floorTile(-0.0001)).toBe(-1);
        expect(Object.is(floorTile(-0), 0)).toBe(true);
    });
});

describe('isometric projection', () => {
    it('places the cardinal neighbours on the diamond axes', () => {
        expect(gridToWorld(isometric, 0, 0)).toEqual({
            worldX: 13.5,
            worldY: -7.25,
        });
        expect(gridToWorld(isometric, 1, 0)).toEqual({
            worldX: 45.5,
            worldY: 8.75,
        });
        expect(gridToWorld(isometric, 0, 1)).toEqual({
            worldX: -18.5,
            worldY: 8.75,
        });
        expect(gridToWorld(isometric, 1, 1)).toEqual({
            worldX: 13.5,
            worldY: 24.75,
        });
    });

    it('converts world points back to fractional grid coordinates', () => {
        const grid = worldToGrid(isometric, 13.5 + 32, -7.25 + 16);
        expect(grid.gridX).toBeCloseTo(1, 9);
        expect(grid.gridY).toBeCloseTo(0, 9);
    });
});

describe('staggered isometric projection', () => {
    it('shifts odd rows by half a tile', () => {
        const odd = staggeredCases[0]!;
        const even = staggeredCases[1]!;
        expect(gridToWorld(odd, 0, 0)).toEqual({
            worldX: 13.5,
            worldY: -7.25,
        });
        expect(gridToWorld(odd, 1, 0)).toEqual({
            worldX: 77.5,
            worldY: -7.25,
        });
        expect(gridToWorld(odd, 0, 1)).toEqual({
            worldX: 45.5,
            worldY: 8.75,
        });
        expect(gridToWorld(odd, 0, -1)).toEqual({
            worldX: 45.5,
            worldY: -23.25,
        });
        expect(gridToWorld(even, 0, 1)).toEqual({
            worldX: 13.5,
            worldY: 8.75,
        });
    });

    it('shifts odd columns when the stagger axis is x', () => {
        const odd = staggeredCases[2]!;
        const even = staggeredCases[3]!;
        expect(gridToWorld(odd, 1, 0)).toEqual({
            worldX: 45.5,
            worldY: 8.75,
        });
        expect(gridToWorld(odd, 0, 1)).toEqual({
            worldX: 13.5,
            worldY: 24.75,
        });
        expect(gridToWorld(even, 1, 0)).toEqual({
            worldX: 45.5,
            worldY: -7.25,
        });
    });

    it('derives parity from floors, including negatives', () => {
        const odd = staggeredCases[0]!;
        expect(staggerOffset(odd, 0)).toBe(0);
        expect(staggerOffset(odd, 1)).toBe(1);
        expect(staggerOffset(odd, -1)).toBe(1);
        expect(staggerOffset(odd, -2)).toBe(0);
        expect(staggerOffset(odd, -1.5)).toBe(0);
        expect(staggerOffset(staggeredCases[1]!, 1)).toBe(0);
        expect(staggerOffset(staggeredCases[1]!, -1)).toBe(0);
    });
});
