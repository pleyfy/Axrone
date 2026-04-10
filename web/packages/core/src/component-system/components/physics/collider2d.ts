import { Component } from '@axrone/ecs';
import { Vec2 } from '@axrone/numeric';
import type { CollisionFilter, PhysicsWorld2D, ShapeId } from '@axrone/physics';
import { Rigidbody2D } from './rigidbody2d';

export interface PhysicsMaterial2D {
    friction: number;
    restitution: number;
    density: number;
}

export abstract class Collider2D extends Component {
    protected _shapeId: ShapeId | null = null;
    protected _physicsWorld: PhysicsWorld2D | null = null;
    protected _rigidbody: Rigidbody2D | null = null;

    protected _isTrigger: boolean = false;
    protected _material: PhysicsMaterial2D = {
        friction: 0.4,
        restitution: 0.0,
        density: 1.0,
    };
    protected _offset: Vec2 = Vec2.ZERO.clone();
    protected _colliderEnabled: boolean = true;

    protected _collisionFilter: any = {
        categoryBits: 0x0001,
        maskBits: 0xffff,
        groupIndex: 0,
    };

    get shapeId(): ShapeId | null {
        return this._shapeId;
    }

    get isTrigger(): boolean {
        return this._isTrigger;
    }

    set isTrigger(value: boolean) {
        if (this._isTrigger !== value) {
            this._isTrigger = value;
            this.updateTrigger();
        }
    }

    get material(): Readonly<PhysicsMaterial2D> {
        return this._material;
    }

    set material(value: PhysicsMaterial2D) {
        this._material = Object.assign({}, value);
        this.updateMaterial();
    }

    get friction(): number {
        return this._material.friction;
    }

    set friction(value: number) {
        this._material.friction = Math.max(0, value);
        this.updateMaterial();
    }

    get restitution(): number {
        return this._material.restitution;
    }

    set restitution(value: number) {
        this._material.restitution = Math.max(0, Math.min(1, value));
        this.updateMaterial();
    }

    get density(): number {
        return this._material.density;
    }

    set density(value: number) {
        this._material.density = Math.max(0, value);
        this.updateMaterial();
    }

    get offset(): Vec2 {
        return this._offset;
    }

    set offset(value: Vec2) {
        this._offset.x = value.x;
        this._offset.y = value.y;
        this.updateOffset();
    }

    get collisionFilter(): Readonly<CollisionFilter> {
        return this._collisionFilter;
    }

    set collisionFilter(value: CollisionFilter) {
        this._collisionFilter = Object.assign({}, value);
        this.updateCollisionFilter();
    }

    awake(): void {
        const comp = this.getComponent(Rigidbody2D as any);
        this._rigidbody = comp instanceof Rigidbody2D ? comp : null;
    }

    start(): void {
        this.createPhysicsShape();
    }

    onDestroy(): void {
        this.destroyPhysicsShape();
    }

    protected abstract createPhysicsShape(): void;
    protected abstract destroyPhysicsShape(): void;
    protected abstract updateTrigger(): void;
    protected abstract updateMaterial(): void;
    protected abstract updateOffset(): void;
    protected abstract updateCollisionFilter(): void;

    protected getPhysicsWorld(): PhysicsWorld2D | null {
        return null;
    }

    serialize(): Record<string, any> {
        return {
            isTrigger: this._isTrigger,
            material: { ...this._material },
            offset: { x: this._offset.x, y: this._offset.y },
            enabled: this._colliderEnabled,
            collisionFilter: { ...this._collisionFilter },
        };
    }

    deserialize(data: Record<string, any>): void {
        this._isTrigger = data.isTrigger ?? false;
        this._material = data.material ?? { friction: 0.4, restitution: 0.0, density: 1.0 };
        this._offset = new Vec2(data.offset?.x ?? 0, data.offset?.y ?? 0);
        this._colliderEnabled = data.enabled ?? true;
        this._collisionFilter = data.collisionFilter ?? {
            categoryBits: 0x0001,
            maskBits: 0xffff,
            groupIndex: 0,
        };
    }
}
