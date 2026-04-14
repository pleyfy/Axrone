import type { ComponentType } from '../types/component';
import type { Component } from '../core/component';

export type PropertyTypeId =
    | 'boolean'
    | 'number'
    | 'string'
    | 'vec2'
    | 'vec3'
    | 'entity'
    | 'transform';

export type PropertyTypeReference = PropertyTypeId | string | Function;

export interface PropertyMetadata {
    readonly propertyKey: string;
    readonly label?: string;
    readonly description?: string;
    readonly type?: PropertyTypeReference;
    readonly defaultValue?: unknown;
    readonly serializable?: boolean;
    readonly visible?: boolean;
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
}

export interface PropertyDecoratorOptions extends Omit<PropertyMetadata, 'propertyKey'> {}

let explicitPropertyMetadataMap = new WeakMap<ComponentType, Map<string, PropertyMetadata>>();
let prototypePropertyMetadataMap = new WeakMap<object, Map<string, PropertyMetadata>>();

const normalizePropertyMetadata = (
    propertyKey: string,
    metadata: PropertyDecoratorOptions | PropertyMetadata,
): PropertyMetadata => ({
    propertyKey,
    label: metadata.label,
    description: metadata.description,
    type: metadata.type,
    defaultValue: metadata.defaultValue,
    serializable: metadata.serializable ?? true,
    visible: metadata.visible ?? true,
    min: metadata.min,
    max: metadata.max,
    step: metadata.step,
});

const getOrCreatePrototypeMetadata = (target: object): Map<string, PropertyMetadata> => {
    const existing = prototypePropertyMetadataMap.get(target);
    if (existing) {
        return existing;
    }

    const created = new Map<string, PropertyMetadata>();
    prototypePropertyMetadataMap.set(target, created);
    return created;
};

const getOrCreateExplicitMetadata = (componentType: ComponentType): Map<string, PropertyMetadata> => {
    const existing = explicitPropertyMetadataMap.get(componentType);
    if (existing) {
        return existing;
    }

    const created = new Map<string, PropertyMetadata>();
    explicitPropertyMetadataMap.set(componentType, created);
    return created;
};

const collectPrototypePropertyMetadata = (componentType: ComponentType): Map<string, PropertyMetadata> => {
    const collected = new Map<string, PropertyMetadata>();
    const prototypes: object[] = [];
    let current = componentType.prototype;

    while (current && current !== Object.prototype) {
        prototypes.unshift(current);
        current = Object.getPrototypeOf(current);
    }

    for (const prototype of prototypes) {
        const metadata = prototypePropertyMetadataMap.get(prototype);
        if (!metadata) {
            continue;
        }

        for (const [propertyKey, propertyMetadata] of metadata.entries()) {
            collected.set(propertyKey, propertyMetadata);
        }
    }

    return collected;
};

export function property(
    options: PropertyDecoratorOptions = {},
): (target: object, propertyKey: string | symbol) => void {
    return function propertyDecorator(target: object, propertyKey: string | symbol): void {
        if (typeof propertyKey !== 'string') {
            return;
        }

        const metadata = normalizePropertyMetadata(propertyKey, options);
        const prototypeMetadata = getOrCreatePrototypeMetadata(target);
        prototypeMetadata.set(propertyKey, metadata);

        const componentType = (target as { constructor?: ComponentType }).constructor;
        if (typeof componentType === 'function') {
            const explicitMetadata = getOrCreateExplicitMetadata(componentType);
            explicitMetadata.set(propertyKey, metadata);
        }
    };
}

export function getComponentPropertyMetadata<T extends Component>(
    componentType: ComponentType<T>,
): readonly PropertyMetadata[] {
    const merged = collectPrototypePropertyMetadata(componentType);
    const explicitMetadata = explicitPropertyMetadataMap.get(componentType);

    if (explicitMetadata) {
        for (const [propertyKey, propertyMetadata] of explicitMetadata.entries()) {
            merged.set(propertyKey, propertyMetadata);
        }
    }

    return [...merged.values()];
}

export function getComponentPropertyMetadataByKey<T extends Component>(
    componentType: ComponentType<T>,
    propertyKey: string,
): PropertyMetadata | undefined {
    return getComponentPropertyMetadata(componentType).find(
        (metadata) => metadata.propertyKey === propertyKey,
    );
}

export function setComponentPropertyMetadata<T extends Component>(
    componentType: ComponentType<T>,
    metadata: readonly PropertyMetadata[],
): void {
    const nextMetadata = new Map<string, PropertyMetadata>();

    for (const propertyMetadata of metadata) {
        nextMetadata.set(
            propertyMetadata.propertyKey,
            normalizePropertyMetadata(propertyMetadata.propertyKey, propertyMetadata),
        );
    }

    explicitPropertyMetadataMap.set(componentType, nextMetadata);
}

export function clearComponentPropertyMetadataCaches(): void {
    explicitPropertyMetadataMap = new WeakMap<ComponentType, Map<string, PropertyMetadata>>();
    prototypePropertyMetadataMap = new WeakMap<object, Map<string, PropertyMetadata>>();
}
