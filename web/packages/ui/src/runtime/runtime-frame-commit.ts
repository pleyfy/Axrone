import type { FontRegistry } from '../font';
import {
    canvasScaleToTransform,
    type CanvasScaleResult,
    resolveCanvasScale,
} from '../layout/canvas-scaler';
import type { RectLike, SizeLike, UICanvasConfig, UIFrame } from '../types';
import { ensureLayoutUpToDate, type RuntimeLayoutHost } from './runtime-layout';

export interface RuntimeFrameHost<TPayload = unknown, TRuntime = unknown> extends RuntimeLayoutHost<TRuntime> {
    readonly fonts: FontRegistry;
    readonly canvasConfig: UICanvasConfig | null;
    lastViewport: { readonly width: number; readonly height: number } | null;
    setViewport(width: number, height: number): void;
    renderFrame(): UIFrame<TPayload>;
}

export function commitFrame<TPayload, TRuntime>(
    host: RuntimeFrameHost<TPayload, TRuntime>,
    viewport?: Partial<SizeLike>
): UIFrame<TPayload> {
    if (viewport) {
        host.setViewport(viewport.width ?? host.viewportWidth, viewport.height ?? host.viewportHeight);
    }
    ensureLayoutUpToDate<TRuntime>(host);
    host.fonts.tickAtlases();
    return host.renderFrame();
}

export function commitToViewportFrame<TPayload, TRuntime>(
    host: RuntimeFrameHost<TPayload, TRuntime>,
    actualWidth: number,
    actualHeight: number
): UIFrame<TPayload> {
    host.lastViewport = { width: actualWidth, height: actualHeight };
    const canvasConfig = host.canvasConfig;
    if (!canvasConfig) {
        return commitFrame(host, { width: actualWidth, height: actualHeight });
    }
    ensureLayoutUpToDate<TRuntime>(host);
    host.fonts.tickAtlases();
    const frame = host.renderFrame();
    const scaleResult = resolveCanvasScale(canvasConfig, actualWidth, actualHeight);
    const transform = canvasScaleToTransform(scaleResult);
    for (const command of frame.commands) {
        const mutable = command as { clip: RectLike | null; transform?: unknown };
        mutable.clip = command.clip ? scaleClipRect(command.clip, scaleResult) : null;
        if (command.kind === 'quad' || command.kind === 'text' || command.kind === 'image' || command.kind === 'stroke') {
            mutable.transform = transform;
        }
    }
    return {
        viewportWidth: actualWidth,
        viewportHeight: actualHeight,
        commands: frame.commands,
        metrics: frame.metrics,
    };
}

export function scaleClipRect(rect: RectLike, scale: CanvasScaleResult): RectLike {
    return {
        x: rect.x * scale.scaleX + scale.offsetX,
        y: rect.y * scale.scaleY + scale.offsetY,
        width: rect.width * scale.scaleX,
        height: rect.height * scale.scaleY,
    };
}
