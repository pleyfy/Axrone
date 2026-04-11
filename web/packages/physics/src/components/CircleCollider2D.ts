import { script } from '@axrone/ecs/decorators';
import { Collider2D } from './collider2d';

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
