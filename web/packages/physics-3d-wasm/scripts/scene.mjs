import fs from "node:fs";
import { PHYSICS_CLOCK_NAMES, REQUIRED_PHYSICS_EXPORTS, allowedPhysicsImports as sharedAllowedPhysicsImports } from "./import-policy.mjs";
import { PHYSICS_ITERATION_POLICY } from "./policy.mjs";

export const STANDARD_BOX_COUNT = 256;
export const STANDARD_STEPS = 240;
export const STANDARD_DT = 1 / 60;
export const STANDARD_MAX_BODIES = 512;
export const STANDARD_MAX_CONTACTS = 16384;

export { REQUIRED_PHYSICS_EXPORTS };

export function allowedPhysicsImports(imports, filePath = "physics.wasm") {
    return sharedAllowedPhysicsImports(imports, PHYSICS_CLOCK_NAMES.hrtime, filePath);
}

function toImportDescriptors(imports) {
    return imports.map((entry) => ({ type: entry.kind, module: entry.module, name: entry.name }));
}

export async function loadWasm(filePath) {
    const bytes = fs.readFileSync(filePath);
    const module = await WebAssembly.compile(bytes);
    const imports = toImportDescriptors(WebAssembly.Module.imports(module));
    const instance = await WebAssembly.instantiate(module, allowedPhysicsImports(imports, filePath));
    const exports = instance.exports;
    for (const name of REQUIRED_PHYSICS_EXPORTS) {
        if (!(name in exports)) {
            throw new Error(`${filePath}: missing export ${name}`);
        }
    }
    return { exports, byteLength: bytes.byteLength, imports };
}

export function addStandardScene(exports) {
    if (exports.worldInit(STANDARD_MAX_BODIES, STANDARD_MAX_CONTACTS, 0, -9.81, 0) !== 0) {
        throw new Error("worldInit failed");
    }

    const ground = exports.bodyCreate(0, 0, -0.5, 0, 0, 0, 0, 1);
    if (ground < 0) {
        throw new Error("ground create failed");
    }
    if (exports.bodySetBox(ground, 20, 0.5, 20, 0) !== 0) {
        throw new Error("ground shape failed");
    }
    exports.bodySetMaterial(ground, 0.8, 0);

    for (let i = 0; i < STANDARD_BOX_COUNT; i += 1) {
        const layer = Math.floor(i / 64);
        const within = i % 64;
        const xIndex = within % 8;
        const zIndex = Math.floor(within / 8);
        const x = xIndex - 3;
        const y = 1 + layer;
        const z = zIndex - 3;

        const id = exports.bodyCreate(1, x, y, z, 0, 0, 0, 1);
        if (id < 0) {
            throw new Error(`box ${i} create failed`);
        }
        if (exports.bodySetBox(id, 0.4, 0.4, 0.4, 1) !== 0) {
            throw new Error(`box ${i} shape failed`);
        }
        exports.bodySetMaterial(id, 0.7, 0);
    }
}

export function addBoxPileScene(exports, count) {
    const maxContacts = Math.max(1024, count * 24);
    if (exports.worldInit(count + 1, maxContacts, 0, -9.81, 0) !== 0) {
        throw new Error(`worldInit failed for ${count} bodies`);
    }

    const side = Math.ceil(Math.cbrt(count));
    const ground = exports.bodyCreate(0, 0, -0.5, 0, 0, 0, 0, 1);
    if (ground < 0) {
        throw new Error("ground create failed");
    }
    if (exports.bodySetBox(ground, 40, 0.5, 40, 0) !== 0) {
        throw new Error("ground shape failed");
    }
    exports.bodySetMaterial(ground, 0.8, 0);

    const offset = (side - 1) / 2;
    for (let i = 0; i < count; i += 1) {
        const xIndex = i % side;
        const zIndex = Math.floor(i / side) % side;
        const layer = Math.floor(i / (side * side));
        const x = xIndex - offset;
        const y = 1 + layer;
        const z = zIndex - offset;

        const id = exports.bodyCreate(1, x, y, z, 0, 0, 0, 1);
        if (id < 0) {
            throw new Error(`body ${i} creation failed`);
        }
        if (exports.bodySetBox(id, 0.4, 0.4, 0.4, 1) !== 0) {
            throw new Error(`body ${i} shape failed`);
        }
        exports.bodySetMaterial(id, 0.7, 0);
    }
}

export const BENCH_SPHERE_RADIUS = 0.4;
export const BENCH_CAPSULE_RADIUS = 0.4;
export const BENCH_CAPSULE_HALF_SEGMENT = 0.4;
export const BENCH_SPHERE_SPACING = 0.90;
export const BENCH_SPHERE_LAYER_PITCH = 0.86;
export const BENCH_SPHERE_DROP = 1.0;
export const BENCH_CAPSULE_SPACING = 1.0;
export const BENCH_CAPSULE_LAYER_PITCH = 1.7;
export const BENCH_CAPSULE_DROP = 1.0;

export function addSpherePileScene(exports, count) {
    const maxContacts = Math.max(1024, count * 24);
    if (exports.worldInit(count + 1, maxContacts, 0, -9.81, 0) !== 0) {
        throw new Error(`worldInit failed for ${count} spheres`);
    }

    const ground = exports.bodyCreate(0, 0, -0.5, 0, 0, 0, 0, 1);
    if (exports.bodySetBox(ground, 40, 0.5, 40, 0) !== 0) {
        throw new Error("ground shape failed");
    }
    exports.bodySetMaterial(ground, 0.8, 0);

    const side = Math.ceil(Math.cbrt(count));
    const offset = (side - 1) / 2;
    for (let index = 0; index < count; index += 1) {
        const column = index % side;
        const depth = Math.floor(index / side) % side;
        const layer = Math.floor(index / (side * side));
        const shift = layer % 2 === 1 ? BENCH_SPHERE_SPACING * 0.5 : 0;
        const id = exports.bodyCreate(1,
            (column - offset) * BENCH_SPHERE_SPACING + shift,
            BENCH_SPHERE_RADIUS + BENCH_SPHERE_DROP + layer * BENCH_SPHERE_LAYER_PITCH,
            (depth - offset) * BENCH_SPHERE_SPACING + shift,
            0, 0, 0, 1);
        if (id < 0) {
            throw new Error(`sphere ${index} creation failed`);
        }
        if (exports.bodySetSphere(id, BENCH_SPHERE_RADIUS, 1) !== 0) {
            throw new Error(`sphere ${index} shape failed`);
        }
        exports.bodySetMaterial(id, 0.7, 0);
    }
}

export function addCapsulePileScene(exports, count) {
    const maxContacts = Math.max(1024, count * 24);
    if (exports.worldInit(count + 1, maxContacts, 0, -9.81, 0) !== 0) {
        throw new Error(`worldInit failed for ${count} capsules`);
    }

    const ground = exports.bodyCreate(0, 0, -0.5, 0, 0, 0, 0, 1);
    if (exports.bodySetBox(ground, 40, 0.5, 40, 0) !== 0) {
        throw new Error("ground shape failed");
    }
    exports.bodySetMaterial(ground, 0.8, 0);

    const side = Math.ceil(Math.cbrt(count));
    const offset = (side - 1) / 2;
    const halfHeight = BENCH_CAPSULE_RADIUS + BENCH_CAPSULE_HALF_SEGMENT;
    for (let index = 0; index < count; index += 1) {
        const column = index % side;
        const depth = Math.floor(index / side) % side;
        const layer = Math.floor(index / (side * side));
        const shift = layer % 2 === 1 ? BENCH_CAPSULE_SPACING * 0.5 : 0;
        const id = exports.bodyCreate(1,
            (column - offset) * BENCH_CAPSULE_SPACING + shift,
            halfHeight + BENCH_CAPSULE_DROP + layer * BENCH_CAPSULE_LAYER_PITCH,
            (depth - offset) * BENCH_CAPSULE_SPACING + shift,
            0, 0, 0, 1);
        if (id < 0) {
            throw new Error(`capsule ${index} creation failed`);
        }
        if (exports.shapeCreateCapsule(id, BENCH_CAPSULE_RADIUS, BENCH_CAPSULE_HALF_SEGMENT, 1,
            0, 0, 0, 0, 0, 0, 1) < 0) {
            throw new Error(`capsule ${index} shape failed`);
        }
        exports.bodySetMaterial(id, 0.7, 0);
    }
}

function mulberry32(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const HINGE_CHAIN_LINKS = 8;
export const HINGE_CHAIN_SEED = 0x5a5afe;

export function addHingeChainScene(exports, count, seed = HINGE_CHAIN_SEED) {
    const linkSpacing = 1.05;
    const anchorY = 10;
    const horizontalSpacing = 6;
    const tiltMagnitude = 0.3;
    const chainCount = Math.max(1, Math.ceil(count / HINGE_CHAIN_LINKS));
    const columns = Math.max(1, Math.ceil(Math.sqrt(chainCount)));
    const totalBodies = count + chainCount + 1;
    const maxContacts = Math.max(1024, totalBodies * 16);

    if (exports.worldInit(totalBodies, maxContacts, 0, -9.81, 0) !== 0) {
        throw new Error(`worldInit failed for ${count} jointed bodies`);
    }

    const random = mulberry32(seed);
    const links = [];
    const anchors = [];
    const chains = [];

    for (let chain = 0; chain < chainCount; chain += 1) {
        const layer = Math.floor(chain / columns);
        const column = chain % columns;
        const anchorX = (column - (columns - 1) * 0.5) * horizontalSpacing;
        const anchorZ = (layer - (columns - 1) * 0.5) * horizontalSpacing;
        const tilt = (random() - 0.5) * 2 * tiltMagnitude;
        const axisX = Math.sin(tilt);
        const axisY = -Math.cos(tilt);
        const qz = Math.sin(tilt * 0.5);
        const qw = Math.cos(tilt * 0.5);
        const chainLinks = [];

        for (let link = 0; link < HINGE_CHAIN_LINKS && links.length < count; link += 1) {
            const distance = (link + 0.5) * linkSpacing;
            const id = exports.bodyCreate(1, anchorX + axisX * distance, anchorY + axisY * distance, anchorZ, 0, 0, qz, qw);
            if (id < 0) {
                throw new Error(`jointed body ${links.length} creation failed`);
            }
            if (exports.bodySetBox(id, 0.5, 0.5, 0.5, 1) !== 0) {
                throw new Error(`jointed body ${links.length} shape failed`);
            }
            exports.bodySetMaterial(id, 0.7, 0);
            chainLinks.push(id);
            links.push(id);
        }

        if (chainLinks.length === 0) {
            break;
        }
        chains.push(chainLinks);
    }

    const groundHalf = Math.max(10, (columns - 1) * horizontalSpacing * 0.5 + 5 + HINGE_CHAIN_LINKS * linkSpacing);
    const ground = exports.bodyCreate(0, 0, -0.5, 0, 0, 0, 0, 1);
    if (ground < 0) {
        throw new Error("ground create failed");
    }
    if (exports.bodySetBox(ground, groundHalf, 0.5, groundHalf, 0) !== 0) {
        throw new Error("ground shape failed");
    }
    exports.bodySetMaterial(ground, 0.8, 0);

    for (let chain = 0; chain < chains.length; chain += 1) {
        const layer = Math.floor(chain / columns);
        const column = chain % columns;
        const anchorX = (column - (columns - 1) * 0.5) * horizontalSpacing;
        const anchorZ = (layer - (columns - 1) * 0.5) * horizontalSpacing;
        const anchor = exports.bodyCreate(0, anchorX, anchorY, anchorZ, 0, 0, 0, 1);
        if (anchor < 0) {
            throw new Error(`anchor ${chain} create failed`);
        }
        if (exports.bodySetBox(anchor, 0.1, 0.1, 0.1, 0) !== 0) {
            throw new Error(`anchor ${chain} shape failed`);
        }
        exports.bodySetMaterial(anchor, 0.8, 0);
        anchors.push(anchor);

        let previous = anchor;
        for (let link = 0; link < chains[chain].length; link += 1) {
            const current = chains[chain][link];
            const anchorAY = link === 0 ? 0 : -0.5 * linkSpacing;
            const joint = exports.constraintCreateHinge(
                previous,
                current,
                0, anchorAY, 0,
                0, 0.5 * linkSpacing, 0,
                0, 0, 1,
                0, 0, 1,
                0, 0, 0, 0,
                0, 0, 0,
                0);
            if (joint < 0) {
                throw new Error(`hinge ${chain}/${link} creation failed`);
            }
            previous = current;
        }
    }

    return { links, anchors, chainCount, columns, totalBodies, maxContacts };
}

export function runStandardScene(exports) {
    for (let i = 0; i < STANDARD_STEPS; i += 1) {
        exports.step(STANDARD_DT, PHYSICS_ITERATION_POLICY.velocityIterations, PHYSICS_ITERATION_POLICY.positionIterations);
    }
}

export function fingerprintHex(exports) {
    return BigInt.asUintN(64, exports.worldFingerprint()).toString(16).padStart(16, "0");
}

export function memoryMegabytes(exports) {
    return exports.worldMemoryBytes() / (1024 * 1024);
}
