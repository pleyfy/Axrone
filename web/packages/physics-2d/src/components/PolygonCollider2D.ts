import { Vec2 } from '@axrone/numeric';
import { script } from '@axrone/ecs-runtime/decorators';
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
        this._vertices = value.map((v) => Vec2.from(v));
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

        this._shapeId = this._physicsWorld.createPolygonShape(this._rigidbody.bodyId, {
            vertices: this._vertices.map((v) => ({
                x: v.x + this._offset.x,
                y: v.y + this._offset.y,
            })),
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
            vertices: this._vertices.map((v) => ({ x: v.x, y: v.y })),
        };
    }

    deserialize(data: Record<string, any>): void {
        super.deserialize(data);
        const vertices = Array.isArray(data.vertices) ? data.vertices : [];
        // Each vertex may arrive as the Editor's `[x, y]` or the engine's `{x, y}`.
        this._vertices = vertices.map((v: unknown) => {
            const point = this.normalizeVec2(v);
            return new Vec2(point.x, point.y);
        });
    }
}
