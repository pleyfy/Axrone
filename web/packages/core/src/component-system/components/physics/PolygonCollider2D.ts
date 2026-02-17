import { Vec2 } from '@axrone/numeric';
import { script } from '../../decorators';
import { Collider2D } from './collider2d';

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
        this._vertices = value.map((v) => new Vec2(v.x, v.y));
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
                vertices: this._vertices.map((v) => ({
                    x: v.x + this._offset.x,
                    y: v.y + this._offset.y,
                })),
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
            vertices: this._vertices.map((v) => ({ x: v.x, y: v.y })),
        };
    }

    deserialize(data: Record<string, any>): void {
        super.deserialize(data);
        this._vertices = (data.vertices ?? []).map((v: any) => new Vec2(v.x, v.y));
    }
}
