import { script } from '@axrone/ecs-runtime/decorators';
import type { Rigidbody3D } from './rigidbody3d';
import {
    DEFAULT_JOINT_MOTOR,
    DEFAULT_SOFT_JOINT_LIMIT_SPRING,
    Joint3D,
    INVALID_CONSTRAINT_ID,
    type IJointLimits3D,
    type IJointMotor3D,
    type ISoftJointLimitSpring3D,
} from './joint3d';

/**
 * WASM-backed hinge joint component.
 *
 * Mirrors the serialized field names and scriptName of the reference
 * `HingeJoint3D` in `physics-3d`.
 *
 * The WASM compat adapter does not expose constraint creation directly.
 * The constraint definition is stored locally; a higher-level bridge
 * materializes it against the inner WasmPhysicsWorld3D when available.
 */
@script({ scriptName: 'HingeJoint3D' })
export class HingeJoint3D extends Joint3D {
    private _useLimits: boolean = false;
    private _useMotor: boolean = false;
    private readonly _limits: IJointLimits3D = {
        min: 0,
        max: 0,
        bounciness: 0,
        contactDistance: 0,
    };
    private readonly _motor: IJointMotor3D = { ...DEFAULT_JOINT_MOTOR };
    private _useSpring: boolean = false;
    private readonly _spring: ISoftJointLimitSpring3D = { ...DEFAULT_SOFT_JOINT_LIMIT_SPRING };
    private _angle: number = 0;
    private _velocity: number = 0;

    get useLimits(): boolean {
        return this._useLimits;
    }

    set useLimits(value: boolean) {
        this._useLimits = value;
        this._updateConstraint();
    }

    get limits(): Readonly<IJointLimits3D> {
        return this._limits;
    }

    set limits(value: Partial<IJointLimits3D>) {
        if (value.min !== undefined) this._limits.min = value.min;
        if (value.max !== undefined) this._limits.max = value.max;
        if (value.bounciness !== undefined) this._limits.bounciness = Math.max(0, Math.min(1, value.bounciness));
        if (value.contactDistance !== undefined) this._limits.contactDistance = Math.max(0, value.contactDistance);
        this._updateConstraint();
    }

    get useMotor(): boolean {
        return this._useMotor;
    }

    set useMotor(value: boolean) {
        this._useMotor = value;
        this._updateConstraint();
    }

    get motor(): Readonly<IJointMotor3D> {
        return this._motor;
    }

    set motor(value: Partial<IJointMotor3D>) {
        if (value.targetVelocity !== undefined) this._motor.targetVelocity = value.targetVelocity;
        if (value.force !== undefined) this._motor.force = Math.max(0, value.force);
        if (value.freeSpin !== undefined) this._motor.freeSpin = value.freeSpin;
        this._updateConstraint();
    }

    get useSpring(): boolean {
        return this._useSpring;
    }

    set useSpring(value: boolean) {
        this._useSpring = value;
        this._updateConstraint();
    }

    get spring(): Readonly<ISoftJointLimitSpring3D> {
        return this._spring;
    }

    set spring(value: Partial<ISoftJointLimitSpring3D>) {
        if (value.spring !== undefined) this._spring.spring = Math.max(0, value.spring);
        if (value.damper !== undefined) this._spring.damper = Math.max(0, value.damper);
        this._updateConstraint();
    }

    get angle(): number {
        return this._angle;
    }

    get velocity(): number {
        return this._velocity;
    }

    protected override _createConstraint(_ownerBody: Rigidbody3D): void {
        // WASM compat does not expose createHingeJoint.
        this._constraintId = INVALID_CONSTRAINT_ID;
    }

    protected override _updateConstraint(): void {
        this._recreateConstraint();
    }

    override serialize(): Record<string, any> {
        return {
            ...super.serialize(),
            limits: {
                enabled: this._useLimits,
                min: this._limits.min,
                max: this._limits.max,
                bounciness: this._limits.bounciness,
                bounceThresholdVelocity: 0,
                contactDistance: this._limits.contactDistance,
            },
            motor: {
                enabled: this._useMotor,
                targetVelocity: this._motor.targetVelocity,
                force: this._motor.force,
                freeSpin: this._motor.freeSpin,
            },
            spring: {
                enabled: this._useSpring,
                spring: this._spring.spring,
                damper: this._spring.damper,
                targetPosition: 0,
            },
        };
    }

    override deserialize(data: Record<string, any>): void {
        super.deserialize(data);
        const limits = data.limits;
        if (limits && typeof limits === 'object') {
            if (limits.enabled !== undefined) this._useLimits = !!limits.enabled;
            if (limits.min !== undefined) this._limits.min = limits.min;
            if (limits.max !== undefined) this._limits.max = limits.max;
            if (limits.bounciness !== undefined) this._limits.bounciness = Math.max(0, Math.min(1, limits.bounciness));
            if (limits.contactDistance !== undefined) this._limits.contactDistance = Math.max(0, limits.contactDistance);
        }
        const motor = data.motor;
        if (motor && typeof motor === 'object') {
            if (motor.enabled !== undefined) this._useMotor = !!motor.enabled;
            if (motor.targetVelocity !== undefined) this._motor.targetVelocity = motor.targetVelocity;
            if (motor.force !== undefined) this._motor.force = Math.max(0, motor.force);
            if (motor.freeSpin !== undefined) this._motor.freeSpin = !!motor.freeSpin;
        }
        const spring = data.spring;
        if (spring && typeof spring === 'object') {
            if (spring.enabled !== undefined) this._useSpring = !!spring.enabled;
            if (spring.spring !== undefined) this._spring.spring = Math.max(0, spring.spring);
            if (spring.damper !== undefined) this._spring.damper = Math.max(0, spring.damper);
        }
    }
}
