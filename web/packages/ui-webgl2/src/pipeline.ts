import type {
    RenderExecutionContext,
    RenderFrameResult,
    RenderPipelineBackend,
    ResolvedRenderPass,
} from '@axrone/core';
import { renderUIFrame } from '@axrone/ui';
import { WebGL2UIRenderer } from './renderer';
import type {
    ManagedUIOverlayRenderPipelineBackend,
    ManagedWebGL2UIOverlayRenderPipelineBackendOptions,
    UIOverlayRenderPipelineBackendOptions,
} from './types';

export const createUIOverlayRenderPipelineBackend = <TNative = unknown, TPayload = unknown>(
    options: UIOverlayRenderPipelineBackendOptions<TNative, TPayload>
): RenderPipelineBackend<TNative> => ({
    async beginFrame(context: RenderExecutionContext<TNative>) {
        await options.base?.beginFrame?.(context);
    },
    async executePass(pass: ResolvedRenderPass, context: RenderExecutionContext<TNative>) {
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

export const createManagedWebGL2UIOverlayRenderPipelineBackend = <TNative = unknown, TPayload = unknown>(
    options: ManagedWebGL2UIOverlayRenderPipelineBackendOptions<TNative, TPayload>
): ManagedUIOverlayRenderPipelineBackend<TNative> => {
    let renderer: WebGL2UIRenderer<TPayload> | null = null;
    let activeGl: WebGL2RenderingContext | null = null;

    const resolveRenderer = (
        context: RenderExecutionContext<TNative>,
        result: RenderFrameResult<TNative>
    ): WebGL2UIRenderer<TPayload> => {
        const gl = options.getGL({ context, result });
        if (renderer !== null && activeGl === gl) {
            return renderer;
        }
        renderer?.dispose();
        renderer = new WebGL2UIRenderer({
            ...options.renderer,
            gl,
        });
        activeGl = gl;
        return renderer;
    };

    return {
        async beginFrame(context: RenderExecutionContext<TNative>) {
            await options.base?.beginFrame?.(context);
        },
        async executePass(pass: ResolvedRenderPass, context: RenderExecutionContext<TNative>) {
            await options.base?.executePass?.(pass, context);
        },
        async endFrame(result: RenderFrameResult<TNative>, context: RenderExecutionContext<TNative>) {
            await options.base?.endFrame?.(result, context);
            renderUIFrame(resolveRenderer(context, result), options.ui, {
                width: context.viewport.width,
                height: context.viewport.height,
            });
        },
        dispose() {
            renderer?.dispose();
            renderer = null;
            activeGl = null;
        },
        [Symbol.dispose]() {
            renderer?.dispose();
            renderer = null;
            activeGl = null;
        },
    };
};

export type {
    ManagedWebGL2UIOverlayRenderPipelineBackendOptions,
    ManagedUIOverlayRenderPipelineBackend,
    UIOverlayRenderPipelineBackendOptions,
};