import type { ComponentRegistry } from '@axrone/ecs-runtime';
import type { SceneOptions } from '@axrone/scene-runtime';
import { Scene } from './scene';

export const createScene = <R extends ComponentRegistry = Record<string, never>>(
    options: SceneOptions<R> = {}
): Scene<R> => new Scene(options);