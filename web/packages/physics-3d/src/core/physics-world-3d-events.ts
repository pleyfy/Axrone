import { CollisionEventType, SensorEventType } from '../types';
import type {
    ICollisionEvent3D,
    IContactListener3D,
    ISensorEvent3D,
} from '../types/physics-3d';
import type { IContactManifold3D } from '../types';
import type { IResolvedContactManifold3D } from './physics-world-3d-shared';

export interface IEventsHost {
    readonly getContactListener: () => IContactListener3D | null;
    readonly toContactManifold: (m: IResolvedContactManifold3D) => IContactManifold3D;
}

export class PhysicsWorld3DEvents {
    private _stayCollisionEvent: ICollisionEvent3D | null = null;
    private _staySensorEvent: ISensorEvent3D | null = null;

    constructor(private readonly _host: IEventsHost) {}

    dispatchEvents(
        next: ReadonlyMap<number, IResolvedContactManifold3D>,
        prev: ReadonlyMap<number, IResolvedContactManifold3D>
    ): void {
        const listener = this._host.getContactListener();
        if (!listener) return;
        const now = performance.now();

        for (const [key, m] of next.entries()) {
            if (!prev.has(key)) {
                if (m.sensor) {
                    const event: ISensorEvent3D = {
                        type: SensorEventType.Enter,
                        sensorBodyId: m.bodyIdA,
                        sensorShapeId: m.shapeIdA,
                        visitorBodyId: m.bodyIdB,
                        visitorShapeId: m.shapeIdB,
                        timestamp: now,
                    };
                    listener.onSensorEnter?.(event);
                } else {
                    const event: ICollisionEvent3D = {
                        type: CollisionEventType.Begin,
                        bodyIdA: m.bodyIdA,
                        bodyIdB: m.bodyIdB,
                        shapeIdA: m.shapeIdA,
                        shapeIdB: m.shapeIdB,
                        manifold: this._host.toContactManifold(m),
                        timestamp: now,
                    };
                    listener.onCollisionBegin?.(event);
                }
            }
        }

        for (const [key, m] of next.entries()) {
            if (prev.has(key)) {
                if (m.sensor) {
                    if (!this._staySensorEvent) {
                        this._staySensorEvent = {
                            type: SensorEventType.Stay,
                            sensorBodyId: m.bodyIdA,
                            sensorShapeId: m.shapeIdA,
                            visitorBodyId: m.bodyIdB,
                            visitorShapeId: m.shapeIdB,
                            timestamp: now,
                        };
                    } else {
                        this._staySensorEvent = {
                            type: SensorEventType.Stay,
                            sensorBodyId: m.bodyIdA,
                            sensorShapeId: m.shapeIdA,
                            visitorBodyId: m.bodyIdB,
                            visitorShapeId: m.shapeIdB,
                            timestamp: now,
                        };
                    }
                    listener.onSensorStay?.(this._staySensorEvent);
                } else {
                    const manifold = this._host.toContactManifold(m);
                    if (!this._stayCollisionEvent) {
                        this._stayCollisionEvent = {
                            type: CollisionEventType.Stay,
                            bodyIdA: m.bodyIdA,
                            bodyIdB: m.bodyIdB,
                            shapeIdA: m.shapeIdA,
                            shapeIdB: m.shapeIdB,
                            manifold,
                            timestamp: now,
                        };
                    } else {
                        this._stayCollisionEvent = {
                            type: CollisionEventType.Stay,
                            bodyIdA: m.bodyIdA,
                            bodyIdB: m.bodyIdB,
                            shapeIdA: m.shapeIdA,
                            shapeIdB: m.shapeIdB,
                            manifold,
                            timestamp: now,
                        };
                    }
                    listener.onCollisionStay?.(this._stayCollisionEvent);
                }
            }
        }

        for (const [key, m] of prev.entries()) {
            if (!next.has(key)) {
                if (m.sensor) {
                    const event: ISensorEvent3D = {
                        type: SensorEventType.Exit,
                        sensorBodyId: m.bodyIdA,
                        sensorShapeId: m.shapeIdA,
                        visitorBodyId: m.bodyIdB,
                        visitorShapeId: m.shapeIdB,
                        timestamp: now,
                    };
                    listener.onSensorExit?.(event);
                } else {
                    const event: ICollisionEvent3D = {
                        type: CollisionEventType.End,
                        bodyIdA: m.bodyIdA,
                        bodyIdB: m.bodyIdB,
                        shapeIdA: m.shapeIdA,
                        shapeIdB: m.shapeIdB,
                        manifold: this._host.toContactManifold(m),
                        timestamp: now,
                    };
                    listener.onCollisionEnd?.(event);
                }
            }
        }
    }
}
