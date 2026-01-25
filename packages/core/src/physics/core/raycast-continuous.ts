import { Vec3, IVec3Like, EPSILON } from '@axrone/numeric';
import type {
    IRaycastHit3D,
    LayerMask,
    RaycastFlags,
} from '../types/raycast-types';
import type { RaycastSystem3D } from './raycast-system';
import type { BodyId } from '../types/primitives';

export interface ITimeOfImpact {
    readonly hit: boolean;
    readonly time: number;
    readonly fraction: number;
    readonly normal: Readonly<IVec3Like>;
    readonly witness1: Readonly<IVec3Like>;
    readonly witness2: Readonly<IVec3Like>;
}

export interface ISweepTestQuery {
    readonly startPosition: Readonly<IVec3Like>;
    readonly endPosition: Readonly<IVec3Like>;
    readonly layerMask: LayerMask;
    readonly maxIterations: number;
    readonly tolerance: number;
}

export class ContinuousRaycast3D {
    private readonly _raycastSystem: RaycastSystem3D;
    private readonly _tempVec3: Vec3 = Vec3.ZERO.clone();
    private readonly _epsilon: number = 1e-6;

    constructor(raycastSystem: RaycastSystem3D) {
        this._raycastSystem = raycastSystem;
    }

    public sweepTest(query: ISweepTestQuery): ITimeOfImpact {
        const displacement = Vec3.subtract(query.endPosition, query.startPosition);
        const distance = Vec3.len(displacement);

        if (distance < this._epsilon) {
            return this._createNoHit();
        }

        const direction = Vec3.multiplyScalar(displacement, 1 / distance);

        let t0 = 0;
        let t1 = 1;
        let iteration = 0;

        while (iteration < query.maxIterations && (t1 - t0) > query.tolerance) {
            const midT = (t0 + t1) * 0.5;
            const testPosition = Vec3.create(
                query.startPosition.x + displacement.x * midT,
                query.startPosition.y + displacement.y * midT,
                query.startPosition.z + displacement.z * midT
            );

            const rayDistance = distance * (1 - midT);
            const hit = this._raycastSystem.raycast(
                testPosition,
                direction,
                rayDistance,
                query.layerMask
            );

            if (hit) {
                t1 = midT;
            } else {
                t0 = midT;
            }

            iteration++;
        }

        if (t1 < 1.0) {
            const hitPosition = Vec3.create(
                query.startPosition.x + displacement.x * t1,
                query.startPosition.y + displacement.y * t1,
                query.startPosition.z + displacement.z * t1
            );

            const finalHit = this._raycastSystem.raycast(
                hitPosition,
                direction,
                distance * (1 - t1) + this._epsilon,
                query.layerMask
            );

            if (finalHit) {
                return {
                    hit: true,
                    time: t1,
                    fraction: t1,
                    normal: finalHit.normal,
                    witness1: hitPosition,
                    witness2: finalHit.point
                };
            }
        }

        return this._createNoHit();
    }

    public continuousCast(
        startOrigin: Readonly<IVec3Like>,
        endOrigin: Readonly<IVec3Like>,
        direction: Readonly<IVec3Like>,
        maxDistance: number,
        layerMask: LayerMask,
        samples: number = 10
    ): IRaycastHit3D | null {
        let closestHit: IRaycastHit3D | null = null;
        let closestFraction = 1;

        for (let i = 0; i <= samples; i++) {
            const t = i / samples;
            const origin = Vec3.create(
                startOrigin.x * (1 - t) + endOrigin.x * t,
                startOrigin.y * (1 - t) + endOrigin.y * t,
                startOrigin.z * (1 - t) + endOrigin.z * t
            );

            const hit = this._raycastSystem.raycast(origin, direction, maxDistance, layerMask);

            if (hit) {
                const totalFraction = t + (1 - t) * hit.fraction;
                if (totalFraction < closestFraction) {
                    closestHit = hit;
                    closestFraction = totalFraction;
                }
            }
        }

        return closestHit;
    }

    public predictiveRaycast(
        origin: Readonly<IVec3Like>,
        velocity: Readonly<IVec3Like>,
        targetPosition: Readonly<IVec3Like>,
        targetVelocity: Readonly<IVec3Like>,
        layerMask: LayerMask,
        maxTime: number = 10,
        timeStep: number = 0.016
    ): IRaycastHit3D | null {
        const steps = Math.ceil(maxTime / timeStep);

        for (let i = 0; i < steps; i++) {
            const t = i * timeStep;

            const currentOrigin = Vec3.create(
                origin.x + velocity.x * t,
                origin.y + velocity.y * t,
                origin.z + velocity.z * t
            );

            const currentTarget = Vec3.create(
                targetPosition.x + targetVelocity.x * t,
                targetPosition.y + targetVelocity.y * t,
                targetPosition.z + targetVelocity.z * t
            );

            const direction = Vec3.subtract(currentTarget, currentOrigin);
            const distance = Vec3.len(direction);

            if (distance < EPSILON) continue;

            Vec3.normalize(direction, direction);

            const hit = this._raycastSystem.raycast(
                currentOrigin,
                direction,
                distance,
                layerMask
            );

            if (hit) {
                return hit;
            }
        }

        return null;
    }

    public linearSweep(
        start: Readonly<IVec3Like>,
        end: Readonly<IVec3Like>,
        layerMask: LayerMask,
        resolution: number = 0.1
    ): IRaycastHit3D | null {
        const displacement = Vec3.subtract(end, start);
        const distance = Vec3.len(displacement);

        if (distance < this._epsilon) {
            return null;
        }

        const direction = Vec3.multiplyScalar(displacement, 1 / distance);
        const steps = Math.max(1, Math.ceil(distance / resolution));
        const stepSize = distance / steps;

        for (let i = 0; i <= steps; i++) {
            const t = (i * stepSize) / distance;
            const position = Vec3.create(
                start.x + displacement.x * t,
                start.y + displacement.y * t,
                start.z + displacement.z * t
            );

            const remainingDistance = distance * (1 - t);
            const hit = this._raycastSystem.raycast(
                position,
                direction,
                remainingDistance + this._epsilon,
                layerMask
            );

            if (hit) {
                return hit;
            }
        }

        return null;
    }

    private _createNoHit(): ITimeOfImpact {
        return {
            hit: false,
            time: 0,
            fraction: 0,
            normal: Vec3.ZERO,
            witness1: Vec3.ZERO,
            witness2: Vec3.ZERO
        };
    }
}

export class AdaptiveRaycaster3D {
    private readonly _raycastSystem: RaycastSystem3D;
    private readonly _performanceThreshold: number = 16.67;
    private readonly _performanceHistory: number[] = [];
    private readonly _maxHistorySize: number = 60;
    private _currentQuality: number = 1.0;
    private _minQuality: number = 0.25;
    private _maxQuality: number = 1.0;

    constructor(raycastSystem: RaycastSystem3D) {
        this._raycastSystem = raycastSystem;
    }

    public adaptiveRaycast(
        origin: Readonly<IVec3Like>,
        direction: Readonly<IVec3Like>,
        maxDistance: number,
        layerMask: LayerMask,
        performanceTime: number
    ): IRaycastHit3D | null {
        this._updatePerformanceHistory(performanceTime);
        this._adjustQuality();

        return this._raycastSystem.raycast(origin, direction, maxDistance, layerMask);
    }

    public adaptiveBatchRaycast(
        origins: readonly IVec3Like[],
        directions: readonly IVec3Like[],
        maxDistances: readonly number[],
        layerMask: LayerMask,
        performanceTime: number
    ): (IRaycastHit3D | null)[] {
        this._updatePerformanceHistory(performanceTime);
        this._adjustQuality();

        const count = Math.min(origins.length, directions.length, maxDistances.length);
        const qualityCount = Math.max(1, Math.floor(count * this._currentQuality));
        const stride = Math.max(1, Math.floor(count / qualityCount));

        const results: (IRaycastHit3D | null)[] = new Array(count).fill(null);

        for (let i = 0; i < count; i += stride) {
            const hit = this._raycastSystem.raycast(
                origins[i],
                directions[i],
                maxDistances[i],
                layerMask
            );
            results[i] = hit;
        }

        return results;
    }

    public get currentQuality(): number {
        return this._currentQuality;
    }

    public set minQuality(value: number) {
        this._minQuality = Math.max(0.1, Math.min(1.0, value));
    }

    public set maxQuality(value: number) {
        this._maxQuality = Math.max(0.1, Math.min(1.0, value));
    }

    private _updatePerformanceHistory(performanceTime: number): void {
        this._performanceHistory.push(performanceTime);

        if (this._performanceHistory.length > this._maxHistorySize) {
            this._performanceHistory.shift();
        }
    }

    private _adjustQuality(): void {
        if (this._performanceHistory.length < 10) return;

        const recentPerformance = this._performanceHistory.slice(-10);
        const avgPerformance = recentPerformance.reduce((a, b) => a + b, 0) / recentPerformance.length;

        if (avgPerformance > this._performanceThreshold * 1.2) {
            this._currentQuality = Math.max(this._minQuality, this._currentQuality * 0.9);
        } else if (avgPerformance < this._performanceThreshold * 0.8) {
            this._currentQuality = Math.min(this._maxQuality, this._currentQuality * 1.1);
        }

        this._currentQuality = Math.max(this._minQuality, Math.min(this._maxQuality, this._currentQuality));
    }
}

export class PriorityRaycaster3D {
    private readonly _raycastSystem: RaycastSystem3D;
    private readonly _queue: Array<{
        priority: number;
        origin: IVec3Like;
        direction: IVec3Like;
        maxDistance: number;
        layerMask: LayerMask;
        callback: (hit: IRaycastHit3D | null) => void;
    }> = [];
    private _maxBudget: number = 100;
    private _currentBudget: number = 100;

    constructor(raycastSystem: RaycastSystem3D) {
        this._raycastSystem = raycastSystem;
    }

    public enqueue(
        priority: number,
        origin: Readonly<IVec3Like>,
        direction: Readonly<IVec3Like>,
        maxDistance: number,
        layerMask: LayerMask,
        callback: (hit: IRaycastHit3D | null) => void
    ): void {
        this._queue.push({
            priority,
            origin,
            direction,
            maxDistance,
            layerMask,
            callback
        });

        this._queue.sort((a, b) => b.priority - a.priority);
    }

    public processBatch(budget?: number): number {
        const effectiveBudget = budget ?? this._currentBudget;
        let processed = 0;

        while (this._queue.length > 0 && processed < effectiveBudget) {
            const item = this._queue.shift()!;
            const hit = this._raycastSystem.raycast(
                item.origin,
                item.direction,
                item.maxDistance,
                item.layerMask
            );
            item.callback(hit);
            processed++;
        }

        this._currentBudget = Math.max(0, effectiveBudget - processed);
        return processed;
    }

    public resetBudget(): void {
        this._currentBudget = this._maxBudget;
    }

    public set maxBudget(value: number) {
        this._maxBudget = Math.max(1, value);
    }

    public get queueSize(): number {
        return this._queue.length;
    }

    public clear(): void {
        this._queue.length = 0;
    }
}

export function createContinuousRaycast3D(raycastSystem: RaycastSystem3D): ContinuousRaycast3D {
    return new ContinuousRaycast3D(raycastSystem);
}

export function createAdaptiveRaycaster3D(raycastSystem: RaycastSystem3D): AdaptiveRaycaster3D {
    return new AdaptiveRaycaster3D(raycastSystem);
}

export function createPriorityRaycaster3D(raycastSystem: RaycastSystem3D): PriorityRaycaster3D {
    return new PriorityRaycaster3D(raycastSystem);
}
