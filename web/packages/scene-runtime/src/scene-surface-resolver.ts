import type { ComponentRegistry } from '@axrone/ecs';
import { SceneCanvasError } from './errors';
import type { SceneOptions } from './types';

export interface ResolvedSceneSurface {
    readonly canvas: HTMLCanvasElement;
    readonly gl: WebGL2RenderingContext;
    readonly autoCreated: boolean;
}

export const resolveSceneSurface = <R extends ComponentRegistry>(
    options: SceneOptions<R>
): ResolvedSceneSurface => {
    let canvas = options.canvas;
    let autoCreated = false;

    if (!canvas) {
        if (options.gl?.canvas instanceof HTMLCanvasElement) {
            canvas = options.gl.canvas;
        } else if (options.createCanvas) {
            canvas = options.createCanvas();
            autoCreated = true;
        } else if (
            typeof document !== 'undefined' &&
            typeof document.createElement === 'function'
        ) {
            canvas = document.createElement('canvas');
            autoCreated = true;
        } else {
            throw new SceneCanvasError('Unable to resolve a canvas for the scene');
        }
    }

    if (!(canvas instanceof HTMLCanvasElement)) {
        throw new SceneCanvasError('Scene canvas must be an HTMLCanvasElement');
    }

    if (options.className) {
        canvas.className = options.className;
    }

    if (autoCreated && options.appendToDom !== false && typeof document !== 'undefined') {
        const parent = options.parent ?? document.body;
        parent?.appendChild(canvas);
    }

    const gl = options.gl ?? canvas.getContext('webgl2', options.contextAttributes);
    if (!gl) {
        throw new SceneCanvasError('Failed to acquire a WebGL2 rendering context');
    }

    return {
        canvas,
        gl,
        autoCreated,
    };
};
