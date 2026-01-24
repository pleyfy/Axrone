import { Component } from '../../core/component';
import { script } from '../../decorators/script';
import { Vec2 } from '@axrone/numeric';
import type { ShapeId, CollisionFilter } from '../../../physics/types';
import { Rigidbody2D } from './rigidbody2d';
import type { PhysicsWorld2D } from '../../../physics';

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
        maskBits: 0xFFFF,
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
        this._rigidbody = this.getComponent(Rigidbody2D as any) ?? null;
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
            maskBits: 0xFFFF,
            groupIndex: 0,
        };
    }
}

@script({
    scriptName: 'CircleCollider2D',
    priority: 90,
    description: 'Circle collider for 2D physics',
    version: '1.0.0',
    author: 'Physics System Team',
    tags: ['physics', 'collider', '2d', 'circle'],
    singleton: false,
    dependencies: [],
    executeInEditMode: false,
})
export class CircleCollider2D extends Collider2D {
    private _radius: number = 0.5;

    get radius(): number {
        return this._radius;
    }

    set radius(value: number) {
        if (this._radius !== value && value > 0) {
            this._radius = value;
            this.recreateShape();
        }
    }

    protected createPhysicsShape(): void {
        if (this._shapeId || !this._rigidbody || !this._rigidbody.bodyId) return;

        this._physicsWorld = this.getPhysicsWorld();
        if (!this._physicsWorld) return;

        this._shapeId = (this._physicsWorld as any).getShapeManager().createCircle(
            this._rigidbody.bodyId,
            {
                center: { x: this._offset.x, y: this._offset.y },
                radius: this._radius,
            },
            {
                friction: this._material.friction as any,
                restitution: this._material.restitution as any,
                density: this._material.density,
            },
            this._collisionFilter
        );
    }

    protected destroyPhysicsShape(): void {
        if (!this._shapeId || !this._physicsWorld) return;
        (this._physicsWorld as any).getShapeManager().destroyShape(this._shapeId);
        this._shapeId = null;
    }

    protected updateTrigger(): void {}
    protected updateMaterial(): void {}
    protected updateOffset(): void {
        this.recreateShape();
    }
    protected updateCollisionFilter(): void {}

    private recreateShape(): void {
        this.destroyPhysicsShape();
        this.createPhysicsShape();
    }

    serialize(): Record<string, any> {
        return {
            ...super.serialize(),
            radius: this._radius,
        };
    }

    deserialize(data: Record<string, any>): void {
        super.deserialize(data);
        this._radius = data.radius ?? 0.5;
    }
}

@script({
    scriptName: 'BoxCollider2D',
    priority: 90,
    description: 'Box collider for 2D physics',
    version: '1.0.0',
    author: 'Physics System Team',
    tags: ['physics', 'collider', '2d', 'box'],
    singleton: false,
    dependencies: [],
    executeInEditMode: false,
})
export class BoxCollider2D extends Collider2D {
    private _size: Vec2 = new Vec2(1, 1);
    private _angle: number = 0;

    get size(): Vec2 {
        return this._size;
    }

    set size(value: Vec2) {
        if (!this._size.equals(value) && value.x > 0 && value.y > 0) {
            this._size.x = value.x;
            this._size.y = value.y;
            this.recreateShape();
        }
    }

    get angle(): number {
        return this._angle;
    }

    set angle(value: number) {
        if (this._angle !== value) {
            this._angle = value;
            this.recreateShape();
        }
    }

    protected createPhysicsShape(): void {
        if (this._shapeId || !this._rigidbody || !this._rigidbody.bodyId) return;

        this._physicsWorld = this.getPhysicsWorld();
        if (!this._physicsWorld) return;

        this._shapeId = (this._physicsWorld as any).getShapeManager().createBox(
            this._rigidbody.bodyId,
            {
                center: { x: this._offset.x, y: this._offset.y },
                halfWidth: this._size.x * 0.5,
                halfHeight: this._size.y * 0.5,
                rotation: this._angle,
            },
            {
                friction: this._material.friction as any,
                restitution: this._material.restitution as any,
                density: this._material.density,
            },
            this._collisionFilter
        );
    }

    protected destroyPhysicsShape(): void {
        if (!this._shapeId || !this._physicsWorld) return;
        (this._physicsWorld as any).getShapeManager().destroyShape(this._shapeId);
        this._shapeId = null;
    }

    protected updateTrigger(): void {}
    protected updateMaterial(): void {}
    protected updateOffset(): void {
        this.recreateShape();
    }
    protected updateCollisionFilter(): void {}

    private recreateShape(): void {
        this.destroyPhysicsShape();
        this.createPhysicsShape();
    }

    serialize(): Record<string, any> {
        return {
            ...super.serialize(),
            size: { x: this._size.x, y: this._size.y },
            angle: this._angle,
        };
    }

    deserialize(data: Record<string, any>): void {
        super.deserialize(data);
        this._size = new Vec2(data.size?.x ?? 1, data.size?.y ?? 1);
        this._angle = data.angle ?? 0;
    }
}

@script({
    scriptName: 'PolygonCollider2D',
    priority: 90,
    description: 'Polygon collider for 2D physics',
    version: '1.0.0',
    author: 'Physics System Team',
    tags: ['physics', 'collider', '2d', 'polygon'],
    singleton: false,
    dependencies: [],
    executeInEditMode: false,
})
export class PolygonCollider2D extends Collider2D {
    private _vertices: Vec2[] = [];

    get vertices(): readonly Vec2[] {
        return this._vertices;
    }

    set vertices(value: Vec2[]) {
        if (value.length < 3) {
            console.warn('Polygon collider requires at least 3 vertices');
            return;
        }
        this._vertices = value.map(v => new Vec2(v.x, v.y));
        this.recreateShape();
    }

    setBox(width: number, height: number): void {
        const hw = width * 0.5;
        const hh = height * 0.5;
        this._vertices = [
            new Vec2(-hw, -hh),
            new Vec2(hw, -hh),
            new Vec2(hw, hh),
            new Vec2(-hw, hh),
        ];
        this.recreateShape();
    }

    protected createPhysicsShape(): void {
        if (this._shapeId || !this._rigidbody || !this._rigidbody.bodyId) return;
        if (this._vertices.length < 3) return;

        this._physicsWorld = this.getPhysicsWorld();
        if (!this._physicsWorld) return;

        this._shapeId = (this._physicsWorld as any).getShapeManager().createPolygon(
            this._rigidbody.bodyId,
            {
                vertices: this._vertices.map(v => ({ x: v.x + this._offset.x, y: v.y + this._offset.y })),
            },
            {
                friction: this._material.friction as any,
                restitution: this._material.restitution as any,
                density: this._material.density,
            },
            this._collisionFilter
        );
    }

    protected destroyPhysicsShape(): void {
        if (!this._shapeId || !this._physicsWorld) return;
        (this._physicsWorld as any).getShapeManager().destroyShape(this._shapeId);
        this._shapeId = null;
    }

    protected updateTrigger(): void {}
    protected updateMaterial(): void {}
    protected updateOffset(): void {
        this.recreateShape();
    }
    protected updateCollisionFilter(): void {}

    private recreateShape(): void {
        this.destroyPhysicsShape();
        this.createPhysicsShape();
    }

    serialize(): Record<string, any> {
        return {
            ...super.serialize(),
            vertices: this._vertices.map(v => ({ x: v.x, y: v.y })),
        };
    }

    deserialize(data: Record<string, any>): void {
        super.deserialize(data);
        this._vertices = (data.vertices ?? []).map((v: any) => new Vec2(v.x, v.y));
    }
}

@script({
    scriptName: 'CapsuleCollider2D',
    priority: 90,
    description: 'Capsule collider for 2D physics',
    version: '1.0.0',
    author: 'Physics System Team',
    tags: ['physics', 'collider', '2d', 'capsule'],
    singleton: false,
    dependencies: [],
    executeInEditMode: false,
})
export class CapsuleCollider2D extends Collider2D {
    private _length: number = 1.0;
    private _radius: number = 0.25;
    private _direction: 'vertical' | 'horizontal' = 'vertical';

    get length(): number {
        return this._length;
    }

    set length(value: number) {
        if (this._length !== value && value > 0) {
            this._length = value;
            this.recreateShape();
        }
    }

    get radius(): number {
        return this._radius;
    }

    set radius(value: number) {
        if (this._radius !== value && value > 0) {
            this._radius = value;
            this.recreateShape();
        }
    }

    get direction(): 'vertical' | 'horizontal' {
        return this._direction;
    }

    set direction(value: 'vertical' | 'horizontal') {
        if (this._direction !== value) {
            this._direction = value;
            this.recreateShape();
        }
    }

    protected createPhysicsShape(): void {
        if (this._shapeId || !this._rigidbody || !this._rigidbody.bodyId) return;

        this._physicsWorld = this.getPhysicsWorld();
        if (!this._physicsWorld) return;

        const halfLength = this._length * 0.5;
        const p1 = this._direction === 'vertical'
            ? { x: this._offset.x, y: this._offset.y - halfLength }
            : { x: this._offset.x - halfLength, y: this._offset.y };
        const p2 = this._direction === 'vertical'
            ? { x: this._offset.x, y: this._offset.y + halfLength }
            : { x: this._offset.x + halfLength, y: this._offset.y };

        this._shapeId = (this._physicsWorld as any).getShapeManager().createCapsule(
            this._rigidbody.bodyId,
            { p1, p2, radius: this._radius },
            {
                friction: this._material.friction as any,
                restitution: this._material.restitution as any,
                density: this._material.density,
            },
            this._collisionFilter
        );
    }

    protected destroyPhysicsShape(): void {
        if (!this._shapeId || !this._physicsWorld) return;
        (this._physicsWorld as any).getShapeManager().destroyShape(this._shapeId);
        this._shapeId = null;
    }

    protected updateTrigger(): void {}
    protected updateMaterial(): void {}
    protected updateOffset(): void {
        this.recreateShape();
    }
    protected updateCollisionFilter(): void {}

    private recreateShape(): void {
        this.destroyPhysicsShape();
        this.createPhysicsShape();
    }

    serialize(): Record<string, any> {
        return {
            ...super.serialize(),
            length: this._length,
            radius: this._radius,
            direction: this._direction,
        };
    }

    deserialize(data: Record<string, any>): void {
        super.deserialize(data);
        this._length = data.length ?? 1.0;
        this._radius = data.radius ?? 0.25;
        this._direction = data.direction ?? 'vertical';
    }
}
