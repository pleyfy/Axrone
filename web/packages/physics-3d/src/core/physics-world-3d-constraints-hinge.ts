/**
 * Hinge constraint solver for 3D.
 *
 * Hinge joint: allows rotation about a single axis, constrains all other DOFs.
 *
 * Rows:
 *   - 3 linear rows: anchor alignment (same as Fixed)
 *   - 2 angular lock rows: prevent rotation about the two axes perpendicular to hinge axis
 *   - 1 axial row (conditional): angle limit and/or motor about the hinge axis
 *
 * Total: 6 rows (or 5 without limit/motor) — full 6-DOF constraint with 1 free rotational DOF.
 *
 * @internal
 * @module
 */

import { Vec3, Quat, type IVec3Like, type IQuatLike } from '@axrone/numeric';
import { PhysicsConstants } from '@axrone/physics-core';
import type { BodyId3D, IHingeConstraintDef3D } from '../types/physics-3d';
import {
    CONSTRAINT_TYPE_HINGE,
    transformPoint3D,
} from './physics-world-3d-shared';
import {
    type JacobianRow3D,
    type SolverBody3D,
    type ConstraintData3D,
    computeEffectiveMass,
    ensureSolverBody3D,
    createRow,
    zeroVec3,
    registerConstraintModule,
    extractAxisAngle,
    buildPerpendicularAxes,
    SCRATCH,
} from './physics-world-3d-constraints-framework';
import type { BodyManager3D } from './physics-managers-3d';

const BAUMGARTE = PhysicsConstants.BAUMGARTE_FACTOR;
const EPSILON = PhysicsConstants.EPSILON;
const ANGULAR_SLOP = PhysicsConstants.ANGULAR_SLOP;

/**
 * Prepare hinge constraint Jacobian rows.
 */
function prepareHinge(
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
    const hingeDef = def as IHingeConstraintDef3D;

    // ─── Transform anchors and axes to world space ────────────────────
    const worldAnchorA = transformPoint3D(hingeDef.localAnchorA, bodyA.position, bodyA.rotation);
    const worldAnchorB = transformPoint3D(hingeDef.localAnchorB, bodyB.position, bodyB.rotation);

    // Transform local axes to world space using quaternion rotation
    const worldAxisA = Quat.rotateVector(bodyA.rotation, hingeDef.localAxisA);
    const worldAxisB = Quat.rotateVector(bodyB.rotation, hingeDef.localAxisB);

    // Normalize world axes (guard against degenerate input)
    const axisALen = Vec3.len(worldAxisA);
    const axisBLen = Vec3.len(worldAxisB);
    const worldAxisANorm = axisALen > EPSILON
        ? Vec3.multiplyScalar(worldAxisA, 1.0 / axisALen)
        : { x: 1, y: 0, z: 0 };
    const worldAxisBNorm = axisBLen > EPSILON
        ? Vec3.multiplyScalar(worldAxisB, 1.0 / axisBLen)
        : { x: 1, y: 0, z: 0 };

    // Use the average of the two world axes as the hinge axis for angular constraints.
    // When both bodies agree on the axis, this is exact. When they disagree slightly
    // (due to numerical drift), the average provides a stable reference.
    const hingeAxis: IVec3Like = Vec3.normalize(Vec3.add(worldAxisANorm, worldAxisBNorm));

    // r vectors for angular Jacobian computation
    const rA = Vec3.subtract(worldAnchorA, bodyA.position);
    const rB = Vec3.subtract(worldAnchorB, bodyB.position);

    // ─── 3 Linear Rows (anchor alignment) ─────────────────────────────
    // Convention: j1Lin = -n, j2Lin = +n → J*v = vB·n - vA·n
    // For positive error: bias = +BAUMGARTE * error / h (convergent)
    const errorX = worldAnchorB.x - worldAnchorA.x;
    const errorY = worldAnchorB.y - worldAnchorA.y;
    const errorZ = worldAnchorB.z - worldAnchorA.z;

    // Convention (matches configurable + cone-twist):
    //   j1Angular = -(rA × j1Linear)
    //   j2Angular = +(rB × j2Linear)
    //
    // Row 1: X constraint
    out.push(createRow(
        bodyIdA, bodyIdB,
        { x: -1, y: 0, z: 0 },
        { x: 0, y: rA.z, z: -rA.y },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: rB.z, z: -rB.y },
        BAUMGARTE * errorX / h,
        -errorX,
    ));

    // Row 2: Y constraint
    out.push(createRow(
        bodyIdA, bodyIdB,
        { x: 0, y: -1, z: 0 },
        { x: -rA.z, y: 0, z: rA.x },
        { x: 0, y: 1, z: 0 },
        { x: -rB.z, y: 0, z: rB.x },
        BAUMGARTE * errorY / h,
        -errorY,
    ));

    // Row 3: Z constraint
    out.push(createRow(
        bodyIdA, bodyIdB,
        { x: 0, y: 0, z: -1 },
        { x: rA.y, y: -rA.x, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: rB.y, y: -rB.x, z: 0 },
        BAUMGARTE * errorZ / h,
        -errorZ,
    ));

    // ─── 2 Angular Lock Rows (perpendicular to hinge axis) ────────────
    // Build orthonormal basis: two vectors perpendicular to the hinge axis.
    const perp1: IVec3Like = { x: 0, y: 0, z: 0 };
    const perp2: IVec3Like = { x: 0, y: 0, z: 0 };
    buildPerpendicularAxes(hingeAxis, perp1, perp2);

    // The angular lock constraints prevent rotation about perp1 and perp2.
    // The Jacobian for "prevent rotation about axis p" is:
    //   j1Angular = -p, j2Angular = p
    // This constrains the relative angular velocity component along p to zero.
    //
    // The error is the component of the relative rotation along p:
    //   error = 2 * dot(qRel.xyz, p)

    const qRel = Quat.multiply(
        { x: -bodyA.rotation.x, y: -bodyA.rotation.y, z: -bodyA.rotation.z, w: bodyA.rotation.w },
        bodyB.rotation,
    );

    const angError1 = 2.0 * (qRel.x * perp1.x + qRel.y * perp1.y + qRel.z * perp1.z);
    const angError2 = 2.0 * (qRel.x * perp2.x + qRel.y * perp2.y + qRel.z * perp2.z);

    // Lock row 1: prevent rotation about perp1
    // Angular Jacobian: j1Ang = -perp, j2Ang = +perp → J*ω = ωB·perp - ωA·perp
    // For positive angular error: bias = +BAUMGARTE * error / h (convergent)
    out.push(createRow(
        bodyIdA, bodyIdB,
        zeroVec3(), { x: -perp1.x, y: -perp1.y, z: -perp1.z },
        zeroVec3(), { x: perp1.x, y: perp1.y, z: perp1.z },
        BAUMGARTE * angError1 / h,
        -angError1,
    ));

    // Lock row 2: prevent rotation about perp2
    out.push(createRow(
        bodyIdA, bodyIdB,
        zeroVec3(), { x: -perp2.x, y: -perp2.y, z: -perp2.z },
        zeroVec3(), { x: perp2.x, y: perp2.y, z: perp2.z },
        BAUMGARTE * angError2 / h,
        -angError2,
    ));

    // ─── 1 Axial Row (limit) + 1 Motor Row (optional) about hinge axis ───
    // Extract the angle about the hinge axis
    const hingeAngle = extractAxisAngle(qRel, hingeAxis);

    // Check if limits are enabled
    const enableLimit = hingeDef.enableLimit ?? false;
    const enableMotor = hingeDef.enableMotor ?? false;
    const lowerLimit = hingeDef.lowerLimit ?? 0;
    const upperLimit = hingeDef.upperLimit ?? 0;
    const motorSpeed = hingeDef.motorSpeed ?? 0;
    const maxMotorTorque = hingeDef.maxMotorTorque ?? 0;

    // ── Motor row (separate from limit — Box2D motor-stall semantics) ──
    // The motor row is pushed BEFORE the limit row (matching ConeTwist and
    // Configurable) so that within each sequential-impulse iteration the limit
    // sees the post-motor velocities and strips any motor impulse that would
    // push past the rim.
    // Jacobian: same as limit row.
    // Motor bias = -motorSpeed (with this Jacobian: positive motorSpeed →
    // negative impulse → negative angular acceleration on B → correct direction).
    if (enableMotor && Math.abs(maxMotorTorque as number) > EPSILON) {
        const maxImpulse = (maxMotorTorque as number) * h;
        const motorRow = createRow(
            bodyIdA, bodyIdB,
            zeroVec3(), { x: -hingeAxis.x, y: -hingeAxis.y, z: -hingeAxis.z },
            zeroVec3(), { x: hingeAxis.x, y: hingeAxis.y, z: hingeAxis.z },
            -(motorSpeed as number),
            0,
            -maxImpulse, maxImpulse,
        );
        motorRow.hasMotor = true;
        out.push(motorRow);
    }

    // ── Limit row (bilateral when violated, drift-prevention when within limits) ──
    // Jacobian: j1Ang = -hingeAxis, j2Ang = +hingeAxis → J*ω = ωB·axis - ωA·axis
    // For positive limit error: bias = +BAUMGARTE * limitError / h (convergent)
    let hasLimit = false;
    if (enableLimit) {
        hasLimit = true;
        let limitError = 0;

        if (hingeAngle < lowerLimit) {
            limitError = hingeAngle - lowerLimit;
        } else if (hingeAngle > upperLimit) {
            limitError = hingeAngle - upperLimit;
        }

        if (Math.abs(limitError) > ANGULAR_SLOP) {
            // Violated: Baumgarte correction with bilateral clamp.
            // Angular rows use POSITIVE bias (same as ConeTwist) because there's
            // no position correction for angular constraints — velocity solve must converge.
            const limitRow = createRow(
                bodyIdA, bodyIdB,
                zeroVec3(), { x: -hingeAxis.x, y: -hingeAxis.y, z: -hingeAxis.z },
                zeroVec3(), { x: hingeAxis.x, y: hingeAxis.y, z: hingeAxis.z },
                BAUMGARTE * limitError / h,
                -limitError,
                -Infinity, Infinity,
            );
            limitRow.hasLimit = true;
            out.push(limitRow);
        } else if (!enableMotor) {
            // Within limits and no motor: bilateral row with zero bias to prevent drift.
            // When motor is active, we skip this row to allow free rotation within limits.
            // The limit row will only activate when the limit is violated.
            const limitRow = createRow(
                bodyIdA, bodyIdB,
                zeroVec3(), { x: -hingeAxis.x, y: -hingeAxis.y, z: -hingeAxis.z },
                zeroVec3(), { x: hingeAxis.x, y: hingeAxis.y, z: hingeAxis.z },
                0, 0,
                -Infinity, Infinity,
            );
            limitRow.hasLimit = true;
            out.push(limitRow);
        }
    }

    // ─── Compute effective masses ─────────────────────────────────────
    for (const row of out) {
        row.effectiveMass = computeEffectiveMass(row, bodyA, bodyB);
    }
}

// ─── Registration ─────────────────────────────────────────────────────────────

registerConstraintModule(CONSTRAINT_TYPE_HINGE, {
    prepare: prepareHinge,
});
