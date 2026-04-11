export type StorageEntity = number;
export type StorageArchetypeId = string;
export type StorageBitMask = bigint;
export type StorageComponentConstructor<T = any> = new (...args: any[]) => T;
export type StorageComponentRegistry = Record<string, StorageComponentConstructor>;
export type StorageComponentMask = Map<string, number>;
export type StorageArchetypeSignature = readonly string[];

export interface StorageComponentPool<T = any, TEntity extends number = number> {
    readonly dense: T[];
    readonly sparse: (number | undefined)[];
    readonly entities: TEntity[];
    size: number;
    capacity: number;
    grow(): void;
    acquire(): T;
    release(item: T): void;
    clear(): void;
}