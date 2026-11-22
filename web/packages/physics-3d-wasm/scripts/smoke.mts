import { WasmPhysicsWorld3D } from "../src/index.ts";

const world = await WasmPhysicsWorld3D.create({
    maxBodies: 64,
    maxContacts: 2048,
    gravity: [0, -9.81, 0]
});

const ground = world.createBody({
    type: "static",
    position: [0, -0.5, 0],
    shape: { kind: "box", halfExtents: [10, 0.5, 10] },
    friction: 0.8
});

const sphere = world.createBody({
    position: [0, 2, 0],
    shape: { kind: "sphere", radius: 0.5 }
});

for (let index = 0; index < 180; index += 1) {
    world.step(1 / 60, { velocityIterations: 8, positionIterations: 3 });
}

const transform = world.readTransform(sphere);
if (Math.abs(transform.position[1] - 0.5) > 0.08) {
    throw new Error(`sphere did not settle: ${transform.position[1]}`);
}
if (world.contactCount < 1) {
    throw new Error("expected ground contact");
}

const second = await WasmPhysicsWorld3D.create({
    maxBodies: 64,
    maxContacts: 2048,
    gravity: [0, -9.81, 0]
});
second.createBody({
    type: "static",
    position: [0, -0.5, 0],
    shape: { kind: "box", halfExtents: [10, 0.5, 10] },
    friction: 0.8
});
second.createBody({
    position: [0, 2, 0],
    shape: { kind: "sphere", radius: 0.5 }
});
for (let index = 0; index < 180; index += 1) {
    second.step(1 / 60, { velocityIterations: 8, positionIterations: 3 });
}
if (world.fingerprint() !== second.fingerprint()) {
    throw new Error("fingerprint mismatch");
}

console.log(`bodies=${world.bodyCount} contacts=${world.contactCount} ground=${ground} fingerprint=${world.fingerprint()} memory=${(world.memoryBytes / (1024 * 1024)).toFixed(2)} MB`);
world.dispose();
second.dispose();
