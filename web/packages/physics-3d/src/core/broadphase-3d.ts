import type { IVec3Like } from '@axrone/numeric';
import type { IAabb3D } from './physics-world-3d-shared';

/** Ray-AABB slab intersection. Returns fraction or -1 if miss. */
function _rayAabbSlab(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    minX: number, minY: number, minZ: number,
    maxX: number, maxY: number, maxZ: number,
    maxFrac: number
): number {
    let tmin = 0;
    let tmax = maxFrac;
    // X slab
    if (Math.abs(dx) < 1e-12) {
        if (ox < minX || ox > maxX) return -1;
    } else {
        const invD = 1.0 / dx;
        let t1 = (minX - ox) * invD;
        let t2 = (maxX - ox) * invD;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return -1;
    }
    // Y slab
    if (Math.abs(dy) < 1e-12) {
        if (oy < minY || oy > maxY) return -1;
    } else {
        const invD = 1.0 / dy;
        let t1 = (minY - oy) * invD;
        let t2 = (maxY - oy) * invD;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return -1;
    }
    // Z slab
    if (Math.abs(dz) < 1e-12) {
        if (oz < minZ || oz > maxZ) return -1;
    } else {
        const invD = 1.0 / dz;
        let t1 = (minZ - oz) * invD;
        let t2 = (maxZ - oz) * invD;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return -1;
    }
    return tmin;
}

/**
 * Box stored by a tree node: six mutable scalars and nothing else.
 *
 * The tree previously held `AABB3D` instances, which recompute centre, extents
 * and size on every construction and allocate a fresh object for each union
 * during insert/remove rebalancing. Node boxes are updated in place instead, so
 * a step performs zero tree allocations. The shape satisfies `IAabb3D`, so the
 * rest of the engine can keep reading `min`/`max`.
 */
export interface ITreeAabb3D {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
}

interface TreeNode3D<TUserData> {
    id: number;
    aabb: ITreeAabb3D;
    userData: TUserData | null;
    parent: number;
    child1: number;
    child2: number;
    height: number;
}

const NULL_NODE = -1;

const createEmptyBox = (): ITreeAabb3D => ({
    // Same neutral state as AABB3D.clear(): empty box, surface area 0.
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
});

/** `AABB3D.isEmpty` for a node box. */
function boxIsEmpty(box: ITreeAabb3D): boolean {
    return box.min.x > box.max.x || box.min.y > box.max.y || box.min.z > box.max.z;
}

/** `AABB3D.surfaceArea` for a node box. */
function boxSurfaceArea(box: ITreeAabb3D): number {
    if (boxIsEmpty(box)) return 0;
    const sx = box.max.x - box.min.x;
    const sy = box.max.y - box.min.y;
    const sz = box.max.z - box.min.z;
    return 2 * (sx * sy + sy * sz + sz * sx);
}

/** Writes the component-wise union of two boxes into `target`. */
function unionInto(target: ITreeAabb3D, a: ITreeAabb3D, b: ITreeAabb3D): void {
    target.min.x = Math.min(a.min.x, b.min.x);
    target.min.y = Math.min(a.min.y, b.min.y);
    target.min.z = Math.min(a.min.z, b.min.z);
    target.max.x = Math.max(a.max.x, b.max.x);
    target.max.y = Math.max(a.max.y, b.max.y);
    target.max.z = Math.max(a.max.z, b.max.z);
}

/** `AABB3D.intersectsAABB` between a node box and any readable box. */
function boxIntersects(box: ITreeAabb3D, other: IAabb3D): boolean {
    return (
        box.min.x <= other.max.x &&
        box.max.x >= other.min.x &&
        box.min.y <= other.max.y &&
        box.max.y >= other.min.y &&
        box.min.z <= other.max.z &&
        box.max.z >= other.min.z
    );
}

/** `AABB3D.containsAABB` for a node box holding a fat AABB. */
function boxContains(box: ITreeAabb3D, other: IAabb3D): boolean {
    return (
        box.min.x <= other.min.x &&
        box.max.x >= other.max.x &&
        box.min.y <= other.min.y &&
        box.max.y >= other.max.y &&
        box.min.z <= other.min.z &&
        box.max.z >= other.max.z
    );
}

export class DynamicAABBTree3D<TUserData = unknown> {
    private _nodes: TreeNode3D<TUserData>[];
    private _root: number = NULL_NODE;
    private _freeList: number = 0;
    private _nodeCount: number = 0;
    private _nodeCapacity: number;
    /** Number of active leaf (proxy) nodes. */
    private _leafCount: number = 0;
    /** Reused traversal stack for query/queryPairs (no per-call allocation). */
    private readonly _stack: number[] = [];
    /** Reused degenerate box for point queries. */
    private readonly _pointBox: ITreeAabb3D = {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 0, y: 0, z: 0 },
    };
    pairQueryNodeVisits = 0;
    pairQueryTestedBoxes = 0;
    pairQueryLeafPairs = 0;

    constructor(initialCapacity: number = 1024) {
        this._nodeCapacity = initialCapacity;
        this._nodes = new Array(initialCapacity);
        for (let i = 0; i < initialCapacity - 1; ++i) {
            this._nodes[i] = this._createNode(i, i + 1);
        }
        this._nodes[initialCapacity - 1] = this._createNode(initialCapacity - 1, NULL_NODE);
    }

    private _createNode(id: number, parent: number): TreeNode3D<TUserData> {
        return {
            id,
            aabb: createEmptyBox(),
            userData: null,
            parent,
            child1: NULL_NODE,
            child2: NULL_NODE,
            height: -1,
        };
    }

    /**
     * Stores a copy of `aabb` as the leaf box.
     *
     * Parity note: the previous implementation called the non-mutating
     * `AABB3D.expand(margin)` and discarded its return value, so no fat margin
     * was ever applied here or in `moveProxy`. Broadphase behaviour depends on
     * that, so this rewrite keeps the boxes tight; widening them is a deliberate
     * semantics change (fewer re-insertions, different pair sets) tracked
     * separately.
     */
    createProxy(aabb: IAabb3D, userData: TUserData): number {
        const proxyId = this._allocateNode();
        const box = this._nodes[proxyId].aabb;
        box.min.x = aabb.min.x;
        box.min.y = aabb.min.y;
        box.min.z = aabb.min.z;
        box.max.x = aabb.max.x;
        box.max.y = aabb.max.y;
        box.max.z = aabb.max.z;
        this._nodes[proxyId].userData = userData;
        this._nodes[proxyId].height = 0;
        this._insertLeaf(proxyId);
        this._leafCount++;
        return proxyId;
    }

    destroyProxy(proxyId: number): void {
        this._removeLeaf(proxyId);
        this._freeNode(proxyId);
        this._leafCount--;
    }

    moveProxy(proxyId: number, aabb: IAabb3D, displacement: IVec3Like): boolean {
        const node = this._nodes[proxyId];
        if (boxContains(node.aabb, aabb)) {
            return false;
        }
        this._removeLeaf(proxyId);

        const dx = displacement.x * 2.0;
        const dy = displacement.y * 2.0;
        const dz = displacement.z * 2.0;
        const box = node.aabb;
        box.min.x = aabb.min.x + (dx < 0 ? dx : 0);
        box.min.y = aabb.min.y + (dy < 0 ? dy : 0);
        box.min.z = aabb.min.z + (dz < 0 ? dz : 0);
        box.max.x = aabb.max.x + (dx > 0 ? dx : 0);
        box.max.y = aabb.max.y + (dy > 0 ? dy : 0);
        box.max.z = aabb.max.z + (dz > 0 ? dz : 0);

        this._insertLeaf(proxyId);
        return true;
    }

    query(callback: (proxyId: number) => boolean, aabb: IAabb3D): void {
        const stack = this._stack;
        stack.length = 0;
        stack.push(this._root);
        while (stack.length > 0) {
            const nodeId = stack.pop()!;
            if (nodeId === NULL_NODE) continue;
            const node = this._nodes[nodeId];
            if (boxIntersects(node.aabb, aabb)) {
                if (node.child1 === NULL_NODE) {
                    const proceed = callback(nodeId);
                    if (!proceed) {
                        stack.length = 0;
                        return;
                    }
                } else {
                    stack.push(node.child1);
                    stack.push(node.child2);
                }
            }
        }
        stack.length = 0;
    }

    queryPairs(callback: (proxyIdA: number, proxyIdB: number) => boolean): void {
        this.pairQueryNodeVisits = 0;
        this.pairQueryTestedBoxes = 0;
        this.pairQueryLeafPairs = 0;
        if (this._root === NULL_NODE) return;
        const stack = this._stack;
        stack.length = 0;
        stack.push(this._root);
        while (stack.length > 0) {
            const nodeId = stack.pop()!;
            if (nodeId === NULL_NODE) continue;
            const node = this._nodes[nodeId];
            if (node.child1 === NULL_NODE) continue;
            this.pairQueryNodeVisits++;
            stack.push(node.child1);
            stack.push(node.child2);
            this._queryPairsInternal(node.child1, node.child2, callback);
        }
    }

    collectLeafIds(out: number[]): number {
        out.length = 0;
        if (this._root === NULL_NODE) return 0;
        const stack = this._stack;
        stack.length = 0;
        stack.push(this._root);
        while (stack.length > 0) {
            const nodeId = stack.pop()!;
            if (nodeId === NULL_NODE) continue;
            const node = this._nodes[nodeId];
            if (node.child1 === NULL_NODE) {
                out.push(nodeId);
            } else {
                stack.push(node.child1);
                stack.push(node.child2);
            }
        }
        return out.length;
    }

    private _queryPairsInternal(
        nodeIdA: number,
        nodeIdB: number,
        callback: (proxyIdA: number, proxyIdB: number) => boolean
    ): void {
        this.pairQueryNodeVisits++;
        const nodeA = this._nodes[nodeIdA];
        const nodeB = this._nodes[nodeIdB];
        this.pairQueryTestedBoxes++;
        if (!boxesIntersect(nodeA.aabb, nodeB.aabb)) return;
        const isLeafA = nodeA.child1 === NULL_NODE;
        const isLeafB = nodeB.child1 === NULL_NODE;
        if (isLeafA && isLeafB) {
            this.pairQueryLeafPairs++;
            if (!callback(nodeIdA, nodeIdB)) return;
            return;
        }
        if (isLeafA) {
            this._queryPairsInternal(nodeIdA, nodeB.child1, callback);
            this._queryPairsInternal(nodeIdA, nodeB.child2, callback);
            return;
        }
        if (isLeafB) {
            this._queryPairsInternal(nodeA.child1, nodeIdB, callback);
            this._queryPairsInternal(nodeA.child2, nodeIdB, callback);
            return;
        }
        const areaA = boxSurfaceArea(nodeA.aabb);
        const areaB = boxSurfaceArea(nodeB.aabb);
        if (areaA > areaB) {
            this._queryPairsInternal(nodeA.child1, nodeIdB, callback);
            this._queryPairsInternal(nodeA.child2, nodeIdB, callback);
        } else {
            this._queryPairsInternal(nodeIdA, nodeB.child1, callback);
            this._queryPairsInternal(nodeIdA, nodeB.child2, callback);
        }
    }

    getUserData(proxyId: number): TUserData | null {
        return this._nodes[proxyId].userData;
    }

    /**
     * Live fat box of a leaf. The tree mutates this object in place when the
     * proxy moves, so callers must not retain it across a step.
     */
    getAABB(proxyId: number): ITreeAabb3D {
        return this._nodes[proxyId].aabb;
    }

    getHeight(): number {
        if (this._root === NULL_NODE) return 0;
        return this._nodes[this._root].height;
    }

    get leafCount(): number {
        return this._leafCount;
    }

    /**
     * Quality ratio: actualHeight / max(1, ceil(log2(leafCount+1))).
     * 1.0 = perfectly balanced; higher = more degenerate.
     */
    getTreeQuality(): number {
        if (this._root === NULL_NODE || this._leafCount <= 1) return 1.0;
        const optimal = Math.ceil(Math.log2(this._leafCount + 1));
        return this._nodes[this._root].height / Math.max(1, optimal);
    }

    /**
     * Balance metric in [0, 1]: averages per-node min/max child-height ratios
     * across all internal nodes. 1.0 = every subtree pair has equal height.
     */
    getTreeBalance(): number {
        if (this._root === NULL_NODE || this._leafCount <= 1) return 1.0;
        const acc = this._sumBalanceRatios(this._root);
        return acc.n === 0 ? 1.0 : acc.sum / acc.n;
    }

    private _sumBalanceRatios(nid: number): { sum: number; n: number } {
        const nd = this._nodes[nid];
        if (nd.child1 === NULL_NODE) return { sum: 0, n: 0 };
        const a = this._nodes[nd.child1].height;
        const b = this._nodes[nd.child2].height;
        const hi = Math.max(a, b);
        const lo = Math.min(a, b);
        const l = this._sumBalanceRatios(nd.child1);
        const r = this._sumBalanceRatios(nd.child2);
        return { sum: (hi > 0 ? lo / hi : 1.0) + l.sum + r.sum, n: 1 + l.n + r.n };
    }

    get nodeCount(): number {
        return this._nodeCount;
    }

    /**
     * BVH-backed ray cast. Traverses the tree testing ray against node AABBs.
     * Callback receives leaf userData and the hit fraction; return new max fraction
     * to clip further tests, or -1 to abort.
     */
    rayCast(
        origin: Readonly<IVec3Like>, direction: Readonly<IVec3Like>, maxDistance: number,
        callback: (userData: TUserData, fraction: number) => number
    ): void {
        if (this._root === NULL_NODE) return;
        const stack = this._stack;
        stack.length = 0;
        stack.push(this._root);
        let currentMax = maxDistance;
        while (stack.length > 0) {
            const nodeId = stack.pop()!;
            if (nodeId === NULL_NODE) continue;
            const node = this._nodes[nodeId];
            const box = node.aabb;
            const frac = _rayAabbSlab(
                origin.x, origin.y, origin.z,
                direction.x, direction.y, direction.z,
                box.min.x, box.min.y, box.min.z,
                box.max.x, box.max.y, box.max.z,
                currentMax
            );
            if (frac < 0) continue;
            if (node.child1 === NULL_NODE) {
                // Leaf
                if (node.userData !== null) {
                    const newMax = callback(node.userData, frac);
                    if (newMax < 0) {
                        stack.length = 0;
                        return;
                    }
                    currentMax = newMax;
                }
            } else {
                stack.push(node.child1);
                stack.push(node.child2);
            }
        }
    }

    /**
     * BVH-backed AABB query. Returns all leaves whose fat AABB overlaps the query AABB.
     */
    queryAABBAll(aabb: IAabb3D, callback: (userData: TUserData) => boolean): void {
        this.query((proxyId) => {
            const ud = this._nodes[proxyId].userData;
            if (ud !== null) return callback(ud);
            return true;
        }, aabb);
    }

    /**
     * BVH-backed point query. Tests if a point lies within any leaf's fat AABB.
     */
    queryPointAll(point: Readonly<IVec3Like>, callback: (userData: TUserData) => boolean): void {
        // Degenerate AABB at the point, written into a reused box.
        const box = this._pointBox;
        box.min.x = point.x;
        box.min.y = point.y;
        box.min.z = point.z;
        box.max.x = point.x;
        box.max.y = point.y;
        box.max.z = point.z;
        this.queryAABBAll(box, callback);
    }

    private _allocateNode(): number {
        if (this._freeList === NULL_NODE) {
            const oldCapacity = this._nodeCapacity;
            this._nodeCapacity *= 2;
            const newNodes = new Array<TreeNode3D<TUserData>>(this._nodeCapacity);
            for (let i = 0; i < oldCapacity; i++) {
                newNodes[i] = this._nodes[i];
            }
            for (let i = oldCapacity; i < this._nodeCapacity - 1; i++) {
                newNodes[i] = this._createNode(i, i + 1);
            }
            newNodes[this._nodeCapacity - 1] = this._createNode(this._nodeCapacity - 1, NULL_NODE);
            this._nodes = newNodes;
            this._freeList = oldCapacity;
        }
        const nodeId = this._freeList;
        this._freeList = this._nodes[nodeId].parent;
        this._nodes[nodeId].parent = NULL_NODE;
        this._nodes[nodeId].child1 = NULL_NODE;
        this._nodes[nodeId].child2 = NULL_NODE;
        this._nodes[nodeId].height = 0;
        this._nodes[nodeId].userData = null;
        this._nodeCount++;
        return nodeId;
    }

    private _freeNode(nodeId: number): void {
        this._nodes[nodeId].parent = this._freeList;
        this._nodes[nodeId].height = -1;
        this._freeList = nodeId;
        this._nodeCount--;
    }

    private _insertLeaf(leaf: number): void {
        if (this._root === NULL_NODE) {
            this._root = leaf;
            this._nodes[this._root].parent = NULL_NODE;
            return;
        }
        const leafAabb = this._nodes[leaf].aabb;
        let index = this._root;
        while (this._nodes[index].child1 !== NULL_NODE) {
            const node = this._nodes[index];
            const child1 = node.child1;
            const child2 = node.child2;
            const area = boxSurfaceArea(node.aabb);
            const combined = this._scratchBox;
            unionInto(combined, node.aabb, leafAabb);
            const combinedArea = boxSurfaceArea(combined);
            const cost = 2.0 * combinedArea;
            const inheritanceCost = 2.0 * (combinedArea - area);
            let cost1: number;
            unionInto(combined, this._nodes[child1].aabb, leafAabb);
            const combinedArea1 = boxSurfaceArea(combined);
            if (this._nodes[child1].child1 === NULL_NODE) {
                cost1 = combinedArea1 + inheritanceCost;
            } else {
                cost1 = combinedArea1 - boxSurfaceArea(this._nodes[child1].aabb) + inheritanceCost;
            }
            let cost2: number;
            unionInto(combined, this._nodes[child2].aabb, leafAabb);
            const combinedArea2 = boxSurfaceArea(combined);
            if (this._nodes[child2].child1 === NULL_NODE) {
                cost2 = combinedArea2 + inheritanceCost;
            } else {
                cost2 = combinedArea2 - boxSurfaceArea(this._nodes[child2].aabb) + inheritanceCost;
            }
            if (cost < cost1 && cost < cost2) {
                break;
            }
            if (cost1 < cost2) {
                index = child1;
            } else {
                index = child2;
            }
        }
        const sibling = index;
        const oldParent = this._nodes[sibling].parent;
        const newParent = this._allocateNode();
        this._nodes[newParent].parent = oldParent;
        this._nodes[newParent].userData = null;
        unionInto(this._nodes[newParent].aabb, leafAabb, this._nodes[sibling].aabb);
        this._nodes[newParent].height = this._nodes[sibling].height + 1;
        if (oldParent !== NULL_NODE) {
            if (this._nodes[oldParent].child1 === sibling) {
                this._nodes[oldParent].child1 = newParent;
            } else {
                this._nodes[oldParent].child2 = newParent;
            }
            this._nodes[newParent].child1 = sibling;
            this._nodes[newParent].child2 = leaf;
            this._nodes[sibling].parent = newParent;
            this._nodes[leaf].parent = newParent;
        } else {
            this._nodes[newParent].child1 = sibling;
            this._nodes[newParent].child2 = leaf;
            this._nodes[sibling].parent = newParent;
            this._nodes[leaf].parent = newParent;
            this._root = newParent;
        }
        let walkIndex = this._nodes[leaf].parent;
        while (walkIndex !== NULL_NODE) {
            const walkNode = this._nodes[walkIndex];
            const child1 = walkNode.child1;
            const child2 = walkNode.child2;
            walkNode.height = 1 + Math.max(this._nodes[child1].height, this._nodes[child2].height);
            unionInto(walkNode.aabb, this._nodes[child1].aabb, this._nodes[child2].aabb);
            walkIndex = walkNode.parent;
        }
    }

    private _removeLeaf(leaf: number): void {
        if (leaf === this._root) {
            this._root = NULL_NODE;
            return;
        }
        const parent = this._nodes[leaf].parent;
        const grandParent = this._nodes[parent].parent;
        const sibling =
            this._nodes[parent].child1 === leaf
                ? this._nodes[parent].child2
                : this._nodes[parent].child1;
        if (grandParent !== NULL_NODE) {
            if (this._nodes[grandParent].child1 === parent) {
                this._nodes[grandParent].child1 = sibling;
            } else {
                this._nodes[grandParent].child2 = sibling;
            }
            this._nodes[sibling].parent = grandParent;
            this._freeNode(parent);
            let index = grandParent;
            while (index !== NULL_NODE) {
                const node = this._nodes[index];
                const child1 = node.child1;
                const child2 = node.child2;
                unionInto(node.aabb, this._nodes[child1].aabb, this._nodes[child2].aabb);
                node.height = 1 + Math.max(this._nodes[child1].height, this._nodes[child2].height);
                index = node.parent;
            }
        } else {
            this._root = sibling;
            this._nodes[sibling].parent = NULL_NODE;
            this._freeNode(parent);
        }
    }

    /** Scratch box for union computations during leaf insertion. */
    private readonly _scratchBox: ITreeAabb3D = createEmptyBox();
}

/** `AABB3D.intersectsAABB` between two node boxes. */
function boxesIntersect(a: ITreeAabb3D, b: ITreeAabb3D): boolean {
    return (
        a.min.x <= b.max.x &&
        a.max.x >= b.min.x &&
        a.min.y <= b.max.y &&
        a.max.y >= b.min.y &&
        a.min.z <= b.max.z &&
        a.max.z >= b.min.z
    );
}
