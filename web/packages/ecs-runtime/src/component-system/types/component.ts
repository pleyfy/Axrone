import type { Component } from '../core/component';

// Using any[] for construct signature compatibility - type safety enforced at usage sites via ComponentType<T>
export type ComponentType<T extends Component = Component> = new (...args: any[]) => T;

export type ComponentMetadata = {
    readonly scriptName: string;
    readonly dependencies?: readonly ComponentType[];
    readonly singleton?: boolean;
    readonly executeInEditMode?: boolean;
    readonly priority?: number;
    readonly allowMultiple?: boolean;
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
