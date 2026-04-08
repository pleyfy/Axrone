import type { GameLoopSystem } from '@axrone/core';
import { renderUIFrame } from '@axrone/ui';
import { WebGL2UIRenderer } from './renderer';
import type {
    SceneUIOverlayHandle,
    SceneUIOverlayOptions,
    SceneUIOverlayTarget,
    SceneUIResourceResolverOptions,
    SceneUIResourceResolverTarget,
    WebGL2UIResolveImageResourceContext,
    WebGL2UIResolvedImageResource,
} from './types';
import type { UIImageSource } from '@axrone/ui';

let nextSceneOverlayId = 1;

const createOverlaySystemId = (): string => `axrone.ui.overlay:${nextSceneOverlayId++}`;

const resolveViewport = (scene: SceneUIOverlayTarget) => ({
    width: Math.max(1, scene.canvas.width || scene.gl.drawingBufferWidth || 1),
    height: Math.max(1, scene.canvas.height || scene.gl.drawingBufferHeight || 1),
});

const isSceneUIResourceResolverTarget = (
    value: SceneUIOverlayTarget
): value is SceneUIOverlayTarget & SceneUIResourceResolverTarget =>
    typeof value.getTextureResource === 'function' && typeof value.getMaterialTextureBinding === 'function';

export const createSceneUIResourceResolver = <TPayload = unknown>(
    scene: SceneUIResourceResolverTarget,
    options: SceneUIResourceResolverOptions<TPayload> = {}
) => {
    return (
        source: UIImageSource,
        context: WebGL2UIResolveImageResourceContext<TPayload>
    ): WebGL2UIResolvedImageResource<TPayload> | null => {
        if (source.kind === 'texture') {
            const texture = scene.getTextureResource(source.resourceId);
            if (!texture) {
                return null;
            }
            return {
                kind: 'texture',
                texture: texture.nativeTexture,
                sampler: texture.nativeSampler,
            };
        }

        const binding = scene.getMaterialTextureBinding(
            source.materialId,
            source.textureBinding ?? options.materialTextureBinding
        );
        if (binding) {
            return {
                kind: 'texture',
                texture: binding.nativeTexture,
                sampler: binding.nativeSampler,
            };
        }

        return options.resolveMaterial?.(source, {
            scene,
            binding,
            context,
        }) ?? null;
    };
};

export const attachUIOverlayToScene = <TPayload = unknown>(
    scene: SceneUIOverlayTarget,
    options: SceneUIOverlayOptions<TPayload>
): SceneUIOverlayHandle<TPayload> => {
    const systemId = options.systemId ?? createOverlaySystemId();
    const resolveImageResource =
        options.renderer?.resolveImageResource ??
        (isSceneUIResourceResolverTarget(scene)
            ? createSceneUIResourceResolver(scene, options.resources)
            : undefined);
    const renderer = new WebGL2UIRenderer<TPayload>({
        ...options.renderer,
        resolveImageResource,
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

export type {
    SceneUIOverlayHandle,
    SceneUIOverlayOptions,
    SceneUIOverlayTarget,
    SceneUIResourceResolverOptions,
    SceneUIResourceResolverTarget,
};