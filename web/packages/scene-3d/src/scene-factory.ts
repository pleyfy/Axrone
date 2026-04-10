import type { ComponentRegistry } from '@axrone/ecs';
import type { SceneOptions } from '../../scene-runtime/src/types';
import { Scene } from './scene';

export const createScene = <R extends ComponentRegistry = Record<string, never>>(
    options: SceneOptions<R> = {}
): Scene<R> => new Scene(options);