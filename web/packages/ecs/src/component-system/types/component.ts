import type { Component } from '../core/component';

export type ComponentType<T extends Component = Component> = new (...args: any[]) => T;

export type ComponentMetadata = {
    readonly scriptName: string;
    readonly dependencies?: readonly ComponentType[];
    readonly singleton?: boolean;
    readonly executeInEditMode?: boolean;
    readonly priority?: number;
};

export interface IComponentPool<T> {
    readonly dense: T[];
    readonly sparse: (number | undefined)[];
    readonly entities: import('./core').Entity[];
    size: number;
    capacity: number;
    grow(): void;
    acquire(): T;
    release(item: T): void;
    clear(): void;
}
