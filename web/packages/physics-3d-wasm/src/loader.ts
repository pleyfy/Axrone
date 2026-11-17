import { WASM_BASE64, WASM_BYTE_LENGTH } from "./generated/wasm";
import {
    PHYSICS_CLOCK_NAMES,
    REQUIRED_PHYSICS_EXPORTS as SHARED_REQUIRED_PHYSICS_EXPORTS,
    allowedPhysicsImports as sharedAllowedPhysicsImports
} from "../scripts/import-policy.mjs";

export interface WasmPhysicsExports {
    readonly memory: WebAssembly.Memory;
    worldInit(maxBodies: number, maxContacts: number, gx: number, gy: number, gz: number): number;
    world_init(maxBodies: number, maxContacts: number, gx: number, gy: number, gz: number): number;
    lib_init(maxBodies: number, maxContacts: number, gx: number, gy: number, gz: number): number;
    worldReset(): void;
    world_reset(): void;
    lib_reset(): void;
    worldSetGravity(gx: number, gy: number, gz: number): number;
    world_set_gravity(gx: number, gy: number, gz: number): number;
    worldSetBoxManifoldPointCap(cap: number): number;
    bodyCreate(type: number, px: number, py: number, pz: number, qx: number, qy: number, qz: number, qw: number): number;
    body_create(type: number, px: number, py: number, pz: number, qx: number, qy: number, qz: number, qw: number): number;
    bodyDestroy(id: number): number;
    body_destroy(id: number): number;
    bodySetSphere(id: number, radius: number, density: number): number;
    body_set_sphere(id: number, radius: number, density: number): number;
    bodyAddSphere(id: number, radius: number, density: number, px: number, py: number, pz: number): number;
    body_add_sphere(id: number, radius: number, density: number, px: number, py: number, pz: number): number;
    bodySetBox(id: number, hx: number, hy: number, hz: number, density: number): number;
    body_set_box(id: number, hx: number, hy: number, hz: number, density: number): number;
    bodySetTransform(id: number, px: number, py: number, pz: number, qx: number, qy: number, qz: number, qw: number): number;
    body_set_transform(id: number, px: number, py: number, pz: number, qx: number, qy: number, qz: number, qw: number): number;
    bodySetVelocity(id: number, vx: number, vy: number, vz: number): number;
    body_set_velocity(id: number, vx: number, vy: number, vz: number): number;
    bodySetAngularVelocity(id: number, vx: number, vy: number, vz: number): number;
    body_set_angular_velocity(id: number, vx: number, vy: number, vz: number): number;
    bodySetMaterial(id: number, friction: number, restitution: number): number;
    body_set_material(id: number, friction: number, restitution: number): number;
    bodySetDamping(id: number, linear: number, angular: number): number;
    body_set_damping(id: number, linear: number, angular: number): number;
    bodySetGravityScale(id: number, scale: number): number;
    body_set_gravity_scale(id: number, scale: number): number;
    bodySetFlags(id: number, setMask: number, clearMask: number): number;
    body_set_flags(id: number, setMask: number, clearMask: number): number;
    bodyApplyForce(id: number, fx: number, fy: number, fz: number, px: number, py: number, pz: number): number;
    body_apply_force(id: number, fx: number, fy: number, fz: number, px: number, py: number, pz: number): number;
    bodyApplyImpulse(id: number, ix: number, iy: number, iz: number, px: number, py: number, pz: number): number;
    body_apply_impulse(id: number, ix: number, iy: number, iz: number, px: number, py: number, pz: number): number;
    bodyApplyTorque(id: number, tx: number, ty: number, tz: number): number;
    body_apply_torque(id: number, tx: number, ty: number, tz: number): number;
    bodyApplyAngularImpulse(id: number, ix: number, iy: number, iz: number): number;
    body_apply_angular_impulse(id: number, ix: number, iy: number, iz: number): number;
    bodySetMassData(id: number, mass: number, ix: number, iy: number, iz: number): number;
    body_set_mass_data(id: number, mass: number, ix: number, iy: number, iz: number): number;
    step(dt: number, velocityIterations: number, positionIterations: number): number;
    bodySetAwake(id: number, awake: number): number;
    body_set_awake(id: number, awake: number): number;
    bodyIsSleeping(id: number): number;
    body_is_sleeping(id: number): number;
    worldSetAllowSleep(on: number): number;
    world_set_allow_sleep(on: number): number;
    eventsPtr(): number;
    eventCount(): number;
    eventsOverflow(): number;
    eventsClear(): void;
    shapeCreateSphere(bodyId: number, radius: number, density: number, cx: number, cy: number, cz: number): number;
    shape_create_sphere(bodyId: number, radius: number, density: number, cx: number, cy: number, cz: number): number;
    shapeCreateBox(
        bodyId: number,
        hx: number,
        hy: number,
        hz: number,
        density: number,
        cx: number,
        cy: number,
        cz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number
    ): number;
    shape_create_box(
        bodyId: number,
        hx: number,
        hy: number,
        hz: number,
        density: number,
        cx: number,
        cy: number,
        cz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number
    ): number;
    shapeCreateCapsule(
        bodyId: number,
        radius: number,
        halfSegment: number,
        density: number,
        cx: number,
        cy: number,
        cz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number
    ): number;
    shape_create_capsule(
        bodyId: number,
        radius: number,
        halfSegment: number,
        density: number,
        cx: number,
        cy: number,
        cz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number
    ): number;
    shapeCreateCylinder(
        bodyId: number,
        radius: number,
        halfHeight: number,
        density: number,
        cx: number,
        cy: number,
        cz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number
    ): number;
    shape_create_cylinder(
        bodyId: number,
        radius: number,
        halfHeight: number,
        density: number,
        cx: number,
        cy: number,
        cz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number
    ): number;
    shapeCreateCone(
        bodyId: number,
        radius: number,
        halfHeight: number,
        density: number,
        cx: number,
        cy: number,
        cz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number
    ): number;
    shape_create_cone(
        bodyId: number,
        radius: number,
        halfHeight: number,
        density: number,
        cx: number,
        cy: number,
        cz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number
    ): number;
    shapeDestroy(shapeId: number): number;
    shape_destroy(shapeId: number): number;
    shapeCreateHull(bodyId: number, density: number, cx: number, cy: number, cz: number): number;
    shape_create_hull(bodyId: number, density: number, cx: number, cy: number, cz: number): number;
    shapeCreateMesh(bodyId: number, density: number, cx: number, cy: number, cz: number): number;
    shape_create_mesh(bodyId: number, density: number, cx: number, cy: number, cz: number): number;
    shapeCreateHeightField(
        bodyId: number,
        density: number,
        cx: number,
        cy: number,
        cz: number,
        width: number,
        depth: number,
        scaleX: number,
        scaleY: number,
        scaleZ: number
    ): number;
    shape_create_height_field(
        bodyId: number,
        density: number,
        cx: number,
        cy: number,
        cz: number,
        width: number,
        depth: number,
        scaleX: number,
        scaleY: number,
        scaleZ: number
    ): number;
    worldAlloc(bytes: number): number;
    world_alloc(bytes: number): number;
    worldRelease(address: number): number;
    world_release(address: number): number;
    shapeSetVertices(shapeId: number, address: number, count: number): number;
    shape_set_vertices(shapeId: number, address: number, count: number): number;
    shapeSetIndices(shapeId: number, address: number, count: number): number;
    shape_set_indices(shapeId: number, address: number, count: number): number;
    shapeSetHeightField(
        shapeId: number,
        address: number,
        width: number,
        depth: number,
        scaleX: number,
        scaleY: number,
        scaleZ: number
    ): number;
    shape_set_height_field(
        shapeId: number,
        address: number,
        width: number,
        depth: number,
        scaleX: number,
        scaleY: number,
        scaleZ: number
    ): number;
    shapeClear(bodyId: number): number;
    shape_clear(bodyId: number): number;
    shapeGetBody(shapeId: number): number;
    shape_get_body(shapeId: number): number;
    shapeGetKind(shapeId: number): number;
    shape_get_kind(shapeId: number): number;
    shapeSetMaterial(shapeId: number, friction: number, restitution: number): number;
    shape_set_material(shapeId: number, friction: number, restitution: number): number;
    shapeGetMaterial(shapeId: number, out2f32: number): number;
    shape_get_material(shapeId: number, out2f32: number): number;
    shapeSetSensor(shapeId: number, on: number): number;
    shape_set_sensor(shapeId: number, on: number): number;
    shapeIsSensor(shapeId: number): number;
    shape_is_sensor(shapeId: number): number;
    shapeSetFilter(shapeId: number, categoryBits: number, maskBits: number, groupIndex: number): number;
    shape_set_filter(shapeId: number, categoryBits: number, maskBits: number, groupIndex: number): number;
    shapeGetFilter(shapeId: number, out3i32: number): number;
    shape_get_filter(shapeId: number, out3i32: number): number;
    bodyCount(): number;
    body_count(): number;
    contactCount(): number;
    contact_count(): number;
    transformsPtr(): number;
    transforms_ptr(): number;
    velocitiesPtr(): number;
    velocities_ptr(): number;
    angularVelocitiesPtr(): number;
    angular_velocities_ptr(): number;
    contactsPtr(): number;
    contacts_ptr(): number;
    worldFingerprint(): bigint;
    world_fingerprint(): bigint;
    worldMemoryBytes(): number;
    world_memory_bytes(): number;
    get_transforms_view(): bigint;
    get_velocities_view(): bigint;
    get_angular_velocities_view(): bigint;
    get_contacts_view(): bigint;
    getTransformsView(): bigint;
    getVelocitiesView(): bigint;
    getAngularVelocitiesView(): bigint;
    getContactsView(): bigint;
    raycastAll(
        ox: number,
        oy: number,
        oz: number,
        dx: number,
        dy: number,
        dz: number,
        maxDistance: number,
        hits: number,
        capacity: number
    ): number;
    raycastClosest(
        ox: number,
        oy: number,
        oz: number,
        dx: number,
        dy: number,
        dz: number,
        maxDistance: number,
        hit: number
    ): number;
    overlapSphere(cx: number, cy: number, cz: number, radius: number, ids: number, capacity: number): number;
    raycastAllV2(
        ox: number,
        oy: number,
        oz: number,
        dx: number,
        dy: number,
        dz: number,
        maxDistance: number,
        categoryBits: number,
        maskBits: number,
        hits: number,
        capacity: number
    ): number;
    raycastClosestV2(
        ox: number,
        oy: number,
        oz: number,
        dx: number,
        dy: number,
        dz: number,
        maxDistance: number,
        categoryBits: number,
        maskBits: number,
        hit: number
    ): number;
    overlapSphereV2(
        cx: number,
        cy: number,
        cz: number,
        radius: number,
        categoryBits: number,
        maskBits: number,
        ids: number,
        capacity: number
    ): number;
    overlapBoxAll(
        outBodyIds: number,
        capacity: number,
        minX: number,
        minY: number,
        minZ: number,
        maxX: number,
        maxY: number,
        maxZ: number
    ): number;
    queryPointAll(outBodyIds: number, capacity: number, x: number, y: number, z: number): number;
    stepStatisticsView(): bigint;
    phaseTimersView?(): bigint;
    phaseTimerSweptNanoseconds?(): bigint;
    phaseTimerCollideNanoseconds?(): bigint;
    phaseTimerClampFired?(): number;
    constraintCreateFixed(
        bodyA: number,
        bodyB: number,
        ax: number,
        ay: number,
        az: number,
        bx: number,
        by: number,
        bz: number,
        collideConnected: number
    ): number;
    constraint_create_fixed(
        bodyA: number,
        bodyB: number,
        ax: number,
        ay: number,
        az: number,
        bx: number,
        by: number,
        bz: number,
        collideConnected: number
    ): number;
    constraintCreateHinge(
        bodyA: number,
        bodyB: number,
        ax: number,
        ay: number,
        az: number,
        bx: number,
        by: number,
        bz: number,
        axisAx: number,
        axisAy: number,
        axisAz: number,
        axisBx: number,
        axisBy: number,
        axisBz: number,
        enableLimit: number,
        lower: number,
        upper: number,
        enableMotor: number,
        motorSpeed: number,
        maxMotorTorque: number,
        collideConnected: number
    ): number;
    constraint_create_hinge(
        bodyA: number,
        bodyB: number,
        ax: number,
        ay: number,
        az: number,
        bx: number,
        by: number,
        bz: number,
        axisAx: number,
        axisAy: number,
        axisAz: number,
        axisBx: number,
        axisBy: number,
        axisBz: number,
        enableLimit: number,
        lower: number,
        upper: number,
        enableMotor: number,
        motorSpeed: number,
        maxMotorTorque: number,
        collideConnected: number
    ): number;
    constraintCreateSlider(
        bodyA: number,
        bodyB: number,
        ax: number,
        ay: number,
        az: number,
        bx: number,
        by: number,
        bz: number,
        axisAx: number,
        axisAy: number,
        axisAz: number,
        enableLimit: number,
        lower: number,
        upper: number,
        enableMotor: number,
        motorSpeed: number,
        maxMotorForce: number,
        collideConnected: number
    ): number;
    constraint_create_slider(
        bodyA: number,
        bodyB: number,
        ax: number,
        ay: number,
        az: number,
        bx: number,
        by: number,
        bz: number,
        axisAx: number,
        axisAy: number,
        axisAz: number,
        enableLimit: number,
        lower: number,
        upper: number,
        enableMotor: number,
        motorSpeed: number,
        maxMotorForce: number,
        collideConnected: number
    ): number;
    constraintCreateSpring(
        bodyA: number,
        bodyB: number,
        ax: number,
        ay: number,
        az: number,
        bx: number,
        by: number,
        bz: number,
        restLength: number,
        stiffness: number,
        damping: number,
        collideConnected: number
    ): number;
    constraint_create_spring(
        bodyA: number,
        bodyB: number,
        ax: number,
        ay: number,
        az: number,
        bx: number,
        by: number,
        bz: number,
        restLength: number,
        stiffness: number,
        damping: number,
        collideConnected: number
    ): number;
    constraintDestroy(id: number): number;
    constraint_destroy(id: number): number;
    constraintSetEnabled(id: number, enabled: number): number;
    constraint_set_enabled(id: number, enabled: number): number;
    constraintSetHingeMotor(id: number, speed: number, maxTorque: number): number;
    constraint_set_hinge_motor(id: number, speed: number, maxTorque: number): number;
    constraintSetHingeLimit(id: number, enable: number, lower: number, upper: number): number;
    constraint_set_hinge_limit(id: number, enable: number, lower: number, upper: number): number;
    constraintSetSliderMotor(id: number, speed: number, maxForce: number): number;
    constraint_set_slider_motor(id: number, speed: number, maxForce: number): number;
    constraintSetSliderLimit(id: number, enable: number, lower: number, upper: number): number;
    constraint_set_slider_limit(id: number, enable: number, lower: number, upper: number): number;
    constraintCount(): number;
    constraint_count(): number;
    constraintGetKind(id: number): number;
    constraint_get_kind(id: number): number;
    queryScratchPtr(): number;
    queryScratchCapacity(): number;
}

export const REQUIRED_PHYSICS_EXPORTS = SHARED_REQUIRED_PHYSICS_EXPORTS;

export function decodeBase64(base64: string): Uint8Array {
    const binary = globalThis.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

async function instantiateModule(module: WebAssembly.Module): Promise<WasmPhysicsExports> {
    const imports = WebAssembly.Module.imports(module).map(toImportDescriptor);
    const instance = await WebAssembly.instantiate(module, allowedPhysicsImports(imports));
    const exports = instance.exports as unknown as Record<string, unknown>;
    for (const name of REQUIRED_PHYSICS_EXPORTS) {
        if (!(name in exports)) {
            throw new Error(`physics wasm is missing export ${name}`);
        }
    }

    return exports as unknown as WasmPhysicsExports;
}

export interface WasmImportDescriptor {
    readonly type: string;
    readonly module: string;
    readonly name: string;
}

function toImportDescriptor(entry: { readonly kind: string; readonly module: string; readonly name: string }): WasmImportDescriptor {
    return { type: entry.kind, module: entry.module, name: entry.name };
}

export function allowedPhysicsImports(imports: readonly WasmImportDescriptor[]): { env: { now: () => number } } {
    return sharedAllowedPhysicsImports(
        imports,
        PHYSICS_CLOCK_NAMES.performance,
        "physics wasm may declare zero imports or exactly env.now"
    );
}

export async function instantiateWasm(bytes: Uint8Array): Promise<WasmPhysicsExports> {
    const module = await WebAssembly.compile(bytes);
    return instantiateModule(module);
}

let embeddedModulePromise: Promise<WebAssembly.Module> | null = null;

export async function loadEmbeddedWasm(): Promise<WasmPhysicsExports> {
    if (embeddedModulePromise === null) {
        const bytes = decodeBase64(WASM_BASE64);
        if (bytes.byteLength !== WASM_BYTE_LENGTH) {
            throw new Error(`physics wasm length mismatch: ${bytes.byteLength} !== ${WASM_BYTE_LENGTH}`);
        }
        embeddedModulePromise = WebAssembly.compile(bytes);
    }

    return instantiateModule(await embeddedModulePromise);
}
