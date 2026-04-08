import type {
    CustomRenderCommand,
    RectLike,
    SizeLike,
    UIFrame,
    UIFrameProducer,
    UIFrameSink,
} from '@axrone/ui';
import type { RenderPipelineBackend } from '@axrone/core';

export interface WebGL2UIRendererStatistics {
    readonly drawCalls: number;
    readonly quadCount: number;
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
    readonly glyphBatchCapacity?: number;
    readonly atlasFilter?: 'nearest' | 'linear';
    readonly customCommandRenderer?: (
        command: CustomRenderCommand<TPayload>,
        context: WebGL2UICustomCommandContext<TPayload>
    ) => void;
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