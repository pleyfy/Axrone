import { clamp01 } from '@axrone/numeric';
import {
    RENDER_2D_SPRITE_INDICES_PER_QUAD,
    RENDER_2D_SPRITE_VERTEX_STRIDE,
    RENDER_2D_SPRITE_VERTICES_PER_QUAD,
} from './sprite-shader';
import { Render2DCapacityError, Render2DValidationError } from './errors';
import {
    type PackedRender2DColor,
    type Render2DColorLike,
    type Render2DRectLike,
    type Render2DSpriteMask,
    type Render2DSpriteBatchBuildResult,
    type Render2DSpriteBatchBuilderOptions,
    type Render2DSpriteBatchKey,
    type Render2DSpriteBatchRange,
    type Render2DSpriteSlice,
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
const MIN_QUAD_EXTENT = 1e-6;

const growCapacity = (current: number, required: number): number => {
    let next = Math.max(256, current);
    while (next < required) {
        next *= 2;
    }

    return next;
};

const packColor = (color: Render2DColorLike): PackedRender2DColor => {
    const red = Math.round(clamp01(color.r) * 255) & 0xff;
    const green = Math.round(clamp01(color.g) * 255) & 0xff;
    const blue = Math.round(clamp01(color.b) * 255) & 0xff;
    const alpha = Math.round(clamp01(color.a ?? 1) * 255) & 0xff;
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
        materialId: isRender2DSpriteMaterialSource(source) ? source.materialId : '',
    } as TSource;
};

const cloneRect = (
    value: Render2DRectLike | null | undefined
): Readonly<Render2DRectLike> | null =>
    value
        ? Object.freeze({
              x: value.x,
              y: value.y,
              width: value.width,
              height: value.height,
          })
        : null;

const cloneMask = (
    value: Render2DSpriteMask | null | undefined
): Readonly<Render2DSpriteMask> | null =>
    value
        ? Object.freeze({
              shape: value.shape,
              inverseWorldMatrix: Object.freeze(Array.from(value.inverseWorldMatrix, (entry) => Number(entry ?? 0))),
              size: Object.freeze({
                  width: value.size.width,
                  height: value.size.height,
              }),
              anchor: Object.freeze({
                  x: value.anchor.x,
                  y: value.anchor.y,
              }),
              ...(value.cornerRadius !== undefined ? { cornerRadius: value.cornerRadius } : {}),
          })
        : null;

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

const areRectsEqual = (
    left: Render2DRectLike | null | undefined,
    right: Render2DRectLike | null | undefined
): boolean => {
    if (!left || !right) {
        return left == null && right == null;
    }

    return (
        left.x === right.x &&
        left.y === right.y &&
        left.width === right.width &&
        left.height === right.height
    );
};

const areMaskMatricesEqual = (
    left: Render2DSpriteMask['inverseWorldMatrix'] | null | undefined,
    right: Render2DSpriteMask['inverseWorldMatrix'] | null | undefined
): boolean => {
    if (!left || !right) {
        return left == null && right == null;
    }

    if (left.length !== right.length) {
        return false;
    }

    for (let index = 0; index < left.length; index += 1) {
        if ((left[index] ?? 0) !== (right[index] ?? 0)) {
            return false;
        }
    }

    return true;
};

const areMasksEqual = (
    left: Render2DSpriteMask | null | undefined,
    right: Render2DSpriteMask | null | undefined
): boolean => {
    if (!left || !right) {
        return left == null && right == null;
    }

    return (
        left.shape === right.shape &&
        areMaskMatricesEqual(left.inverseWorldMatrix, right.inverseWorldMatrix) &&
        left.size.width === right.size.width &&
        left.size.height === right.size.height &&
        left.anchor.x === right.anchor.x &&
        left.anchor.y === right.anchor.y &&
        (left.cornerRadius ?? 0) === (right.cornerRadius ?? 0)
    );
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
    assertFinite('Sprite color.r', submission.color.r);
    assertFinite('Sprite color.g', submission.color.g);
    assertFinite('Sprite color.b', submission.color.b);
    assertFinite('Sprite color.a', submission.color.a ?? 1);

    if (submission.clipRect) {
        assertFinite('Sprite clipRect.x', submission.clipRect.x);
        assertFinite('Sprite clipRect.y', submission.clipRect.y);
        assertFinite('Sprite clipRect.width', submission.clipRect.width);
        assertFinite('Sprite clipRect.height', submission.clipRect.height);
    }

    if (submission.slice) {
        assertFinite('Sprite slice source width', submission.slice.sourceSize.width);
        assertFinite('Sprite slice source height', submission.slice.sourceSize.height);
        assertFinite('Sprite slice border.left', submission.slice.border.left);
        assertFinite('Sprite slice border.right', submission.slice.border.right);
        assertFinite('Sprite slice border.top', submission.slice.border.top);
        assertFinite('Sprite slice border.bottom', submission.slice.border.bottom);

        if (submission.slice.sourceSize.width <= 0 || submission.slice.sourceSize.height <= 0) {
            throw new Render2DValidationError(
                'Sprite slice sourceSize must be greater than zero'
            );
        }

        if (
            submission.slice.border.left < 0 ||
            submission.slice.border.right < 0 ||
            submission.slice.border.top < 0 ||
            submission.slice.border.bottom < 0
        ) {
            throw new Render2DValidationError(
                'Sprite slice borders must be zero or greater'
            );
        }

        if (
            submission.slice.border.left + submission.slice.border.right >
                submission.slice.sourceSize.width ||
            submission.slice.border.top + submission.slice.border.bottom >
                submission.slice.sourceSize.height
        ) {
            throw new Render2DValidationError(
                'Sprite slice borders must fit inside the source size'
            );
        }
    }

    if (submission.mask) {
        assertFinite('Sprite mask size.width', submission.mask.size.width);
        assertFinite('Sprite mask size.height', submission.mask.size.height);
        assertFinite('Sprite mask anchor.x', submission.mask.anchor.x);
        assertFinite('Sprite mask anchor.y', submission.mask.anchor.y);

        if (submission.mask.size.width <= 0 || submission.mask.size.height <= 0) {
            throw new Render2DValidationError('Sprite mask size must be greater than zero');
        }

        if (submission.mask.inverseWorldMatrix.length < 16) {
            throw new Render2DValidationError('Sprite mask inverse matrix must have 16 values');
        }

        if (submission.mask.shape === 'rounded-rect') {
            assertFinite('Sprite mask cornerRadius', submission.mask.cornerRadius ?? 0);
        }
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

    if (submission.clipRect && (submission.clipRect.width === 0 || submission.clipRect.height === 0)) {
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
    out[0] = (matrix[0] ?? 0) * localX + (matrix[1] ?? 0) * localY + (matrix[3] ?? 0);
    out[1] = (matrix[4] ?? 0) * localX + (matrix[5] ?? 0) * localY + (matrix[7] ?? 0);
    out[2] = (matrix[8] ?? 0) * localX + (matrix[9] ?? 0) * localY + (matrix[11] ?? 0);
    return out;
};

export class Render2DSpriteBatchBuilder {
    private readonly _maxBatchQuads: number;
    private readonly _batches: MutableRender2DSpriteBatchRange[] = [];
    private readonly _renderableSubmissions: Render2DSpriteSubmission[] = [];
    private readonly _submissionQuadCounts: number[] = [];
    private _vertexBuffer = new ArrayBuffer(0);
    private _vertexBytes = new Uint8Array(0);
    private _vertexFloatView = new Float32Array(0);
    private _vertexUintView = new Uint32Array(0);
    private _indexData16 = new Uint16Array(0);
    private _indexData32 = new Uint32Array(0);
    private readonly _pointScratch = new Float32Array(3);
    private readonly _xEdges = new Float32Array(4);
    private readonly _yEdges = new Float32Array(4);
    private readonly _uEdges = new Float32Array(4);
    private readonly _vEdges = new Float32Array(4);
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
        this._renderableSubmissions.length = 0;
        this._submissionQuadCounts.length = 0;

        let spriteCount = 0;
        let quadCount = 0;

        for (const submission of submissions) {
            validateSubmission(submission);
            if (!isRenderableSubmission(submission)) {
                continue;
            }

            const submissionQuadCount = this._measureQuadCount(submission);
            if (submissionQuadCount > this._maxBatchQuads) {
                throw new Render2DCapacityError(
                    'Sprite submission exceeds the configured maxBatchQuads limit'
                );
            }

            spriteCount += 1;
            quadCount += submissionQuadCount;
            this._renderableSubmissions.push(submission);
            this._submissionQuadCounts.push(submissionQuadCount);
        }

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
        let lastClipRect: Render2DRectLike | null = null;
        let lastMask: Render2DSpriteMask | null = null;

        for (
            let submissionIndex = 0;
            submissionIndex < this._renderableSubmissions.length;
            submissionIndex += 1
        ) {
            const submission = this._renderableSubmissions[submissionIndex]!;
            const submissionQuadCount = this._submissionQuadCounts[submissionIndex]!;
            const submissionClipRect = submission.clipRect ?? null;

            if (
                !lastSource ||
                !areSourcesEqual(lastSource, submission.source) ||
                !areRectsEqual(lastClipRect, submissionClipRect) ||
                !areMasksEqual(lastMask, submission.mask ?? null) ||
                this._batches[batchIndex]!.quadCount + submissionQuadCount > this._maxBatchQuads
            ) {
                batchIndex += 1;
                const key = {
                    source: cloneSource(submission.source),
                    sourceKey: getRender2DSpriteSourceKey(submission.source),
                    clipRect: cloneRect(submissionClipRect),
                    mask: cloneMask(submission.mask),
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
                lastClipRect = submissionClipRect;
                lastMask = submission.mask ?? null;
            }

            const currentBatch = this._batches[batchIndex]!;
            const quadsWritten = this._writeSubmission(submission, quadIndex, indexTarget);
            currentBatch.spriteCount += 1;
            currentBatch.quadCount += quadsWritten;
            currentBatch.indexCount += quadsWritten * RENDER_2D_SPRITE_INDICES_PER_QUAD;
            quadIndex += quadsWritten;
            spriteOffset += 1;
        }

        this._result.vertexByteLength = vertexCount * RENDER_2D_SPRITE_VERTEX_STRIDE;
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

    private _measureQuadCount(submission: Render2DSpriteSubmission): number {
        if (!submission.slice) {
            return 1;
        }

        this._resolveSliceLocalEdges(submission, this._xEdges, this._yEdges);

        let count = 0;
        for (let row = 0; row < 3; row += 1) {
            const height = this._yEdges[row + 1]! - this._yEdges[row]!;
            if (height <= MIN_QUAD_EXTENT) {
                continue;
            }

            for (let column = 0; column < 3; column += 1) {
                const width = this._xEdges[column + 1]! - this._xEdges[column]!;
                if (width > MIN_QUAD_EXTENT) {
                    count += 1;
                }
            }
        }

        return Math.max(1, count);
    }

    private _writeSubmission(
        submission: Render2DSpriteSubmission,
        quadIndex: number,
        indexTarget: Uint16Array | Uint32Array
    ): number {
        const color = packColor(submission.color);
        const minX = -submission.anchor.x * submission.size.width;
        const minY = -submission.anchor.y * submission.size.height;
        const maxX = minX + submission.size.width;
        const maxY = minY + submission.size.height;

        if (!submission.slice) {
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

            this._writeTransformedQuad(
                submission,
                quadIndex,
                indexTarget,
                minX,
                minY,
                maxX,
                maxY,
                u0,
                v0,
                u1,
                v1,
                color
            );
            return 1;
        }

        this._resolveSliceLocalEdges(submission, this._xEdges, this._yEdges);
        this._resolveSliceUVEdges(submission, this._uEdges, this._vEdges);

        let written = 0;
        for (let row = 0; row < 3; row += 1) {
            const localMinY = this._yEdges[row]!;
            const localMaxY = this._yEdges[row + 1]!;
            if (localMaxY - localMinY <= MIN_QUAD_EXTENT) {
                continue;
            }

            for (let column = 0; column < 3; column += 1) {
                const localMinX = this._xEdges[column]!;
                const localMaxX = this._xEdges[column + 1]!;
                if (localMaxX - localMinX <= MIN_QUAD_EXTENT) {
                    continue;
                }

                this._writeTransformedQuad(
                    submission,
                    quadIndex + written,
                    indexTarget,
                    localMinX,
                    localMinY,
                    localMaxX,
                    localMaxY,
                    this._uEdges[column]!,
                    this._vEdges[row + 1]!,
                    this._uEdges[column + 1]!,
                    this._vEdges[row]!,
                    color
                );
                written += 1;
            }
        }

        return Math.max(1, written);
    }

    private _resolveSliceLocalEdges(
        submission: Render2DSpriteSubmission,
        xEdges: Float32Array,
        yEdges: Float32Array
    ): void {
        const slice = submission.slice as Render2DSpriteSlice;
        const minX = -submission.anchor.x * submission.size.width;
        const minY = -submission.anchor.y * submission.size.height;

        this._resolveDisplayAxisEdges(
            submission.size.width,
            slice.sourceSize.width,
            slice.border.left,
            slice.border.right,
            minX,
            xEdges
        );
        this._resolveDisplayAxisEdges(
            submission.size.height,
            slice.sourceSize.height,
            slice.border.bottom,
            slice.border.top,
            minY,
            yEdges
        );
    }

    private _resolveSliceUVEdges(
        submission: Render2DSpriteSubmission,
        uEdges: Float32Array,
        vEdges: Float32Array
    ): void {
        const slice = submission.slice as Render2DSpriteSlice;
        const uvLeft = submission.uvRect.x;
        const uvTop = submission.uvRect.y;
        const uvRight = submission.uvRect.x + submission.uvRect.width;
        const uvBottom = submission.uvRect.y + submission.uvRect.height;
        const leftInner =
            uvLeft + submission.uvRect.width * (slice.border.left / slice.sourceSize.width);
        const rightInner =
            uvLeft +
            submission.uvRect.width *
                ((slice.sourceSize.width - slice.border.right) / slice.sourceSize.width);
        const topInner =
            uvTop + submission.uvRect.height * (slice.border.top / slice.sourceSize.height);
        const bottomInner =
            uvTop +
            submission.uvRect.height *
                ((slice.sourceSize.height - slice.border.bottom) /
                    slice.sourceSize.height);

        uEdges[0] = uvLeft;
        uEdges[1] = leftInner;
        uEdges[2] = rightInner;
        uEdges[3] = uvRight;
        if (submission.flipX) {
            this._reverseEdges(uEdges);
        }

        vEdges[0] = uvBottom;
        vEdges[1] = bottomInner;
        vEdges[2] = topInner;
        vEdges[3] = uvTop;
        if (submission.flipY) {
            this._reverseEdges(vEdges);
        }
    }

    private _resolveDisplayAxisEdges(
        targetSize: number,
        sourceSize: number,
        startBorder: number,
        endBorder: number,
        offset: number,
        out: Float32Array
    ): void {
        let startSize = (startBorder / sourceSize) * targetSize;
        let endSize = (endBorder / sourceSize) * targetSize;
        const totalBorderSize = startSize + endSize;

        if (totalBorderSize > targetSize && totalBorderSize > 0) {
            const scale = targetSize / totalBorderSize;
            startSize *= scale;
            endSize *= scale;
        }

        const centerSize = Math.max(0, targetSize - startSize - endSize);

        out[0] = offset;
        out[1] = offset + startSize;
        out[2] = offset + startSize + centerSize;
        out[3] = offset + targetSize;
    }

    private _reverseEdges(edges: Float32Array): void {
        const first = edges[0]!;
        const second = edges[1]!;
        edges[0] = edges[3]!;
        edges[1] = edges[2]!;
        edges[2] = second;
        edges[3] = first;
    }

    private _writeTransformedQuad(
        submission: Render2DSpriteSubmission,
        quadIndex: number,
        indexTarget: Uint16Array | Uint32Array,
        minX: number,
        minY: number,
        maxX: number,
        maxY: number,
        uLeft: number,
        vTop: number,
        uRight: number,
        vBottom: number,
        color: PackedRender2DColor
    ): void {
        const vertexBase = quadIndex * RENDER_2D_SPRITE_VERTICES_PER_QUAD;
        const indexBase = quadIndex * RENDER_2D_SPRITE_INDICES_PER_QUAD;

        const point = transformPoint(submission.worldMatrix, minX, minY, this._pointScratch);
        writeVertex(
            this._vertexFloatView,
            this._vertexUintView,
            vertexBase,
            point[0]!,
            point[1]!,
            point[2]!,
            uLeft,
            vBottom,
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
            uRight,
            vBottom,
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
            uRight,
            vTop,
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
            uLeft,
            vTop,
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