import type { ComponentRegistry } from '@axrone/ecs';
import type { SceneOptions } from '../../scene-runtime/src/types';
import { Scene2D } from './scene-2d';

export const createScene2D = <R extends ComponentRegistry = Record<string, never>>(
    options: SceneOptions<R> = {}
): Scene2D<R> => new Scene2D(options);