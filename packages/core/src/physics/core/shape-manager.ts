import type { IVec2Like } from '@axrone/numeric';
import type {
    ShapeId,
    BodyId,
    Density,
    Friction,
    Restitution,
    IMaterial,
    IMassData2D,
    Mass,
    Inertia,
} from '../types';
import { ShapeType, CollisionFilter } from '../types';
import type {
    ICircleShapeDef,
    IBoxShapeDef2D,
    IPolygonShapeDef,
    ICapsuleShapeDef2D,
    ISegmentShapeDef,
} from '../types';

const enum ShapeManagerError {
    INVALID_STATE = 'INVALID_STATE',
    SHAPE_NOT_FOUND = 'SHAPE_NOT_FOUND',
    CAPACITY_EXCEEDED = 'CAPACITY_EXCEEDED',
    INVALID_SHAPE = 'INVALID_SHAPE',
}

class ShapeError extends Error {
    readonly code: ShapeManagerError;
    constructor(message: string, code: ShapeManagerError) {
        super(message);
        this.name = 'ShapeError';
        this.code = code;
        Object.setPrototypeOf(this, ShapeError.prototype);
    }
}

const SHAPE_DATA_STRIDE = 8;
const CIRCLE_SHAPE_SIZE = 3;
const BOX_SHAPE_SIZE = 5;
const POLYGON_MAX_VERTICES = 8;

interface ShapeData {
    readonly type: ShapeType;
    readonly bodyId: BodyId;
    readonly material: IMaterial;
    readonly isSensor: boolean;
    readonly filter: {
        categoryBits: CollisionFilter;
        maskBits: CollisionFilter;
        groupIndex: number;
    };
    userData?: unknown;
}

export class ShapeManager2D implements Disposable {
    private _nextShapeId: number = 1;
    private _shapeCount: number = 0;
    private readonly _maxShapes: number;
    private readonly _shapeMetadata: Map<ShapeId, ShapeData>;
    private readonly _circleData: Float64Array;
    private readonly _boxData: Float64Array;
    private readonly _polygonData: Float64Array;
    private readonly _polygonVertexCounts: Uint8Array;
    private readonly _segmentData: Float64Array;
    private readonly _capsuleData: Float64Array;
    private readonly _shapeToCircleIndex: Map<ShapeId, number>;
    private readonly _shapeToBoxIndex: Map<ShapeId, number>;
    private readonly _shapeToPolygonIndex: Map<ShapeId, number>;
    private readonly _shapeToSegmentIndex: Map<ShapeId, number>;
    private readonly _shapeToCapsuleIndex: Map<ShapeId, number>;
    private readonly _bodyToShapes: Map<BodyId, Set<ShapeId>>;
    private _circleCount: number = 0;
    private _boxCount: number = 0;
    private _polygonCount: number = 0;
    private _segmentCount: number = 0;
    private _capsuleCount: number = 0;
    private _disposed: boolean = false;

    constructor(maxShapes: number = 2048) {
        this._maxShapes = maxShapes;
        const quarterMax = Math.ceil(maxShapes / 4);

        this._shapeMetadata = new Map();
        this._circleData = new Float64Array(quarterMax * CIRCLE_SHAPE_SIZE);
        this._boxData = new Float64Array(quarterMax * BOX_SHAPE_SIZE);
        this._polygonData = new Float64Array(quarterMax * POLYGON_MAX_VERTICES * 2);
        this._polygonVertexCounts = new Uint8Array(quarterMax);
        this._segmentData = new Float64Array(quarterMax * 4);
        this._capsuleData = new Float64Array(quarterMax * 4);

        this._shapeToCircleIndex = new Map();
        this._shapeToBoxIndex = new Map();
        this._shapeToPolygonIndex = new Map();
        this._shapeToSegmentIndex = new Map();
        this._shapeToCapsuleIndex = new Map();
        this._bodyToShapes = new Map();
    }

    get shapeCount(): number {
        return this._shapeCount;
    }

    createCircle(bodyId: BodyId, def: ICircleShapeDef): ShapeId {
        this._assertNotDisposed();
        this._assertCapacity();

        const shapeId = this._nextShapeId++ as ShapeId;
        const index = this._circleCount++;
        const offset = index * CIRCLE_SHAPE_SIZE;

        const center = def.center ?? def.offset ?? { x: 0, y: 0 };
        this._circleData[offset] = center.x;
        this._circleData[offset + 1] = center.y;
        this._circleData[offset + 2] = def.radius;

        this._shapeToCircleIndex.set(shapeId, index);
        this._registerShape(shapeId, bodyId, ShapeType.Circle, def);
        return shapeId;
    }

    createBox(bodyId: BodyId, def: IBoxShapeDef2D): ShapeId {
        this._assertNotDisposed();
        this._assertCapacity();

        const shapeId = this._nextShapeId++ as ShapeId;
        const index = this._boxCount++;
        const offset = index * BOX_SHAPE_SIZE;

        const center = def.center ?? def.offset ?? { x: 0, y: 0 };
        const halfWidth = def.halfWidth ?? (def.width !== undefined ? def.width / 2 : undefined);
        const halfHeight = def.halfHeight ?? (def.height !== undefined ? def.height / 2 : undefined);
        if (halfWidth === undefined || halfHeight === undefined) {
            throw new ShapeError('Box must have halfWidth/halfHeight or width/height', ShapeManagerError.INVALID_SHAPE);
        }
        this._boxData[offset] = center.x;
        this._boxData[offset + 1] = center.y;
        this._boxData[offset + 2] = halfWidth;
        this._boxData[offset + 3] = halfHeight;
        this._boxData[offset + 4] = def.rotation ?? 0;

        this._shapeToBoxIndex.set(shapeId, index);
        this._registerShape(shapeId, bodyId, ShapeType.Box, def);
        return shapeId;
    }

    createPolygon(bodyId: BodyId, def: IPolygonShapeDef): ShapeId {
        this._assertNotDisposed();
        this._assertCapacity();

        const vertices = def.vertices;
        if (vertices.length < 3 || vertices.length > POLYGON_MAX_VERTICES) {
            throw new ShapeError(
                `Polygon must have 3-${POLYGON_MAX_VERTICES} vertices`,
                ShapeManagerError.INVALID_SHAPE
            );
        }

        const shapeId = this._nextShapeId++ as ShapeId;
        const index = this._polygonCount++;
        const offset = index * POLYGON_MAX_VERTICES * 2;

        for (let i = 0; i < vertices.length; i++) {
            this._polygonData[offset + i * 2] = vertices[i].x;
            this._polygonData[offset + i * 2 + 1] = vertices[i].y;
        }
        this._polygonVertexCounts[index] = vertices.length;

        this._shapeToPolygonIndex.set(shapeId, index);
        this._registerShape(shapeId, bodyId, ShapeType.Polygon, def);
        return shapeId;
    }

    createSegment(bodyId: BodyId, def: ISegmentShapeDef): ShapeId {
        this._assertNotDisposed();
        this._assertCapacity();

        const shapeId = this._nextShapeId++ as ShapeId;
        const index = this._segmentCount++;
        const offset = index * 4;

        this._segmentData[offset] = def.start.x;
        this._segmentData[offset + 1] = def.start.y;
        this._segmentData[offset + 2] = def.end.x;
        this._segmentData[offset + 3] = def.end.y;

        this._shapeToSegmentIndex.set(shapeId, index);
        this._registerShape(shapeId, bodyId, ShapeType.Segment, def);
        return shapeId;
    }

    createCapsule(bodyId: BodyId, def: ICapsuleShapeDef2D): ShapeId {
        this._assertNotDisposed();
        this._assertCapacity();

        const shapeId = this._nextShapeId++ as ShapeId;
        const index = this._capsuleCount++;
        const offset = index * 4;

        const center = def.center ?? def.offset ?? { x: 0, y: 0 };
        this._capsuleData[offset] = center.x;
        this._capsuleData[offset + 1] = center.y;
        this._capsuleData[offset + 2] = def.radius;
        this._capsuleData[offset + 3] = def.length;

        this._shapeToCapsuleIndex.set(shapeId, index);
        this._registerShape(shapeId, bodyId, ShapeType.Capsule, def);
        return shapeId;
    }

    destroyShape(shapeId: ShapeId): void {
        this._assertNotDisposed();

        const metadata = this._shapeMetadata.get(shapeId);
        if (!metadata) {
            throw new ShapeError(`Shape ${shapeId} not found`, ShapeManagerError.SHAPE_NOT_FOUND);
        }

        const bodyShapes = this._bodyToShapes.get(metadata.bodyId);
        if (bodyShapes) {
            bodyShapes.delete(shapeId);
            if (bodyShapes.size === 0) {
                this._bodyToShapes.delete(metadata.bodyId);
            }
        }

        this._shapeMetadata.delete(shapeId);
        this._shapeToCircleIndex.delete(shapeId);
        this._shapeToBoxIndex.delete(shapeId);
        this._shapeToPolygonIndex.delete(shapeId);
        this._shapeToSegmentIndex.delete(shapeId);
        this._shapeToCapsuleIndex.delete(shapeId);
        this._shapeCount--;
    }

    getShapeType(shapeId: ShapeId): ShapeType {
        const metadata = this._shapeMetadata.get(shapeId);
        if (!metadata) {
            throw new ShapeError(`Shape ${shapeId} not found`, ShapeManagerError.SHAPE_NOT_FOUND);
        }
        return metadata.type;
    }

    getBodyId(shapeId: ShapeId): BodyId {
        const metadata = this._shapeMetadata.get(shapeId);
        if (!metadata) {
            throw new ShapeError(`Shape ${shapeId} not found`, ShapeManagerError.SHAPE_NOT_FOUND);
        }
        return metadata.bodyId;
    }

    getCircleData(shapeId: ShapeId): { center: IVec2Like; radius: number } {
        const index = this._shapeToCircleIndex.get(shapeId);
        if (index === undefined) {
            throw new ShapeError(`Circle ${shapeId} not found`, ShapeManagerError.SHAPE_NOT_FOUND);
        }
        const offset = index * CIRCLE_SHAPE_SIZE;
        return {
            center: { x: this._circleData[offset], y: this._circleData[offset + 1] },
            radius: this._circleData[offset + 2],
        };
    }

    getBoxData(shapeId: ShapeId): {
        center: IVec2Like;
        halfWidth: number;
        halfHeight: number;
        rotation: number;
    } {
        const index = this._shapeToBoxIndex.get(shapeId);
        if (index === undefined) {
            throw new ShapeError(`Box ${shapeId} not found`, ShapeManagerError.SHAPE_NOT_FOUND);
        }
        const offset = index * BOX_SHAPE_SIZE;
        return {
            center: { x: this._boxData[offset], y: this._boxData[offset + 1] },
            halfWidth: this._boxData[offset + 2],
            halfHeight: this._boxData[offset + 3],
            rotation: this._boxData[offset + 4],
        };
    }

    getPolygonData(shapeId: ShapeId): { vertices: IVec2Like[] } {
        const index = this._shapeToPolygonIndex.get(shapeId);
        if (index === undefined) {
            throw new ShapeError(`Polygon ${shapeId} not found`, ShapeManagerError.SHAPE_NOT_FOUND);
        }
        const vertexCount = this._polygonVertexCounts[index];
        const offset = index * POLYGON_MAX_VERTICES * 2;
        const vertices: IVec2Like[] = [];
        for (let i = 0; i < vertexCount; i++) {
            vertices.push({
                x: this._polygonData[offset + i * 2],
                y: this._polygonData[offset + i * 2 + 1],
            });
        }
        return { vertices };
    }

    getCapsuleData(shapeId: ShapeId): { p1: IVec2Like; p2: IVec2Like; radius: number } {
        const index = this._shapeToCapsuleIndex.get(shapeId);
        if (index === undefined) {
            throw new ShapeError(`Capsule ${shapeId} not found`, ShapeManagerError.SHAPE_NOT_FOUND);
        }
        const offset = index * 4;
        const centerX = this._capsuleData[offset];
        const centerY = this._capsuleData[offset + 1];
        const radius = this._capsuleData[offset + 2];
        const length = this._capsuleData[offset + 3];
        const halfLength = length * 0.5;
        return {
            p1: { x: centerX - halfLength, y: centerY },
            p2: { x: centerX + halfLength, y: centerY },
            radius,
        };
    }

    computeCircleMassData(shapeId: ShapeId, density: Density): IMassData2D {
        const data = this.getCircleData(shapeId);
        const r = data.radius;
        const mass = density * Math.PI * r * r;
        const inertia = mass * r * r * 0.5;

        return {
            mass: mass as Mass,
            inverseMass: mass > 0 ? 1 / mass : 0,
            inertia: inertia as Inertia,
            inverseInertia: inertia > 0 ? 1 / inertia : 0,
            center: data.center,
        };
    }

    computeBoxMassData(shapeId: ShapeId, density: Density): IMassData2D {
        const data = this.getBoxData(shapeId);
        const w = data.halfWidth * 2;
        const h = data.halfHeight * 2;
        const mass = density * w * h;
        const inertia = (mass / 12) * (w * w + h * h);

        return {
            mass: mass as Mass,
            inverseMass: mass > 0 ? 1 / mass : 0,
            inertia: inertia as Inertia,
            inverseInertia: inertia > 0 ? 1 / inertia : 0,
            center: data.center,
        };
    }

    getShapesForBody(bodyId: BodyId): readonly ShapeId[] {
        const shapes = this._bodyToShapes.get(bodyId);
        return shapes ? Array.from(shapes) : [];
    }

    hasShape(shapeId: ShapeId): boolean {
        return this._shapeMetadata.has(shapeId);
    }

    private _registerShape(
        shapeId: ShapeId,
        bodyId: BodyId,
        type: ShapeType,
        def: {
            material?: IMaterial;
            friction?: Friction;
            restitution?: Restitution;
            density?: Density;
            isSensor?: boolean;
            filter?: any;
            userData?: unknown;
        }
    ): void {
        const material: IMaterial = def.material ?? {
            friction: (def.friction ?? 0.2) as Friction,
            restitution: (def.restitution ?? 0) as Restitution,
            density: (def.density ?? 1) as Density,
        };

        const filter = def.filter ?? {
            categoryBits: CollisionFilter.Default,
            maskBits: CollisionFilter.All,
            groupIndex: 0,
        };

        this._shapeMetadata.set(shapeId, {
            type,
            bodyId,
            material,
            isSensor: def.isSensor ?? false,
            filter,
            userData: def.userData,
        });

        let bodyShapes = this._bodyToShapes.get(bodyId);
        if (!bodyShapes) {
            bodyShapes = new Set();
            this._bodyToShapes.set(bodyId, bodyShapes);
        }
        bodyShapes.add(shapeId);
        this._shapeCount++;
    }

    private _assertNotDisposed(): void {
        if (this._disposed) {
            throw new ShapeError('Manager is disposed', ShapeManagerError.INVALID_STATE);
        }
    }

    private _assertCapacity(): void {
        if (this._shapeCount >= this._maxShapes) {
            throw new ShapeError('Shape capacity exceeded', ShapeManagerError.CAPACITY_EXCEEDED);
        }
    }

    [Symbol.dispose](): void {
        if (this._disposed) return;
        this._disposed = true;
        this._shapeMetadata.clear();
        this._shapeToCircleIndex.clear();
        this._shapeToBoxIndex.clear();
        this._shapeToPolygonIndex.clear();
        this._shapeToSegmentIndex.clear();
        this._shapeToCapsuleIndex.clear();
        this._bodyToShapes.clear();
    }
}
