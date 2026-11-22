import { script } from '@axrone/ecs-runtime/decorators';
import { Vec2 } from '@axrone/numeric';
import { Joint2D } from './joint2d';

/**
 * Slider/prismatic joint: constrains body B to slide along a local axis
 * of body A. Locks rotation and lateral movement.
 *
 * Maps to solver `Prismatic` case.
 * **Solver**: FULL — lateral lock + rotation lock + optional translation limit
 * + optional motor. Velocity + position correction active.
 *
 * @see JOINT_CAPABILITY_2D
 */
@script({
    scriptName: 'SliderJoint2D',
    priority: 80,
    description: 'Prismatic/slider joint for linear constraints',
    version: '1.0.0',
    author: 'Physics System Team',
    tags: ['physics', 'joint', '2d', 'slider', 'prismatic'],
    singleton: false,
    dependencies: [],
    executeInEditMode: false,
})
export class SliderJoint2D extends Joint2D {
    private _anchor: Vec2 = Vec2.ZERO.clone();
    private _axis: Vec2 = new Vec2(1, 0);
    private _useMotor: boolean = false;
    private _motor: { speed: number; maxForce: number } = { speed: 0, maxForce: 10000 };
    private _useLimits: boolean = false;
    private _limits: { min: number; max: number } = { min: -1, max: 1 };
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

    get axis(): Vec2 {
        return this._axis;
    }

    set axis(value: Vec2) {
        this._axis.x = value.x;
        this._axis.y = value.y;
        this._axis.normalize();
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

    get maxMotorForce(): number {
        return this._motor.maxForce;
    }

    set maxMotorForce(value: number) {
        this._motor.maxForce = Math.max(0, value);
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
            .createPrismaticConstraint({
                bodyIdA: this._rigidbodyA.bodyId,
                bodyIdB: this._connectedBody.bodyId,
                localAnchorA: { x: this._anchor.x, y: this._anchor.y },
                // Auto-configured maps the authored world anchor into B's space.
                localAnchorB: this._autoConfigureConnectedAnchor
                    ? this.resolveAutoConnectedAnchor(this._anchor)
                    : { x: this._connectedAnchor.x, y: this._connectedAnchor.y },
                localAxisA: { x: this._axis.x, y: this._axis.y },
                referenceAngle: 0,
                enableLimit: this._useLimits,
                lowerTranslation: this._limits.min,
                upperTranslation: this._limits.max,
                enableMotor: this._useMotor,
                motorSpeed: this._motor.speed,
                maxMotorForce: this._motor.maxForce as any,
                collideConnected: this._enableCollision,
            });
    }

    protected destroyConstraint(): void {
        if (!this._constraintId || !this._physicsWorld) return;
        (this._physicsWorld as any).getConstraintManager().destroyConstraint(this._constraintId);
        this._constraintId = null;
    }

    serialize(): Record<string, any> {
        return {
            ...super.serialize(),
            anchor: { x: this._anchor.x, y: this._anchor.y },
            axis: { x: this._axis.x, y: this._axis.y },
            useMotor: this._useMotor,
            motorSpeed: this._motor.speed,
            maxMotorForce: this._motor.maxForce,
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
        if (data.axis !== undefined) {
            const v = this.normalizeVec2Value(data.axis, 1, 0);
            this._axis.x = v.x;
            this._axis.y = v.y;
            this._axis.normalize();
        }
        this._useMotor = data.useMotor ?? false;
        this._motor = {
            speed: data.motorSpeed ?? 0,
            maxForce: data.maxMotorForce ?? 10000,
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
            this._limits = data.limits ?? { min: -1, max: 1 };
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
