import { clamp } from '@axrone/numeric';
import { BodyFlags, PhysicsConstants } from '../types';
import type { Impulse } from '../types';
import { BODY_LAYOUT, type BodyManager3D } from './physics-managers-3d';
import { CONTACT_NORMAL_RELAXATION } from './physics-solver-policy-3d';
import type { IMutableContactPoint3D, IResolvedContactManifold3D } from './physics-world-3d-shared';

/**
 * Per-step contact solve data, computed once when manifolds are collected and
 * reused by the warm-start pass and by every velocity iteration.
 *
 * Why a cache exists: no transform is written between manifold collection and
 * the end of the velocity phase (position integration runs after it), so each
 * manifold's contact geometry (`rA`, `rB`, effective normal mass) and the mass
 * profile of both bodies are invariant across the velocity iterations.
 * Recomputing them per iteration cost a Map lookup plus several temporary
 * objects per contact point and dominated the step.
 *
 * Layout: one flat buffer, one block per manifold — a fixed header followed by
 * `points.length` point slots. Blocks are handed out by `allocate` and stay
 * valid until the next `reset`, which runs when manifolds are recollected.
 */

export const HEADER_FLOATS = 28;
export const POINT_FLOATS = 7;

// Header slots
const H_VALID = 0;
const H_VEL_SOLVE = 1;
const H_INDEX_A = 2;
const H_INDEX_B = 3;
const H_IMASS_A = 4;
const H_IMASS_B = 5;
const H_NORMAL_X = 6;
const H_NORMAL_Y = 7;
const H_NORMAL_Z = 8;
const H_FRICTION = 9;
const H_RESTITUTION = 10;
const H_IIV_AX = 11;
const H_IIV_AY = 12;
const H_IIV_AZ = 13;
const H_IIV_BX = 14;
const H_IIV_BY = 15;
const H_IIV_BZ = 16;
const H_RAW_IMASS_A = 17;
const H_RAW_IMASS_B = 18;
const H_RIIV_AX = 19;
const H_RIIV_AY = 20;
const H_RIIV_AZ = 21;
const H_RIIV_BX = 22;
const H_RIIV_BY = 23;
const H_RIIV_BZ = 24;
const H_APPLY_A = 25;
const H_APPLY_B = 26;

// Point slots
const P_REL_A_X = 0;
const P_REL_A_Y = 1;
const P_REL_A_Z = 2;
const P_REL_B_X = 3;
const P_REL_B_Y = 4;
const P_REL_B_Z = 5;
const P_NORMAL_MASS = 6;

const BODY_TYPE_DYNAMIC = 2;
export { CONTACT_NORMAL_RELAXATION as NORMAL_RELAXATION };

export class ContactSolverCache {
    private _values = new Float64Array(4096);
    private _cursor = 0;

    get values(): Float64Array {
        return this._values;
    }

    /** Drops every block handed out since the last reset. */
    reset(): void {
        this._cursor = 0;
    }

    /** Reserves a header plus `pointCount` point slots; returns the block offset. */
    allocate(pointCount: number): number {
        const needed = HEADER_FLOATS + pointCount * POINT_FLOATS;
        const offset = this._cursor;
        const required = offset + needed;
        if (required > this._values.length) {
            let capacity = this._values.length;
            while (capacity < required) {
                capacity *= 2;
            }
            // Growing swaps the view, so callers must re-read `values` after
            // every allocate() — the solver does.
            const grown = new Float64Array(capacity);
            grown.set(this._values);
            this._values = grown;
        }
        this._cursor = required;
        return offset;
    }
}

export interface ISolverHost {
    readonly bodyManager: BodyManager3D;
}

export class PhysicsWorld3DSolver {
    /** Scratch reused by the quaternion rotation helpers (no per-call objects). */
    private readonly _rotA = { x: 0, y: 0, z: 0 };
    private readonly _rotB = { x: 0, y: 0, z: 0 };
    /** Union-find scratch for island counting (grown on demand, never rebuilt per step). */
    private _islandParent: Int32Array = new Int32Array(1024);
    private readonly _islandMap = new Map<number, number>();
    private readonly _islandRoots = new Set<number>();

    constructor(private readonly _host: ISolverHost) {}

    /**
     * Fills one cache block for a manifold. Runs once per step from the
     * manifold collection phase; warm start and the velocity solve fall back to
     * preparing lazily so the phases stay usable independently.
     */
    prepareContact(manifold: IResolvedContactManifold3D, cache: ContactSolverCache): void {
        const bm = this._host.bodyManager;
        const indexA = bm.resolveIndex(manifold.bodyIdA);
        const indexB = bm.resolveIndex(manifold.bodyIdB);
        const offset = cache.allocate(manifold.points.length);
        manifold.solverOffset = offset;

        const values = cache.values;
        if (indexA < 0 || indexB < 0) {
            values[offset + H_VALID] = 0;
            values[offset + H_VEL_SOLVE] = 0;
            return;
        }

        const positions = bm.positionsRaw();
        const massData = bm.massDataRaw();
        const bodyTypes = bm.bodyTypesRaw();
        const bodyFlags = bm.bodyFlagsRaw();

        const typeA = bodyTypes[indexA];
        const typeB = bodyTypes[indexB];
        const enabledA = (bodyFlags[indexA] & BodyFlags.Active) !== 0;
        const enabledB = (bodyFlags[indexB] & BodyFlags.Active) !== 0;
        const fixedRotA = (bodyFlags[indexA] & BodyFlags.FixedRotation) !== 0;
        const fixedRotB = (bodyFlags[indexB] & BodyFlags.FixedRotation) !== 0;
        const massBaseA = indexA * BODY_LAYOUT.massStride;
        const massBaseB = indexB * BODY_LAYOUT.massStride;
        const rawInvMassA = massData[massBaseA + BODY_LAYOUT.inverseMass];
        const rawInvMassB = massData[massBaseB + BODY_LAYOUT.inverseMass];

        // Gatekeeping that invMass()/invInertia() used to apply per call.
        const invMassA = typeA === BODY_TYPE_DYNAMIC && enabledA ? rawInvMassA : 0;
        const invMassB = typeB === BODY_TYPE_DYNAMIC && enabledB ? rawInvMassB : 0;
        const solveInertiaA = typeA === BODY_TYPE_DYNAMIC && enabledA && !fixedRotA;
        const solveInertiaB = typeB === BODY_TYPE_DYNAMIC && enabledB && !fixedRotB;
        const inertiaBaseA = massBaseA + BODY_LAYOUT.inverseInertia;
        const inertiaBaseB = massBaseB + BODY_LAYOUT.inverseInertia;

        // applyImpulse() only checks the body type and the raw inverse mass, so
        // it still writes (and wakes) when the solver mass is filtered to zero.
        values[offset + H_VALID] = 1;
        values[offset + H_VEL_SOLVE] =
            !manifold.sensor && invMassA + invMassB > PhysicsConstants.EPSILON ? 1 : 0;
        values[offset + H_INDEX_A] = indexA;
        values[offset + H_INDEX_B] = indexB;
        values[offset + H_IMASS_A] = invMassA;
        values[offset + H_IMASS_B] = invMassB;
        values[offset + H_IIV_AX] = solveInertiaA ? massData[inertiaBaseA] : 0;
        values[offset + H_IIV_AY] = solveInertiaA ? massData[inertiaBaseA + 1] : 0;
        values[offset + H_IIV_AZ] = solveInertiaA ? massData[inertiaBaseA + 2] : 0;
        values[offset + H_IIV_BX] = solveInertiaB ? massData[inertiaBaseB] : 0;
        values[offset + H_IIV_BY] = solveInertiaB ? massData[inertiaBaseB + 1] : 0;
        values[offset + H_IIV_BZ] = solveInertiaB ? massData[inertiaBaseB + 2] : 0;
        values[offset + H_RAW_IMASS_A] = rawInvMassA;
        values[offset + H_RAW_IMASS_B] = rawInvMassB;
        values[offset + H_RIIV_AX] = massData[inertiaBaseA];
        values[offset + H_RIIV_AY] = massData[inertiaBaseA + 1];
        values[offset + H_RIIV_AZ] = massData[inertiaBaseA + 2];
        values[offset + H_RIIV_BX] = massData[inertiaBaseB];
        values[offset + H_RIIV_BY] = massData[inertiaBaseB + 1];
        values[offset + H_RIIV_BZ] = massData[inertiaBaseB + 2];
        values[offset + H_APPLY_A] = typeA === BODY_TYPE_DYNAMIC && rawInvMassA !== 0 ? 1 : 0;
        values[offset + H_APPLY_B] = typeB === BODY_TYPE_DYNAMIC && rawInvMassB !== 0 ? 1 : 0;

        const normal = manifold.normal;
        const normalX = normal.x;
        const normalY = normal.y;
        const normalZ = normal.z;
        values[offset + H_NORMAL_X] = normalX;
        values[offset + H_NORMAL_Y] = normalY;
        values[offset + H_NORMAL_Z] = normalZ;
        values[offset + H_FRICTION] = manifold.friction;
        values[offset + H_RESTITUTION] = manifold.restitution;

        const rowBaseA = indexA * BODY_LAYOUT.positionStride;
        const rowBaseB = indexB * BODY_LAYOUT.positionStride;
        const rotBaseA = rowBaseA + BODY_LAYOUT.rotationOffset;
        const rotBaseB = rowBaseB + BODY_LAYOUT.rotationOffset;
        const centerAX = positions[rowBaseA];
        const centerAY = positions[rowBaseA + 1];
        const centerAZ = positions[rowBaseA + 2];
        const centerBX = positions[rowBaseB];
        const centerBY = positions[rowBaseB + 1];
        const centerBZ = positions[rowBaseB + 2];
        const iivAx = values[offset + H_IIV_AX];
        const iivAy = values[offset + H_IIV_AY];
        const iivAz = values[offset + H_IIV_AZ];
        const iivBx = values[offset + H_IIV_BX];
        const iivBy = values[offset + H_IIV_BY];
        const iivBz = values[offset + H_IIV_BZ];

        // Warm start applies impulses through these slots even for manifolds the
        // velocity solver skips, so geometry is always prepared.
        for (let pointIndex = 0; pointIndex < manifold.points.length; pointIndex++) {
            const point = manifold.points[pointIndex];
            this._rotateTo(positions, rotBaseA, point.localPointA, this._rotA);
            this._rotateTo(positions, rotBaseB, point.localPointB, this._rotB);

            // lp2w() = rotate(local) + centre, then midpointVec3() = (a + b) * 0.5
            const wpAx = this._rotA.x + centerAX;
            const wpAy = this._rotA.y + centerAY;
            const wpAz = this._rotA.z + centerAZ;
            const wpBx = this._rotB.x + centerBX;
            const wpBy = this._rotB.y + centerBY;
            const wpBz = this._rotB.z + centerBZ;
            const wpX = (wpAx + wpBx) * 0.5;
            const wpY = (wpAy + wpBy) * 0.5;
            const wpZ = (wpAz + wpBz) * 0.5;

            const slot = offset + HEADER_FLOATS + pointIndex * POINT_FLOATS;
            const relAX = wpX - centerAX;
            const relAY = wpY - centerAY;
            const relAZ = wpZ - centerAZ;
            const relBX = wpX - centerBX;
            const relBY = wpY - centerBY;
            const relBZ = wpZ - centerBZ;
            values[slot + P_REL_A_X] = relAX;
            values[slot + P_REL_A_Y] = relAY;
            values[slot + P_REL_A_Z] = relAZ;
            values[slot + P_REL_B_X] = relBX;
            values[slot + P_REL_B_Y] = relBY;
            values[slot + P_REL_B_Z] = relBZ;

            // rn = r x normal, effective normal mass (same term order as before).
            const rnAx = relAY * normalZ - relAZ * normalY;
            const rnAy = relAZ * normalX - relAX * normalZ;
            const rnAz = relAX * normalY - relAY * normalX;
            const rnBx = relBY * normalZ - relBZ * normalY;
            const rnBy = relBZ * normalX - relBX * normalZ;
            const rnBz = relBX * normalY - relBY * normalX;
            const kNormal =
                invMassA +
                invMassB +
                iivAx * rnAx * rnAx +
                iivAy * rnAy * rnAy +
                iivAz * rnAz * rnAz +
                iivBx * rnBx * rnBx +
                iivBy * rnBy * rnBy +
                iivBz * rnBz * rnBz;
            values[slot + P_NORMAL_MASS] = kNormal > PhysicsConstants.EPSILON ? 1 / kNormal : 0;
        }
    }

    solveContactVelocity(manifold: IResolvedContactManifold3D, cache: ContactSolverCache): void {
        const offset = this._ensurePrepared(manifold, cache);
        const values = cache.values;
        if (offset < 0 || values[offset + H_VEL_SOLVE] !== 1) return;

        const bm = this._host.bodyManager;
        const positions = bm.positionsRaw();
        const velocities = bm.velocitiesRaw();
        const bodyFlags = bm.bodyFlagsRaw();
        const indexA = values[offset + H_INDEX_A];
        const indexB = values[offset + H_INDEX_B];
        const invMassA = values[offset + H_IMASS_A];
        const invMassB = values[offset + H_IMASS_B];
        const normalX = values[offset + H_NORMAL_X];
        const normalY = values[offset + H_NORMAL_Y];
        const normalZ = values[offset + H_NORMAL_Z];
        const friction = values[offset + H_FRICTION];
        const restitution = values[offset + H_RESTITUTION];
        const iivAx = values[offset + H_IIV_AX];
        const iivAy = values[offset + H_IIV_AY];
        const iivAz = values[offset + H_IIV_AZ];
        const iivBx = values[offset + H_IIV_BX];
        const iivBy = values[offset + H_IIV_BY];
        const iivBz = values[offset + H_IIV_BZ];
        const applyA = values[offset + H_APPLY_A] === 1;
        const applyB = values[offset + H_APPLY_B] === 1;
        const rawInvMassA = values[offset + H_RAW_IMASS_A];
        const rawInvMassB = values[offset + H_RAW_IMASS_B];
        const rowBaseA = indexA * BODY_LAYOUT.positionStride;
        const rowBaseB = indexB * BODY_LAYOUT.positionStride;
        const velBaseA = indexA * BODY_LAYOUT.velocityStride;
        const velBaseB = indexB * BODY_LAYOUT.velocityStride;
        const angBaseA = velBaseA + BODY_LAYOUT.angularVelocityOffset;
        const angBaseB = velBaseB + BODY_LAYOUT.angularVelocityOffset;

        for (let pointIndex = 0; pointIndex < manifold.points.length; pointIndex++) {
            const point = manifold.points[pointIndex];
            const slot = offset + HEADER_FLOATS + pointIndex * POINT_FLOATS;
            const relAX = values[slot + P_REL_A_X];
            const relAY = values[slot + P_REL_A_Y];
            const relAZ = values[slot + P_REL_A_Z];
            const relBX = values[slot + P_REL_B_X];
            const relBY = values[slot + P_REL_B_Y];
            const relBZ = values[slot + P_REL_B_Z];

            // worldPointVelocity(body) = linear + angular x rel
            const avX = velocities[angBaseA];
            const avY = velocities[angBaseA + 1];
            const avZ = velocities[angBaseA + 2];
            const bvX = velocities[angBaseB];
            const bvY = velocities[angBaseB + 1];
            const bvZ = velocities[angBaseB + 2];
            const relVx =
                velocities[velBaseB] + (bvY * relBZ - bvZ * relBY) -
                (velocities[velBaseA] + (avY * relAZ - avZ * relAY));
            const relVy =
                velocities[velBaseB + 1] + (bvZ * relBX - bvX * relBZ) -
                (velocities[velBaseA + 1] + (avZ * relAX - avX * relAZ));
            const relVz =
                velocities[velBaseB + 2] + (bvX * relBY - bvY * relBX) -
                (velocities[velBaseA + 2] + (avX * relAY - avY * relAX));

            const normalImpulse = point.normalImpulse as unknown as number;
            const ns = relVx * normalX + relVy * normalY + relVz * normalZ;
            const rest = ns < -PhysicsConstants.VELOCITY_THRESHOLD ? restitution : 0;
            const dPn = CONTACT_NORMAL_RELAXATION * values[slot + P_NORMAL_MASS] * (-(1 + rest) * ns);
            const newPn = normalImpulse + dPn > 0 ? normalImpulse + dPn : 0;
            point.normalImpulse = newPn as unknown as Impulse;
            const accumulatedNormal = newPn;
            const dNormalApplied = newPn - normalImpulse;
            if (dNormalApplied !== 0) {
                if (applyA) {
                    this._applyImpulse(
                        velocities, velBaseA, bodyFlags, indexA,
                        negateComponent(normalX * dNormalApplied),
                        negateComponent(normalY * dNormalApplied),
                        negateComponent(normalZ * dNormalApplied),
                        relAX, relAY, relAZ, rawInvMassA,
                        values[offset + H_RIIV_AX], values[offset + H_RIIV_AY], values[offset + H_RIIV_AZ]
                    );
                }
                if (applyB) {
                    this._applyImpulse(
                        velocities, velBaseB, bodyFlags, indexB,
                        normalX * dNormalApplied, normalY * dNormalApplied, normalZ * dNormalApplied,
                        relBX, relBY, relBZ, rawInvMassB,
                        values[offset + H_RIIV_BX], values[offset + H_RIIV_BY], values[offset + H_RIIV_BZ]
                    );
                }
            }

            const bvX2 = velocities[angBaseB];
            const bvY2 = velocities[angBaseB + 1];
            const bvZ2 = velocities[angBaseB + 2];
            const avX2 = velocities[angBaseA];
            const avY2 = velocities[angBaseA + 1];
            const avZ2 = velocities[angBaseA + 2];
            const tanVx =
                velocities[velBaseB] + (bvY2 * relBZ - bvZ2 * relBY) -
                (velocities[velBaseA] + (avY2 * relAZ - avZ2 * relAY));
            const tanVy =
                velocities[velBaseB + 1] + (bvZ2 * relBX - bvX2 * relBZ) -
                (velocities[velBaseA + 1] + (avZ2 * relAX - avX2 * relAZ));
            const tanVz =
                velocities[velBaseB + 2] + (bvX2 * relBY - bvY2 * relBX) -
                (velocities[velBaseA + 2] + (avX2 * relAY - avY2 * relAX));
            const tLen = Math.sqrt(tanVx * tanVx + tanVy * tanVy + tanVz * tanVz);
            if (tLen <= PhysicsConstants.EPSILON) continue;

            const inv = 1 / tLen;
            const tanX = tanVx * inv;
            const tanY = tanVy * inv;
            const tanZ = tanVz * inv;
            const rtAx = relAY * tanZ - relAZ * tanY;
            const rtAy = relAZ * tanX - relAX * tanZ;
            const rtAz = relAX * tanY - relAY * tanX;
            const rtBx = relBY * tanZ - relBZ * tanY;
            const rtBy = relBZ * tanX - relBX * tanZ;
            const rtBz = relBX * tanY - relBY * tanX;
            const kTangent =
                invMassA +
                invMassB +
                iivAx * rtAx * rtAx +
                iivAy * rtAy * rtAy +
                iivAz * rtAz * rtAz +
                iivBx * rtBx * rtBx +
                iivBy * rtBy * rtBy +
                iivBz * rtBz * rtBz;
            const tangentMass = kTangent > PhysicsConstants.EPSILON ? 1 / kTangent : 0;

            const dPt = tangentMass * -(tanVx * tanX + tanVy * tanY + tanVz * tanZ);
            const maxPt = friction * accumulatedNormal;
            const previousTangent = point.tangentImpulse1 as unknown as number;
            const newPt = clamp(previousTangent + dPt, -maxPt, maxPt);
            point.tangentImpulse1 = newPt as unknown as Impulse;
            const dApplied = newPt - previousTangent;
            if (applyA) {
                this._applyImpulse(
                    velocities, velBaseA, bodyFlags, indexA,
                    negateComponent(tanX * dApplied),
                    negateComponent(tanY * dApplied),
                    negateComponent(tanZ * dApplied),
                    relAX, relAY, relAZ, rawInvMassA,
                    values[offset + H_RIIV_AX], values[offset + H_RIIV_AY], values[offset + H_RIIV_AZ]
                );
            }
            if (applyB) {
                this._applyImpulse(
                    velocities, velBaseB, bodyFlags, indexB,
                    tanX * dApplied, tanY * dApplied, tanZ * dApplied,
                    relBX, relBY, relBZ, rawInvMassB,
                    values[offset + H_RIIV_BX], values[offset + H_RIIV_BY], values[offset + H_RIIV_BZ]
                );
            }
        }
    }

    warmStartContact(manifold: IResolvedContactManifold3D, cache: ContactSolverCache): void {
        const offset = this._ensurePrepared(manifold, cache);
        const values = cache.values;
        if (offset < 0 || values[offset + H_VALID] !== 1) return;

        const bm = this._host.bodyManager;
        const positions = bm.positionsRaw();
        const velocities = bm.velocitiesRaw();
        const bodyFlags = bm.bodyFlagsRaw();
        const indexA = values[offset + H_INDEX_A];
        const indexB = values[offset + H_INDEX_B];
        const normalX = values[offset + H_NORMAL_X];
        const normalY = values[offset + H_NORMAL_Y];
        const normalZ = values[offset + H_NORMAL_Z];
        const pairAwake = (bodyFlags[indexA] & BodyFlags.Awake) !== 0 && (bodyFlags[indexB] & BodyFlags.Awake) !== 0;
        const applyA = values[offset + H_APPLY_A] === 1 && pairAwake;
        const applyB = values[offset + H_APPLY_B] === 1 && pairAwake;
        const rowBaseA = indexA * BODY_LAYOUT.positionStride;
        const rowBaseB = indexB * BODY_LAYOUT.positionStride;

        for (let pointIndex = 0; pointIndex < manifold.points.length; pointIndex++) {
            const point = manifold.points[pointIndex];
            const normal = (point.normalImpulse as unknown as number) ?? 0;
            if (normal === 0) continue;

            const slot = offset + HEADER_FLOATS + pointIndex * POINT_FLOATS;
            const impX = normalX * normal;
            const impY = normalY * normal;
            const impZ = normalZ * normal;
            if (applyA) {
                this._applyImpulse(
                    velocities, indexA * BODY_LAYOUT.velocityStride,
                    bodyFlags, indexA,
                    negateComponent(impX), negateComponent(impY), negateComponent(impZ),
                    values[slot + P_REL_A_X], values[slot + P_REL_A_Y], values[slot + P_REL_A_Z],
                    values[offset + H_RAW_IMASS_A],
                    values[offset + H_RIIV_AX], values[offset + H_RIIV_AY], values[offset + H_RIIV_AZ],
                    false
                );
            }
            if (applyB) {
                this._applyImpulse(
                    velocities, indexB * BODY_LAYOUT.velocityStride,
                    bodyFlags, indexB,
                    impX, impY, impZ,
                    values[slot + P_REL_B_X], values[slot + P_REL_B_Y], values[slot + P_REL_B_Z],
                    values[offset + H_RAW_IMASS_B],
                    values[offset + H_RIIV_BX], values[offset + H_RIIV_BY], values[offset + H_RIIV_BZ],
                    false
                );
            }
        }
    }

    correctContactPositions(
        manifold: IResolvedContactManifold3D,
        beta: number,
        cache: ContactSolverCache,
        entering: boolean
    ): void {
        const offset = this._ensurePrepared(manifold, cache);
        const values = cache.values;
        if (offset < 0 || values[offset + H_VALID] !== 1 || manifold.sensor) return;

        const invMassA = values[offset + H_IMASS_A];
        const invMassB = values[offset + H_IMASS_B];
        const iSum = invMassA + invMassB;
        if (iSum <= PhysicsConstants.EPSILON) return;

        const trimDepth = entering ? 0 : PhysicsConstants.ALLOWED_PENETRATION;

        const bm = this._host.bodyManager;
        const positions = bm.positionsRaw();
        const indexA = values[offset + H_INDEX_A];
        const indexB = values[offset + H_INDEX_B];
        const normalX = values[offset + H_NORMAL_X];
        const normalY = values[offset + H_NORMAL_Y];
        const normalZ = values[offset + H_NORMAL_Z];
        const rowBaseA = indexA * BODY_LAYOUT.positionStride;
        const rowBaseB = indexB * BODY_LAYOUT.positionStride;

        // Positions move while correcting, so separation is always re-evaluated.
        for (let pointIndex = 0; pointIndex < manifold.points.length; pointIndex++) {
            const point = manifold.points[pointIndex];
            const sep = this._separation(positions, rowBaseA, rowBaseB, point, normalX, normalY, normalZ);
            const pen = Math.max(0, -sep);
            if (pen <= trimDepth) continue;

            const scale = ((pen - trimDepth) * beta) / iSum;
            const corrX = normalX * scale;
            const corrY = normalY * scale;
            const corrZ = normalZ * scale;
            if (invMassA > 0) {
                positions[rowBaseA] = positions[rowBaseA] - corrX * invMassA;
                positions[rowBaseA + 1] = positions[rowBaseA + 1] - corrY * invMassA;
                positions[rowBaseA + 2] = positions[rowBaseA + 2] - corrZ * invMassA;
            }
            if (invMassB > 0) {
                positions[rowBaseB] = positions[rowBaseB] + corrX * invMassB;
                positions[rowBaseB + 1] = positions[rowBaseB + 1] + corrY * invMassB;
                positions[rowBaseB + 2] = positions[rowBaseB + 2] + corrZ * invMassB;
            }
            point.separation = this._separation(positions, rowBaseA, rowBaseB, point, normalX, normalY, normalZ);
        }
    }

    /**
     * Number of connected body groups among the manifolds solved this step.
     *
     * Uses the row indices already resolved into the contact cache, so the
     * union-find runs over integer scratch arrays instead of a fresh `Map`,
     * `Set` and two closures per step. Falls back to the id-keyed path if any
     * manifold lacks a prepared block, which keeps the count identical.
     */
    countIslands(manifolds: readonly IResolvedContactManifold3D[], cache: ContactSolverCache): number {
        const values = cache.values;
        let rows = this._islandParent;
        let capacity = rows.length;
        let maxIndex = -1;
        for (let i = 0; i < manifolds.length; i++) {
            const m = manifolds[i];
            if (m.solverOffset < 0) {
                this.prepareContact(m, cache);
            }
            const offset = m.solverOffset;
            if (offset < 0 || values[offset + H_VALID] !== 1) {
                return this._countIslandsById(manifolds);
            }
            const indexA = values[offset + H_INDEX_A];
            const indexB = values[offset + H_INDEX_B];
            if (indexA > maxIndex) maxIndex = indexA;
            if (indexB > maxIndex) maxIndex = indexB;
        }
        if (maxIndex < 0) return 0;

        while (capacity <= maxIndex) {
            capacity *= 2;
        }
        if (capacity !== rows.length) {
            rows = new Int32Array(capacity);
            this._islandParent = rows;
        }
        // Sentinel: a row not present in any contact keeps rank -1.
        rows.fill(-1, 0, maxIndex + 1);

        const find = (x: number): number => {
            let root = x;
            while (rows[root] !== root) {
                root = rows[root];
            }
            let cursor = x;
            while (cursor !== root) {
                const next = rows[cursor];
                rows[cursor] = root;
                cursor = next;
            }
            return root;
        };

        let islands = 0;
        for (let i = 0; i < manifolds.length; i++) {
            const m = manifolds[i];
            const offset = m.solverOffset;
            const indexA = values[offset + H_INDEX_A];
            const indexB = values[offset + H_INDEX_B];
            if (rows[indexA] === -1) {
                rows[indexA] = indexA;
                islands += 1;
            }
            if (rows[indexB] === -1) {
                rows[indexB] = indexB;
                islands += 1;
            }
            const rootA = find(indexA);
            const rootB = find(indexB);
            if (rootA !== rootB) {
                rows[rootA] = rootB;
                islands -= 1;
            }
        }
        return islands;
    }

    /** Id-keyed union-find; the original implementation, kept as a fallback. */
    private _countIslandsById(manifolds: readonly IResolvedContactManifold3D[]): number {
        const parent = this._islandMap;
        parent.clear();
        const find = (x: number): number => {
            let root = x;
            while (true) {
                const p = parent.get(root);
                if (p === undefined || p === root) break;
                root = p;
            }
            let curr = x;
            while (curr !== root) {
                const next = parent.get(curr)!;
                parent.set(curr, root);
                curr = next;
            }
            return root;
        };
        const union = (a: number, b: number): void => {
            const ra = find(a);
            const rb = find(b);
            if (ra !== rb) parent.set(ra, rb);
        };

        for (let i = 0; i < manifolds.length; i++) {
            const m = manifolds[i];
            if (!parent.has(m.bodyIdA)) parent.set(m.bodyIdA, m.bodyIdA);
            if (!parent.has(m.bodyIdB)) parent.set(m.bodyIdB, m.bodyIdB);
            union(m.bodyIdA, m.bodyIdB);
        }

        const roots = this._islandRoots;
        roots.clear();
        for (const key of parent.keys()) roots.add(find(key));
        return roots.size;
    }

    private _ensurePrepared(manifold: IResolvedContactManifold3D, cache: ContactSolverCache): number {
        if (manifold.solverOffset < 0) {
            this.prepareContact(manifold, cache);
        }
        return manifold.solverOffset;
    }

    /** Mirrors BodyManager3D.applyImpulse() including its trailing wake. */
    private _applyImpulse(
        velocities: Float64Array,
        velBase: number,
        bodyFlags: Uint32Array,
        index: number,
        impulseX: number,
        impulseY: number,
        impulseZ: number,
        relX: number,
        relY: number,
        relZ: number,
        inverseMass: number,
        inverseInertiaX: number,
        inverseInertiaY: number,
        inverseInertiaZ: number,
        wake = true
    ): void {
        velocities[velBase] += impulseX * inverseMass;
        velocities[velBase + 1] += impulseY * inverseMass;
        velocities[velBase + 2] += impulseZ * inverseMass;

        const angBase = velBase + BODY_LAYOUT.angularVelocityOffset;
        velocities[angBase] += (relY * impulseZ - relZ * impulseY) * inverseInertiaX;
        velocities[angBase + 1] += (relZ * impulseX - relX * impulseZ) * inverseInertiaY;
        velocities[angBase + 2] += (relX * impulseY - relY * impulseX) * inverseInertiaZ;

        if (wake) {
            // applyImpulse() wakes the body it writes; the row is already resolved,
            // so this is the flag write without the Map lookup.
            bodyFlags[index] |= BodyFlags.Awake;
        }
    }

    /** Quat.rotateVector(q, v) writing into `out`; term order matches @axrone/numeric. */
    private _rotateTo(
        positions: Float64Array,
        rotBase: number,
        v: Readonly<{ x: number; y: number; z: number }>,
        out: { x: number; y: number; z: number }
    ): void {
        const qx = positions[rotBase];
        const qy = positions[rotBase + 1];
        const qz = positions[rotBase + 2];
        const qw = positions[rotBase + 3];
        const vx = v.x, vy = v.y, vz = v.z;

        const uvx = qy * vz - qz * vy;
        const uvy = qz * vx - qx * vz;
        const uvz = qx * vy - qy * vx;
        const uuvx = qy * uvz - qz * uvy;
        const uuvy = qz * uvx - qx * uvz;
        const uuvz = qx * uvy - qy * uvx;
        const w2 = qw * 2;

        out.x = vx + (uvx * w2 + uuvx * 2);
        out.y = vy + (uvy * w2 + uuvy * 2);
        out.z = vz + (uvz * w2 + uuvz * 2);
    }

    /** Vec3.dot(lp2w(B, localPointB) - lp2w(A, localPointA), normal). */
    private _separation(
        positions: Float64Array,
        rowBaseA: number,
        rowBaseB: number,
        point: IMutableContactPoint3D,
        normalX: number,
        normalY: number,
        normalZ: number
    ): number {
        const rotBaseA = rowBaseA + BODY_LAYOUT.rotationOffset;
        const rotBaseB = rowBaseB + BODY_LAYOUT.rotationOffset;
        this._rotateTo(positions, rotBaseA, point.localPointA, this._rotA);
        this._rotateTo(positions, rotBaseB, point.localPointB, this._rotB);

        const wx = this._rotB.x + positions[rowBaseB] - (this._rotA.x + positions[rowBaseA]);
        const wy = this._rotB.y + positions[rowBaseB + 1] - (this._rotA.y + positions[rowBaseA + 1]);
        const wz = this._rotB.z + positions[rowBaseB + 2] - (this._rotA.z + positions[rowBaseA + 2]);
        return wx * normalX + wy * normalY + wz * normalZ;
    }
}

/** Vec3.negate maps signed zero to +0; the inlined impulse must do the same. */
function negateComponent(value: number): number {
    return value === 0 ? 0 : -value;
}
