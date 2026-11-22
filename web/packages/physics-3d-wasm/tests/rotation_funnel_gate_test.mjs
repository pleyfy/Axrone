import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GATE = path.join(ROOT, "scripts", "rotation-funnel-gate.mjs");

function runGate(srcDir) {
    return spawnSync(process.execPath, [GATE, "--src", srcDir], { encoding: "utf8" });
}

function fixtureTree(name, files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `rotation-funnel-${name}-`));
    const core = path.join(root, "core");
    fs.mkdirSync(core, { recursive: true });
    for (const [file, text] of Object.entries(files)) {
        fs.writeFileSync(path.join(core, file), text, "utf8");
    }
    return root;
}

const BYPASS = [
    "namespace axrone::physics {",
    "struct World {",
    "    Body* bodies;",
    "};",
    "}",
    "void setRotationQuat(axrone::physics::World& world, int32_t id, float qx, float qy, float qz, float qw) {",
    "    Body& body = world.bodies[id];",
    "    body.rotation.fromQuaternion(qx, qy, qz, qw);",
    "}"
].join("\n");

const INDEXED_ASSIGNMENT = [
    "namespace axrone::physics {",
    "void teleport(World& world, int32_t id, const Mat3& matrix) {",
    "    world.bodies[id].rotation = matrix;",
    "}",
    "}"
].join("\n");

const PROXY_WRITE = [
    "namespace axrone::physics {",
    "struct ShapeWorld {",
    "    Mat3 rotation;",
    "};",
    "void fillShapeProxy(const Body& body, ShapeWorld& out) {",
    "    out.rotation = body.rotation;",
    "}",
    "void fillFromShape(const Shape& boxShape, ShapeWorld& anchorSphere) {",
    "    anchorSphere.rotation = boxShape.rotation;",
    "}",
    "void spinWithShape(const Shape* shape, const Mat3& middle) {",
    "    Vec3 offset = shape->offset + shape->rotation.transform(middle);",
    "    void(offset);",
    "}",
    "}"
].join("\n");

const FUNNEL_SHAPED = [
    "namespace axrone::physics {",
    "void refreshBodyRotation(World& world, int32_t id) {",
    "    Body& body = world.bodies[id];",
    "    const Transform& transform = world.transforms[id];",
    "    body.rotation.fromQuaternion(transform.qx, transform.qy, transform.qz, transform.qw);",
    "}",
    "}"
].join("\n");

test("the committed gate passes on the real source tree and counts only the funnel writes", () => {
    const result = runGate(path.join(ROOT, "src"));
    assert.equal(result.status, 0, `the shipped tree must be clean: ${result.stderr}`);
    assert.match(result.stdout, /clean over \d+ source file\(s\); 1 Body rotation write\(s\)/,
        "the gate must report the single funnel write, not a vacuous zero");
});

test("the gate fails on a bypassing setRotation entry that recomputes the same matrix", () => {
    const root = fixtureTree("bypass", { "bypass.cpp": BYPASS });
    const result = runGate(root);
    assert.notEqual(result.status, 0, "a Body rotation write outside the funnel must fail the gate");
    assert.match(result.stderr, /core\/bypass\.cpp:8/, `the violation must point at the write: ${result.stderr}`);
    assert.match(result.stderr, /body\.rotation\.fromQuaternion/, "the violating line must be echoed");
});

test("the gate fails on a whole-matrix assignment through the bodies array", () => {
    const root = fixtureTree("indexed", { "indexed.cpp": INDEXED_ASSIGNMENT });
    const result = runGate(root);
    assert.notEqual(result.status, 0, "bodies[id].rotation = matrix is a fifth door and must fail");
    assert.match(result.stderr, /core\/indexed\.cpp:3/, `the violation must point at the write: ${result.stderr}`);
});

const ARROW_BYPASS = [
    "namespace axrone::physics {",
    "void retag(World& world, int32_t id) {",
    "    Body* first = &world.bodies[id];",
    "    Body* p = first;",
    "    p->rotation = Mat3();",
    "    p->rotation.fromQuaternion(0.0f, 0.0f, 0.0f, 1.0f);",
    "}",
    "}"
].join("\n");

test("the gate fails on a bypass that writes through a Body pointer with the arrow operator", () => {
    const root = fixtureTree("arrow", { "arrow.cpp": ARROW_BYPASS });
    const result = runGate(root);
    assert.notEqual(result.status, 0, "p->rotation = matrix is the same door, reached by a different operator");
    assert.match(result.stderr, /core\/arrow\.cpp:5/, `the whole-matrix arrow write must be reported: ${result.stderr}`);
    assert.match(result.stderr, /core\/arrow\.cpp:6/, "the arrow method write must be reported too");
});

test("the gate does not mistake a shape proxy write for a body write", () => {
    const root = fixtureTree("proxy", { "proxy.cpp": PROXY_WRITE });
    const result = runGate(root);
    assert.equal(result.status, 0, `proxy and copy writes must not be reported: ${result.stderr}`);
    assert.match(result.stdout, /clean over 1 source file\(s\); 0 Body rotation write\(s\)/);
});

test("the gate recognises the funnel's own write as allowed", () => {
    const root = fixtureTree("funnel", { "world.cpp": FUNNEL_SHAPED });
    const result = runGate(root);
    assert.equal(result.status, 0, `a write inside refreshBodyRotation is the sanctioned door: ${result.stderr}`);
    assert.match(result.stdout, /1 Body rotation write/, "the allowed write must be counted, not ignored");
});
