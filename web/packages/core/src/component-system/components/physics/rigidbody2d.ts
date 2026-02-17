import { Component } from '../../core/component';
import { script } from '../../decorators/script';
import { Vec2 } from '@axrone/numeric';
import type { BodyId, BodyType } from '../../../physics/types';
import { Transform } from '../transform';
import type { PhysicsWorld2D } from '../../../physics';

export enum RigidbodyType2D {
    Static = 0,
    Kinematic = 1,
    Dynamic = 2,
}

export interface RigidbodyConfig2D {
    bodyType?: RigidbodyType2D;
    mass?: number;
    linearDamping?: number;
    angularDamping?: number;
    gravityScale?: number;
    fixedRotation?: boolean;
    bullet?: boolean;
    allowSleep?: boolean;
    awake?: boolean;
    enabled?: boolean;
}

@script({
    scriptName: 'Rigidbody2D',
    priority: 100,
    description: 'Physics rigidbody component for 2D physics simulation',
    version: '1.0.0',
    author: 'Physics System Team',
    tags: ['physics', 'rigidbody', '2d'],
    singleton: false,
    dependencies: [],
    executeInEditMode: false,
    validateDependencies: true,
    enableMetrics: true,
    enableCaching: true,
})
export class Rigidbody2D extends Component {
    private _bodyId: BodyId | null = null;
    private _physicsWorld: PhysicsWorld2D | null = null;
    private _transform: Transform | null = null;

    private _bodyType: RigidbodyType2D = RigidbodyType2D.Dynamic;
    private _mass: number = 1.0;
    private _linearDamping: number = 0.01;
    private _angularDamping: number = 0.01;
    private _gravityScale: number = 1.0;
    private _fixedRotation: boolean = false;
    private _bullet: boolean = false;
    private _allowSleep: boolean = true;
    private _awake: boolean = true;
    private _rbEnabled: boolean = true;

    private _linearVelocity: Vec2 = Vec2.ZERO.clone();
    private _angularVelocity: number = 0;
    private _force: Vec2 = Vec2.ZERO.clone();
    private _torque: number = 0;

    private _syncFromPhysics: boolean = true;
    private _syncToPhysics: boolean = true;

    get bodyId(): BodyId | null {
        return this._bodyId;
    }

    get bodyType(): RigidbodyType2D {
        return this._bodyType;
    }

    set bodyType(value: RigidbodyType2D) {
        if (this._bodyType !== value) {
            this._bodyType = value;
            this.updateBodyType();
        }
    }

    get mass(): number {
        return this._mass;
    }

    set mass(value: number) {
        if (this._mass !== value && value > 0) {
            this._mass = value;
            this.updateMass();
        }
    }

    get linearDamping(): number {
        return this._linearDamping;
    }

    set linearDamping(value: number) {
        if (this._linearDamping !== value) {
            this._linearDamping = Math.max(0, value);
            this.updateDamping();
        }
    }

    get angularDamping(): number {
        return this._angularDamping;
    }

    set angularDamping(value: number) {
        if (this._angularDamping !== value) {
            this._angularDamping = Math.max(0, value);
            this.updateDamping();
        }
    }

    get gravityScale(): number {
        return this._gravityScale;
    }

    set gravityScale(value: number) {
        if (this._gravityScale !== value) {
            this._gravityScale = value;
            this.updateGravityScale();
        }
    }

    get fixedRotation(): boolean {
        return this._fixedRotation;
    }

    set fixedRotation(value: boolean) {
        if (this._fixedRotation !== value) {
            this._fixedRotation = value;
            this.updateFixedRotation();
        }
    }

    get bullet(): boolean {
        return this._bullet;
    }

    set bullet(value: boolean) {
        if (this._bullet !== value) {
            this._bullet = value;
            this.updateBullet();
        }
    }

    get linearVelocity(): Vec2 {
        if (this._bodyId && this._physicsWorld) {
            const vel = (this._physicsWorld as any)
                .getBodyManager()
                .getLinearVelocity(this._bodyId);
            this._linearVelocity.x = vel.x;
            this._linearVelocity.y = vel.y;
        }
        return this._linearVelocity;
    }

    set linearVelocity(value: Vec2) {
        this._linearVelocity.x = value.x;
        this._linearVelocity.y = value.y;
        if (this._bodyId && this._physicsWorld) {
            (this._physicsWorld as any).getBodyManager().setLinearVelocity(this._bodyId, value);
        }
    }

    get angularVelocity(): number {
        if (this._bodyId && this._physicsWorld) {
            this._angularVelocity = (this._physicsWorld as any)
                .getBodyManager()
                .getAngularVelocity(this._bodyId);
        }
        return this._angularVelocity;
    }

    set angularVelocity(value: number) {
        this._angularVelocity = value;
        if (this._bodyId && this._physicsWorld) {
            (this._physicsWorld as any).getBodyManager().setAngularVelocity(this._bodyId, value);
        }
    }

    awake(): void {
        this._transform = this.getComponent(Transform as any) ?? null;
        if (!this._transform) {
            throw new Error('Rigidbody2D requires Transform component');
        }
    }

    start(): void {
        this.createPhysicsBody();
    }

    fixedUpdate(fixedDeltaTime: number): void {
        if (!this._rbEnabled || !this._bodyId || !this._physicsWorld || !this._transform) return;

        if (this._syncFromPhysics && this._bodyType === RigidbodyType2D.Dynamic) {
            this.syncFromPhysics();
        }

        if (this._syncToPhysics && this._bodyType === RigidbodyType2D.Kinematic) {
            this.syncToPhysics();
        }
    }

    onDestroy(): void {
        this.destroyPhysicsBody();
    }

    applyForce(force: Vec2, worldPoint?: Vec2): void {
        if (!this._bodyId || !this._physicsWorld) return;
        (this._physicsWorld as any)
            .getBodyManager()
            .applyForce(this._bodyId, force as any, worldPoint as any);
    }

    applyForceToCenter(force: Vec2): void {
        if (!this._bodyId || !this._physicsWorld) return;
        (this._physicsWorld as any).getBodyManager().applyForceToCenter(this._bodyId, force as any);
    }

    applyTorque(torque: number): void {
        if (!this._bodyId || !this._physicsWorld) return;
        (this._physicsWorld as any).getBodyManager().applyTorque(this._bodyId, torque as any);
    }

    applyLinearImpulse(impulse: Vec2, worldPoint?: Vec2): void {
        if (!this._bodyId || !this._physicsWorld) return;
        (this._physicsWorld as any)
            .getBodyManager()
            .applyImpulse(this._bodyId, impulse as any, worldPoint as any);
    }

    applyAngularImpulse(impulse: number): void {
        if (!this._bodyId || !this._physicsWorld) return;
        const currentVel = (this._physicsWorld as any)
            .getBodyManager()
            .getAngularVelocity(this._bodyId);
        const invI = (this._physicsWorld as any).getBodyManager().getInverseInertia(this._bodyId);
        (this._physicsWorld as any)
            .getBodyManager()
            .setAngularVelocity(this._bodyId, currentVel + impulse * invI);
    }

    setPosition(position: Vec2): void {
        if (!this._bodyId || !this._physicsWorld) return;
        (this._physicsWorld as any).getBodyManager().setPosition(this._bodyId, position as any);
        if (this._transform) {
            this._transform.position.x = position.x;
            this._transform.position.y = position.y;
        }
    }

    setRotation(angle: number): void {
        if (!this._bodyId || !this._physicsWorld) return;
        (this._physicsWorld as any).getBodyManager().setRotation(this._bodyId, angle);
        if (this._transform) {
        }
    }

    getPosition(): Vec2 {
        if (!this._bodyId || !this._physicsWorld) return Vec2.ZERO.clone();
        const pos = (this._physicsWorld as any).getBodyManager().getPosition(this._bodyId);
        return new Vec2(pos.x, pos.y);
    }

    getRotation(): number {
        if (!this._bodyId || !this._physicsWorld) return 0;
        return (this._physicsWorld as any).getBodyManager().getRotation(this._bodyId);
    }

    isAwake(): boolean {
        if (!this._bodyId || !this._physicsWorld) return false;
        return (this._physicsWorld as any).getBodyManager().isAwake(this._bodyId);
    }

    setAwake(awake: boolean): void {
        if (!this._bodyId || !this._physicsWorld) return;
        (this._physicsWorld as any).getBodyManager().setAwake(this._bodyId, awake);
    }

    isSleepingAllowed(): boolean {
        return this._allowSleep;
    }

    setSleepingAllowed(allowed: boolean): void {
        this._allowSleep = allowed;
    }

    private createPhysicsBody(): void {
        if (this._bodyId || !this._transform) return;

        this._physicsWorld = this.getPhysicsWorld();
        if (!this._physicsWorld) {
            console.warn('PhysicsWorld2D not found');
            return;
        }

        const position = this._transform.position;
        const rotation = 0;

        this._bodyId = (this._physicsWorld as any).getBodyManager().createBody({
            type: this._bodyType as unknown as BodyType,
            position: { x: position.x, y: position.y },
            rotation,
            linearVelocity: { x: this._linearVelocity.x, y: this._linearVelocity.y },
            angularVelocity: this._angularVelocity,
            linearDamping: this._linearDamping,
            angularDamping: this._angularDamping,
            gravityScale: this._gravityScale,
            fixedRotation: this._fixedRotation,
            bullet: this._bullet,
            allowSleep: this._allowSleep,
            awake: this._awake,
            enabled: this._rbEnabled,
        });
    }

    private destroyPhysicsBody(): void {
        if (!this._bodyId || !this._physicsWorld) return;
        (this._physicsWorld as any).getBodyManager().destroyBody(this._bodyId);
        this._bodyId = null;
    }

    private syncFromPhysics(): void {
        if (!this._bodyId || !this._physicsWorld || !this._transform) return;

        const pos = (this._physicsWorld as any).getBodyManager().getPosition(this._bodyId);
        const rot = (this._physicsWorld as any).getBodyManager().getRotation(this._bodyId);

        this._transform.position.x = pos.x;
        this._transform.position.y = pos.y;
    }

    private syncToPhysics(): void {
        if (!this._bodyId || !this._physicsWorld || !this._transform) return;

        const pos = this._transform.position;
        (this._physicsWorld as any)
            .getBodyManager()
            .setPosition(this._bodyId, { x: pos.x, y: pos.y });
    }

    private updateBodyType(): void {
        if (!this._bodyId || !this._physicsWorld) return;
        (this._physicsWorld as any)
            .getBodyManager()
            .setBodyType(this._bodyId, this._bodyType as unknown as BodyType);
    }

    private updateMass(): void {
        if (!this._bodyId || !this._physicsWorld) return;
    }

    private updateDamping(): void {
        if (!this._bodyId || !this._physicsWorld) return;
    }

    private updateGravityScale(): void {
        if (!this._bodyId || !this._physicsWorld) return;
    }

    private updateFixedRotation(): void {
        if (!this._bodyId || !this._physicsWorld) return;
    }

    private updateBullet(): void {
        if (!this._bodyId || !this._physicsWorld) return;
    }

    private getPhysicsWorld(): PhysicsWorld2D | null {
        return null;
    }

    serialize(): Record<string, any> {
        return {
            bodyType: this._bodyType,
            mass: this._mass,
            linearDamping: this._linearDamping,
            angularDamping: this._angularDamping,
            gravityScale: this._gravityScale,
            fixedRotation: this._fixedRotation,
            bullet: this._bullet,
            allowSleep: this._allowSleep,
            awake: this._awake,
            enabled: this._rbEnabled,
        };
    }

    deserialize(data: Record<string, any>): void {
        this._bodyType = data.bodyType ?? RigidbodyType2D.Dynamic;
        this._mass = data.mass ?? 1.0;
        this._linearDamping = data.linearDamping ?? 0.01;
        this._angularDamping = data.angularDamping ?? 0.01;
        this._gravityScale = data.gravityScale ?? 1.0;
        this._fixedRotation = data.fixedRotation ?? false;
        this._bullet = data.bullet ?? false;
        this._allowSleep = data.allowSleep ?? true;
        this._awake = data.awake ?? true;
        this._rbEnabled = data.enabled ?? true;
    }
}
