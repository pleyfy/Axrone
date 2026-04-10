declare const EntityBrand: unique symbol;
declare const ComponentBrand: unique symbol;
declare const SystemBrand: unique symbol;
declare const ActorBrand: unique symbol;
declare const ArchetypeBrand: unique symbol;

export type Entity = number & { readonly [EntityBrand]: true };
export type ComponentId<T extends string = string> = T & { readonly [ComponentBrand]: true };
export type SystemId<T extends string = string> = T & { readonly [SystemBrand]: true };
export type ActorId<T extends string = string> = T & { readonly [ActorBrand]: true };
export type ArchetypeId = string & { readonly [ArchetypeBrand]: true };

export type ComponentConstructor<T = any> = new (...args: any[]) => T;
export type ComponentInstance<T extends ComponentConstructor> =
    T extends ComponentConstructor<infer U> ? U : never;

export type ComponentRegistry = Record<string, ComponentConstructor>;

export type BitMask = bigint;
export type ComponentMask = Map<string, number>;

export type ArchetypeSignature = readonly string[];

export type EventType = string & { readonly __event: true };
