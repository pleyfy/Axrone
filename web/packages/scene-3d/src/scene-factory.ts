import type { ComponentRegistry } from '../../core/src/component-system/types/core';
import type { SceneOptions } from '../../core/src/scene/types';
import { Scene } from './scene';

export const createScene = <R extends ComponentRegistry = Record<string, never>>(
    options: SceneOptions<R> = {}
): Scene<R> => new Scene(options);