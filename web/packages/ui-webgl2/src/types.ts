import type {
    CustomRenderCommand,
    ImageRenderCommand,
    RectLike,
    SizeLike,
    UIImageSource,
    UIFrame,
    UIFrameProducer,
    UIFrameSink,
} from '@axrone/ui';
import type {
    RenderPipelineBackend,
} from '@axrone/render-core';
import type { GameLoop } from '@axrone/game-loop';
import type {
    SceneMaterialTextureBindingHandle,
    SceneTextureResourceHandle,
} from '@axrone/scene-runtime';

export interface WebGL2UIRendererStatistics {
    readonly drawCalls: number;
    readonly quadCount: number;
    readonly imageCount: number;
    readonly materialImageCount: number;
    readonly glyphCount: number;
    readonly customCommandCount: number;
    readonly uploadedGlyphCount: number;
    readonly atlasPageCount: number;
}

export interface WebGL2UICustomCommandContext<TPayload = unknown> {
    readonly gl: WebGL2RenderingContext;
    readonly frame: Readonly<UIFrame<TPayload>>;
    readonly clip: RectLike | null;
    readonly viewport: Readonly<SizeLike>;
}

export interface WebGL2UIRendererOptions<TPayload = unknown> {
    readonly gl: WebGL2RenderingContext;
    readonly quadBatchCapacity?: number;
    readonly imageBatchCapacity?: number;
    readonly glyphBatchCapacity?: number;
    readonly atlasFilter?: 'nearest' | 'linear';
    readonly resolveImageResource?: (
        source: UIImageSource,
        context: WebGL2UIResolveImageResourceContext<TPayload>
    ) => WebGL2UIResolvedImageResource<TPayload> | null;
    readonly customCommandRenderer?: (
        command: CustomRenderCommand<TPayload>,
        context: WebGL2UICustomCommandContext<TPayload>
    ) => void;
}

export interface WebGL2UIResolveImageResourceContext<TPayload = unknown> {
    readonly gl: WebGL2RenderingContext;
    readonly frame: Readonly<UIFrame<TPayload>>;
    readonly command: ImageRenderCommand;
}

export interface WebGL2UIResolvedTextureImage {
    readonly kind: 'texture';
    readonly texture: WebGLTexture;
    readonly sampler?: WebGLSampler | null;
}

export interface WebGL2UIMaterialImageContext<TPayload = unknown> {
    readonly gl: WebGL2RenderingContext;
    readonly frame: Readonly<UIFrame<TPayload>>;
    readonly command: ImageRenderCommand;
    readonly clip: RectLike | null;
    readonly viewport: Readonly<SizeLike>;
}

export interface WebGL2UIResolvedMaterialImage<TPayload = unknown> {
    readonly kind: 'material';
    render(context: WebGL2UIMaterialImageContext<TPayload>): void;
}

export type WebGL2UIResolvedImageResource<TPayload = unknown> =
    | WebGL2UIResolvedTextureImage
    | WebGL2UIResolvedMaterialImage<TPayload>;

export interface SceneUIResourceResolverTarget {
    getTextureResource(id: string): SceneTextureResourceHandle | null;
    getMaterialTextureBinding(
        materialId: string,
        uniformName?: string
    ): SceneMaterialTextureBindingHandle | null;
}

export interface SceneUIResourceResolverOptions<TPayload = unknown> {
    readonly materialTextureBinding?: string;
    readonly resolveMaterial?: (
        source: Extract<UIImageSource, { readonly kind: 'material' }>,
        input: {
            readonly scene: SceneUIResourceResolverTarget;
            readonly binding: SceneMaterialTextureBindingHandle | null;
            readonly context: WebGL2UIResolveImageResourceContext<TPayload>;
        }
    ) => WebGL2UIResolvedImageResource<TPayload> | null;
}

export interface UIOverlayRenderPipelineBackendOptions<TNative = unknown, TPayload = unknown> {
    readonly base?: RenderPipelineBackend<TNative>;
    readonly renderer: Pick<UIFrameSink<TPayload>, 'render'>;
    readonly ui: UIFrameProducer<TPayload>;
}

export interface ManagedWebGL2UIOverlayRenderPipelineBackendOptions<TNative = unknown, TPayload = unknown>
    extends Omit<UIOverlayRenderPipelineBackendOptions<TNative, TPayload>, 'renderer'> {
    readonly renderer?: Omit<WebGL2UIRendererOptions<TPayload>, 'gl'>;
    readonly getGL: (input: {
        readonly context: Parameters<NonNullable<RenderPipelineBackend<TNative>['beginFrame']>>[0];
        readonly result: Parameters<NonNullable<RenderPipelineBackend<TNative>['endFrame']>>[0];
    }) => WebGL2RenderingContext;
}

export interface ManagedUIOverlayRenderPipelineBackend<TNative = unknown>
    extends RenderPipelineBackend<TNative>,
        Disposable {
    dispose(): void;
}

export interface SceneUIOverlayTarget extends Partial<SceneUIResourceResolverTarget> {
    readonly canvas: Pick<HTMLCanvasElement, 'width' | 'height'>;
    readonly gl: Pick<WebGL2RenderingContext, 'drawingBufferWidth' | 'drawingBufferHeight'> & WebGL2RenderingContext;
    readonly loop: Pick<GameLoop<{ readonly sceneId: string }>, 'addSystem' | 'removeSystem' | 'getSystem'>;
}

export interface SceneUIOverlayOptions<TPayload = unknown> {
    readonly ui: UIFrameProducer<TPayload>;
    readonly renderer?: Omit<WebGL2UIRendererOptions<TPayload>, 'gl'>;
    readonly resources?: SceneUIResourceResolverOptions<TPayload>;
    readonly systemId?: string;
    readonly priority?: number;
}

export interface SceneUIOverlayHandle<TPayload = unknown> extends Disposable {
    readonly scene: SceneUIOverlayTarget;
    readonly systemId: string;
    readonly renderer: Pick<UIFrameSink<TPayload>, 'render'> & Disposable;
    render(): UIFrame<TPayload> | null;
    dispose(): void;
}