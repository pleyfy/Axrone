export const PHYSICS_NOW_UNIT = "seconds";
export const NANOSECONDS_PER_SECOND = 1000000000;
export const MILLISECONDS_PER_SECOND = 1000;

export const PHYSICS_CLOCK_NAMES = Object.freeze({
    zero: "zero",
    hrtime: "hrtime",
    performance: "performance"
});

export const PHYSICS_CLOCKS = Object.freeze({
    [PHYSICS_CLOCK_NAMES.zero]: () => 0,
    [PHYSICS_CLOCK_NAMES.hrtime]: () => Number(globalThis.process.hrtime.bigint()) / NANOSECONDS_PER_SECOND,
    [PHYSICS_CLOCK_NAMES.performance]: () => globalThis.performance.now() / MILLISECONDS_PER_SECOND
});

export const REQUIRED_PHYSICS_EXPORTS = [
    "memory",
    "worldInit",
    "worldReset",
    "worldSetGravity",
    "worldSetBoxManifoldPointCap",
    "bodyCreate",
    "bodyDestroy",
    "bodySetSphere",
    "bodyAddSphere",
    "bodySetBox",
    "bodySetTransform",
    "bodySetVelocity",
    "bodySetAngularVelocity",
    "bodySetMaterial",
    "bodySetDamping",
    "bodySetGravityScale",
    "bodySetFlags",
    "bodyApplyForce",
    "bodyApplyImpulse",
    "bodyApplyTorque",
    "bodyApplyAngularImpulse",
    "bodySetMassData",
    "step",
    "bodySetAwake",
    "bodyIsSleeping",
    "worldSetAllowSleep",
    "eventsPtr",
    "eventCount",
    "eventsOverflow",
    "eventsClear",
    "shapeCreateSphere",
    "shapeCreateBox",
    "shapeCreateCapsule",
    "shapeCreateCylinder",
    "shapeCreateCone",
    "shapeCreateHull",
    "shapeCreateMesh",
    "shapeCreateHeightField",
    "worldAlloc",
    "worldRelease",
    "shapeSetVertices",
    "shapeSetIndices",
    "shapeSetHeightField",
    "shapeDestroy",
    "shapeClear",
    "shapeGetBody",
    "shapeGetKind",
    "shapeSetMaterial",
    "shapeGetMaterial",
    "shapeSetSensor",
    "shapeIsSensor",
    "shapeSetFilter",
    "shapeGetFilter",
    "bodyCount",
    "contactCount",
    "transformsPtr",
    "velocitiesPtr",
    "angularVelocitiesPtr",
    "contactsPtr",
    "worldFingerprint",
    "worldMemoryBytes",
    "get_transforms_view",
    "get_velocities_view",
    "get_angular_velocities_view",
    "get_contacts_view",
    "raycastAll",
    "raycastClosest",
    "overlapSphere",
    "raycastAllV2",
    "raycastClosestV2",
    "overlapSphereV2",
    "overlapBoxAll",
    "queryPointAll",
    "stepStatisticsView",
    "queryScratchPtr",
    "queryScratchCapacity",
    "constraintCreateFixed",
    "constraintCreateHinge",
    "constraintCreateSlider",
    "constraintCreateSpring",
    "constraintDestroy",
    "constraintSetEnabled",
    "constraintSetHingeMotor",
    "constraintSetHingeLimit",
    "constraintSetSliderMotor",
    "constraintSetSliderLimit",
    "constraintCount",
    "constraintGetKind"
];

export function allowedPhysicsImports(imports, clockName = PHYSICS_CLOCK_NAMES.performance, label = "physics wasm") {
    if (imports.length === 0) {
        return { env: { now: PHYSICS_CLOCKS.zero } };
    }

    const nowOnly = imports.length === 1
        && imports[0].type === "function"
        && imports[0].module === "env"
        && imports[0].name === "now";

    if (!nowOnly) {
        throw new Error(
            `${label}: only env.now is allowed, found `
            + imports.map((entry) => `${entry.type} ${entry.module}.${entry.name}`).join(", ")
        );
    }

    const clock = PHYSICS_CLOCKS[clockName];
    if (clock === undefined) {
        throw new Error(`${label}: unknown physics clock ${String(clockName)}`);
    }

    return { env: { now: clock } };
}
