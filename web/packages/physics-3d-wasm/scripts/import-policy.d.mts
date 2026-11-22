export interface WasmImportShape {
    readonly type: string;
    readonly module: string;
    readonly name: string;
}

export const PHYSICS_NOW_UNIT: "seconds";
export const NANOSECONDS_PER_SECOND: 1000000000;
export const MILLISECONDS_PER_SECOND: 1000;

export const PHYSICS_CLOCK_NAMES: Readonly<{
    readonly zero: "zero";
    readonly hrtime: "hrtime";
    readonly performance: "performance";
}>;

export const PHYSICS_CLOCKS: Readonly<Record<string, () => number>>;

export const REQUIRED_PHYSICS_EXPORTS: readonly string[];

export function allowedPhysicsImports(
    imports: readonly WasmImportShape[],
    clockName?: string,
    label?: string
): { env: { now: () => number } };
