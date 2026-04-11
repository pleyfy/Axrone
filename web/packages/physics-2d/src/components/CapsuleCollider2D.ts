import { script } from '@axrone/ecs/decorators';
import { Collider2D } from './collider2d';

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
        const p1 =
            this._direction === 'vertical'
                ? { x: this._offset.x, y: this._offset.y - halfLength }
                : { x: this._offset.x - halfLength, y: this._offset.y };
        const p2 =
            this._direction === 'vertical'
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
