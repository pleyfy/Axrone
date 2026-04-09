import type { ComponentRegistry } from '../component-system/types/core';
import { Scene } from './scene';
import type { SceneOptions } from './types';

export const createScene = <R extends ComponentRegistry = Record<string, never>>(
    options: SceneOptions<R> = {}
): Scene<R> => new Scene(options);
