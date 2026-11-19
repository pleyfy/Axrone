import { Vec2 } from '@axrone/numeric';
import { script } from '@axrone/ecs-runtime/decorators';
import { Collider2D } from './collider2d';
import { finiteOr } from '../core/physics-world-2d-helpers';

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

        this._shapeId = this._physicsWorld.createBoxShape(this._rigidbody.bodyId, {
            center: { x: this._offset.x, y: this._offset.y },
            halfWidth: this._size.x * 0.5,
            halfHeight: this._size.y * 0.5,
            rotation: this._angle,
            material: {
                friction: this._material.friction,
                restitution: this._material.restitution,
                density: this._material.density,
            },
            isSensor: this._isTrigger,
            filter: this._collisionFilter,
        });
    }

    protected destroyPhysicsShape(): void {
        if (!this._shapeId || !this._physicsWorld) return;
        this._physicsWorld.destroyShape(this._shapeId);
        this._shapeId = null;
    }

    protected updateTrigger(): void {
        this.recreateShape();
    }
    protected updateMaterial(): void {
        this.recreateShape();
    }
    protected updateOffset(): void {
        this.recreateShape();
    }
    protected updateCollisionFilter(): void {
        this.recreateShape();
    }

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
        // The Editor writes size as `[x, y]`, the engine reads `{x, y}`.
        const size = this.normalizeVec2(data.size, 1, 1);
        this._size = new Vec2(size.x, size.y);
        this._angle = finiteOr(data.angle, 0);
    }
}
