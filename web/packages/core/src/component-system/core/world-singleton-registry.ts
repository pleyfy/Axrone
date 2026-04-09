import type { Entity } from '../types/core';

interface WorldSingletonEntry<T = unknown> {
    readonly entity: Entity;
    readonly instance: T;
}

export class WorldSingletonRegistry {
    private readonly _entries = new Map<string, WorldSingletonEntry>();

    get<T = unknown>(componentName: string): WorldSingletonEntry<T> | undefined {
        return this._entries.get(componentName) as WorldSingletonEntry<T> | undefined;
    }

    getEntity(componentName: string): Entity | undefined {
        return this._entries.get(componentName)?.entity;
    }

    set(componentName: string, entity: Entity, instance: unknown): void {
        this._entries.set(componentName, {
            entity,
            instance,
        });
    }

    clearComponent(componentName: string, entity: Entity): void {
        const cached = this._entries.get(componentName);
        if (cached?.entity === entity) {
            this._entries.delete(componentName);
        }
    }

    clearEntity(entity: Entity, componentNames: Iterable<string>): void {
        for (const componentName of componentNames) {
            this.clearComponent(componentName, entity);
        }
    }

    clear(): void {
        this._entries.clear();
    }
}