import { ActorRegistry } from '@axrone/ecs-world-support/actor-registry';
import type { Entity } from '../types/core';
import type { Actor } from './actor';

export class WorldActorRegistry extends ActorRegistry<Entity, Actor> {}
