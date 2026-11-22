import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const distPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.mjs");
const { WasmPhysicsWorld3D, WasmPhysicsWorld3DCompat, WASM_PHYSICS_CAPABILITIES } = await import(pathToFileURL(distPath).href);

const STEP_OPTIONS = { velocityIterations: 10, positionIterations: 4 };

async function createWorld() {
    return WasmPhysicsWorld3D.create({ maxBodies: 64, maxContacts: 2048, gravity: [0, -9.81, 0] });
}

function buildStack(world) {
    world.createBody({
        type: "static",
        position: [0, -0.5, 0],
        shape: { kind: "box", halfExtents: [10, 0.5, 10] },
        friction: 0.8
    });
    return [0.5, 1.5, 2.5].map((y) => world.createBody({
        position: [0, y + 1.5, 0],
        shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] },
        friction: 0.8
    }));
}

function runStack(world, steps) {
    buildStack(world);
    for (let index = 0; index < steps; index += 1) {
        world.step(1 / 60, STEP_OPTIONS);
    }
}

const world = await createWorld();
const bodies = buildStack(world);
for (let index = 0; index < 480; index += 1) {
    world.step(1 / 60, STEP_OPTIONS);
}

const positions = bodies.map((id) => world.readTransform(id).position[1]);
for (let level = 0; level < positions.length; level += 1) {
    const expected = 0.5 + level;
    const error = Math.abs(positions[level] - expected);
    if (!(error <= 0.05)) {
        throw new Error(`stack level ${level} settled at ${positions[level]}, expected ${expected} within 0.05`);
    }
    if (level > 0) {
        const spacing = positions[level] - positions[level - 1];
        if (!(spacing >= 0.95 && spacing <= 1)) {
            throw new Error(`stack gap ${level - 1}->${level} is ${spacing}, expected within [0.95, 1]`);
        }
    }
}
if (world.contactCount < 3) {
    throw new Error(`expected at least 3 contacts, got ${world.contactCount}`);
}

const dropped = world.createBody({
    position: [4, 6, 0],
    shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] }
});
let sawBegin = 0;
let sawStay = 0;
for (let index = 0; index < 180; index += 1) {
    world.step(1 / 60, STEP_OPTIONS);
    for (const event of world.drainEvents()) {
        if (event.kind === "begin") {
            sawBegin += 1;
        } else if (event.kind === "stay") {
            sawStay += 1;
        }
        if (event.bodyA !== dropped && event.bodyB !== dropped) {
            continue;
        }
        if (!(Math.abs(event.normal[1]) > 0.5)) {
            throw new Error(`dropped body contact normal is not vertical: ${JSON.stringify(event.normal)}`);
        }
    }
}
if (sawBegin < 1) {
    throw new Error("no begin event was emitted for the dropped body");
}
const droppedY = world.readTransform(dropped).position[1];
if (!(Math.abs(droppedY - 0.5) <= 0.05)) {
    throw new Error(`dropped body did not rest on the ground: y=${droppedY}`);
}

const ray = world.raycastClosest([0, 10, 0], [0, -1, 0], 20);
if (ray === null) {
    throw new Error("downward ray missed the settled stack");
}
if (!(ray.point[1] > 2.4 && ray.point[1] < 3.6)) {
    throw new Error(`ray hit point y=${ray.point[1]} is not on the top box`);
}
if (!(ray.distance > 0 && ray.distance < 20)) {
    throw new Error(`ray distance out of range: ${ray.distance}`);
}

const fractionRay = world.raycastClosestV2([0, 10, 0], [0, -20, 0], 20);
if (fractionRay === null) {
    throw new Error("fraction convention ray missed the settled stack");
}
if (!(fractionRay.fraction > 0 && fractionRay.fraction < 1)) {
    throw new Error(`fraction ray out of range: ${fractionRay.fraction}`);
}
if (!(Math.abs(fractionRay.point[1] - ray.point[1]) <= 1e-3)) {
    throw new Error(`fraction ray hit point ${fractionRay.point[1]} differs from distance ray ${ray.point[1]}`);
}
if (!(Math.abs(fractionRay.fraction * 20 - ray.distance) <= 1e-3)) {
    throw new Error(`fraction and distance disagree: ${fractionRay.fraction} * 20 vs ${ray.distance}`);
}

const overlapped = world.overlapSphere([0, 1.5, 0], 2, 64);
if (overlapped.length < 3) {
    throw new Error(`overlapSphere found ${overlapped.length} bodies, expected at least 3`);
}

world.setAllowSleep(true);
for (let index = 0; index < 900; index += 1) {
    world.step(1 / 60, STEP_OPTIONS);
    world.drainEvents();
}
const sleeping = bodies.filter((id) => world.isSleeping(id)).length;
if (sleeping < 1) {
    throw new Error("no settled stack body slept after 900 quiet steps");
}

const statistics = world.getStepStatistics();
for (const [name, value] of Object.entries(statistics)) {
    if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) {
        throw new Error(`step statistic ${name} is invalid: ${value}`);
    }
}

const fingerprint = world.fingerprint();
world.dispose();

const left = await createWorld();
runStack(left, 480);
const leftFingerprint = left.fingerprint();
const sphereBody = left.createBody({ position: [0, 3, 0], shape: { kind: "sphere", radius: 0.5 } });
const compound = left.createBody({ position: [6, 3, 0], shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] } });
left.addBox(compound, [0.25, 0.25, 0.25], 1, [0.5, 0, 0]);
left.step(1 / 60, STEP_OPTIONS);
left.dispose();

const right = await createWorld();
runStack(right, 480);
const rightFingerprint = right.fingerprint();
right.dispose();
if (leftFingerprint !== rightFingerprint) {
    throw new Error(`dist determinism failed: ${leftFingerprint} !== ${rightFingerprint}`);
}

if (WASM_PHYSICS_CAPABILITIES.shapes.box !== true) {
    throw new Error("capabilities must report box support");
}
if (typeof WasmPhysicsWorld3DCompat !== "function") {
    throw new Error("compat adapter is missing from the published bundle");
}

console.log(`dist smoke PASS fingerprint=${fingerprint} stack=${positions.map((value) => value.toFixed(4)).join(",")} begin=${sawBegin} stay=${sawStay} ray=${fractionRay.fraction.toFixed(4)}/${ray.distance.toFixed(4)}@${ray.point[1].toFixed(4)} overlap=${overlapped.length} sleeping=${sleeping}/3 statistics=${Object.keys(statistics).length} determinism=${leftFingerprint}`);
