export interface SingletonEntry<TEntity extends number = number, T = unknown> {
    readonly entity: TEntity;
    readonly instance: T;
}

export class SingletonRegistry<TEntity extends number = number> {
    private readonly _entries = new Map<string, SingletonEntry<TEntity>>();

    get<T = unknown>(componentName: string): SingletonEntry<TEntity, T> | undefined {
        return this._entries.get(componentName) as SingletonEntry<TEntity, T> | undefined;
    }

    getEntity(componentName: string): TEntity | undefined {
        return this._entries.get(componentName)?.entity;
    }

    set(componentName: string, entity: TEntity, instance: unknown): void {
        this._entries.set(componentName, {
            entity,
            instance,
        });
    }

    clearComponent(componentName: string, entity: TEntity): void {
        const cached = this._entries.get(componentName);
        if (cached?.entity === entity) {
            this._entries.delete(componentName);
        }
    }

    clearEntity(entity: TEntity, componentNames: Iterable<string>): void {
        for (const componentName of componentNames) {
            this.clearComponent(componentName, entity);
        }
    }

    clear(): void {
        if (this._entries.size === 0) {
            return;
        }

        this._entries.clear();
    }
}