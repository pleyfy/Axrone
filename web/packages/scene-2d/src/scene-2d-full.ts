import type { ComponentRegistry } from '@axrone/ecs-runtime';
import {
    resolveSceneRuntimeComposition,
} from '@axrone/scene-runtime/default-composition';
import { get2DSceneRuntimeProfile } from '@axrone/scene-runtime/scene-2d-profile';
import type { SceneOptions } from '@axrone/scene-runtime/types';
import { createScene2DAnimationRuntime } from './scene-2d-animation-runtime';
import { Scene2D as Scene2DBase } from './scene-2d';

/**
 * Root 2D scene: 2D built-in profile, full runtime composition (2D physics
 * bridge and the full render batch set) and the animated/mask actor factories.
 * This is the behavior-preserving subclass the root `@axrone/scene-2d` entry
 * has always exported.
 */
export class Scene2D<R extends ComponentRegistry = Record<string, never>> extends Scene2DBase<R> {
    constructor(options: SceneOptions<R> = {}) {
        super(
            {
                ...options,
                profile: options.profile ?? get2DSceneRuntimeProfile<R>(),
                composition: resolveSceneRuntimeComposition<R>(options.composition),
            },
            { createAnimation: createScene2DAnimationRuntime }
        );
    }
}
