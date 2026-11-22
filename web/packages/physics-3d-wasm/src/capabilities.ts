export interface WasmPhysicsCapabilities {
    readonly backend: "wasm";
    readonly bodyTypes: {
        readonly static: boolean;
        readonly dynamic: boolean;
        readonly kinematic: boolean;
    };
    readonly shapes: {
        readonly sphere: boolean;
        readonly box: boolean;
        readonly capsule: boolean;
        readonly cylinder: boolean;
        readonly cone: boolean;
        readonly convexHull: boolean;
        readonly triangleMesh: boolean;
        readonly heightField: boolean;
    };
    readonly multiShape: boolean;
    readonly shapeOffsets: boolean;
    readonly materials: boolean;
    readonly restitution: boolean;
    readonly sleeping: boolean;
    readonly contactEvents: boolean;
    readonly constraints: boolean;
    readonly queries: boolean;
    readonly raycast: boolean;
    readonly overlapBox: boolean;
    readonly queryPoint: boolean;
    readonly characterController: boolean;
}

export const WASM_PHYSICS_CAPABILITIES: WasmPhysicsCapabilities = Object.freeze({
    backend: "wasm",
    bodyTypes: Object.freeze({
        static: true,
        dynamic: true,
        kinematic: true
    }),
    shapes: Object.freeze({
        sphere: true,
        box: true,
        capsule: true,
        cylinder: true,
        cone: true,
        convexHull: true,
        triangleMesh: true,
        heightField: true
    }),
    multiShape: true,
    shapeOffsets: true,
    materials: true,
    restitution: true,
    sleeping: true,
    contactEvents: true,
    constraints: true,
    queries: true,
    raycast: true,
    overlapBox: true,
    queryPoint: true,
    characterController: true
});
