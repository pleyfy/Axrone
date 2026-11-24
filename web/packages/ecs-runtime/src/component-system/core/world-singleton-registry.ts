import { SingletonRegistry } from '../../support/singleton-registry';
import type { EntityId } from '../types/core';

export class WorldSingletonRegistry extends SingletonRegistry<EntityId> {}