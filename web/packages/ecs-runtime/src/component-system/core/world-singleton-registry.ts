import { SingletonRegistry } from '@axrone/ecs-world-support/singleton-registry';
import type { Entity } from '../types/core';

export class WorldSingletonRegistry extends SingletonRegistry<Entity> {}