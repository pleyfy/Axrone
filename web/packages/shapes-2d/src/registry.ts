import {
    DEFAULT_MAX_CURVE_SEGMENTS,
    DEFAULT_MIN_CURVE_SEGMENTS,
    DEFAULT_REGISTRY_MAX_COMPILED,
    DEFAULT_REGISTRY_MAX_SHAPES,
    DEFAULT_CURVE_TOLERANCE,
} from './common';
import { ShapeRegistryError, SHAPES_2D_ERROR_CODE } from './errors';
import { compileShape } from './mesh';
import { serializeShape, createShapeFingerprint } from './serialization';
import type {
    CompiledShape2D,
    Shape2D,
    ShapeCompileOptions,
    ShapeFingerprint,
    ShapeId,
    ShapeRegistryOptions,
    ShapeRegistryStats,
} from './types';

const createCompileCacheKey = (
    fingerprint: string,
    options: ShapeCompileOptions
): string =>
    `${fingerprint}|${options.curveTolerance ?? DEFAULT_CURVE_TOLERANCE}|${options.minCurveSegments ?? DEFAULT_MIN_CURVE_SEGMENTS}|${options.maxCurveSegments ?? DEFAULT_MAX_CURVE_SEGMENTS}|${options.includeFillMesh === false ? 0 : 1}|${options.includeStrokeMesh === false ? 0 : 1}`;

export class ShapeRegistry implements Disposable {
    private readonly _maxShapes: number;
    private readonly _maxCompiledEntries: number;
    private readonly _defaultCompileOptions: ShapeCompileOptions;
    private readonly _shapesById = new Map<ShapeId, Shape2D>();
    private readonly _fingerprintsById = new Map<ShapeId, ShapeFingerprint>();
    private readonly _idsByFingerprint = new Map<ShapeFingerprint, ShapeId>();
    private readonly _compiledByKey = new Map<string, CompiledShape2D>();
    private _disposed = false;
    private _nextId = 1;

    constructor(options: ShapeRegistryOptions = {}) {
        this._maxShapes = Math.max(1, Math.floor(options.maxShapes ?? DEFAULT_REGISTRY_MAX_SHAPES));
        this._maxCompiledEntries = Math.max(
            1,
            Math.floor(options.maxCompiledEntries ?? DEFAULT_REGISTRY_MAX_COMPILED)
        );
        this._defaultCompileOptions = {
            curveTolerance: options.curveTolerance ?? DEFAULT_CURVE_TOLERANCE,
            minCurveSegments: options.minCurveSegments ?? DEFAULT_MIN_CURVE_SEGMENTS,
            maxCurveSegments: options.maxCurveSegments ?? DEFAULT_MAX_CURVE_SEGMENTS,
        };
    }

    get stats(): ShapeRegistryStats {
        return {
            shapeCount: this._shapesById.size,
            fingerprintCount: this._idsByFingerprint.size,
            compiledCount: this._compiledByKey.size,
            disposed: this._disposed,
        };
    }

    has(id: ShapeId): boolean {
        return this._shapesById.has(id);
    }

    get(id: ShapeId): Shape2D | null {
        this.ensureActive();
        return this._shapesById.get(id) ?? null;
    }

    register(shape: Shape2D): ShapeId {
        this.ensureActive();
        const fingerprint = createShapeFingerprint(shape);
        const existingId = this._idsByFingerprint.get(fingerprint);
        if (existingId) {
            return existingId;
        }

        if (this._shapesById.size >= this._maxShapes) {
            throw new ShapeRegistryError(
                SHAPES_2D_ERROR_CODE.CAPACITY_EXCEEDED,
                `Shape registry capacity of ${this._maxShapes} entries exceeded`
            );
        }

        const id = `shape_${this._nextId++}` as ShapeId;
        this._shapesById.set(id, shape);
        this._fingerprintsById.set(id, fingerprint);
        this._idsByFingerprint.set(fingerprint, id);
        return id;
    }

    unregister(id: ShapeId): boolean {
        this.ensureActive();
        const fingerprint = this._fingerprintsById.get(id);
        if (!fingerprint) {
            return false;
        }

        this._fingerprintsById.delete(id);
        this._idsByFingerprint.delete(fingerprint);
        this._shapesById.delete(id);

        for (const key of this._compiledByKey.keys()) {
            if (key.startsWith(`${fingerprint}|`)) {
                this._compiledByKey.delete(key);
            }
        }

        return true;
    }

    compile(target: ShapeId | Shape2D, options: ShapeCompileOptions = {}): CompiledShape2D {
        this.ensureActive();
        const shape = typeof target === 'string' ? this.resolveShape(target) : target;
        const fingerprint = createShapeFingerprint(shape);
        const resolvedOptions = {
            ...this._defaultCompileOptions,
            ...options,
        };
        const cacheKey = createCompileCacheKey(fingerprint, resolvedOptions);
        const cached = this._compiledByKey.get(cacheKey);
        if (cached) {
            this._compiledByKey.delete(cacheKey);
            this._compiledByKey.set(cacheKey, cached);
            return cached;
        }

        const compiled = compileShape(shape, resolvedOptions);
        this._compiledByKey.set(cacheKey, compiled);
        this.trimCompiledCache();
        return compiled;
    }

    serialize(target: ShapeId | Shape2D) {
        this.ensureActive();
        const shape = typeof target === 'string' ? this.resolveShape(target) : target;
        return serializeShape(shape);
    }

    clear(): void {
        this._shapesById.clear();
        this._fingerprintsById.clear();
        this._idsByFingerprint.clear();
        this._compiledByKey.clear();
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }
        this.clear();
        this._disposed = true;
    }

    [Symbol.dispose](): void {
        this.dispose();
    }

    private resolveShape(id: ShapeId): Shape2D {
        const shape = this._shapesById.get(id);
        if (!shape) {
            throw new ShapeRegistryError(
                SHAPES_2D_ERROR_CODE.SHAPE_NOT_FOUND,
                `Shape ${id} is not registered`
            );
        }
        return shape;
    }

    private trimCompiledCache(): void {
        while (this._compiledByKey.size > this._maxCompiledEntries) {
            const oldestKey = this._compiledByKey.keys().next().value as string | undefined;
            if (!oldestKey) {
                return;
            }
            this._compiledByKey.delete(oldestKey);
        }
    }

    private ensureActive(): void {
        if (this._disposed) {
            throw new ShapeRegistryError(
                SHAPES_2D_ERROR_CODE.REGISTRY_DISPOSED,
                'Shape registry has been disposed'
            );
        }
    }
}
