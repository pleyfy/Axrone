import { getComponentMetadata } from '../component-system/decorators/script';
import type { ComponentConstructor, ComponentRegistry } from '../component-system/types/core';

export const getSceneComponentTypeName = (
    componentType: ComponentConstructor
): string => getComponentMetadata(componentType)?.scriptName ?? componentType.name;

export interface SceneComponentTypeResolver {
    get(name: string): ComponentConstructor | undefined;
    getName(componentType: ComponentConstructor): string;
}

export class SceneComponentCatalog implements SceneComponentTypeResolver {
    private readonly _componentTypes = new Map<string, ComponentConstructor>();

    constructor(registry: ComponentRegistry = {}) {
        this.registerAll(Object.values(registry));
    }

    register<T extends ComponentConstructor>(componentType: T): T {
        this._componentTypes.set(getSceneComponentTypeName(componentType), componentType);
        return componentType;
    }

    registerAll(componentTypes: readonly ComponentConstructor[]): this {
        for (const componentType of componentTypes) {
            this.register(componentType);
        }
        return this;
    }

    get(name: string): ComponentConstructor | undefined {
        return this._componentTypes.get(name);
    }

    getName(componentType: ComponentConstructor): string {
        return getSceneComponentTypeName(componentType);
    }

    has(name: string): boolean {
        return this._componentTypes.has(name);
    }

    names(): readonly string[] {
        return [...this._componentTypes.keys()];
    }
}
