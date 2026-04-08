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