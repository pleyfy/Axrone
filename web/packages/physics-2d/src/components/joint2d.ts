import { Component } from '@axrone/ecs';
import { script } from '@axrone/ecs/decorators';
import { Vec2 } from '@axrone/numeric';
import type { ConstraintId } from '../types';
import type { PhysicsWorld2D } from '../core/physics-world';
import { Rigidbody2D } from './rigidbody2d';

export abstract class Joint2D extends Component {
    protected _constraintId: ConstraintId | null = null;
    protected _physicsWorld: PhysicsWorld2D | null = null;
    protected _rigidbodyA: Rigidbody2D | null = null;
    protected _rigidbodyB: Rigidbody2D | null = null;

    protected _connectedBody: Rigidbody2D | null = null;
    protected _enableCollision: boolean = false;
    protected _breakForce: number = Infinity;
    protected _breakTorque: number = Infinity;
    protected _jointEnabled: boolean = true;

    get constraintId(): ConstraintId | null {
        return this._constraintId;
    }

    get connectedBody(): Rigidbody2D | null {
        return this._connectedBody;
    }

    set connectedBody(value: Rigidbody2D | null) {
        if (this._connectedBody !== value) {
            this._connectedBody = value;
            this.recreateConstraint();
        }
    }

    get enableCollision(): boolean {
        return this._enableCollision;
    }

    set enableCollision(value: boolean) {
        if (this._enableCollision !== value) {
            this._enableCollision = value;
            this.recreateConstraint();
        }
    }

    get breakForce(): number {
        return this._breakForce;
    }

    set breakForce(value: number) {
        this._breakForce = Math.max(0, value);
    }

    get breakTorque(): number {
        return this._breakTorque;
    }

    set breakTorque(value: number) {
        this._breakTorque = Math.max(0, value);
    }

    awake(): void {
        this._rigidbodyA = (this.getComponent(Rigidbody2D as any) as Rigidbody2D | null) ?? null;
        if (!this._rigidbodyA) {
            throw new Error('Joint2D requires Rigidbody2D component');
        }
    }

    start(): void {
        this.createConstraint();
    }

    onDestroy(): void {
        this.destroyConstraint();
    }

    protected abstract createConstraint(): void;
    protected abstract destroyConstraint(): void;

    protected recreateConstraint(): void {
        this.destroyConstraint();
        this.createConstraint();
    }

    protected getPhysicsWorld(): PhysicsWorld2D | null {
        return null;
    }

    serialize(): Record<string, any> {
        return {
            enableCollision: this._enableCollision,
            breakForce: this._breakForce,
            breakTorque: this._breakTorque,
            enabled: this._jointEnabled,
        };
    }

    deserialize(data: Record<string, any>): void {
        this._enableCollision = data.enableCollision ?? false;
        this._breakForce = data.breakForce ?? Infinity;
        this._breakTorque = data.breakTorque ?? Infinity;
        this._jointEnabled = data.enabled ?? true;
    }
}

@script({
    scriptName: 'DistanceJoint2D',
    priority: 80,
    description: 'Distance constraint between two rigidbodies',
    version: '1.0.0',
    author: 'Physics System Team',
    tags: ['physics', 'joint', '2d', 'distance'],
    singleton: false,
    dependencies: [],
    executeInEditMode: false,
})
export class DistanceJoint2D extends Joint2D {
    private _distance: number = 1.0;
    private _minDistance: number = 0;
    private _maxDistance: number = Infinity;
    private _stiffness: number = 0;
    private _damping: number = 0;
    private _anchorA: Vec2 = Vec2.ZERO.clone();
    private _anchorB: Vec2 = Vec2.ZERO.clone();
    private _autoConfigureDistance: boolean = true;

    get distance(): number {
        return this._distance;
    }

    set distance(value: number) {
        if (this._distance !== value && value >= 0) {
            this._distance = value;
            this.recreateConstraint();
        }
    }

    get minDistance(): number {
        return this._minDistance;
    }

    set minDistance(value: number) {
        if (this._minDistance !== value && value >= 0) {
            this._minDistance = value;
            this.recreateConstraint();
        }
    }

    get maxDistance(): number {
        return this._maxDistance;
    }

    set maxDistance(value: number) {
        if (this._maxDistance !== value && value >= 0) {
            this._maxDistance = value;
            this.recreateConstraint();
        }
    }

    get stiffness(): number {
        return this._stiffness;
    }

    set stiffness(value: number) {
        if (this._stiffness !== value && value >= 0) {
            this._stiffness = value;
            this.recreateConstraint();
        }
    }

    get damping(): number {
        return this._damping;
    }

    set damping(value: number) {
        if (this._damping !== value && value >= 0) {
            this._damping = value;
            this.recreateConstraint();
        }
    }

    get anchorA(): Vec2 {
        return this._anchorA;
    }

    set anchorA(value: Vec2) {
        this._anchorA.x = value.x;
        this._anchorA.y = value.y;
        this.recreateConstraint();
    }

    get anchorB(): Vec2 {
        return this._anchorB;
    }

    set anchorB(value: Vec2) {
        this._anchorB.x = value.x;
        this._anchorB.y = value.y;
        this.recreateConstraint();
    }

    protected createConstraint(): void {
        if (this._constraintId || !this._rigidbodyA || !this._rigidbodyA.bodyId) return;
        if (!this._connectedBody || !this._connectedBody.bodyId) return;

        this._physicsWorld = this.getPhysicsWorld();
        if (!this._physicsWorld) return;

        if (this._autoConfigureDistance) {
            const posA = this._rigidbodyA.getPosition();
            const posB = this._connectedBody.getPosition();
            this._distance = posA.distance(posB);
        }

        this._constraintId = (this._physicsWorld as any)
            .getConstraintManager()
            .createDistanceConstraint({
                bodyIdA: this._rigidbodyA.bodyId,
                bodyIdB: this._connectedBody.bodyId,
                localAnchorA: { x: this._anchorA.x, y: this._anchorA.y },
                localAnchorB: { x: this._anchorB.x, y: this._anchorB.y },
                length: this._distance,
                minLength: this._minDistance,
                maxLength: this._maxDistance,
                stiffness: this._stiffness,
                damping: this._damping,
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
            distance: this._distance,
            minDistance: this._minDistance,
            maxDistance: this._maxDistance,
            stiffness: this._stiffness,
            damping: this._damping,
            anchorA: { x: this._anchorA.x, y: this._anchorA.y },
            anchorB: { x: this._anchorB.x, y: this._anchorB.y },
            autoConfigureDistance: this._autoConfigureDistance,
        };
    }

    deserialize(data: Record<string, any>): void {
        super.deserialize(data);
        this._distance = data.distance ?? 1.0;
        this._minDistance = data.minDistance ?? 0;
        this._maxDistance = data.maxDistance ?? Infinity;
        this._stiffness = data.stiffness ?? 0;
        this._damping = data.damping ?? 0;
        this._anchorA = new Vec2(data.anchorA?.x ?? 0, data.anchorA?.y ?? 0);
        this._anchorB = new Vec2(data.anchorB?.x ?? 0, data.anchorB?.y ?? 0);
        this._autoConfigureDistance = data.autoConfigureDistance ?? true;
    }
}

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
                localAnchorB: { x: 0, y: 0 },
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
        };
    }

    deserialize(data: Record<string, any>): void {
        super.deserialize(data);
        this._anchor = new Vec2(data.anchor?.x ?? 0, data.anchor?.y ?? 0);
        this._useMotor = data.useMotor ?? false;
        this._motor = {
            speed: data.motorSpeed ?? 0,
            maxTorque: data.maxMotorTorque ?? 10000,
        };
        this._useLimits = data.useLimits ?? false;
        this._limits = data.limits ?? { min: 0, max: 360 };
    }
}

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
                localAnchorB: { x: 0, y: 0 },
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
        };
    }

    deserialize(data: Record<string, any>): void {
        super.deserialize(data);
        this._anchor = new Vec2(data.anchor?.x ?? 0, data.anchor?.y ?? 0);
        this._axis = new Vec2(data.axis?.x ?? 1, data.axis?.y ?? 0);
        this._useMotor = data.useMotor ?? false;
        this._motor = {
            speed: data.motorSpeed ?? 0,
            maxForce: data.maxMotorForce ?? 10000,
        };
        this._useLimits = data.useLimits ?? false;
        this._limits = data.limits ?? { min: -1, max: 1 };
    }
}

@script({
    scriptName: 'SpringJoint2D',
    priority: 80,
    description: 'Spring joint with damping for soft constraints',
    version: '1.0.0',
    author: 'Physics System Team',
    tags: ['physics', 'joint', '2d', 'spring'],
    singleton: false,
    dependencies: [],
    executeInEditMode: false,
})
export class SpringJoint2D extends Joint2D {
    private _distance: number = 1.0;
    private _stiffness: number = 10.0;
    private _damping: number = 0.5;
    private _anchorA: Vec2 = Vec2.ZERO.clone();
    private _anchorB: Vec2 = Vec2.ZERO.clone();
    private _autoConfigureDistance: boolean = true;

    get distance(): number {
        return this._distance;
    }

    set distance(value: number) {
        if (this._distance !== value && value >= 0) {
            this._distance = value;
            this.recreateConstraint();
        }
    }

    get stiffness(): number {
        return this._stiffness;
    }

    set stiffness(value: number) {
        if (this._stiffness !== value && value >= 0) {
            this._stiffness = value;
            this.recreateConstraint();
        }
    }

    get damping(): number {
        return this._damping;
    }

    set damping(value: number) {
        if (this._damping !== value && value >= 0) {
            this._damping = value;
            this.recreateConstraint();
        }
    }

    protected createConstraint(): void {
        if (this._constraintId || !this._rigidbodyA || !this._rigidbodyA.bodyId) return;
        if (!this._connectedBody || !this._connectedBody.bodyId) return;

        this._physicsWorld = this.getPhysicsWorld();
        if (!this._physicsWorld) return;

        if (this._autoConfigureDistance) {
            const posA = this._rigidbodyA.getPosition();
            const posB = this._connectedBody.getPosition();
            this._distance = posA.distance(posB);
        }

        this._constraintId = (this._physicsWorld as any)
            .getConstraintManager()
            .createDistanceConstraint({
                bodyIdA: this._rigidbodyA.bodyId,
                bodyIdB: this._connectedBody.bodyId,
                localAnchorA: { x: this._anchorA.x, y: this._anchorA.y },
                localAnchorB: { x: this._anchorB.x, y: this._anchorB.y },
                length: this._distance,
                stiffness: this._stiffness,
                damping: this._damping,
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
            distance: this._distance,
            stiffness: this._stiffness,
            damping: this._damping,
            anchorA: { x: this._anchorA.x, y: this._anchorA.y },
            anchorB: { x: this._anchorB.x, y: this._anchorB.y },
            autoConfigureDistance: this._autoConfigureDistance,
        };
    }

    deserialize(data: Record<string, any>): void {
        super.deserialize(data);
        this._distance = data.distance ?? 1.0;
        this._stiffness = data.stiffness ?? 10.0;
        this._damping = data.damping ?? 0.5;
        this._anchorA = new Vec2(data.anchorA?.x ?? 0, data.anchorA?.y ?? 0);
        this._anchorB = new Vec2(data.anchorB?.x ?? 0, data.anchorB?.y ?? 0);
        this._autoConfigureDistance = data.autoConfigureDistance ?? true;
    }
}

@script({
    scriptName: 'FixedJoint2D',
    priority: 80,
    description: 'Fixed/weld joint for rigid attachment',
    version: '1.0.0',
    author: 'Physics System Team',
    tags: ['physics', 'joint', '2d', 'fixed', 'weld'],
    singleton: false,
    dependencies: [],
    executeInEditMode: false,
})
export class FixedJoint2D extends Joint2D {
    private _anchor: Vec2 = Vec2.ZERO.clone();
    private _dampingRatio: number = 0.7;
    private _frequency: number = 0;

    get anchor(): Vec2 {
        return this._anchor;
    }

    set anchor(value: Vec2) {
        this._anchor.x = value.x;
        this._anchor.y = value.y;
        this.recreateConstraint();
    }

    get dampingRatio(): number {
        return this._dampingRatio;
    }

    set dampingRatio(value: number) {
        if (this._dampingRatio !== value && value >= 0 && value <= 1) {
            this._dampingRatio = value;
            this.recreateConstraint();
        }
    }

    get frequency(): number {
        return this._frequency;
    }

    set frequency(value: number) {
        if (this._frequency !== value && value >= 0) {
            this._frequency = value;
            this.recreateConstraint();
        }
    }

    protected createConstraint(): void {
        if (this._constraintId || !this._rigidbodyA || !this._rigidbodyA.bodyId) return;
        if (!this._connectedBody || !this._connectedBody.bodyId) return;

        this._physicsWorld = this.getPhysicsWorld();
        if (!this._physicsWorld) return;

        const stiffness = this._frequency > 0 ? this._frequency * this._frequency : 0;
        const damping = 2 * this._dampingRatio * Math.sqrt(stiffness);

        this._constraintId = (this._physicsWorld as any)
            .getConstraintManager()
            .createWeldConstraint({
                bodyIdA: this._rigidbodyA.bodyId,
                bodyIdB: this._connectedBody.bodyId,
                localAnchorA: { x: this._anchor.x, y: this._anchor.y },
                localAnchorB: { x: 0, y: 0 },
                referenceAngle: 0,
                stiffness,
                damping,
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
            dampingRatio: this._dampingRatio,
            frequency: this._frequency,
        };
    }

    deserialize(data: Record<string, any>): void {
        super.deserialize(data);
        this._anchor = new Vec2(data.anchor?.x ?? 0, data.anchor?.y ?? 0);
        this._dampingRatio = data.dampingRatio ?? 0.7;
        this._frequency = data.frequency ?? 0;
    }
}
