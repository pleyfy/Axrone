import type { ComponentRegistry } from '@axrone/ecs-runtime';
import {
    resolveSceneRuntimeComposition,
} from '@axrone/scene-runtime/default-composition';
import { getDefaultSceneRuntimeProfile } from '@axrone/scene-runtime/scene-full-profile';
import type { SceneOptions } from '@axrone/scene-runtime/types';
import { Scene as SceneBase } from './scene';

/**
 * Root 3D scene: full built-in profile plus the full runtime composition
 * (physics bridge factories and the full render batch set). This is the
 * behavior-preserving subclass the root `@axrone/scene-3d` entry has always
 * exported.
 */
export class Scene<R extends ComponentRegistry = Record<string, never>> extends SceneBase<R> {
    constructor(options: SceneOptions<R> = {}) {
        super({
            ...options,
            profile: options.profile ?? getDefaultSceneRuntimeProfile<R>(),
            composition: resolveSceneRuntimeComposition<R>(options.composition),
        });
    }
}
