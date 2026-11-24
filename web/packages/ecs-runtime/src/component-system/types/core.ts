import type { Component } from '../core/component';

declare const EntityIdBrand: unique symbol;
declare const ComponentBrand: unique symbol;
declare const SystemBrand: unique symbol;
declare const EntityUidBrand: unique symbol;
declare const ArchetypeBrand: unique symbol;

export type EntityId = number & { readonly [EntityIdBrand]: true };
export type ComponentId<T extends string = string> = T & { readonly [ComponentBrand]: true };
export type SystemId<T extends string = string> = T & { readonly [SystemBrand]: true };
export type EntityUid<T extends string = string> = T & { readonly [EntityUidBrand]: true };
export type ArchetypeId = string & { readonly [ArchetypeBrand]: true };

export type ComponentConstructor<T extends Component = Component> = new (...args: any[]) => T;
export type ComponentInstance<T extends ComponentConstructor> =
    T extends ComponentConstructor<infer U> ? U : never;

export type ComponentRegistry = Record<string, ComponentConstructor>;

export type BitMask = bigint;
export type ComponentMask = Map<string, number>;

export type ArchetypeSignature = readonly string[];

export type EventType = string & { readonly __event: true };
