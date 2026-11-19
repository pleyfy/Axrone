import { script } from '@axrone/ecs-runtime/decorators';
import { Vec2 } from '@axrone/numeric';
import { Joint2D } from './joint2d';

/**
 * Hinge/revolute joint: constrains two bodies to share an anchor point
 * while allowing relative rotation.
 *
 * Maps to solver `Revolute` case.
 * **Solver**: FULL — 2-row anchor constraint + optional angle limit + optional motor.
 * Velocity + position correction active.
 *
 * @see JOINT_CAPABILITY_2D
 */
@script({
    scriptName: 'HingeJoint2D',
    priority: 80,
    description: 'Revolute/hinge joint for rotation constraints',
    version: '1.0.0',
    author: 'Physics System Team',
    tags: ['physics', 'joint', '2d', 'hinge', 'revolute'],
    singleton: false,
    dependencies: [],
    executeInEditMode: false,
})
export class HingeJoint2D extends Joint2D {
    private _anchor: Vec2 = Vec2.ZERO.clone();
    private _useMotor: boolean = false;
    private _motor: { speed: number; maxTorque: number } = { speed: 0, maxTorque: 10000 };
    private _useLimits: boolean = false;
    private _limits: { min: number; max: number } = { min: 0, max: 360 };
    private _connectedAnchor: Vec2 = Vec2.ZERO.clone();
    private _autoConfigureConnectedAnchor: boolean = true;

    get anchor(): Vec2 {
        return this._anchor;
    }

    set anchor(value: Vec2) {
        this._anchor.x = value.x;
        this._anchor.y = value.y;
        this.recreateConstraint();
    }

    get useMotor(): boolean {
        return this._useMotor;
    }

    set useMotor(value: boolean) {
        if (this._useMotor !== value) {
            this._useMotor = value;
            this.recreateConstraint();
        }
    }

    get motorSpeed(): number {
        return this._motor.speed;
    }

    set motorSpeed(value: number) {
        this._motor.speed = value;
        this.recreateConstraint();
    }

    get maxMotorTorque(): number {
        return this._motor.maxTorque;
    }

    set maxMotorTorque(value: number) {
        this._motor.maxTorque = Math.max(0, value);
        this.recreateConstraint();
    }

    get useLimits(): boolean {
        return this._useLimits;
    }

    set useLimits(value: boolean) {
        if (this._useLimits !== value) {
            this._useLimits = value;
            this.recreateConstraint();
        }
    }

    get limits(): { min: number; max: number } {
        return { ...this._limits };
    }

    set limits(value: { min: number; max: number }) {
        this._limits = { ...value };
        this.recreateConstraint();
    }

    get connectedAnchor(): Vec2 {
        return this._connectedAnchor;
    }

    set connectedAnchor(value: Vec2) {
        this._connectedAnchor.x = value.x;
        this._connectedAnchor.y = value.y;
        this.recreateConstraint();
    }

    // No public `autoConfigureConnectedAnchor` accessor on purpose: scene-runtime
    // discriminates 2D from 3D joints by that member name (physics-reference-contract
    // isJoint3DLike), and `physics-3d` owns it. The flag stays private + authored-only.

    protected createConstraint(): void {
        if (this._constraintId || !this._rigidbodyA || !this._rigidbodyA.bodyId) return;
        if (!this._connectedBody || !this._connectedBody.bodyId) return;

        this._physicsWorld = this.getPhysicsWorld();
        if (!this._physicsWorld) return;

        this._constraintId = (this._physicsWorld as any)
            .getConstraintManager()
            .createRevoluteConstraint({
                bodyIdA: this._rigidbodyA.bodyId,
                bodyIdB: this._connectedBody.bodyId,
                localAnchorA: { x: this._anchor.x, y: this._anchor.y },
                // Auto-configured keeps the historical {0,0}; authored value only applies when off.
                localAnchorB: this._autoConfigureConnectedAnchor
                    ? { x: 0, y: 0 }
                    : { x: this._connectedAnchor.x, y: this._connectedAnchor.y },
                referenceAngle: 0,
                enableLimit: this._useLimits,
                lowerAngle: this._limits.min * (Math.PI / 180),
                upperAngle: this._limits.max * (Math.PI / 180),
                enableMotor: this._useMotor,
                motorSpeed: this._motor.speed,
                maxMotorTorque: this._motor.maxTorque as any,
                collideConnected: this._enableCollision,
            });
    }

    protected destroyConstraint(): void {
        if (!this._constraintId || !this._physicsWorld) return;
        (this._physicsWorld as any).getConstraintManager().destroyConstraint(this._constraintId);
        this._constraintId = null;
    }

    getJointAngle(): number {
        if (!this._rigidbodyA || !this._connectedBody) return 0;
        return this._rigidbodyA.getRotation() - this._connectedBody.getRotation();
    }

    getJointSpeed(): number {
        if (!this._rigidbodyA || !this._connectedBody) return 0;
        return this._rigidbodyA.angularVelocity - this._connectedBody.angularVelocity;
    }

    serialize(): Record<string, any> {
        return {
            ...super.serialize(),
            anchor: { x: this._anchor.x, y: this._anchor.y },
            useMotor: this._useMotor,
            motorSpeed: this._motor.speed,
            maxMotorTorque: this._motor.maxTorque,
            useLimits: this._useLimits,
            limits: { ...this._limits },
            connectedAnchor: { x: this._connectedAnchor.x, y: this._connectedAnchor.y },
            autoConfigureConnectedAnchor: this._autoConfigureConnectedAnchor,
        };
    }

    deserialize(data: Record<string, any>): void {
        super.deserialize(data);
        // Vec2 fields: Editor writes ARRAY [x,y], engine uses OBJECT {x,y}.
        // normalizeVec2Value accepts both formats for backward compatibility.
        if (data.anchor !== undefined) {
            const v = this.normalizeVec2Value(data.anchor);
            this._anchor.x = v.x;
            this._anchor.y = v.y;
        }
        this._useMotor = data.useMotor ?? false;
        this._motor = {
            speed: data.motorSpeed ?? 0,
            maxTorque: data.maxMotorTorque ?? 10000,
        };
        this._useLimits = data.useLimits ?? false;
        // Accept both flat keys (limitsMin/limitsMax from Editor) and nested
        // object (limits: { min, max } from legacy scenes). Flat keys win.
        if (data.limitsMin !== undefined || data.limitsMax !== undefined) {
            this._limits = {
                min: data.limitsMin ?? this._limits.min,
                max: data.limitsMax ?? this._limits.max,
            };
        } else {
            this._limits = data.limits ?? { min: 0, max: 360 };
        }
        // anchorB is the Editor alias for the connected-body anchor.
        const connectedAnchorRaw = data.connectedAnchor ?? data.anchorB;
        if (connectedAnchorRaw !== undefined) {
            const v = this.normalizeVec2Value(connectedAnchorRaw);
            this._connectedAnchor.x = v.x;
            this._connectedAnchor.y = v.y;
        }
        this._autoConfigureConnectedAnchor = data.autoConfigureConnectedAnchor ?? true;
    }
}
