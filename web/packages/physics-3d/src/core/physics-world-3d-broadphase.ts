import { Vec3, type IVec3Like } from '@axrone/numeric';
import { makeCollisionPairKey } from '@axrone/physics-core';
import type { BodyId3D, ShapeId3D } from '../types/physics-3d';
import {
    BODY_TYPE_STATIC,
    type IAabb3D,
    type IShapeDescriptor3D,
    type IShapePairCandidate3D,
    shouldShapeFiltersCollide,
} from './physics-world-3d-shared';
import type { DynamicAABBTree3D } from './broadphase-3d';
import { broadphaseDiagnostics } from './broadphase-diagnostics-3d';
import { SweepAndPrune3D, type SweepAxis3D } from './broadphase-sweep-3d';

export interface IBroadphaseHost {
    readonly bodyManager: {
        isEnabled(bodyId: BodyId3D): boolean;
        getBodyType(bodyId: BodyId3D): number;
    };
    readonly shapeDescriptors: ReadonlyMap<ShapeId3D, IShapeDescriptor3D>;
    readonly getCollisionFilter: () => { shouldCollide(a: ShapeId3D, b: ShapeId3D): boolean } | null;
    readonly computeShapeAabb: (descriptor: IShapeDescriptor3D) => IAabb3D;
}

export type BroadphaseStrategy3D = 'tree' | 'sweep';

interface ICandidateRecord3D {
    descriptorA: IShapeDescriptor3D;
    descriptorB: IShapeDescriptor3D;
    aabbA: IAabb3D;
    aabbB: IAabb3D;
    pairKey: number;
}

let defaultStrategy: BroadphaseStrategy3D = 'tree';
const defaultSweepAxis: SweepAxis3D = 'x';

export function setDefaultBroadphaseStrategy(strategy: BroadphaseStrategy3D): void {
    defaultStrategy = strategy;
}

export function getDefaultBroadphaseStrategy(): BroadphaseStrategy3D {
    return defaultStrategy;
}

export class PhysicsWorld3DBroadphase {
    private readonly _shapeProxyMap = new Map<ShapeId3D, number>();
    private readonly _shapePreviousCenter = new Map<ShapeId3D, IVec3Like>();
    private readonly _candidateRecords: ICandidateRecord3D[] = [];
    private readonly _candidatePool: ICandidateRecord3D[] = [];
    private _candidateCount = 0;
    private _proxyDescriptors: (IShapeDescriptor3D | undefined)[] = [];
    private _proxyNumericIds: number[] = [];
    private readonly _sweep: SweepAndPrune3D;
    private _strategy: BroadphaseStrategy3D;
    private readonly _scratchAabb: { min: IVec3Like; max: IVec3Like } = {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 0, y: 0, z: 0 },
    };
    private readonly _scratchCenter: IVec3Like = { x: 0, y: 0, z: 0 };
    private readonly _scratchDisp: IVec3Like = { x: 0, y: 0, z: 0 };

    constructor(
        private readonly _broadphase: DynamicAABBTree3D<ShapeId3D>,
        strategy?: BroadphaseStrategy3D,
        sweepAxis?: SweepAxis3D,
    ) {
        this._strategy = strategy ?? defaultStrategy;
        this._sweep = new SweepAndPrune3D(sweepAxis ?? defaultSweepAxis);
    }

    get strategy(): BroadphaseStrategy3D {
        return this._strategy;
    }

    get sweep(): SweepAndPrune3D {
        return this._sweep;
    }

    setStrategy(strategy: BroadphaseStrategy3D): void {
        this._strategy = strategy;
    }

    collectPotentialCollisionPairs(host: IBroadphaseHost): IShapePairCandidate3D[] {
        this._candidateCount = 0;
        const diag = broadphaseDiagnostics;
        const traced = diag.enabled;
        const upkeepStart = traced ? performance.now() : 0;

        const filter = host.getCollisionFilter();
        for (const d of host.shapeDescriptors.values()) {
            if (traced) diag.shapesVisited++;
            if (!host.bodyManager.isEnabled(d.bodyId)) continue;

            const rawAabb = host.computeShapeAabb(d);
            this._scratchAabb.min.x = rawAabb.min.x;
            this._scratchAabb.min.y = rawAabb.min.y;
            this._scratchAabb.min.z = rawAabb.min.z;
            this._scratchAabb.max.x = rawAabb.max.x;
            this._scratchAabb.max.y = rawAabb.max.y;
            this._scratchAabb.max.z = rawAabb.max.z;

            this._scratchCenter.x = (rawAabb.min.x + rawAabb.max.x) * 0.5;
            this._scratchCenter.y = (rawAabb.min.y + rawAabb.max.y) * 0.5;
            this._scratchCenter.z = (rawAabb.min.z + rawAabb.max.z) * 0.5;

            const existing = this._shapeProxyMap.get(d.id);
            if (traced) diag.enabledShapes++;
            let proxyId: number;
            if (existing !== undefined) {
                proxyId = existing;
                const prev = this._shapePreviousCenter.get(d.id);
                if (prev) {
                    this._scratchDisp.x = this._scratchCenter.x - prev.x;
                    this._scratchDisp.y = this._scratchCenter.y - prev.y;
                    this._scratchDisp.z = this._scratchCenter.z - prev.z;
                } else {
                    this._scratchDisp.x = 0;
                    this._scratchDisp.y = 0;
                    this._scratchDisp.z = 0;
                }
                const reinserted = this._broadphase.moveProxy(existing, this._scratchAabb, this._scratchDisp);
                if (traced) {
                    if (reinserted) diag.proxiesReinserted++;
                    else diag.proxiesContained++;
                }
            } else {
                proxyId = this._broadphase.createProxy(this._scratchAabb, d.id);
                this._shapeProxyMap.set(d.id, proxyId);
                if (traced) diag.proxiesCreated++;
            }
            this._proxyDescriptors[proxyId] = d;
            this._proxyNumericIds[proxyId] = Number(d.id);
            const prevCenter = this._shapePreviousCenter.get(d.id);
            if (prevCenter) {
                prevCenter.x = this._scratchCenter.x;
                prevCenter.y = this._scratchCenter.y;
                prevCenter.z = this._scratchCenter.z;
            } else {
                this._shapePreviousCenter.set(d.id, {
                    x: this._scratchCenter.x,
                    y: this._scratchCenter.y,
                    z: this._scratchCenter.z,
                });
            }
        }

        const pairStart = traced ? performance.now() : 0;
        if (traced) {
            diag.upkeepMs += pairStart - upkeepStart;
        }

        if (this._strategy === 'sweep') {
            this._sweep.sync(this._broadphase);
            this._sweep.queryPairs((pA, pB) => this._emitCandidate(host, filter, pA, pB, traced));
        } else {
            this._broadphase.queryPairs((pA, pB) => this._emitCandidate(host, filter, pA, pB, traced));
        }

        if (traced) {
            const tree = this._broadphase;
            diag.pairQueryMs += performance.now() - pairStart;
            if (this._strategy === 'sweep') {
                diag.pairQueryNodeVisits += 0;
                diag.pairQueryTestedBoxes += this._sweep.boxTests;
                diag.leafPairsReported += this._sweep.leafPairs;
            } else {
                diag.pairQueryNodeVisits += tree.pairQueryNodeVisits;
                diag.pairQueryTestedBoxes += tree.pairQueryTestedBoxes;
                diag.leafPairsReported += tree.pairQueryLeafPairs;
            }
            diag.candidates += this._candidateCount;
            diag.steps++;
        }

        if (this._candidateRecords.length !== this._candidateCount) {
            this._candidateRecords.length = this._candidateCount;
        }
        return this._candidateRecords;
    }

    private _emitCandidate(
        host: IBroadphaseHost,
        filter: { shouldCollide(a: ShapeId3D, b: ShapeId3D): boolean } | null,
        pA: number,
        pB: number,
        traced: boolean
    ): boolean {
        const diag = broadphaseDiagnostics;
        const dA = this._proxyDescriptors[pA];
        const dB = this._proxyDescriptors[pB];
        if (!dA || !dB) { if (traced) diag.filteredOut++; return true; }
        if (dA.bodyId === dB.bodyId) { if (traced) diag.filteredOut++; return true; }
        if (!host.bodyManager.isEnabled(dA.bodyId)) { if (traced) diag.filteredOut++; return true; }
        if (!host.bodyManager.isEnabled(dB.bodyId)) { if (traced) diag.filteredOut++; return true; }
        if (!shouldShapeFiltersCollide(dA.filter, dB.filter)) { if (traced) diag.filteredOut++; return true; }
        if (filter && !filter.shouldCollide(dA.id, dB.id)) { if (traced) diag.filteredOut++; return true; }
        const tA = host.bodyManager.getBodyType(dA.bodyId);
        const tB = host.bodyManager.getBodyType(dB.bodyId);
        if (tA === BODY_TYPE_STATIC && tB === BODY_TYPE_STATIC) { if (traced) diag.filteredOut++; return true; }

        const index = this._candidateCount;
        this._candidateCount = index + 1;
        const idA = this._proxyNumericIds[pA];
        const idB = this._proxyNumericIds[pB];
        const aabbA = this._broadphase.getAABB(pA);
        const aabbB = this._broadphase.getAABB(pB);
        const pairKey = makeCollisionPairKey(idA, idB);
        const pooled = this._candidatePool[index];
        if (pooled === undefined) {
            const created: ICandidateRecord3D = { descriptorA: dA, descriptorB: dB, aabbA, aabbB, pairKey };
            this._candidatePool[index] = created;
            this._candidateRecords[index] = created;
        } else {
            pooled.descriptorA = dA;
            pooled.descriptorB = dB;
            pooled.aabbA = aabbA;
            pooled.aabbB = aabbB;
            pooled.pairKey = pairKey;
            this._candidateRecords[index] = pooled;
        }
        return true;
    }

    pruneShape(shapeId: ShapeId3D): void {
        const proxy = this._shapeProxyMap.get(shapeId);
        if (proxy !== undefined) {
            this._broadphase.destroyProxy(proxy);
            this._shapeProxyMap.delete(shapeId);
            this._proxyDescriptors[proxy] = undefined;
        }
        this._shapePreviousCenter.delete(shapeId);
    }
}
