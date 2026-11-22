import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Transform } from '@axrone/ecs-runtime';
import { getDefaultSceneRuntimeComposition } from '@axrone/scene-runtime/default-composition';
import {
    createSceneRuntimeProfile,
    type SceneRuntimePhysicsBridge,
} from '@axrone/scene-runtime';
import { SceneRuntimeKernel } from '@axrone/scene-runtime/scene-facade';
import {
    createSceneOptions,
    installWebGL2Constants,
    ManualScheduler,
} from '../../../../tests/shared/test-harness';

const createKernel = (optionsOverride: Record<string, unknown> = {}) => {
    const canvas = document.createElement('canvas');
    return new SceneRuntimeKernel({
        sceneId: 'composition-test',
        options: {
            ...createSceneOptions(new ManualScheduler(), canvas),
            ...optionsOverride,
        },
    });
};

describe('SceneRuntimeKernel composition', () => {
    beforeAll(() => {
        installWebGL2Constants();
    });

    it('falls back to the core registry and no bridges without a composition', () => {
        const kernel = createKernel();

        try {
            expect(kernel.actors.getRegisteredComponentNames()).toEqual(
                expect.arrayContaining(['Hierarchy', 'Transform', 'PrefabNodeBinding'])
            );
            expect(kernel.actors.getRegisteredComponentNames()).not.toContain('Camera');
            expect(kernel.physicsBridge3D).toBeNull();
            expect(kernel.physicsBridge2D).toBeNull();
        } finally {
            kernel.lifecycle.dispose();
        }
    });

    it('uses the injected default profile when no profile is supplied', () => {
        const profile = createSceneRuntimeProfile({
            id: 'test/transform-only',
            resolveRegistry: ({ registry }) => ({
                Transform,
                ...(registry ?? {}),
            }) as any,
        });
        const kernel = createKernel({
            composition: { defaultProfile: profile },
        });

        try {
            expect(kernel.actors.getRegisteredComponentNames()).toEqual(['Transform']);
        } finally {
            kernel.lifecycle.dispose();
        }
    });

    it('creates, drives and disposes the injected physics bridges', () => {
        const dispose = vi.fn();
        const beforeUpdate = vi.fn();
        const fixedUpdate = vi.fn();
        const bridge: SceneRuntimePhysicsBridge = {
            id: 'test.physics',
            physicsWorld: { getProfiler: () => null },
            beforeUpdate,
            fixedUpdate,
            dispose,
        };
        const createPhysicsBridges = vi.fn(() => ({
            bridge3D: bridge,
            bridge2D: null,
        }));

        const kernel = createKernel({
            composition: { createPhysicsBridges },
        });

        try {
            expect(createPhysicsBridges).toHaveBeenCalledTimes(1);
            expect(kernel.physicsBridge3D).toBe(bridge);
            expect(kernel.physicsBridge2D).toBeNull();
        } finally {
            kernel.lifecycle.dispose();
        }

        expect(dispose).toHaveBeenCalledTimes(1);
    });

    it('keeps the default composition on the full registry and physics selection', () => {
        const kernel = createKernel({
            composition: getDefaultSceneRuntimeComposition(),
        });

        try {
            const names = kernel.actors.getRegisteredComponentNames();
            expect(names).toEqual(
                expect.arrayContaining([
                    'Hierarchy',
                    'Transform',
                    'PrefabNodeBinding',
                    'Camera',
                    'MeshRenderer',
                    'Terrain',
                    'Animator',
                    'UIHost',
                ])
            );
            expect(names).not.toContain('SpriteRenderer');
            expect(kernel.physicsBridge3D).not.toBeNull();
            expect(kernel.physicsBridge2D).toBeNull();
        } finally {
            kernel.lifecycle.dispose();
        }
    });

    it('forwards the injected render batch factory to the render runtime', () => {
        const createRenderBatchRuntimes = vi.fn(() => ({}));

        const kernel = createKernel({
            composition: { createRenderBatchRuntimes },
        });

        try {
            expect(createRenderBatchRuntimes).toHaveBeenCalledTimes(1);
            expect(createRenderBatchRuntimes).toHaveBeenCalledWith(
                expect.objectContaining({
                    gl: expect.anything(),
                    resources: expect.anything(),
                })
            );
        } finally {
            kernel.lifecycle.dispose();
        }
    });
});
