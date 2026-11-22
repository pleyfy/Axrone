import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, '..');
const srcRoot = path.join(packageDir, 'src').replaceAll('\\', '/');
const tmpDir = path.join(packageDir, '.tmp');

const DT = 1 / 60;
const HALF = 0.4;
const START_Y = 0.8;
const GROUND_HALF = [40, 0.5, 40];
const GROUND_Y = -0.5;
const GRAVITY = { x: 0, y: -9.81, z: 0 };
const BOX_FRICTION = 0.7;
const GROUND_FRICTION = 0.8;
const VEL_ITERS = 10;
const POS_ITERS = 4;

let engine = null;

export const loadEngine = async () => {
    const esbuild = await import('esbuild');
    fs.mkdirSync(tmpDir, { recursive: true });
    const entry = path.join(tmpDir, 'ts-solver-dump-entry.ts');
    fs.writeFileSync(entry, [
        `export { PhysicsWorld3D } from '${srcRoot}/core/physics-world-3d';`,
        `export { BodyType, PhysicsConstants } from '${srcRoot}/types';`,
        `export { HEADER_FLOATS, POINT_FLOATS, NORMAL_RELAXATION } from '${srcRoot}/core/physics-world-3d-solver';`,
        ''
    ].join('\n'));
    const bundle = path.join(tmpDir, 'ts-solver-dump.bundle.mjs');
    await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        format: 'esm',
        platform: 'node',
        outfile: bundle,
        logLevel: 'silent',
    });
    engine = await import(pathToFileURL(bundle).href);
    return engine;
};

const requireEngine = () => {
    if (!engine) throw new Error('loadEngine() must run first');
    return engine;
};

export const makeWorld = (options = {}) => {
    const { PhysicsWorld3D } = requireEngine();
    return new PhysicsWorld3D({
        gravity: { x: 0, y: -9.81, z: 0 },
        maxBodies: 64,
        maxShapes: 64,
        maxConstraints: 8,
        allowSleep: false,
        ...options,
    });
};

export const addGround = (world) => {
    const { BodyType } = requireEngine();
    const bodyId = world.createBody({
        type: BodyType.Static,
        position: { x: 0, y: GROUND_Y, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        allowSleep: false,
    });
    world.createBoxShape(bodyId, {
        center: { x: 0, y: 0, z: 0 },
        halfExtents: { x: GROUND_HALF[0], y: GROUND_HALF[1], z: GROUND_HALF[2] },
    }, { friction: GROUND_FRICTION, restitution: 0 });
    return bodyId;
};

export const addBox = (world, friction = BOX_FRICTION) => {
    const { BodyType } = requireEngine();
    const bodyId = world.createBody({
        type: BodyType.Dynamic,
        position: { x: 0, y: START_Y, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        allowSleep: false,
    });
    world.createBoxShape(bodyId, {
        center: { x: 0, y: 0, z: 0 },
        halfExtents: { x: HALF, y: HALF, z: HALF },
    }, { friction, restitution: 0 });
    world.getBody(bodyId)?.resetMassData();
    return bodyId;
};

export const addSphere = (world, friction = BOX_FRICTION) => {
    const { BodyType } = requireEngine();
    const bodyId = world.createBody({
        type: BodyType.Dynamic,
        position: { x: 0, y: START_Y, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        allowSleep: false,
    });
    world.createSphereShape(bodyId, { center: { x: 0, y: 0, z: 0 }, radius: HALF }, { friction, restitution: 0 });
    world.getBody(bodyId)?.resetMassData();
    return bodyId;
};

export const buildScene = (world, shape = 'box', friction = BOX_FRICTION) => {
    addGround(world);
    return shape === 'sphere' ? addSphere(world, friction) : addBox(world, friction);
};

const v3 = (v) => ({ x: v.x, y: v.y, z: v.z });
const q4 = (q) => ({ x: q.x, y: q.y, z: q.z, w: q.w });

const rotateVector = (q, v) => {
    const uvx = q.y * v.z - q.z * v.y;
    const uvy = q.z * v.x - q.x * v.z;
    const uvz = q.x * v.y - q.y * v.x;
    const uuvx = q.y * uvz - q.z * uvy;
    const uuvy = q.z * uvx - q.x * uvz;
    const uuvz = q.x * uvy - q.y * uvx;
    const w2 = q.w * 2;
    return {
        x: v.x + (uvx * w2 + uuvx * 2),
        y: v.y + (uvy * w2 + uuvy * 2),
        z: v.z + (uvz * w2 + uuvz * 2),
    };
};

const cross = (a, b) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
});

export const tiltDegrees = (q) => {
    const norm = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w) || 1;
    return 2 * (Math.acos(Math.min(1, Math.abs(q.w) / norm)) * 180) / Math.PI;
};

export const omegaOf = (body) => Math.sqrt(body.angular.x * body.angular.x + body.angular.y * body.angular.y + body.angular.z * body.angular.z);

export const snapshotBody = (world, bodyId) => {
    const manager = world.getBodyManager();
    return {
        bodyId: Number(bodyId),
        position: v3(manager.getPosition(bodyId)),
        rotation: q4(manager.getRotation(bodyId)),
        linear: v3(manager.getLinearVelocity(bodyId)),
        angular: v3(manager.getAngularVelocity(bodyId)),
        mass: manager.getMass(bodyId),
        inverseMass: manager.getInverseMass(bodyId),
        inverseInertia: v3(manager.getInverseInertia(bodyId)),
        tilt: tiltDegrees(manager.getRotation(bodyId)),
    };
};

export const readStore = (world) => {
    const { HEADER_FLOATS, POINT_FLOATS } = requireEngine();
    const { manifolds, cacheValues } = world.getSolverDiagnostics();
    const manager = world.getBodyManager();
    const values = cacheValues;
    return manifolds.map((m) => ({
        pairKey: m.pairKey,
        rawBodyIdA: m.bodyIdA,
        rawBodyIdB: m.bodyIdB,
        bodyIdA: Number(m.bodyIdA),
        bodyIdB: Number(m.bodyIdB),
        poseA: q4(manager.getRotation(m.bodyIdA)),
        poseB: q4(manager.getRotation(m.bodyIdB)),
        centerA: v3(manager.getPosition(m.bodyIdA)),
        centerB: v3(manager.getPosition(m.bodyIdB)),
        invMassA: manager.getInverseMass(m.bodyIdA),
        invMassB: manager.getInverseMass(m.bodyIdB),
        invInertiaA: v3(manager.getInverseInertia(m.bodyIdA)),
        invInertiaB: v3(manager.getInverseInertia(m.bodyIdB)),
        normal: v3(m.normal),
        tangent1: v3(m.tangent1),
        tangent2: v3(m.tangent2),
        friction: m.friction,
        restitution: m.restitution,
        sensor: m.sensor,
        pointCount: m.pointCount,
        solverOffset: m.solverOffset,
        points: m.points.map((p, i) => {
            const slot = m.solverOffset + HEADER_FLOATS + i * POINT_FLOATS;
            return {
                index: i,
                localPointA: v3(p.localPointA),
                localPointB: v3(p.localPointB),
                separation: p.separation,
                storedNormalImpulse: Number(p.normalImpulse),
                storedTangentImpulse1: Number(p.tangentImpulse1),
                storedTangentImpulse2: Number(p.tangentImpulse2),
                relA: { x: values[slot], y: values[slot + 1], z: values[slot + 2] },
                relB: { x: values[slot + 3], y: values[slot + 4], z: values[slot + 5] },
                normalMass: values[slot + 6],
            };
        }),
    }));
};

const readWarm = (world) => {
    const { warmImpulses } = world.getSolverDiagnostics();
    const out = new Map();
    for (const entry of warmImpulses) out.set(entry.key, { normal: entry.normal, tangent: entry.tangent, generation: entry.generation });
    return out;
};

export const strideCheck = (store) => {
    const poseA = store.poseA;
    const poseB = store.poseB;
    const invMassA = store.invMassA;
    const invMassB = store.invMassB;
    const invInertiaA = store.invInertiaA;
    const invInertiaB = store.invInertiaB;
    const n = store.normal;
    let worstRel = 0;
    let worstMass = 0;
    const rows = store.points.map((p) => {
        const worldA = rotateVector(poseA, p.localPointA);
        const worldB = rotateVector(poseB, p.localPointB);
        const midA = {
            x: (worldA.x + store.centerA.x + worldB.x + store.centerB.x) * 0.5 - store.centerA.x,
            y: (worldA.y + store.centerA.y + worldB.y + store.centerB.y) * 0.5 - store.centerA.y,
            z: (worldA.z + store.centerA.z + worldB.z + store.centerB.z) * 0.5 - store.centerA.z,
        };
        const midB = {
            x: midA.x + store.centerA.x - store.centerB.x,
            y: midA.y + store.centerA.y - store.centerB.y,
            z: midA.z + store.centerA.z - store.centerB.z,
        };
        const relErr = Math.max(
            Math.abs(midA.x - p.relA.x), Math.abs(midA.y - p.relA.y), Math.abs(midA.z - p.relA.z),
            Math.abs(midB.x - p.relB.x), Math.abs(midB.y - p.relB.y), Math.abs(midB.z - p.relB.z)
        );
        const rnA = cross(midA, n);
        const rnB = cross(midB, n);
        const k = invMassA + invMassB
            + invInertiaA.x * rnA.x * rnA.x + invInertiaA.y * rnA.y * rnA.y + invInertiaA.z * rnA.z * rnA.z
            + invInertiaB.x * rnB.x * rnB.x + invInertiaB.y * rnB.y * rnB.y + invInertiaB.z * rnB.z * rnB.z;
        const expectedMass = k > requireEngine().PhysicsConstants.EPSILON ? 1 / k : 0;
        const massErr = Math.abs(expectedMass - p.normalMass);
        if (relErr > worstRel) worstRel = relErr;
        if (massErr > worstMass) worstMass = massErr;
        return { index: p.index, relErr, massErr, expectedNormalMass: expectedMass };
    });
    return { worstRelError: worstRel, worstNormalMassError: worstMass, rows };
};

export const freeFallGuard = (options = {}) => {
    const world = makeWorld();
    const { BodyType } = requireEngine();
    const bodyId = world.createBody({
        type: BodyType.Dynamic,
        position: { x: 0, y: 50, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        allowSleep: false,
    });
    world.createBoxShape(bodyId, {
        center: { x: 0, y: 0, z: 0 },
        halfExtents: { x: HALF, y: HALF, z: HALF },
    }, { friction: 0, restitution: 0 });
    world.getBody(bodyId)?.resetMassData();
    const before = q4(world.getBodyManager().getRotation(bodyId));
    for (let i = 0; i < 60; i += 1) world.step(DT, options.vel ?? VEL_ITERS, options.pos ?? POS_ITERS);
    const body = snapshotBody(world, bodyId);
    const after = body.rotation;
    const ok = Math.abs(body.linear.y + 9.81) <= 0.02
        && Math.abs(before.w - 1) < 1e-9
        && Math.abs(body.linear.x) < 1e-12
        && Math.abs(body.linear.z) < 1e-12
        && body.tilt < 1e-6;
    return { ok, vy: body.linear.y, vx: body.linear.x, vz: body.linear.z, tilt: body.tilt };
};

export const dumpSolveState = (world, options = {}) => {
    const target = options.step ?? 18;
    const dt = options.dt ?? DT;
    const velIters = options.velocityIterations ?? VEL_ITERS;
    const posIters = options.positionIterations ?? POS_ITERS;
    const focusBody = options.bodyId;

    for (let s = 1; s < target; s += 1) world.step(dt, velIters, posIters);

    const preStore = readStore(world);
    const preWarm = readWarm(world);
    const preManifold = pickManifold(preStore, options.pairKey, focusBody);
    const preStride = preManifold ? strideCheck(preManifold) : null;
    const preBody = focusBody === undefined ? null : snapshotBody(world, focusBody);
    const liveManifolds = world.getSolverDiagnostics().manifolds;
    const solvedRef = pickLive(liveManifolds, focusBody, options.pairKey);
    const solvedPairKey = solvedRef ? solvedRef.pairKey : null;
    const solvedSeed = solvedRef ? solvedRef.points.map((p) => ({
        normal: Number(p.normalImpulse),
        tangent1: Number(p.tangentImpulse1),
        tangent2: Number(p.tangentImpulse2),
    })) : [];

    world.step(dt, velIters, posIters);

    const postLive = world.getSolverDiagnostics().manifolds;
    const solvedPost = solvedPairKey !== null ? postLive.find((m) => m.pairKey === solvedPairKey) ?? null : null;
    const solvedFinal = solvedPost ? solvedPost.points.map((p) => ({
        normal: Number(p.normalImpulse),
        tangent1: Number(p.tangentImpulse1),
        tangent2: Number(p.tangentImpulse2),
    })) : [];
    const solvedStillLive = solvedPost !== null;
    const postStore = readStore(world);
    const postWarm = readWarm(world);
    const postManifold = pickManifold(postStore, options.pairKey, focusBody);
    const postBody = focusBody === undefined ? null : snapshotBody(world, focusBody);

    const boxIsA = preManifold ? preManifold.bodyIdA === Number(focusBody) : true;
    const sign = boxIsA ? -1 : 1;
    const points = preManifold ? preManifold.points.map((p, i) => {
        const warm = postWarm.get(solvedPairKey * 4 + i);
        const livePost = postManifold && postManifold.points[i];
        return {
            index: p.index,
            normalImpulse: solvedFinal[i] ? solvedFinal[i].normal : 0,
            tangentImpulse1: solvedFinal[i] ? solvedFinal[i].tangent1 : 0,
            tangentImpulse2: solvedFinal[i] ? solvedFinal[i].tangent2 : 0,
            separation: p.separation,
            relA: p.relA,
            relB: p.relB,
            normalMass: p.normalMass,
            localPointA: p.localPointA,
            localPointB: p.localPointB,
            preSolveNormalImpulse: solvedSeed[i] ? solvedSeed[i].normal : 0,
            preSolveTangentImpulse1: solvedSeed[i] ? solvedSeed[i].tangent1 : 0,
            warmNormal: warm ? warm.normal : 0,
            warmTangent: warm ? warm.tangent : 0,
            livePostNormalImpulse: livePost ? livePost.storedNormalImpulse : 0,
            livePostTangentImpulse1: livePost ? livePost.storedTangentImpulse1 : 0,
            boxRel: boxIsA ? p.relA : p.relB,
            boxLocalPoint: boxIsA ? p.localPointA : p.localPointB,
        };
    }) : [];

    const normal = preManifold ? preManifold.normal : { x: 0, y: 0, z: 0 };
    let net = { x: 0, y: 0, z: 0 };
    let netTangent = { x: 0, y: 0, z: 0 };
    for (const p of points) {
        const j = { x: sign * p.normalImpulse * normal.x, y: sign * p.normalImpulse * normal.y, z: sign * p.normalImpulse * normal.z };
        const t = cross(p.boxRel, j);
        net = { x: net.x + t.x, y: net.y + t.y, z: net.z + t.z };
        const jt = {
            x: sign * p.tangentImpulse1 * preManifold.tangent1.x,
            y: sign * p.tangentImpulse1 * preManifold.tangent1.y,
            z: sign * p.tangentImpulse1 * preManifold.tangent1.z,
        };
        const tt = cross(p.boxRel, jt);
        netTangent = { x: netTangent.x + tt.x, y: netTangent.y + tt.y, z: netTangent.z + tt.z };
    }

    const ii = preBody ? preBody.inverseInertia : { x: 0, y: 0, z: 0 };
    const omegaBefore = preBody ? preBody.angular : { x: 0, y: 0, z: 0 };
    const predicted = {
        x: omegaBefore.x + net.x * ii.x,
        y: omegaBefore.y + net.y * ii.y,
        z: omegaBefore.z + net.z * ii.z,
    };
    const predictedWithTangent = {
        x: predicted.x + netTangent.x * ii.x,
        y: predicted.y + netTangent.y * ii.y,
        z: predicted.z + netTangent.z * ii.z,
    };
    const measured = postBody ? postBody.angular : { x: 0, y: 0, z: 0 };

    return {
        step: target,
        policy: `${velIters}/${posIters}`,
        pairKey: solvedPairKey,
        manifoldCountPre: preStore.length,
        manifoldCountPost: postStore.length,
        warmEntriesPre: preWarm.size,
        warmEntriesPost: postWarm.size,
        solvedStillLiveAfterStep: solvedStillLive,
        pointCount: preManifold ? preManifold.pointCount : 0,
        postPointCount: postManifold ? postManifold.pointCount : 0,
        bodyIdA: preManifold ? preManifold.bodyIdA : null,
        bodyIdB: preManifold ? preManifold.bodyIdB : null,
        boxIsA,
        normal,
        tangent1: preManifold ? preManifold.tangent1 : null,
        friction: preManifold ? preManifold.friction : null,
        restitution: preManifold ? preManifold.restitution : null,
        separations: points.map((p) => p.separation),
        normalMasses: points.map((p) => p.normalMass),
        normalImpulses: points.map((p) => p.normalImpulse),
        tangentImpulses: points.map((p) => p.tangentImpulse1),
        points,
        preBody,
        postBody,
        netAngularImpulse: net,
        netTangentAngularImpulse: netTangent,
        predictedOmegaNormalOnly: predicted,
        predictedOmegaNormalPlusTangent1: predictedWithTangent,
        measuredOmega: measured,
        measuredOmegaMagnitude: Math.sqrt(measured.x ** 2 + measured.y ** 2 + measured.z ** 2),
        predictedOmegaMagnitude: Math.sqrt(predicted.x ** 2 + predicted.y ** 2 + predicted.z ** 2),
        stride: preStride,
        preStore,
        postStore,
    };
};

const pickManifold = (store, pairKey, focusBody) => {
    if (store.length === 0) return null;
    if (pairKey !== undefined && pairKey !== null) return store.find((m) => m.pairKey === pairKey) ?? null;
    if (focusBody !== undefined) {
        const hit = store.find((m) => m.bodyIdA === Number(focusBody) || m.bodyIdB === Number(focusBody));
        if (hit) return hit;
    }
    return store[0];
};

const pickLive = (list, focusBody, pairKey) => {
    if (list.length === 0) return null;
    if (pairKey !== undefined && pairKey !== null) return list.find((m) => m.pairKey === pairKey) ?? null;
    if (focusBody !== undefined) {
        const hit = list.find((m) => Number(m.bodyIdA) === Number(focusBody) || Number(m.bodyIdB) === Number(focusBody));
        if (hit) return hit;
    }
    return list[0];
};

export const runSummary = (world, bodyId, steps, velIters = VEL_ITERS, posIters = POS_ITERS) => {
    let firstStep = -1;
    let firstOmega = 0;
    let maxTilt = 0;
    let maxLateral = 0;
    let maxOmega = 0;
    for (let step = 1; step <= steps; step += 1) {
        world.step(DT, velIters, posIters);
        const body = snapshotBody(world, bodyId);
        const omega = omegaOf(body);
        if (firstStep < 0 && omega > 0) {
            firstStep = step;
            firstOmega = omega;
        }
        if (body.tilt > maxTilt) maxTilt = body.tilt;
        if (omega > maxOmega) maxOmega = omega;
        const lateral = Math.sqrt(body.position.x ** 2 + body.position.z ** 2);
        if (lateral > maxLateral) maxLateral = lateral;
    }
    const final = snapshotBody(world, bodyId);
    return { firstStep, firstOmega, maxTilt, maxLateral, maxOmega, finalY: final.position.y, finalTilt: final.tilt };
};

const fmt = (value) => Number(value).toPrecision(17);
const short = (value) => Number(value).toPrecision(10);

const printDump = (dump) => {
    console.log(`DUMP step ${dump.step} policy ${dump.policy} pairKey ${dump.pairKey} manifold A=${dump.bodyIdA} B=${dump.bodyIdB} boxIsA=${dump.boxIsA}`);
    console.log(`  manifolds pre ${dump.manifoldCountPre} post ${dump.manifoldCountPost} | warm entries pre ${dump.warmEntriesPre} post ${dump.warmEntriesPost} | sensors ${dump.preStore.map((m) => m.sensor ? 1 : 0).join(',')}`);
    console.log(`  normal ${fmt(dump.normal.x)} ${fmt(dump.normal.y)} ${fmt(dump.normal.z)} | tangent1 ${fmt(dump.tangent1.x)} ${fmt(dump.tangent1.y)} ${fmt(dump.tangent1.z)}`);
    console.log(`  friction ${dump.friction} restitution ${dump.restitution} | pointCount(pre) ${dump.pointCount} pointCount(post) ${dump.postPointCount}`);
    console.log(`  stride selftest | worst rel error ${short(dump.stride.worstRelError)} | worst normalMass error ${short(dump.stride.worstNormalMassError)}`);
    console.log(`  mass parity | mass ${fmt(dump.preBody.mass)} inverseMass ${fmt(dump.preBody.inverseMass)} inverseInertia ${fmt(dump.preBody.inverseInertia.x)} ${fmt(dump.preBody.inverseInertia.y)} ${fmt(dump.preBody.inverseInertia.z)}`);
    console.log('  pre-solve body | angular ' + `${short(dump.preBody.angular.x)} ${short(dump.preBody.angular.y)} ${short(dump.preBody.angular.z)}` + ` | linear ${short(dump.preBody.linear.x)} ${short(dump.preBody.linear.y)} ${short(dump.preBody.linear.z)}` + ` | y ${fmt(dump.preBody.position.y)} tilt ${short(dump.preBody.tilt)}`);
    console.log(`  post-solve body | angular ${short(dump.postBody.angular.x)} ${short(dump.postBody.angular.y)} ${short(dump.postBody.angular.z)} | linear ${short(dump.postBody.linear.x)} ${short(dump.postBody.linear.y)} ${short(dump.postBody.linear.z)} | y ${fmt(dump.postBody.position.y)} tilt ${short(dump.postBody.tilt)}`);
    console.log(`  solved manifold still live after step: ${dump.solvedStillLiveAfterStep}`);
    for (const p of dump.points) {
        console.log(`  point ${p.index} | separation ${fmt(p.separation)} | normalMass ${fmt(p.normalMass)}`);
        console.log(`     relA ${fmt(p.relA.x)} ${fmt(p.relA.y)} ${fmt(p.relA.z)}`);
        console.log(`     relB ${fmt(p.relB.x)} ${fmt(p.relB.y)} ${fmt(p.relB.z)}`);
        console.log(`     localA ${fmt(p.localPointA.x)} ${fmt(p.localPointA.y)} ${fmt(p.localPointA.z)}`);
        console.log(`     localB ${fmt(p.localPointB.x)} ${fmt(p.localPointB.y)} ${fmt(p.localPointB.z)}`);
        console.log(`     normalImpulse(final) ${fmt(p.normalImpulse)} | warm ${fmt(p.warmNormal)} | live(post) ${fmt(p.livePostNormalImpulse)}`);
        console.log(`     tangentImpulse1(final) ${fmt(p.tangentImpulse1)} | warm ${fmt(p.warmTangent)} | live(post) ${fmt(p.livePostTangentImpulse1)} | tangentImpulse2 ${fmt(p.tangentImpulse2)}`);
        console.log(`     seed(pre) ${fmt(p.preSolveNormalImpulse)} ${fmt(p.preSolveTangentImpulse1)}`);
    }
    console.log(`  net angular impulse (normal channel) ${fmt(dump.netAngularImpulse.x)} ${fmt(dump.netAngularImpulse.y)} ${fmt(dump.netAngularImpulse.z)}`);
    console.log(`  net angular impulse (tangent1 channel) ${fmt(dump.netTangentAngularImpulse.x)} ${fmt(dump.netTangentAngularImpulse.y)} ${fmt(dump.netTangentAngularImpulse.z)}`);
    console.log(`  predicted omega (normal only) ${short(dump.predictedOmegaNormalOnly.x)} ${short(dump.predictedOmegaNormalOnly.y)} ${short(dump.predictedOmegaNormalOnly.z)} | |w| ${short(dump.predictedOmegaMagnitude)}`);
    console.log(`  predicted omega (normal+tangent1) ${short(dump.predictedOmegaNormalPlusTangent1.x)} ${short(dump.predictedOmegaNormalPlusTangent1.y)} ${short(dump.predictedOmegaNormalPlusTangent1.z)}`);
    console.log(`  measured omega  ${short(dump.measuredOmega.x)} ${short(dump.measuredOmega.y)} ${short(dump.measuredOmega.z)} | |w| ${short(dump.measuredOmegaMagnitude)}`);
    console.log(`  closure | |w| ${short(dump.predictedOmegaMagnitude)} predicted vs ${short(dump.measuredOmegaMagnitude)} measured, abs error ${short(Math.abs(dump.predictedOmegaMagnitude - dump.measuredOmegaMagnitude))}`);
};

const parseArgs = (argv) => {
    const out = {};
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (!token.startsWith('--')) continue;
        const name = token.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
            out[name] = true;
        } else {
            out[name] = next;
            i += 1;
        }
    }
    return out;
};

const num = (value, dflt) => (value === undefined || value === true ? dflt : Number(value));

export const measurePreSolveState = (worldFactory, shape, friction, target, vel, pos) => {
    const world = worldFactory();
    const bodyId = buildScene(world, shape, friction);
    for (let s = 1; s < target; s += 1) world.step(DT, vel, pos);
    const store = pickManifold(readStore(world), null, bodyId);
    const body = snapshotBody(world, bodyId);
    const boxIsA = store ? store.bodyIdA === Number(bodyId) : true;
    const otherRawId = store ? (boxIsA ? store.rawBodyIdB : store.rawBodyIdA) : null;
    const other = otherRawId === null ? null : snapshotBody(world, otherRawId);
    const otherInverseMass = store ? (boxIsA ? store.invMassB : store.invMassA) : null;
    world.step(DT, 0, 0);
    const integrated = snapshotBody(world, bodyId);
    return { bodyId, store, body, other, integrated, otherInverseMass };
};

const clampNum = (value, min, max) => (value < min ? min : value > max ? max : value);

export const replayVelocityPass = (input) => {
    const engineRelaxation = requireEngine().NORMAL_RELAXATION;
    const eps = requireEngine().PhysicsConstants.EPSILON;
    const velThreshold = requireEngine().PhysicsConstants.VELOCITY_THRESHOLD;
    const n = input.normal;
    const rels = input.relBox;
    const count = rels.length;
    const accN = input.seedNormal.slice();
    const accT = new Array(count).fill(0);
    const appliedN = input.seedNormal.slice();
    const appliedT = new Array(count).fill(0);
    let netTangent = { x: 0, y: 0, z: 0 };
    const v = { x: input.linear.x, y: input.linear.y, z: input.linear.z };
    const w = { x: input.angular.x, y: input.angular.y, z: input.angular.z };
    const invMass = input.boxInverseMass;
    const invInertia = input.boxInverseInertia;

    const applyToBox = (px, py, pz, r) => {
        v.x += px * invMass;
        v.y += py * invMass;
        v.z += pz * invMass;
        w.x += (r.y * pz - r.z * py) * invInertia.x;
        w.y += (r.z * px - r.x * pz) * invInertia.y;
        w.z += (r.x * py - r.y * px) * invInertia.z;
    };

    for (let i = 0; i < count; i += 1) {
        if (accN[i] !== 0) applyToBox(n.x * accN[i], n.y * accN[i], n.z * accN[i], rels[i]);
    }

    for (let iteration = 0; iteration < input.iterations; iteration += 1) {
        for (let i = 0; i < count; i += 1) {
            const r = rels[i];
            const relV = {
                x: v.x + (w.y * r.z - w.z * r.y),
                y: v.y + (w.z * r.x - w.x * r.z),
                z: v.z + (w.x * r.y - w.y * r.x),
            };
            const ns = relV.x * n.x + relV.y * n.y + relV.z * n.z;
            const rest = ns < -velThreshold ? input.restitution : 0;
            const dPn = engineRelaxation * input.normalMass[i] * (-(1 + rest) * ns);
            const sum = accN[i] + dPn;
            const newPn = sum > 0 ? sum : 0;
            const dNormal = newPn - accN[i];
            accN[i] = newPn;
            appliedN[i] += dNormal;
            if (dNormal !== 0) applyToBox(n.x * dNormal, n.y * dNormal, n.z * dNormal, r);

            const tanVx = v.x + (w.y * r.z - w.z * r.y);
            const tanVy = v.y + (w.z * r.x - w.x * r.z);
            const tanVz = v.z + (w.x * r.y - w.y * r.x);
            const tLen = Math.sqrt(tanVx * tanVx + tanVy * tanVy + tanVz * tanVz);
            if (tLen <= eps) continue;
            const inv = 1 / tLen;
            const t = { x: tanVx * inv, y: tanVy * inv, z: tanVz * inv };
            const rt = cross(r, t);
            const kT = invMass
                + invInertia.x * rt.x * rt.x + invInertia.y * rt.y * rt.y + invInertia.z * rt.z * rt.z;
            const tangentMass = kT > eps ? 1 / kT : 0;
            const dPt = tangentMass * -(tanVx * t.x + tanVy * t.y + tanVz * t.z);
            const maxPt = input.friction * accN[i];
            const newPt = clampNum(accT[i] + dPt, -maxPt, maxPt);
            const delta = newPt - accT[i];
            accT[i] = newPt;
            appliedT[i] += delta;
            applyToBox(t.x * delta, t.y * delta, t.z * delta, r);
            const tq = cross(r, { x: t.x * delta, y: t.y * delta, z: t.z * delta });
            netTangent = { x: netTangent.x + tq.x, y: netTangent.y + tq.y, z: netTangent.z + tq.z };
        }
        if (input.uniformNormal && count > 1) {
            let mean = 0;
            for (let i = 0; i < count; i += 1) mean += accN[i];
            mean /= count;
            for (let i = 0; i < count; i += 1) {
                const shift = mean - accN[i];
                if (shift === 0) continue;
                accN[i] = mean;
                appliedN[i] += shift;
                applyToBox(n.x * shift, n.y * shift, n.z * shift, rels[i]);
            }
        }
    }

    const netNormal = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < count; i += 1) {
        const jn = cross(rels[i], { x: n.x * appliedN[i], y: n.y * appliedN[i], z: n.z * appliedN[i] });
        netNormal.x += jn.x;
        netNormal.y += jn.y;
        netNormal.z += jn.z;
    }
    return {
        appliedNormal: appliedN,
        appliedTangent: appliedT,
        accumulatedNormal: accN,
        accumulatedTangent: accT,
        finalLinear: v,
        finalAngular: w,
        netNormalTorque: netNormal,
        netTangentTorque: netTangent,
        omegaFromApplied: {
            x: input.angular.x + netNormal.x * invInertia.x,
            y: input.angular.y + netNormal.y * invInertia.y,
            z: input.angular.z + netNormal.z * invInertia.z,
        },
        omegaFromAppliedBoth: {
            x: input.angular.x + (netNormal.x + netTangent.x) * invInertia.x,
            y: input.angular.y + (netNormal.y + netTangent.y) * invInertia.y,
            z: input.angular.z + (netNormal.z + netTangent.z) * invInertia.z,
        },
    };
};

const replayFor = (shape, friction, target, iters, pos, measured, uniformNormal) => {
    const pre = measurePreSolveState(makeWorld, shape, friction, target, iters, pos);
    if (!pre.store) return { ok: false, reason: 'no manifold at pre-step' };
    const boxIsA = pre.store.bodyIdA === Number(pre.bodyId);
    const n = boxIsA
        ? { x: -pre.store.normal.x, y: -pre.store.normal.y, z: -pre.store.normal.z }
        : pre.store.normal;
    return {
        ok: true,
        pre,
        boxIsA,
        normalEff: n,
        iters,
        replay: replayVelocityPass({
            normal: n,
            relBox: pre.store.points.map((p) => (boxIsA ? p.relA : p.relB)),
            normalMass: pre.store.points.map((p) => p.normalMass),
            separations: pre.store.points.map((p) => p.separation),
            seedNormal: pre.store.points.map((p) => p.storedNormalImpulse),
            friction: pre.store.friction,
            restitution: pre.store.restitution,
            boxInverseMass: pre.body.inverseMass,
            boxInverseInertia: pre.body.inverseInertia,
            linear: pre.integrated.linear,
            angular: pre.integrated.angular,
            iterations: iters,
            uniformNormal: uniformNormal === true,
        }),
        otherInverseMass: pre.other ? pre.other.inverseMass : null,
        measured,
    };
};

export const measureCase = (options = {}) => {
    const shape = options.shape ?? 'box';
    const friction = options.friction ?? BOX_FRICTION;
    const vel = options.vel ?? VEL_ITERS;
    const pos = options.pos ?? POS_ITERS;
    const target = options.target ?? 18;
    const uniformNormal = options.uniformNormal === true;
    const world = makeWorld();
    const bodyId = buildScene(world, shape, friction);
    const dump = dumpSolveState(world, { step: target, bodyId, velocityIterations: vel, positionIterations: pos });
    const measuredFrom = (iters) => {
        const w = makeWorld();
        const b = buildScene(w, shape, friction);
        const d = dumpSolveState(w, { step: target, bodyId: b, velocityIterations: iters, positionIterations: pos });
        return {
            angular: d.measuredOmega,
            magnitude: d.measuredOmegaMagnitude,
            records: d.points.map((p) => p.normalImpulse),
        };
    };
    const iterationSet = [];
    for (const iters of [1, vel]) if (!iterationSet.includes(iters)) iterationSet.push(iters);
    const replays = iterationSet.map((iters) => ({
        iters,
        pos,
        friction,
        shape,
        result: replayFor(shape, friction, target, iters, pos, measuredFrom(iters), uniformNormal),
    }));
    return { dump, replays };
};

const printReplay = (label, r) => {
    if (!r.ok) {
        console.log(`REPLAY ${label} | unavailable: ${r.reason}`);
        return;
    }
    const rp = r.replay;
    console.log(`REPLAY ${label} iterations ${r.iters} boxIsA=${r.boxIsA} otherBodyInverseMass ${r.otherInverseMass}`);
    console.log(`  pre-solve velocity (engine, 0-iteration probe) linear ${fmt(r.pre.integrated.linear.x)} ${fmt(r.pre.integrated.linear.y)} ${fmt(r.pre.integrated.linear.z)} | angular ${fmt(r.pre.integrated.angular.x)} ${fmt(r.pre.integrated.angular.y)} ${fmt(r.pre.integrated.angular.z)}`);
    for (let i = 0; i < rp.appliedNormal.length; i += 1) {
        console.log(`  point ${i} | applied normal TOTAL ${fmt(rp.appliedNormal[i])} | applied tangent1 TOTAL ${fmt(rp.appliedTangent[i])} | seed before step ${fmt(r.pre.store.points[i].storedNormalImpulse)}`);
    }
    console.log(`  record read from the engine manifold after the step: ${r.measured.records.map((v) => fmt(v)).join(' ')}`);
    console.log(`  replay omega ${short(rp.finalAngular.x)} ${short(rp.finalAngular.y)} ${short(rp.finalAngular.z)} | |w| ${short(Math.sqrt(rp.finalAngular.x ** 2 + rp.finalAngular.y ** 2 + rp.finalAngular.z ** 2))}`);
    console.log(`  engine omega ${short(r.measured.angular.x)} ${short(r.measured.angular.y)} ${short(r.measured.angular.z)} | |w| ${short(r.measured.magnitude)}`);
    const err = Math.max(
        Math.abs(rp.finalAngular.x - r.measured.angular.x),
        Math.abs(rp.finalAngular.y - r.measured.angular.y),
        Math.abs(rp.finalAngular.z - r.measured.angular.z)
    );
    console.log(`  replay fidelity | max component abs error ${short(err)} -> ${err < 1e-12 ? 'EXACT' : 'NOT EXACT'}`);
    console.log(`  closure normal only | I^-1 * sum(ra x (J n)) = ${short(rp.omegaFromApplied.x)} ${short(rp.omegaFromApplied.y)} ${short(rp.omegaFromApplied.z)} | |w| ${short(Math.sqrt(rp.omegaFromApplied.x ** 2 + rp.omegaFromApplied.y ** 2 + rp.omegaFromApplied.z ** 2))} vs engine ${short(r.measured.magnitude)}`);
    console.log(`  closure normal + tangent | |w| ${short(Math.sqrt(rp.omegaFromAppliedBoth.x ** 2 + rp.omegaFromAppliedBoth.y ** 2 + rp.omegaFromAppliedBoth.z ** 2))}`);
};

export const sweepIterations = (options = {}) => {
    const shape = options.shape ?? 'box';
    const friction = options.friction ?? BOX_FRICTION;
    const pos = options.pos ?? POS_ITERS;
    const target = options.target ?? 18;
    const max = options.max ?? 12;
    const rows = [];
    for (let iters = 0; iters <= max; iters += 1) {
        const w = makeWorld();
        const b = buildScene(w, shape, friction);
        const d = dumpSolveState(w, { step: target, bodyId: b, velocityIterations: iters, positionIterations: pos });
        rows.push({
            iterations: iters,
            omega: d.measuredOmega,
            magnitude: d.measuredOmegaMagnitude,
            records: d.points.map((p) => p.normalImpulse),
        });
    }
    for (const row of rows) {
        console.log(`SWEEP iterations ${row.iterations} | omega ${short(row.omega.x)} ${short(row.omega.y)} ${short(row.omega.z)} | |w| ${short(row.magnitude)} | record ${row.records.map((v) => short(v)).join(' ')}`);
    }
    return rows;
};

export const main = async (argv) => {
    const args = parseArgs(argv);
    await loadEngine();
    const vel = num(args.vel, VEL_ITERS);
    const pos = num(args.pos, POS_ITERS);
    const friction = num(args.friction, BOX_FRICTION);
    const shape = args.shape === 'sphere' ? 'sphere' : 'box';
    const target = num(args.step, 18);

    const guard = freeFallGuard({ vel, pos });
    console.log(`free-fall guard | 60 steps vy = ${guard.vy.toFixed(6)} (expect -9.810000 +- 0.02), vx ${guard.vx.toExponential(3)} vz ${guard.vz.toExponential(3)}, tilt ${guard.tilt.toFixed(6)} deg -> ${guard.ok ? 'PASS' : 'FAIL'}`);
    if (!guard.ok) {
        console.log('guard failed: no number below is trustworthy');
        return 1;
    }

    const measured = measureCase({ shape, friction, vel, pos, target });
    console.log(`SCENE shape=${shape} friction=${friction} policy ${vel}/${pos} dt=1/60`);
    printDump(measured.dump);
    for (const r of measured.replays) printReplay(`friction=${friction} policy ${r.iters}/${pos}`, r.result);
    if (args.sweep) sweepIterations({ shape, friction, pos, target, max: num(args.sweep, 12) });
    if (args.uniform) {
        const mag = (o) => Math.sqrt(o.x ** 2 + o.y ** 2 + o.z ** 2);
        const plain = measureCase({ shape, friction, vel, pos, target }).replays.find((r) => r.iters === vel).result;
        const projected = measureCase({ shape, friction, vel, pos, target, uniformNormal: true }).replays.find((r) => r.iters === vel).result;
        const engine = plain.measured.magnitude;
        console.log(`UNIFORM-PROJECTION PRICE (instrument replay only, engine untouched) policy ${vel}/${pos} friction=${friction} step ${target}`);
        console.log(`  sequential replay omega |w| ${short(mag(plain.replay.finalAngular))} | engine omega |w| ${short(engine)} | replay fidelity ${short(Math.abs(mag(plain.replay.finalAngular) - engine))}`);
        console.log(`  projected  replay omega |w| ${short(mag(projected.replay.finalAngular))}`);
        console.log(`  applied normal impulses sequential ${plain.replay.appliedNormal.map((value) => short(value)).join(' ')}`);
        console.log(`  applied normal impulses projected  ${projected.replay.appliedNormal.map((value) => short(value)).join(' ')}`);
        const from = mag(plain.replay.finalAngular);
        const to = mag(projected.replay.finalAngular);
        console.log(`  injection ratio sequential/projected ${to === 0 ? 'infinite' : (from / to).toPrecision(4)} | projected residual drift estimate ${short(0.031835 * (to / (from === 0 ? 1 : from)))} deg at the gate's 900 steps if the per-step injection scales linearly`);
    }

    const totalSteps = num(args.steps, 0);
    if (totalSteps > 0) {
        const summaryWorld = makeWorld();
        const summaryBody = buildScene(summaryWorld, shape, friction);
        const summary = runSummary(summaryWorld, summaryBody, totalSteps, vel, pos);
        console.log(`SUMMARY ${shape} friction=${friction} policy ${vel}/${pos} over ${totalSteps} steps | first non-zero omega step ${summary.firstStep} at ${short(summary.firstOmega)} | maxTilt ${summary.maxTilt.toFixed(6)} deg | maxLateral ${summary.maxLateral.toFixed(6)} m | maxOmega ${short(summary.maxOmega)} | final y ${summary.finalY.toFixed(6)} | final tilt ${summary.finalTilt.toFixed(6)} deg`);
    }
    if (args.json) {
        fs.writeFileSync(path.resolve(String(args.json)), JSON.stringify({ guard, dump: measured.dump }, (key, value) => (value === undefined ? null : value), 1));
        console.log(`json written ${args.json}`);
    }
    return 0;
};

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    main(process.argv.slice(2)).then((code) => {
        process.exitCode = code;
    });
}
