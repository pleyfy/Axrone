import type { IVec2Like } from '@axrone/numeric';
import type { ConstraintId, BodyId } from '../types';
import { ConstraintType } from '../types';
import type { ConstraintManager2D } from './constraint-manager';
import type { BodyManager2D } from './body-manager';

interface SolverBody {
    bodyId: BodyId;
    invMass: number;
    invI: number;
    linearVelocity: { x: number; y: number };
    angularVelocity: number;
    position: { x: number; y: number };
    rotation: number;
}

interface JacobianRow {
    j1: { linear: IVec2Like; angular: number };
    j2: { linear: IVec2Like; angular: number };
    bias: number;
    impulse: number;
    lowerLimit: number;
    upperLimit: number;
}

export class ConstraintSolver2D {
    private readonly _constraintManager: ConstraintManager2D;
    private readonly _bodyManager: BodyManager2D;
    private readonly _bodyMap: Map<BodyId, SolverBody> = new Map();
    private readonly _jacobianCache: Map<ConstraintId, JacobianRow[]> = new Map();

    constructor(constraintManager: ConstraintManager2D, bodyManager: BodyManager2D) {
        this._constraintManager = constraintManager;
        this._bodyManager = bodyManager;
    }

    prepareConstraints(constraints: readonly ConstraintId[], deltaTime: number): void {
        this._bodyMap.clear();
        this._jacobianCache.clear();

        for (const constraintId of constraints) {
            const type = this._constraintManager.getConstraintType(constraintId);

            switch (type) {
                case ConstraintType.Distance:
                    this._prepareDistanceConstraint(constraintId, deltaTime);
                    break;
                case ConstraintType.Revolute:
                    this._prepareRevoluteConstraint(constraintId, deltaTime);
                    break;
                case ConstraintType.Prismatic:
                    this._preparePrismaticConstraint(constraintId, deltaTime);
                    break;
                case ConstraintType.Weld:
                    this._prepareWeldConstraint(constraintId, deltaTime);
                    break;
                case ConstraintType.Motor:
                    this._prepareMotorConstraint(constraintId, deltaTime);
                    break;
                case ConstraintType.Mouse:
                    this._prepareMouseConstraint(constraintId, deltaTime);
                    break;
            }
        }
    }

    solveVelocityConstraints(iterations: number): void {
        for (let iter = 0; iter < iterations; iter++) {
            for (const [constraintId, jacobians] of this._jacobianCache) {
                for (const jac of jacobians) {
                    const lambda = this._solveSingleJacobian(jac);
                    jac.impulse += lambda;
                }
            }
        }
    }

    solvePositionConstraints(iterations: number): boolean {
        let minError = 0;

        for (let iter = 0; iter < iterations; iter++) {
            for (const [constraintId, jacobians] of this._jacobianCache) {
                for (const jac of jacobians) {
                    const error = Math.abs(jac.bias);
                    if (error < minError) minError = error;
                }
            }

            if (minError < 0.001) return true;
        }

        return false;
    }

    private _solveSingleJacobian(jac: JacobianRow): number {
        const jv1 = jac.j1.linear.x * 0 + jac.j1.linear.y * 0 + jac.j1.angular * 0;
        const jv2 = jac.j2.linear.x * 0 + jac.j2.linear.y * 0 + jac.j2.angular * 0;
        const jv = jv1 + jv2;

        const effectiveMass = 1.0;
        let lambda = -effectiveMass * (jv + jac.bias);

        const oldImpulse = jac.impulse;
        jac.impulse = Math.max(jac.lowerLimit, Math.min(jac.impulse + lambda, jac.upperLimit));
        lambda = jac.impulse - oldImpulse;

        return lambda;
    }

    private _prepareDistanceConstraint(constraintId: ConstraintId, dt: number): void {
        const jacobians: JacobianRow[] = [
            {
                j1: { linear: { x: 1, y: 0 }, angular: 0 },
                j2: { linear: { x: -1, y: 0 }, angular: 0 },
                bias: 0,
                impulse: 0,
                lowerLimit: -Infinity,
                upperLimit: Infinity,
            },
        ];

        this._jacobianCache.set(constraintId, jacobians);
    }

    private _prepareRevoluteConstraint(constraintId: ConstraintId, dt: number): void {
        const jacobians: JacobianRow[] = [
            {
                j1: { linear: { x: 1, y: 0 }, angular: 0 },
                j2: { linear: { x: -1, y: 0 }, angular: 0 },
                bias: 0,
                impulse: 0,
                lowerLimit: -Infinity,
                upperLimit: Infinity,
            },
            {
                j1: { linear: { x: 0, y: 1 }, angular: 0 },
                j2: { linear: { x: 0, y: -1 }, angular: 0 },
                bias: 0,
                impulse: 0,
                lowerLimit: -Infinity,
                upperLimit: Infinity,
            },
            {
                j1: { linear: { x: 0, y: 0 }, angular: 1 },
                j2: { linear: { x: 0, y: 0 }, angular: -1 },
                bias: 0,
                impulse: 0,
                lowerLimit: -Infinity,
                upperLimit: Infinity,
            },
        ];

        this._jacobianCache.set(constraintId, jacobians);
    }

    private _preparePrismaticConstraint(constraintId: ConstraintId, dt: number): void {
        const jacobians: JacobianRow[] = [
            {
                j1: { linear: { x: 0, y: 1 }, angular: 0 },
                j2: { linear: { x: 0, y: -1 }, angular: 0 },
                bias: 0,
                impulse: 0,
                lowerLimit: -Infinity,
                upperLimit: Infinity,
            },
            {
                j1: { linear: { x: 0, y: 0 }, angular: 1 },
                j2: { linear: { x: 0, y: 0 }, angular: -1 },
                bias: 0,
                impulse: 0,
                lowerLimit: -Infinity,
                upperLimit: Infinity,
            },
        ];

        this._jacobianCache.set(constraintId, jacobians);
    }

    private _prepareWeldConstraint(constraintId: ConstraintId, dt: number): void {
        const jacobians: JacobianRow[] = [
            {
                j1: { linear: { x: 1, y: 0 }, angular: 0 },
                j2: { linear: { x: -1, y: 0 }, angular: 0 },
                bias: 0,
                impulse: 0,
                lowerLimit: -Infinity,
                upperLimit: Infinity,
            },
            {
                j1: { linear: { x: 0, y: 1 }, angular: 0 },
                j2: { linear: { x: 0, y: -1 }, angular: 0 },
                bias: 0,
                impulse: 0,
                lowerLimit: -Infinity,
                upperLimit: Infinity,
            },
            {
                j1: { linear: { x: 0, y: 0 }, angular: 1 },
                j2: { linear: { x: 0, y: 0 }, angular: -1 },
                bias: 0,
                impulse: 0,
                lowerLimit: -Infinity,
                upperLimit: Infinity,
            },
        ];

        this._jacobianCache.set(constraintId, jacobians);
    }

    private _prepareMotorConstraint(constraintId: ConstraintId, dt: number): void {
        const jacobians: JacobianRow[] = [
            {
                j1: { linear: { x: 1, y: 0 }, angular: 0 },
                j2: { linear: { x: -1, y: 0 }, angular: 0 },
                bias: 0,
                impulse: 0,
                lowerLimit: -1000,
                upperLimit: 1000,
            },
        ];

        this._jacobianCache.set(constraintId, jacobians);
    }

    private _prepareMouseConstraint(constraintId: ConstraintId, dt: number): void {
        const jacobians: JacobianRow[] = [
            {
                j1: { linear: { x: 1, y: 0 }, angular: 0 },
                j2: { linear: { x: 0, y: 0 }, angular: 0 },
                bias: 0,
                impulse: 0,
                lowerLimit: -10000,
                upperLimit: 10000,
            },
            {
                j1: { linear: { x: 0, y: 1 }, angular: 0 },
                j2: { linear: { x: 0, y: 0 }, angular: 0 },
                bias: 0,
                impulse: 0,
                lowerLimit: -10000,
                upperLimit: 10000,
            },
        ];

        this._jacobianCache.set(constraintId, jacobians);
    }

    getSolverBody(bodyId: BodyId): SolverBody | undefined {
        return this._bodyMap.get(bodyId);
    }

    clearCache(): void {
        this._bodyMap.clear();
        this._jacobianCache.clear();
    }
}
