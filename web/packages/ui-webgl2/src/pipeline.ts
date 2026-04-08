import type { RenderExecutionContext, RenderFrameResult, RenderPassSummary, RenderPipelineBackend } from '@axrone/core';
import { renderUIFrame } from '@axrone/ui';
import type { UIOverlayRenderPipelineBackendOptions } from './types';

export const createUIOverlayRenderPipelineBackend = <TNative = unknown, TPayload = unknown>(
    options: UIOverlayRenderPipelineBackendOptions<TNative, TPayload>
): RenderPipelineBackend<TNative> => ({
    async beginFrame(context: RenderExecutionContext<TNative>) {
        await options.base?.beginFrame?.(context);
    },
    async executePass(pass: RenderPassSummary | any, context: RenderExecutionContext<TNative>) {
        await options.base?.executePass?.(pass, context);
    },
    async endFrame(result: RenderFrameResult<TNative>, context: RenderExecutionContext<TNative>) {
        await options.base?.endFrame?.(result, context);
        renderUIFrame(options.renderer, options.ui, {
            width: context.viewport.width,
            height: context.viewport.height,
        });
    },
});

export type { UIOverlayRenderPipelineBackendOptions };