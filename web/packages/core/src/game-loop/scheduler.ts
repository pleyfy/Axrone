import type { GameLoopScheduler } from './types';

export interface AnimationFrameSchedulerOptions {
    readonly fallbackFps?: number;
    readonly now?: () => number;
}

const DEFAULT_FALLBACK_FPS = 60;
const DEFAULT_FRAME_DURATION = 1000 / DEFAULT_FALLBACK_FPS;

const resolveNow = (options: AnimationFrameSchedulerOptions): (() => number) => {
    if (options.now !== undefined) {
        return options.now;
    }

    if (
        typeof globalThis.performance !== 'undefined' &&
        typeof globalThis.performance.now === 'function'
    ) {
        return () => globalThis.performance.now();
    }

    return () => Date.now();
};

export const isGameLoopScheduler = (value: unknown): value is GameLoopScheduler => {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    return (
        typeof Reflect.get(value, 'kind') === 'string' &&
        typeof Reflect.get(value, 'now') === 'function' &&
        typeof Reflect.get(value, 'request') === 'function' &&
        typeof Reflect.get(value, 'cancel') === 'function'
    );
};

export const createAnimationFrameScheduler = (
    options: AnimationFrameSchedulerOptions = {}
): GameLoopScheduler<number> => {
    const now = resolveNow(options);
    const fallbackFrameDuration =
        typeof options.fallbackFps === 'number' &&
        Number.isFinite(options.fallbackFps) &&
        options.fallbackFps > 0
            ? 1000 / options.fallbackFps
            : DEFAULT_FRAME_DURATION;

    if (
        typeof globalThis.requestAnimationFrame === 'function' &&
        typeof globalThis.cancelAnimationFrame === 'function'
    ) {
        return {
            kind: 'animation-frame',
            now,
            request: (callback) => globalThis.requestAnimationFrame(callback),
            cancel: (handle) => globalThis.cancelAnimationFrame(handle),
        };
    }

    return {
        kind: 'timeout',
        now,
        request: (callback) =>
            Number(globalThis.setTimeout(() => callback(now()), fallbackFrameDuration)),
        cancel: (handle) => globalThis.clearTimeout(handle),
    };
};
