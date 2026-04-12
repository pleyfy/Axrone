import {
    RENDER_2D_SPRITE_INDICES_PER_QUAD,
    RENDER_2D_SPRITE_VERTEX_STRIDE,
    RENDER_2D_SPRITE_VERTICES_PER_QUAD,
} from './sprite-shader';
import { Render2DCapacityError, Render2DValidationError } from './errors';
import {
    type PackedRender2DColor,
    type Render2DColorLike,
    type Render2DSpriteBatchBuildResult,
    type Render2DSpriteBatchBuilderOptions,
    type Render2DSpriteBatchKey,
    type Render2DSpriteBatchRange,
    type Render2DSpriteSource,
    type Render2DSpriteSubmission,
    getRender2DSpriteSourceKey,
    isRender2DSpriteMaterialSource,
    isRender2DSpriteTextureSource,
} from './types';

interface MutableRender2DSpriteBatchRange {
    key: Render2DSpriteBatchKey;
    spriteOffset: number;
    spriteCount: number;
    quadCount: number;
    indexOffset: number;
    indexCount: number;
}

interface MutableRender2DSpriteBatchBuildResult {
    vertexStride: number;
    vertexByteLength: number;
    vertexData: Uint8Array;
    indexData: Uint16Array | Uint32Array;
    batches: readonly Render2DSpriteBatchRange[];
    spriteCount: number;
    quadCount: number;
    vertexCount: number;
    indexCount: number;
}

const DEFAULT_MAX_BATCH_QUADS = 2048;

const growCapacity = (current: number, required: number): number => {
    let next = Math.max(256, current);
    while (next < required) {
        next *= 2;
    }

    return next;
};

const clamp01 = (value: number): number =>
    value <= 0 ? 0 : value >= 1 ? 1 : value;

const packColor = (color: Render2DColorLike): PackedRender2DColor => {
    const red = Math.round(clamp01(color[0] ?? 1) * 255) & 0xff;
    const green = Math.round(clamp01(color[1] ?? 1) * 255) & 0xff;
    const blue = Math.round(clamp01(color[2] ?? 1) * 255) & 0xff;
    const alpha = Math.round(clamp01(color[3] ?? 1) * 255) & 0xff;
    return (red | (green << 8) | (blue << 16) | (alpha << 24)) as PackedRender2DColor;
};

const cloneSource = <TSource extends Render2DSpriteSource>(source: TSource): TSource => {
    if (isRender2DSpriteTextureSource(source)) {
        return {
            kind: 'texture',
            textureId: source.textureId,
        } as TSource;
    }

    return {
        kind: 'material',
        materialId: isRender2DSpriteMaterialSource(source)
            ? source.materialId
            : '',
    } as TSource;
};

const areSourcesEqual = (
    left: Render2DSpriteSource,
    right: Render2DSpriteSource
): boolean => {
    if (left.kind !== right.kind) {
        return false;
    }

    return isRender2DSpriteTextureSource(left)
        ? left.textureId === (right as typeof left).textureId
        : (left as Extract<Render2DSpriteSource, { kind: 'material' }>).materialId ===
              (right as Extract<Render2DSpriteSource, { kind: 'material' }>).materialId;
};

const assertFinite = (label: string, value: number): void => {
    if (!Number.isFinite(value)) {
        throw new Render2DValidationError(`${label} must be a finite number`);
    }
};

const validateSubmission = (submission: Render2DSpriteSubmission): void => {
    if (submission.worldMatrix.length < 16) {
        throw new Render2DValidationError('Sprite worldMatrix must expose at least 16 values');
    }

    assertFinite('Sprite width', submission.size.width);
    assertFinite('Sprite height', submission.size.height);
    assertFinite('Sprite anchor.x', submission.anchor.x);
    assertFinite('Sprite anchor.y', submission.anchor.y);
    assertFinite('Sprite uvRect.x', submission.uvRect.x);
    assertFinite('Sprite uvRect.y', submission.uvRect.y);
    assertFinite('Sprite uvRect.width', submission.uvRect.width);
    assertFinite('Sprite uvRect.height', submission.uvRect.height);

    if (submission.color.length < 4) {
        throw new Render2DValidationError('Sprite color must contain 4 channels');
    }

    for (let index = 0; index < 16; index += 1) {
        assertFinite(`Sprite worldMatrix[${index}]`, submission.worldMatrix[index] ?? NaN);
    }
};

const isRenderableSubmission = (submission: Render2DSpriteSubmission): boolean => {
    if (submission.visible === false) {
        return false;
    }

    if (submission.size.width === 0 || submission.size.height === 0) {
        return false;
    }

    return isRender2DSpriteTextureSource(submission.source)
        ? submission.source.textureId.length > 0
        : submission.source.materialId.length > 0;
};

const writeVertex = (
    floatView: Float32Array,
    uintView: Uint32Array,
    baseVertex: number,
    x: number,
    y: number,
    z: number,
    u: number,
    v: number,
    color: PackedRender2DColor
): void => {
    const offset = baseVertex * (RENDER_2D_SPRITE_VERTEX_STRIDE / 4);
    floatView[offset] = x;
    floatView[offset + 1] = y;
    floatView[offset + 2] = z;
    floatView[offset + 3] = u;
    floatView[offset + 4] = v;
    uintView[offset + 5] = color;
};

const transformPoint = (
    matrix: ArrayLike<number>,
    localX: number,
    localY: number,
    out: Float32Array
): Float32Array => {
    out[0] =
        (matrix[0] ?? 0) * localX +
        (matrix[1] ?? 0) * localY +
        (matrix[3] ?? 0);
    out[1] =
        (matrix[4] ?? 0) * localX +
        (matrix[5] ?? 0) * localY +
        (matrix[7] ?? 0);
    out[2] =
        (matrix[8] ?? 0) * localX +
        (matrix[9] ?? 0) * localY +
        (matrix[11] ?? 0);
    return out;
};

export class Render2DSpriteBatchBuilder {
    private readonly _maxBatchQuads: number;
    private readonly _batches: MutableRender2DSpriteBatchRange[] = [];
    private _vertexBuffer = new ArrayBuffer(0);
    private _vertexBytes = new Uint8Array(0);
    private _vertexFloatView = new Float32Array(0);
    private _vertexUintView = new Uint32Array(0);
    private _indexData16 = new Uint16Array(0);
    private _indexData32 = new Uint32Array(0);
    private readonly _pointScratch = new Float32Array(3);
    private readonly _result: MutableRender2DSpriteBatchBuildResult = {
        vertexStride: RENDER_2D_SPRITE_VERTEX_STRIDE,
        vertexByteLength: 0,
        vertexData: this._vertexBytes,
        indexData: this._indexData16,
        batches: this._batches,
        spriteCount: 0,
        quadCount: 0,
        vertexCount: 0,
        indexCount: 0,
    };

    constructor(options: Render2DSpriteBatchBuilderOptions = {}) {
        this._maxBatchQuads = options.maxBatchQuads ?? DEFAULT_MAX_BATCH_QUADS;

        if (!Number.isInteger(this._maxBatchQuads) || this._maxBatchQuads <= 0) {
            throw new Render2DValidationError('maxBatchQuads must be a positive integer');
        }
    }

    build(
        submissions: readonly Render2DSpriteSubmission[]
    ): Render2DSpriteBatchBuildResult {
        let spriteCount = 0;

        for (const submission of submissions) {
            validateSubmission(submission);
            if (isRenderableSubmission(submission)) {
                spriteCount += 1;
            }
        }

        const quadCount = spriteCount;
        const vertexCount = quadCount * RENDER_2D_SPRITE_VERTICES_PER_QUAD;
        const indexCount = quadCount * RENDER_2D_SPRITE_INDICES_PER_QUAD;
        const useUint32 = vertexCount > 0xffff;

        if (vertexCount > 0xffffffff) {
            throw new Render2DCapacityError('Sprite vertex count exceeds Uint32 draw capacity');
        }

        this._ensureVertexCapacity(vertexCount);
        this._ensureIndexCapacity(indexCount, useUint32);
        this._batches.length = 0;

        const indexTarget = useUint32 ? this._indexData32 : this._indexData16;
        let quadIndex = 0;
        let spriteOffset = 0;
        let batchIndex = -1;
        let lastSource: Render2DSpriteSource | null = null;

        for (const submission of submissions) {
            if (!isRenderableSubmission(submission)) {
                continue;
            }

            if (
                !lastSource ||
                !areSourcesEqual(lastSource, submission.source) ||
                this._batches[batchIndex]!.quadCount >= this._maxBatchQuads
            ) {
                batchIndex += 1;
                const key = {
                    source: cloneSource(submission.source),
                    sourceKey: getRender2DSpriteSourceKey(submission.source),
                } satisfies Render2DSpriteBatchKey;
                this._batches[batchIndex] = {
                    key,
                    spriteOffset,
                    spriteCount: 0,
                    quadCount: 0,
                    indexOffset: quadIndex * RENDER_2D_SPRITE_INDICES_PER_QUAD,
                    indexCount: 0,
                };
                lastSource = submission.source;
            }

            const currentBatch = this._batches[batchIndex]!;
            this._writeQuad(submission, quadIndex, indexTarget);
            currentBatch.spriteCount += 1;
            currentBatch.quadCount += 1;
            currentBatch.indexCount += RENDER_2D_SPRITE_INDICES_PER_QUAD;
            quadIndex += 1;
            spriteOffset += 1;
        }

        this._result.vertexByteLength =
            vertexCount * RENDER_2D_SPRITE_VERTEX_STRIDE;
        this._result.vertexData = this._vertexBytes.subarray(0, this._result.vertexByteLength);
        this._result.indexData = useUint32
            ? this._indexData32.subarray(0, indexCount)
            : this._indexData16.subarray(0, indexCount);
        this._result.batches = this._batches;
        this._result.spriteCount = spriteCount;
        this._result.quadCount = quadCount;
        this._result.vertexCount = vertexCount;
        this._result.indexCount = indexCount;
        return this._result;
    }

    private _ensureVertexCapacity(vertexCount: number): void {
        const requiredBytes = vertexCount * RENDER_2D_SPRITE_VERTEX_STRIDE;
        if (this._vertexBuffer.byteLength >= requiredBytes) {
            return;
        }

        const nextByteLength = growCapacity(this._vertexBuffer.byteLength, requiredBytes);
        this._vertexBuffer = new ArrayBuffer(nextByteLength);
        this._vertexBytes = new Uint8Array(this._vertexBuffer);
        this._vertexFloatView = new Float32Array(this._vertexBuffer);
        this._vertexUintView = new Uint32Array(this._vertexBuffer);
    }

    private _ensureIndexCapacity(indexCount: number, useUint32: boolean): void {
        if (useUint32) {
            if (this._indexData32.length >= indexCount) {
                return;
            }

            this._indexData32 = new Uint32Array(
                growCapacity(this._indexData32.length, indexCount)
            );
            return;
        }

        if (this._indexData16.length >= indexCount) {
            return;
        }

        this._indexData16 = new Uint16Array(
            growCapacity(this._indexData16.length, indexCount)
        );
    }

    private _writeQuad(
        submission: Render2DSpriteSubmission,
        quadIndex: number,
        indexTarget: Uint16Array | Uint32Array
    ): void {
        const vertexBase = quadIndex * RENDER_2D_SPRITE_VERTICES_PER_QUAD;
        const indexBase = quadIndex * RENDER_2D_SPRITE_INDICES_PER_QUAD;
        const color = packColor(submission.color);

        const minX = -submission.anchor.x * submission.size.width;
        const minY = -submission.anchor.y * submission.size.height;
        const maxX = minX + submission.size.width;
        const maxY = minY + submission.size.height;

        let u0 = submission.uvRect.x;
        let v0 = submission.uvRect.y;
        let u1 = submission.uvRect.x + submission.uvRect.width;
        let v1 = submission.uvRect.y + submission.uvRect.height;

        if (submission.flipX) {
            [u0, u1] = [u1, u0];
        }

        if (submission.flipY) {
            [v0, v1] = [v1, v0];
        }

        const point = transformPoint(submission.worldMatrix, minX, minY, this._pointScratch);
        writeVertex(
            this._vertexFloatView,
            this._vertexUintView,
            vertexBase,
            point[0]!,
            point[1]!,
            point[2]!,
            u0,
            v1,
            color
        );

        transformPoint(submission.worldMatrix, maxX, minY, this._pointScratch);
        writeVertex(
            this._vertexFloatView,
            this._vertexUintView,
            vertexBase + 1,
            this._pointScratch[0]!,
            this._pointScratch[1]!,
            this._pointScratch[2]!,
            u1,
            v1,
            color
        );

        transformPoint(submission.worldMatrix, maxX, maxY, this._pointScratch);
        writeVertex(
            this._vertexFloatView,
            this._vertexUintView,
            vertexBase + 2,
            this._pointScratch[0]!,
            this._pointScratch[1]!,
            this._pointScratch[2]!,
            u1,
            v0,
            color
        );

        transformPoint(submission.worldMatrix, minX, maxY, this._pointScratch);
        writeVertex(
            this._vertexFloatView,
            this._vertexUintView,
            vertexBase + 3,
            this._pointScratch[0]!,
            this._pointScratch[1]!,
            this._pointScratch[2]!,
            u0,
            v0,
            color
        );

        indexTarget[indexBase] = vertexBase;
        indexTarget[indexBase + 1] = vertexBase + 1;
        indexTarget[indexBase + 2] = vertexBase + 2;
        indexTarget[indexBase + 3] = vertexBase;
        indexTarget[indexBase + 4] = vertexBase + 2;
        indexTarget[indexBase + 5] = vertexBase + 3;
    }
}