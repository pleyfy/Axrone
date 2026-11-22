import { TilemapErrorCode, TilemapFault } from '../errors';

export const ProjectionKind = {
    Orthogonal: 'orthogonal',
    Isometric: 'isometric',
    StaggeredIsometric: 'staggered-isometric',
} as const;

export type ProjectionKind =
    (typeof ProjectionKind)[keyof typeof ProjectionKind];

export type StaggerAxis = 'x' | 'y';
export type StaggerIndex = 'odd' | 'even';

export interface ProjectionSpec {
    readonly kind: ProjectionKind;
    readonly tileWidth: number;
    readonly tileHeight: number;
    /** World position of grid origin `(0, 0)`. */
    readonly originX?: number;
    readonly originY?: number;
    /** Staggered-isometric staggering axis; default `y`. */
    readonly staggerAxis?: StaggerAxis;
    /** Staggered-isometric first staggered row/column; default `odd`. */
    readonly staggerIndex?: StaggerIndex;
}

export const DEFAULT_PROJECTION: ProjectionSpec = Object.freeze({
    kind: ProjectionKind.Orthogonal,
    tileWidth: 32,
    tileHeight: 32,
});

const isProjectionKind = (value: unknown): value is ProjectionKind =>
    value === ProjectionKind.Orthogonal ||
    value === ProjectionKind.Isometric ||
    value === ProjectionKind.StaggeredIsometric;

export const createProjectionSpec = (
    spec: ProjectionSpec
): Readonly<ProjectionSpec> => {
    if (!isProjectionKind(spec.kind)) {
        throw new TilemapFault(
            `unknown projection kind: ${String(spec.kind)}`,
            TilemapErrorCode.INVALID_CONFIGURATION,
            { kind: spec.kind }
        );
    }
    if (!Number.isFinite(spec.tileWidth) || spec.tileWidth <= 0) {
        throw new TilemapFault(
            'projection tileWidth must be a positive finite number',
            TilemapErrorCode.INVALID_CONFIGURATION,
            { tileWidth: spec.tileWidth }
        );
    }
    if (!Number.isFinite(spec.tileHeight) || spec.tileHeight <= 0) {
        throw new TilemapFault(
            'projection tileHeight must be a positive finite number',
            TilemapErrorCode.INVALID_CONFIGURATION,
            { tileHeight: spec.tileHeight }
        );
    }
    if (spec.staggerAxis !== undefined && spec.staggerAxis !== 'x' && spec.staggerAxis !== 'y') {
        throw new TilemapFault(
            `invalid stagger axis: ${String(spec.staggerAxis)}`,
            TilemapErrorCode.INVALID_CONFIGURATION,
            { staggerAxis: spec.staggerAxis }
        );
    }
    if (
        spec.staggerIndex !== undefined &&
        spec.staggerIndex !== 'odd' &&
        spec.staggerIndex !== 'even'
    ) {
        throw new TilemapFault(
            `invalid stagger index: ${String(spec.staggerIndex)}`,
            TilemapErrorCode.INVALID_CONFIGURATION,
            { staggerIndex: spec.staggerIndex }
        );
    }
    return Object.freeze({ ...spec });
};
