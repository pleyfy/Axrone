import { Vec3, IVec3Like, EPSILON } from '@axrone/numeric';
import type { IAABB } from '@axrone/geometry';

const MAX_DEPTH = 64;
const MIN_PRIMITIVES_PER_LEAF = 4;
const MAX_PRIMITIVES_PER_LEAF = 8;
const TRAVERSAL_COST = 1.0;
const INTERSECTION_COST = 1.0;

interface BVHPrimitive {
    readonly index: number;
    readonly centroid: Readonly<IVec3Like>;
    readonly bounds: IAABB<IVec3Like>;
}

interface BVHNode {
    bounds: IAABB<IVec3Like>;
    left: number;
    right: number;
    splitAxis: number;
    firstPrimIndex: number;
    primCount: number;
}

interface BVHBuildInfo {
    nodeCount: number;
    maxDepth: number;
    leafCount: number;
}

const enum SplitMethod {
    Middle = 0,
    SAH = 1,
    EqualCounts = 2,
}

class BVHBucket {
    public count: number = 0;
    public bounds: IAABB<IVec3Like> | null = null;
}

export class BoundingVolumeHierarchy {
    private _nodes: BVHNode[] = [];
    private _primitives: BVHPrimitive[] = [];
    private _orderedPrimitives: BVHPrimitive[] = [];
    private _buildInfo: BVHBuildInfo = { nodeCount: 0, maxDepth: 0, leafCount: 0 };
    private _splitMethod: SplitMethod = SplitMethod.SAH;

    constructor(splitMethod: SplitMethod = SplitMethod.SAH) {
        this._splitMethod = splitMethod;
    }

    public build(primitives: BVHPrimitive[]): void {
        if (primitives.length === 0) {
            return;
        }

        this._primitives = primitives.slice();
        this._orderedPrimitives = [];
        this._nodes = [];
        this._buildInfo = { nodeCount: 0, maxDepth: 0, leafCount: 0 };

        const totalPrims = primitives.length;
        const indices = Array.from({ length: totalPrims }, (_, i) => i);

        this._recursiveBuild(indices, 0, totalPrims, 0);
    }

    public intersect(
        origin: Readonly<IVec3Like>,
        invDirection: Readonly<IVec3Like>,
        maxDistance: number,
        callback: (primIndex: number, tMin: number, tMax: number) => boolean
    ): boolean {
        if (this._nodes.length === 0) {
            return false;
        }

        const nodesToVisit: { nodeIndex: number; tMin: number; tMax: number }[] = [];
        let toVisitOffset = 0;
        let currentNodeIndex = 0;
        let foundHit = false;

        const dirIsNeg = [invDirection.x < 0, invDirection.y < 0, invDirection.z < 0];

        while (true) {
            const node = this._nodes[currentNodeIndex];

            const aabbHitResult = { tMin: 0, tMax: 0 };
            if (
                this._intersectAABB(origin, invDirection, node.bounds, maxDistance, aabbHitResult)
            ) {
                if (node.primCount > 0) {
                    for (let i = 0; i < node.primCount; i++) {
                        const primIndex = this._orderedPrimitives[node.firstPrimIndex + i].index;
                        if (callback(primIndex, aabbHitResult.tMin, aabbHitResult.tMax)) {
                            foundHit = true;
                        }
                    }

                    if (toVisitOffset === 0) break;
                    const next = nodesToVisit[--toVisitOffset];
                    currentNodeIndex = next.nodeIndex;
                } else {
                    const axis = node.splitAxis;
                    const firstChild = dirIsNeg[axis] ? node.right : node.left;
                    const secondChild = dirIsNeg[axis] ? node.left : node.right;

                    nodesToVisit[toVisitOffset++] = {
                        nodeIndex: secondChild,
                        tMin: aabbHitResult.tMin,
                        tMax: aabbHitResult.tMax,
                    };
                    currentNodeIndex = firstChild;
                }
            } else {
                if (toVisitOffset === 0) break;
                const next = nodesToVisit[--toVisitOffset];
                currentNodeIndex = next.nodeIndex;
            }
        }

        return foundHit;
    }

    public get nodeCount(): number {
        return this._buildInfo.nodeCount;
    }

    public get maxDepth(): number {
        return this._buildInfo.maxDepth;
    }

    public get leafCount(): number {
        return this._buildInfo.leafCount;
    }

    private _recursiveBuild(indices: number[], start: number, end: number, depth: number): number {
        this._buildInfo.maxDepth = Math.max(this._buildInfo.maxDepth, depth);

        const nodeIndex = this._nodes.length;
        this._buildInfo.nodeCount++;

        const node: BVHNode = {
            bounds: this._computeBounds(indices, start, end),
            left: -1,
            right: -1,
            splitAxis: 0,
            firstPrimIndex: 0,
            primCount: 0,
        };

        this._nodes.push(node);

        const nPrimitives = end - start;

        if (nPrimitives <= MAX_PRIMITIVES_PER_LEAF || depth >= MAX_DEPTH) {
            node.firstPrimIndex = this._orderedPrimitives.length;
            node.primCount = nPrimitives;
            this._buildInfo.leafCount++;

            for (let i = start; i < end; i++) {
                this._orderedPrimitives.push(this._primitives[indices[i]]);
            }

            return nodeIndex;
        }

        const centroidBounds = this._computeCentroidBounds(indices, start, end);
        const dim = this._maxExtentAxis(centroidBounds);
        node.splitAxis = dim;

        if (this._isDegenerate(centroidBounds, dim)) {
            node.firstPrimIndex = this._orderedPrimitives.length;
            node.primCount = nPrimitives;
            this._buildInfo.leafCount++;

            for (let i = start; i < end; i++) {
                this._orderedPrimitives.push(this._primitives[indices[i]]);
            }

            return nodeIndex;
        }

        let mid: number;

        if (this._splitMethod === SplitMethod.Middle) {
            mid = this._splitMiddle(indices, start, end, dim, centroidBounds);
        } else if (this._splitMethod === SplitMethod.EqualCounts) {
            mid = Math.floor((start + end) / 2);
            this._partitionByMedian(indices, start, end, mid, dim);
        } else {
            if (nPrimitives <= MIN_PRIMITIVES_PER_LEAF) {
                mid = Math.floor((start + end) / 2);
                this._partitionByMedian(indices, start, end, mid, dim);
            } else {
                mid = this._splitSAH(indices, start, end, dim, node.bounds);
            }
        }

        node.left = this._recursiveBuild(indices, start, mid, depth + 1);
        node.right = this._recursiveBuild(indices, mid, end, depth + 1);

        return nodeIndex;
    }

    private _computeBounds(indices: number[], start: number, end: number): IAABB<IVec3Like> {
        const first = this._primitives[indices[start]];
        let minX = first.bounds.min.x,
            minY = first.bounds.min.y,
            minZ = first.bounds.min.z;
        let maxX = first.bounds.max.x,
            maxY = first.bounds.max.y,
            maxZ = first.bounds.max.z;

        for (let i = start + 1; i < end; i++) {
            const prim = this._primitives[indices[i]];
            minX = Math.min(minX, prim.bounds.min.x);
            minY = Math.min(minY, prim.bounds.min.y);
            minZ = Math.min(minZ, prim.bounds.min.z);
            maxX = Math.max(maxX, prim.bounds.max.x);
            maxY = Math.max(maxY, prim.bounds.max.y);
            maxZ = Math.max(maxZ, prim.bounds.max.z);
        }

        return {
            min: { x: minX, y: minY, z: minZ },
            max: { x: maxX, y: maxY, z: maxZ },
        } as IAABB<IVec3Like>;
    }

    private _computeCentroidBounds(
        indices: number[],
        start: number,
        end: number
    ): IAABB<IVec3Like> {
        const first = this._primitives[indices[start]].centroid;
        let minX = first.x,
            minY = first.y,
            minZ = first.z;
        let maxX = first.x,
            maxY = first.y,
            maxZ = first.z;

        for (let i = start + 1; i < end; i++) {
            const centroid = this._primitives[indices[i]].centroid;
            minX = Math.min(minX, centroid.x);
            minY = Math.min(minY, centroid.y);
            minZ = Math.min(minZ, centroid.z);
            maxX = Math.max(maxX, centroid.x);
            maxY = Math.max(maxY, centroid.y);
            maxZ = Math.max(maxZ, centroid.z);
        }

        return {
            min: { x: minX, y: minY, z: minZ },
            max: { x: maxX, y: maxY, z: maxZ },
        } as IAABB<IVec3Like>;
    }

    private _maxExtentAxis(bounds: IAABB<IVec3Like>): number {
        const dx = bounds.max.x - bounds.min.x;
        const dy = bounds.max.y - bounds.min.y;
        const dz = bounds.max.z - bounds.min.z;

        if (dx > dy && dx > dz) return 0;
        if (dy > dz) return 1;
        return 2;
    }

    private _isDegenerate(bounds: IAABB<IVec3Like>, dim: number): boolean {
        const extent =
            dim === 0
                ? bounds.max.x - bounds.min.x
                : dim === 1
                  ? bounds.max.y - bounds.min.y
                  : bounds.max.z - bounds.min.z;
        return extent < EPSILON;
    }

    private _splitMiddle(
        indices: number[],
        start: number,
        end: number,
        dim: number,
        centroidBounds: IAABB<IVec3Like>
    ): number {
        const pmid =
            dim === 0
                ? (centroidBounds.min.x + centroidBounds.max.x) * 0.5
                : dim === 1
                  ? (centroidBounds.min.y + centroidBounds.max.y) * 0.5
                  : (centroidBounds.min.z + centroidBounds.max.z) * 0.5;

        let mid = start;
        for (let i = start; i < end; i++) {
            const centroid = this._primitives[indices[i]].centroid;
            const value = dim === 0 ? centroid.x : dim === 1 ? centroid.y : centroid.z;

            if (value < pmid) {
                const temp = indices[i];
                indices[i] = indices[mid];
                indices[mid] = temp;
                mid++;
            }
        }

        if (mid === start || mid === end) {
            mid = Math.floor((start + end) / 2);
        }

        return mid;
    }

    private _splitSAH(
        indices: number[],
        start: number,
        end: number,
        dim: number,
        nodeBounds: IAABB<IVec3Like>
    ): number {
        const nPrimitives = end - start;
        const nBuckets = 12;
        const buckets: BVHBucket[] = Array.from({ length: nBuckets }, () => new BVHBucket());

        const centroidBounds = this._computeCentroidBounds(indices, start, end);
        const extent =
            dim === 0
                ? centroidBounds.max.x - centroidBounds.min.x
                : dim === 1
                  ? centroidBounds.max.y - centroidBounds.min.y
                  : centroidBounds.max.z - centroidBounds.min.z;

        if (extent < EPSILON) {
            return Math.floor((start + end) / 2);
        }

        for (let i = start; i < end; i++) {
            const prim = this._primitives[indices[i]];
            const centroid = prim.centroid;
            const value = dim === 0 ? centroid.x : dim === 1 ? centroid.y : centroid.z;
            const minValue =
                dim === 0
                    ? centroidBounds.min.x
                    : dim === 1
                      ? centroidBounds.min.y
                      : centroidBounds.min.z;

            let b = Math.floor(nBuckets * ((value - minValue) / extent));
            if (b === nBuckets) b = nBuckets - 1;

            buckets[b].count++;
            if (!buckets[b].bounds) {
                buckets[b].bounds = prim.bounds;
            } else {
                buckets[b].bounds = this._unionAABB(buckets[b].bounds!, prim.bounds);
            }
        }

        const cost: number[] = new Array(nBuckets - 1);

        for (let i = 0; i < nBuckets - 1; i++) {
            let count0 = 0;
            let count1 = 0;
            let b0: IAABB<IVec3Like> | null = null;
            let b1: IAABB<IVec3Like> | null = null;

            for (let j = 0; j <= i; j++) {
                if (buckets[j].bounds) {
                    count0 += buckets[j].count;
                    b0 = b0 ? this._unionAABB(b0, buckets[j].bounds!) : buckets[j].bounds!;
                }
            }

            for (let j = i + 1; j < nBuckets; j++) {
                if (buckets[j].bounds) {
                    count1 += buckets[j].count;
                    b1 = b1 ? this._unionAABB(b1, buckets[j].bounds!) : buckets[j].bounds!;
                }
            }

            const sa0 = b0 ? this._surfaceArea(b0) : 0;
            const sa1 = b1 ? this._surfaceArea(b1) : 0;

            cost[i] =
                TRAVERSAL_COST +
                (INTERSECTION_COST * (count0 * sa0 + count1 * sa1)) / this._surfaceArea(nodeBounds);
        }

        let minCostSplitBucket = 0;
        let minCost = cost[0];
        for (let i = 1; i < nBuckets - 1; i++) {
            if (cost[i] < minCost) {
                minCost = cost[i];
                minCostSplitBucket = i;
            }
        }

        const leafCost = nPrimitives * INTERSECTION_COST;

        if (minCost < leafCost && nPrimitives > MAX_PRIMITIVES_PER_LEAF) {
            let mid = start;
            for (let i = start; i < end; i++) {
                const prim = this._primitives[indices[i]];
                const centroid = prim.centroid;
                const value = dim === 0 ? centroid.x : dim === 1 ? centroid.y : centroid.z;
                const minValue =
                    dim === 0
                        ? centroidBounds.min.x
                        : dim === 1
                          ? centroidBounds.min.y
                          : centroidBounds.min.z;

                let b = Math.floor(nBuckets * ((value - minValue) / extent));
                if (b === nBuckets) b = nBuckets - 1;

                if (b <= minCostSplitBucket) {
                    const temp = indices[i];
                    indices[i] = indices[mid];
                    indices[mid] = temp;
                    mid++;
                }
            }

            if (mid === start || mid === end) {
                return Math.floor((start + end) / 2);
            }

            return mid;
        }

        return Math.floor((start + end) / 2);
    }

    private _partitionByMedian(
        indices: number[],
        start: number,
        end: number,
        mid: number,
        dim: number
    ): void {
        const getValue = (index: number) => {
            const centroid = this._primitives[indices[index]].centroid;
            return dim === 0 ? centroid.x : dim === 1 ? centroid.y : centroid.z;
        };

        let left = start;
        let right = end - 1;

        while (left < right) {
            const pivot = getValue(Math.floor((left + right) / 2));
            let i = left;
            let j = right;

            while (i <= j) {
                while (getValue(i) < pivot) i++;
                while (getValue(j) > pivot) j--;

                if (i <= j) {
                    const temp = indices[i];
                    indices[i] = indices[j];
                    indices[j] = temp;
                    i++;
                    j--;
                }
            }

            if (mid <= j) {
                right = j;
            } else if (mid >= i) {
                left = i;
            } else {
                break;
            }
        }
    }

    private _unionAABB(a: IAABB<IVec3Like>, b: IAABB<IVec3Like>): IAABB<IVec3Like> {
        return {
            min: {
                x: Math.min(a.min.x, b.min.x),
                y: Math.min(a.min.y, b.min.y),
                z: Math.min(a.min.z, b.min.z),
            },
            max: {
                x: Math.max(a.max.x, b.max.x),
                y: Math.max(a.max.y, b.max.y),
                z: Math.max(a.max.z, b.max.z),
            },
        } as IAABB<IVec3Like>;
    }

    private _surfaceArea(bounds: IAABB<IVec3Like>): number {
        const dx = bounds.max.x - bounds.min.x;
        const dy = bounds.max.y - bounds.min.y;
        const dz = bounds.max.z - bounds.min.z;
        return 2 * (dx * dy + dy * dz + dz * dx);
    }

    private _intersectAABB(
        origin: Readonly<IVec3Like>,
        invDirection: Readonly<IVec3Like>,
        aabb: IAABB<IVec3Like>,
        maxDistance: number,
        out: { tMin: number; tMax: number }
    ): boolean {
        let tMin = 0;
        let tMax = maxDistance;

        const min = aabb.min;
        const max = aabb.max;

        {
            const t1 = (min.x - origin.x) * invDirection.x;
            const t2 = (max.x - origin.x) * invDirection.x;
            tMin = Math.max(tMin, Math.min(t1, t2));
            tMax = Math.min(tMax, Math.max(t1, t2));
        }

        {
            const t1 = (min.y - origin.y) * invDirection.y;
            const t2 = (max.y - origin.y) * invDirection.y;
            tMin = Math.max(tMin, Math.min(t1, t2));
            tMax = Math.min(tMax, Math.max(t1, t2));
        }

        {
            const t1 = (min.z - origin.z) * invDirection.z;
            const t2 = (max.z - origin.z) * invDirection.z;
            tMin = Math.max(tMin, Math.min(t1, t2));
            tMax = Math.min(tMax, Math.max(t1, t2));
        }

        const hit = tMax >= tMin && tMax >= 0;
        out.tMin = tMin;
        out.tMax = tMax;
        return hit;
    }
}

export { BVHPrimitive };
