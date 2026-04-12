declare const __render2DColorBrand: unique symbol;
declare const __render2DTextureReferenceBrand: unique symbol;
declare const __render2DMaterialReferenceBrand: unique symbol;

export type PackedRender2DColor = number & { readonly [__render2DColorBrand]: true };
export type Render2DTextureReference = string & {
    readonly [__render2DTextureReferenceBrand]: true;
};
export type Render2DMaterialReference = string & {
    readonly [__render2DMaterialReferenceBrand]: true;
};

export interface Render2DVec2Like {
    readonly x: number;
    readonly y: number;
}

export interface Render2DSizeLike {
    readonly width: number;
    readonly height: number;
}

export interface Render2DRectLike extends Render2DVec2Like, Render2DSizeLike {}

export type Render2DColorLike = readonly [number, number, number, number];
export type Render2DReadonlyMat4Like = ArrayLike<number>;

export interface Render2DSpriteTextureSource {
    readonly kind: 'texture';
    readonly textureId: string;
}

export interface Render2DSpriteMaterialSource {
    readonly kind: 'material';
    readonly materialId: string;
}

export type Render2DSpriteSource =
    | Render2DSpriteTextureSource
    | Render2DSpriteMaterialSource;

type Render2DSpriteSourceId<TSource extends Render2DSpriteSource> =
    TSource extends Render2DSpriteTextureSource
        ? TSource['textureId']
        : TSource extends Render2DSpriteMaterialSource
          ? TSource['materialId']
          : never;

export type Render2DSpriteSourceKey<
    TSource extends Render2DSpriteSource = Render2DSpriteSource,
> = `${TSource['kind']}:${Render2DSpriteSourceId<TSource>}`;

export interface Render2DSpriteSubmission<
    TSource extends Render2DSpriteSource = Render2DSpriteSource,
> {
    readonly source: TSource;
    readonly worldMatrix: Render2DReadonlyMat4Like;
    readonly size: Render2DSizeLike;
    readonly anchor: Render2DVec2Like;
    readonly uvRect: Render2DRectLike;
    readonly color: Render2DColorLike;
    readonly visible?: boolean;
    readonly flipX?: boolean;
    readonly flipY?: boolean;
}

export interface Render2DSpriteBatchKey<
    TSource extends Render2DSpriteSource = Render2DSpriteSource,
> {
    readonly source: TSource;
    readonly sourceKey: Render2DSpriteSourceKey<TSource>;
}

export interface Render2DSpriteBatchRange<
    TSource extends Render2DSpriteSource = Render2DSpriteSource,
> {
    readonly key: Render2DSpriteBatchKey<TSource>;
    readonly spriteOffset: number;
    readonly spriteCount: number;
    readonly quadCount: number;
    readonly indexOffset: number;
    readonly indexCount: number;
}

export interface Render2DSpriteBatchBuildResult {
    readonly vertexStride: number;
    readonly vertexByteLength: number;
    readonly vertexData: Uint8Array;
    readonly indexData: Uint16Array | Uint32Array;
    readonly batches: readonly Render2DSpriteBatchRange[];
    readonly spriteCount: number;
    readonly quadCount: number;
    readonly vertexCount: number;
    readonly indexCount: number;
}

export interface Render2DSpriteBatchBuilderOptions {
    readonly maxBatchQuads?: number;
}

export const asRender2DTextureReference = (
    value: string
): Render2DTextureReference => value as Render2DTextureReference;

export const asRender2DMaterialReference = (
    value: string
): Render2DMaterialReference => value as Render2DMaterialReference;

export const isRender2DSpriteTextureSource = (
    source: Render2DSpriteSource
): source is Render2DSpriteTextureSource => source.kind === 'texture';

export const isRender2DSpriteMaterialSource = (
    source: Render2DSpriteSource
): source is Render2DSpriteMaterialSource => source.kind === 'material';

export const getRender2DSpriteSourceKey = <
    TSource extends Render2DSpriteSource,
>(
    source: TSource
): Render2DSpriteSourceKey<TSource> => {
    if (isRender2DSpriteTextureSource(source)) {
        return `texture:${source.textureId}` as Render2DSpriteSourceKey<TSource>;
    }

    return `material:${source.materialId}` as Render2DSpriteSourceKey<TSource>;
};