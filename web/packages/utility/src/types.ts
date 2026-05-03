export type Primitive = undefined | null | boolean | number | string | bigint | symbol;

export type JsonPrimitive = string | number | boolean | null;

export interface JsonObject {
    readonly [key: string]: JsonValue;
}

export interface JsonArray extends ReadonlyArray<JsonValue> {}

export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export type Brand<TValue, TBrand extends PropertyKey> = TValue & { readonly __brand: TBrand };
export type Nominal<TValue, TName extends PropertyKey> = TValue & {
    readonly __nominal: TName;
};

declare const __opaqueBrand: unique symbol;
export type Opaque<TValue, TBrand extends PropertyKey> = TValue & {
    readonly [__opaqueBrand]: TBrand;
};

export type MaybePromise<TValue> = TValue | Promise<TValue>;
export type Constructor<TValue = unknown, TArgs extends any[] = any[]> = new (
    ...args: TArgs
) => TValue;
export type AbstractConstructor<TValue = unknown, TArgs extends any[] = any[]> = abstract new (
    ...args: TArgs
) => TValue;

export type ArrayElement<TValue> = TValue extends readonly (infer TElement)[] ? TElement : never;
export type NonEmptyReadonlyArray<TValue> = readonly [TValue, ...TValue[]];
export type Mutable<TValue> = { -readonly [TKey in keyof TValue]: TValue[TKey] };

export type TypedArray =
    | Int8Array
    | Uint8Array
    | Uint8ClampedArray
    | Int16Array
    | Uint16Array
    | Int32Array
    | Uint32Array
    | Float32Array
    | Float64Array
    | BigInt64Array
    | BigUint64Array;

export type NumericTypedArray = Exclude<TypedArray, BigInt64Array | BigUint64Array>;

export type TypedArrayConstructor =
    | Int8ArrayConstructor
    | Uint8ArrayConstructor
    | Uint8ClampedArrayConstructor
    | Int16ArrayConstructor
    | Uint16ArrayConstructor
    | Int32ArrayConstructor
    | Uint32ArrayConstructor
    | Float32ArrayConstructor
    | Float64ArrayConstructor
    | BigInt64ArrayConstructor
    | BigUint64ArrayConstructor;

export type NumericTypedArrayConstructor = Exclude<
    TypedArrayConstructor,
    BigInt64ArrayConstructor | BigUint64ArrayConstructor
>;

export type ReadonlyTuple2<TValue = number> = readonly [TValue, TValue];
export type ReadonlyTuple3<TValue = number> = readonly [TValue, TValue, TValue];
export type ReadonlyTuple4<TValue = number> = readonly [TValue, TValue, TValue, TValue];

export type Builtin = Primitive | BuiltinObject;

export type BuiltinObject =
    | Object
    | Function
    | Boolean
    | Symbol
    | Error
    | EvalError
    | RangeError
    | ReferenceError
    | SyntaxError
    | TypeError
    | URIError
    | AggregateError
    | Number
    | BigInt
    | Math
    | Date
    | String
    | RegExp
    | Array<any>
    | Map<any, any>
    | Set<any>
    | WeakMap<any, any>
    | WeakSet<any>
    | Promise<any>
    | TypedArray
    | ArrayBuffer
    | SharedArrayBuffer
    | DataView
    | JSON
    | WebAssembly.Module
    | WebAssembly.Instance
    | WebAssembly.Memory
    | WebAssembly.Table
    | WebAssembly.Global
    | WebAssembly.CompileError
    | WebAssembly.LinkError
    | WebAssembly.RuntimeError;

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
    ? T
    : T extends Primitive
      ? T
      : T extends readonly (infer U)[]
        ? readonly DeepReadonly<U>[]
        : T extends Map<infer K, infer V>
          ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
          : T extends Set<infer U>
            ? ReadonlySet<DeepReadonly<U>>
            : T extends Record<string | number | symbol, any>
              ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
              : T;

export type DeepReadonlyPartial<TValue> = TValue extends readonly (infer TElement)[]
    ? readonly DeepReadonlyPartial<TElement>[]
    : TValue extends (...args: never[]) => unknown
      ? TValue
      : TValue extends object
        ? { readonly [TKey in keyof TValue]?: DeepReadonlyPartial<TValue[TKey]> }
        : TValue;

export type DeepMutable<T> = T extends (...args: never[]) => unknown
    ? T
    : T extends Primitive
      ? T
      : T extends readonly (infer U)[]
        ? DeepMutable<U>[]
        : T extends ReadonlyMap<infer K, infer V>
          ? Map<DeepMutable<K>, DeepMutable<V>>
          : T extends ReadonlySet<infer U>
            ? Set<DeepMutable<U>>
            : T extends Record<string | number | symbol, any>
              ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
              : T;
