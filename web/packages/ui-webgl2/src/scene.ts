import type { GameLoopSystem } from '@axrone/core';
import { renderUIFrame } from '@axrone/ui';
import { WebGL2UIRenderer } from './renderer';
import type { SceneUIOverlayHandle, SceneUIOverlayOptions, SceneUIOverlayTarget } from './types';

let nextSceneOverlayId = 1;

const createOverlaySystemId = (): string => `axrone.ui.overlay:${nextSceneOverlayId++}`;

const resolveViewport = (scene: SceneUIOverlayTarget) => ({
    width: Math.max(1, scene.canvas.width || scene.gl.drawingBufferWidth || 1),
    height: Math.max(1, scene.canvas.height || scene.gl.drawingBufferHeight || 1),
});

export const attachUIOverlayToScene = <TPayload = unknown>(
    scene: SceneUIOverlayTarget,
    options: SceneUIOverlayOptions<TPayload>
): SceneUIOverlayHandle<TPayload> => {
    const systemId = options.systemId ?? createOverlaySystemId();
    const renderer = new WebGL2UIRenderer<TPayload>({
        ...options.renderer,
        gl: scene.gl,
    });
    let disposed = false;

    const render = (): ReturnType<SceneUIOverlayHandle<TPayload>['render']> => {
        if (disposed) {
            return null;
        }
        return renderUIFrame(renderer, options.ui, resolveViewport(scene));
    };

    const system: GameLoopSystem<{ readonly sceneId: string }> = {
        id: systemId,
        priority: options.priority ?? -1000,
        enabled: true,
        afterFrame() {
            render();
        },
    };

    scene.loop.addSystem(system);

    return {
        scene,
        systemId,
        renderer,
        render,
        dispose() {
            if (disposed) {
                return;
            }
            disposed = true;
            scene.loop.removeSystem(systemId);
            renderer.dispose();
        },
        [Symbol.dispose]() {
            if (disposed) {
                return;
            }
            disposed = true;
            scene.loop.removeSystem(systemId);
            renderer.dispose();
        },
    };
};

export type { SceneUIOverlayHandle, SceneUIOverlayOptions, SceneUIOverlayTarget };