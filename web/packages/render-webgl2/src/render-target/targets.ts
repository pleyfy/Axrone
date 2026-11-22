import type { ContextSource } from '../context';
import { resolveContext } from '../context';
import { FramebufferFactory } from './factory';
import type { IFramebuffer, IFramebufferFactory } from './interfaces';
import type { GLTextureFormat } from './types';

export const createFramebufferFactory = (source: ContextSource): IFramebufferFactory => {
    return new FramebufferFactory(source);
};

export const createRenderTarget = (
    source: ContextSource,
    width: number,
    height: number,
    options: {
        colorFormat?: GLTextureFormat;
        depthFormat?: GLTextureFormat;
        samples?: number;
        useDepth?: boolean;
        useStencil?: boolean;
        label?: string;
    } = {}
): IFramebuffer => {
    const ctx = resolveContext(source);
    const gl = ctx.gl;
    const {
        colorFormat = gl.RGBA8,
        depthFormat = gl.DEPTH24_STENCIL8,
        samples = 0,
        useDepth = true,
        useStencil = false,
        label = 'RenderTarget',
    } = options;

    const factory = createFramebufferFactory(ctx);

    if (useDepth || useStencil) {
        const actualDepthFormat =
            useDepth && useStencil
                ? depthFormat
                : useDepth
                  ? (gl.DEPTH_COMPONENT24 as GLTextureFormat)
                  : (gl.STENCIL_INDEX8 as GLTextureFormat);

        return factory.createFramebufferWithDepth(
            width,
            height,
            colorFormat,
            actualDepthFormat,
            samples
        );
    } else {
        return factory.createColorFramebuffer(width, height, colorFormat, samples);
    }
};

export const createShadowMap = (
    source: ContextSource,
    size: number,
    format?: GLTextureFormat
): IFramebuffer => {
    const ctx = resolveContext(source);
    const gl = ctx.gl;
    const resolvedFormat = format ?? gl.DEPTH_COMPONENT24 as GLTextureFormat;
    const factory = createFramebufferFactory(ctx);
    return factory.createDepthFramebuffer(size, size, resolvedFormat);
};

export const createMultisampledRenderTarget = (
    source: ContextSource,
    width: number,
    height: number,
    samples: number,
    colorFormat?: GLTextureFormat,
    depthFormat?: GLTextureFormat
): { msaaTarget: IFramebuffer; resolveTarget: IFramebuffer } => {
    const ctx = resolveContext(source);
    const gl = ctx.gl;
    const resolvedColorFormat = colorFormat ?? (gl.RGBA8 as GLTextureFormat);
    const resolvedDepthFormat = depthFormat ?? (gl.DEPTH24_STENCIL8 as GLTextureFormat);
    const factory = createFramebufferFactory(ctx);

    const msaaTarget = factory.createFramebufferWithDepth(
        width,
        height,
        resolvedColorFormat,
        resolvedDepthFormat,
        samples
    );

    const resolveTarget = factory.createFramebufferWithDepth(
        width,
        height,
        resolvedColorFormat,
        resolvedDepthFormat,
        0
    );

    return { msaaTarget, resolveTarget };
};
