/**
 * Fixed + Distance constraint solver for 3D.
 *
 * Fixed constraint: locks 6 DOF (3 linear + 3 angular) — rigid connection.
 * Distance constraint: maintains anchor-point distance (1 linear row).
 *
 * Both use the Jacobian-row framework from physics-world-3d-constraints-framework.ts.
 *
 * Fixed: 3 linear rows (anchor alignment) + 3 angular rows (orientation lock).
 * Distance: 1 linear row (anchor distance preservation).
 *
 * @internal
 * @module
 */

import { Vec3, Quat, type IVec3Like, type IQuatLike } from '@axrone/numeric';
import { PhysicsConstants } from '@axrone/physics-core';
import type { BodyId3D } from '../types/physics-3d';
import {
    CONSTRAINT_TYPE_FIXED,
    transformPoint3D,
    type SupportedConstraintDef3D,
} from './physics-world-3d-shared';
import {
    type JacobianRow3D,
    type SolverBody3D,
    type ConstraintData3D,
    type PrepareFn,
    computeEffectiveMass,
    ensureSolverBody3D,
    createRow,
    zeroVec3,
    registerConstraintModule,
} from './physics-world-3d-constraints-framework';
import type { BodyManager3D } from './physics-managers-3d';

const BAUMGARTE = PhysicsConstants.BAUMGARTE_FACTOR;
const EPSILON = PhysicsConstants.EPSILON;

/**
 * Prepare Fixed/Distance constraints.
 *
 * For Fixed (type 0):
 *   - 3 linear rows: anchor alignment in X, Y, Z
 *   - 3 angular rows: relative orientation lock (identity rotation error)
 *
 * For Distance (same type 0, but with different target distance):
 *   - Currently Fixed and Distance share type 0 in the constraint manager.
 *   - Both use the same prepare path (anchor alignment = distance 0).
 *   - A proper Distance joint with non-zero rest length would need a
 *   - separate constraint type. For now, this matches existing behavior.
 */
function prepareFixedOrDistance(
    data: ConstraintData3D,
    solverBodies: Map<BodyId3D, SolverBody3D>,
    bodyManager: BodyManager3D,
    dt: number,
    out: JacobianRow3D[],
): void {
    const { bodyIdA, bodyIdB, def } = data;
    const bodyA = ensureSolverBody3D(bodyIdA, bodyManager, solverBodies);
    const bodyB = ensureSolverBody3D(bodyIdB, bodyManager, solverBodies);

    const h = Math.max(dt, EPSILON);

    // Transform local anchors to world space
    const localAnchorA = (def as { localAnchorA: IVec3Like }).localAnchorA;
    const localAnchorB = (def as { localAnchorB: IVec3Like }).localAnchorB;

    const worldAnchorA = transformPoint3D(localAnchorA, bodyA.position, bodyA.rotation);
    const worldAnchorB = transformPoint3D(localAnchorB, bodyB.position, bodyB.rotation);

    // Compute r vectors (world anchor - body position) for angular Jacobian
    const rA = Vec3.subtract(worldAnchorA, bodyA.position);
    const rB = Vec3.subtract(worldAnchorB, bodyB.position);

    // Position error = worldAnchorB - worldAnchorA (vector)
    const errorX = worldAnchorB.x - worldAnchorA.x;
    const errorY = worldAnchorB.y - worldAnchorA.y;
    const errorZ = worldAnchorB.z - worldAnchorA.z;

    // ─── 3 Linear Rows (one per axis) ─────────────────────────────────
    // Convention: j1Lin = -n, j2Lin = +n → J*v = vB·n - vA·n
    // For positive error (B ahead of A), bias must be POSITIVE so that
    // the kernel drives J*v toward -bias (negative), closing the gap.
    // Sequential impulse: deltaImpulse = -effMass * bias → negative impulse
    // → pushes A along +n (toward B) and B along -n (toward A).

    // Row 1: X-axis alignment
    const row1 = createRow(
        bodyIdA, bodyIdB,
        { x: -1, y: 0, z: 0 }, // j1Linear
        { x: 0, y: rA.z, z: -rA.y }, // j1Angular = -(rA × xHat)
        { x: 1, y: 0, z: 0 }, // j2Linear
        { x: 0, y: rB.z, z: -rB.y }, // j2Angular = +(rB × xHat)
        BAUMGARTE * errorX / h, // Baumgarte bias (positive for positive error → convergence)
        -errorX, // positionError (negated for position solver convention)
    );

    // Row 2: Y-axis alignment
    const row2 = createRow(
        bodyIdA, bodyIdB,
        { x: 0, y: -1, z: 0 },
        { x: -rA.z, y: 0, z: rA.x }, // j1Angular for Y: -(rA × yHat)
        { x: 0, y: 1, z: 0 },
        { x: -rB.z, y: 0, z: rB.x }, // j2Angular for Y: +(rB × yHat)
        BAUMGARTE * errorY / h,
        -errorY,
    );

    // Row 3: Z-axis alignment
    const row3 = createRow(
        bodyIdA, bodyIdB,
        { x: 0, y: 0, z: -1 },
        { x: rA.y, y: -rA.x, z: 0 }, // j1Angular for Z: -(rA × zHat)
        { x: 0, y: 0, z: 1 },
        { x: rB.y, y: -rB.x, z: 0 }, // j2Angular for Z: +(rB × zHat)
        BAUMGARTE * errorZ / h,
        -errorZ,
    );

    out.push(row1, row2, row3);

    // ─── 3 Angular Rows (orientation lock) ────────────────────────────
    // Compute relative rotation error: qRel = conj(qA) * qB
    // For fixed joint, target relative rotation is identity (no relative rotation).
    // The error quaternion = conj(qA) * qB, and we extract axis-angle from it.
    const qRel = Quat.multiply(
        { x: -bodyA.rotation.x, y: -bodyA.rotation.y, z: -bodyA.rotation.z, w: bodyA.rotation.w },
        bodyB.rotation,
    );

    // For small angles, the vector part of qRel ≈ 0.5 * rotation_error_vector
    // So angular error ≈ 2 * qRel.xyz
    // Each axis gets its own row:
    const angErrorX = 2.0 * qRel.x;
    const angErrorY = 2.0 * qRel.y;
    const angErrorZ = 2.0 * qRel.z;

    // Angular row 1: lock rotation about X
    // Angular Jacobian: j1Ang = -xHat, j2Ang = +xHat → J*ω = ωB_x - ωA_x
    // For positive angular error: bias = +BAUMGARTE * error / h (convergent)
    const angRow1 = createRow(
        bodyIdA, bodyIdB,
        zeroVec3(), { x: -1, y: 0, z: 0 }, // j1Linear=0, j1Angular=-xHat
        zeroVec3(), { x: 1, y: 0, z: 0 },  // j2Linear=0, j2Angular=xHat
        BAUMGARTE * angErrorX / h,
        -angErrorX,
    );

    // Angular row 2: lock rotation about Y
    const angRow2 = createRow(
        bodyIdA, bodyIdB,
        zeroVec3(), { x: 0, y: -1, z: 0 },
        zeroVec3(), { x: 0, y: 1, z: 0 },
        BAUMGARTE * angErrorY / h,
        -angErrorY,
    );

    // Angular row 3: lock rotation about Z
    const angRow3 = createRow(
        bodyIdA, bodyIdB,
        zeroVec3(), { x: 0, y: 0, z: -1 },
        zeroVec3(), { x: 0, y: 0, z: 1 },
        BAUMGARTE * angErrorZ / h,
        -angErrorZ,
    );

    out.push(angRow1, angRow2, angRow3);

    // ─── Compute effective masses ─────────────────────────────────────
    for (const row of out) {
        row.effectiveMass = computeEffectiveMass(row, bodyA, bodyB);
    }
}

// ─── Registration ─────────────────────────────────────────────────────────────

registerConstraintModule(CONSTRAINT_TYPE_FIXED, {
    prepare: prepareFixedOrDistance,
});
