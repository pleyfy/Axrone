import type { ComponentRegistry } from '../component-system/types/core';
import type { SceneOptions } from './types';
import { Scene2D } from './scene-2d';

export const createScene2D = <R extends ComponentRegistry = Record<string, never>>(
    options: SceneOptions<R> = {}
): Scene2D<R> => new Scene2D(options);