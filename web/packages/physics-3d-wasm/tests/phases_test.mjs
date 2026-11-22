import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { measurePhases } from "../bench/phases.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = path.join(root, "build", "wasm-release", "physics.wasm");
const pins = JSON.parse(fs.readFileSync(path.join(root, "bench", "results", "policy-10-4-fingerprints.json"), "utf8"));

const pinFor = (count) => pins.cells.find((cell) => cell.count === count);

const result = await measurePhases({ wasmPath, count: 250, warmupSteps: 40, measuredSteps: 120 });

assert.equal(result.ladder.length, 3);
const [rest, velocity, full] = result.ladder;
assert.equal(rest.velocityIterations, 0);
assert.equal(rest.positionIterations, 0);
assert.equal(velocity.positionIterations, 0);
assert.equal(full.velocityIterations, 10);
assert.equal(full.positionIterations, 4);
assert.ok(Number.isFinite(velocity.msPerStep) && Number.isFinite(rest.msPerStep), "the ladder must report finite step times before comparing them");
assert.ok(velocity.msPerStep >= rest.msPerStep, "velocity solve cannot be free");
assert.ok(full.msPerStep >= velocity.msPerStep, "position solve cannot be free");
assert.ok(result.shares.restShare > 0 && result.shares.restShare < 1);
assert.ok(Math.abs(result.shares.restShare + result.shares.velocityShare + result.shares.positionShare - 1) < 0.001);
assert.ok(full.contacts > 0);
assert.notEqual(velocity.fingerprint, full.fingerprint);

assert.equal(result.shares.clamped, false);
assert.equal(result.bounds.contactPopulationMatched, false);
assert.ok(Math.abs(result.bounds.solverShareUpperBound - (result.shares.velocityShare + result.shares.positionShare)) < 1e-9);
assert.ok(Math.abs(result.bounds.collisionShareLowerBound - result.shares.restShare) < 1e-9);

const pin250 = pinFor(250);
assert.equal(full.fingerprint, pin250.fingerprint);
assert.equal(full.contacts, pin250.contacts);

const large = await measurePhases({ wasmPath, count: 1000, warmupSteps: 40, measuredSteps: 120 });
const largeFull = large.ladder[2];
const pin1000 = pinFor(1000);
assert.equal(largeFull.fingerprint, pin1000.fingerprint);
assert.equal(largeFull.contacts, pin1000.contacts);

console.log("phases_test: ok");
