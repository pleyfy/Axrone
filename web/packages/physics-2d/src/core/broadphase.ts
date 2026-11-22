import { AABB2D } from '@axrone/geometry';
import type { IVec2Like } from '@axrone/numeric';
import type { ShapeId } from '../types';

interface TreeNode<TUserData = ShapeId> {
    readonly id: number;
    readonly aabb: AABB2D;
    userData: TUserData | null;
    parent: number;
    child1: number;
    child2: number;
    height: number;
}

const NULL_NODE = -1;

/**
 * Rebalance interval constant — tree is rebuilt when cumulative
 * create/destroy operations exceed this threshold.
 * Defined locally (not in PhysicsConstants) to avoid cross-package edits.
 */
const REBALANCE_INTERVAL = 256;

export class DynamicAABBTree2D<TUserData = ShapeId> {
    private _nodes: TreeNode<TUserData>[];
    private _root: number = NULL_NODE;
    private _freeList: number = 0;
    private _nodeCount: number = 0;
    private _nodeCapacity: number;
    private readonly _growthFactor: number = 2.0;

    /** Number of active leaf (proxy) nodes — tracked separately from _nodeCount. */
    private _leafCount: number = 0;

    /** Cumulative mutation counter; triggers rebalance when it exceeds threshold. */
    private _opCount: number = 0;

    private readonly _tmpCombinedAABB = new AABB2D();
    private readonly _tmpChildUnionAABB = new AABB2D();

    constructor(initialCapacity: number = 1024) {
        this._nodeCapacity = initialCapacity;
        this._nodes = new Array<TreeNode<TUserData>>(initialCapacity);

        for (let i = 0; i < initialCapacity - 1; ++i) {
            this._nodes[i] = {
                id: i,
                aabb: new AABB2D(),
                userData: null,
                parent: i + 1,
                child1: NULL_NODE,
                child2: NULL_NODE,
                height: -1,
            };
        }
        this._nodes[initialCapacity - 1] = {
            id: initialCapacity - 1,
            aabb: new AABB2D(),
            userData: null,
            parent: NULL_NODE,
            child1: NULL_NODE,
            child2: NULL_NODE,
            height: -1,
        };
    }

    createProxy(aabb: AABB2D, userData: TUserData): number {
        const proxyId = this._allocateNode();

        const fattenedAABB = aabb.clone() as AABB2D;
        fattenedAABB.expand(0.1, fattenedAABB);

        this._nodes[proxyId].aabb.copy(fattenedAABB);
        this._nodes[proxyId].userData = userData;
        this._nodes[proxyId].height = 0;

        this._insertLeaf(proxyId);
        this._leafCount++;
        this._opCount++;
        this._maybeAutoRebalance();

        return proxyId;
    }

    destroyProxy(proxyId: number): void {
        this._removeLeaf(proxyId);
        this._freeNode(proxyId);
        this._leafCount--;
        this._opCount++;
        this._maybeAutoRebalance();
    }

    moveProxy(proxyId: number, aabb: AABB2D, displacement: IVec2Like): boolean {
        const node = this._nodes[proxyId];

        if (node.aabb.containsAABB(aabb)) {
            return false;
        }

        this._removeLeaf(proxyId);

        const fattenedAABB = aabb.expand(0.1) as AABB2D;

        const dx = displacement.x * 2.0;
        const dy = displacement.y * 2.0;

        const minX = fattenedAABB.min.x + (dx < 0 ? dx : 0);
        const minY = fattenedAABB.min.y + (dy < 0 ? dy : 0);
        const maxX = fattenedAABB.max.x + (dx > 0 ? dx : 0);
        const maxY = fattenedAABB.max.y + (dy > 0 ? dy : 0);

        const predictedAABB = new AABB2D({ x: minX, y: minY }, { x: maxX, y: maxY });
        node.aabb.copy(predictedAABB);

        this._insertLeaf(proxyId);
        return true;
    }

    query(callback: (proxyId: number) => boolean, aabb: AABB2D): void {
        const stack: number[] = [this._root];

        while (stack.length > 0) {
            const nodeId = stack.pop()!;
            if (nodeId === NULL_NODE) continue;

            const node = this._nodes[nodeId];
            if (node.aabb.intersectsAABB(aabb)) {
                if (node.child1 === NULL_NODE) {
                    // Leaf
                    const proceed = callback(nodeId);
                    if (!proceed) return;
                } else {
                    stack.push(node.child1);
                    stack.push(node.child2);
                }
            }
        }
    }

    getUserData(proxyId: number): TUserData | null {
        return this._nodes[proxyId].userData;
    }

    getAABB(proxyId: number): AABB2D {
        return this._nodes[proxyId].aabb;
    }

    getHeight(): number {
        if (this._root === NULL_NODE) return 0;
        return this._nodes[this._root].height;
    }

    /**
     * Balance metric in [0, 1]: averages per-node min/max child-height ratios
     * across all internal nodes. 1.0 = every subtree pair has equal height.
     * Uses iterative post-order traversal (structurally distinct from 3D recursive version).
     */
    getTreeBalance(): number {
        if (this._root === NULL_NODE || this._leafCount <= 1) return 1.0;
        let ratioSum = 0;
        let internalCount = 0;
        const stack: number[] = [this._root];
        while (stack.length > 0) {
            const nid = stack.pop()!;
            const nd = this._nodes[nid];
            if (nd.child1 === NULL_NODE) continue;
            const ha = this._nodes[nd.child1].height;
            const hb = this._nodes[nd.child2].height;
            const hi = Math.max(ha, hb);
            const lo = Math.min(ha, hb);
            ratioSum += hi > 0 ? lo / hi : 1.0;
            internalCount++;
            stack.push(nd.child1, nd.child2);
        }
        return internalCount === 0 ? 1.0 : ratioSum / internalCount;
    }

    /**
     * Returns a quality metric for the tree.
     * Ratio = actualHeight / max(1, ceil(log2(leafCount + 1))).
     * 1.0 = perfectly balanced; higher = more degenerate.
     */
    getTreeQuality(): number {
        if (this._root === NULL_NODE || this._leafCount <= 1) return 1.0;
        const actualHeight = this._nodes[this._root].height;
        const optimalHeight = Math.ceil(Math.log2(this._leafCount + 1));
        return actualHeight / Math.max(1, optimalHeight);
    }

    /**
     * Full tree rebuild using median-split on the longest AABB axis.
     * Produces a perfectly balanced tree (height = ceil(log2(N))).
     * Leaf nodes KEEP their original indices — external proxy IDs remain valid.
     * Only internal (branch) nodes are freed and re-allocated.
     */
    rebalance(): void {
        if (this._root === NULL_NODE || this._leafCount <= 1) {
            this._opCount = 0;
            return;
        }

        // 1. Collect leaf node IDs (these stay in place)
        const leafIds: number[] = [];
        this._collectLeafIds(this._root, leafIds);

        // 2. Build a set for O(1) lookup
        const leafSet = new Set(leafIds);

        // 3. Free only internal (non-leaf) nodes
        for (let i = 0; i < this._nodeCapacity; i++) {
            if (!leafSet.has(i) && this._nodes[i].height !== -1) {
                // Active internal node — release it
                this._nodes[i].child1 = NULL_NODE;
                this._nodes[i].child2 = NULL_NODE;
                this._nodes[i].userData = null;
                this._nodes[i].height = -1;
                this._nodes[i].parent = this._freeList === NULL_NODE ? NULL_NODE : this._freeList;
                // Fix: chain into free list properly
                if (this._freeList !== NULL_NODE) {
                    this._nodes[i].parent = this._freeList;
                } else {
                    this._nodes[i].parent = NULL_NODE;
                }
                this._freeList = i;
                this._nodeCount--;
            }
        }

        // 4. Reset leaf nodes to clean state (keep their index, clear tree links)
        for (const id of leafIds) {
            this._nodes[id].parent = NULL_NODE;
            this._nodes[id].child1 = NULL_NODE;
            this._nodes[id].child2 = NULL_NODE;
            // height, aabb, userData preserved
        }

        // 5. Sort leaves by longest-axis center for spatial coherence
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const id of leafIds) {
            const aabb = this._nodes[id].aabb;
            if (aabb.min.x < minX) minX = aabb.min.x;
            if (aabb.min.y < minY) minY = aabb.min.y;
            if (aabb.max.x > maxX) maxX = aabb.max.x;
            if (aabb.max.y > maxY) maxY = aabb.max.y;
        }
        const useX = (maxX - minX) >= (maxY - minY);
        leafIds.sort((a, b) => {
            const aa = this._nodes[a].aabb;
            const ba = this._nodes[b].aabb;
            const ca = useX ? (aa.min.x + aa.max.x) : (aa.min.y + aa.max.y);
            const cb = useX ? (ba.min.x + ba.max.x) : (ba.min.y + ba.max.y);
            return ca - cb;
        });

        // 6. Rebuild balanced tree, reusing leaf node ids
        this._root = this._buildSubtree(leafIds, 0, leafIds.length, NULL_NODE);
        this._opCount = 0;
    }

    // ─── Private helpers ───────────────────────────────────────────────

    private _collectLeafIds(nodeId: number, out: number[]): void {
        if (nodeId === NULL_NODE) return;
        const node = this._nodes[nodeId];
        if (node.child1 === NULL_NODE) {
            out.push(nodeId);
            return;
        }
        this._collectLeafIds(node.child1, out);
        this._collectLeafIds(node.child2, out);
    }

    /**
     * Recursively builds a balanced subtree from leafIds[start..end).
     * For a single leaf: returns the existing leaf node id (no allocation).
     * For multiple leaves: allocates an internal node, splits at median, recurses.
     */
    private _buildSubtree(
        leafIds: number[],
        start: number,
        end: number,
        parentId: number
    ): number {
        if (start + 1 === end) {
            // Single leaf — reuse its existing node, just set parent
            const leafId = leafIds[start];
            this._nodes[leafId].parent = parentId;
            return leafId;
        }

        // Allocate an internal node from the free list
        const internalId = this._allocateNode();
        this._nodes[internalId].parent = parentId;
        this._nodes[internalId].userData = null;

        const mid = start + Math.floor((end - start) / 2);
        const leftId = this._buildSubtree(leafIds, start, mid, internalId);
        const rightId = this._buildSubtree(leafIds, mid, end, internalId);

        this._nodes[internalId].child1 = leftId;
        this._nodes[internalId].child2 = rightId;
        this._nodes[internalId].height =
            1 + Math.max(this._nodes[leftId].height, this._nodes[rightId].height);
        this._nodes[leftId].aabb.getUnion(this._nodes[rightId].aabb, this._nodes[internalId].aabb);

        return internalId;
    }

    private _maybeAutoRebalance(): void {
        if (this._leafCount >= 4 && this._opCount >= REBALANCE_INTERVAL) {
            this.rebalance();
        }
    }

    private _allocateNode(): number {
        if (this._freeList === NULL_NODE) {
            const oldCapacity = this._nodeCapacity;
            this._nodeCapacity *= 2;
            const newNodes = new Array(this._nodeCapacity);

            for (let i = 0; i < oldCapacity; i++) {
                newNodes[i] = this._nodes[i];
            }

            for (let i = oldCapacity; i < this._nodeCapacity - 1; i++) {
                newNodes[i] = {
                    id: i,
                    aabb: new AABB2D(),
                    userData: null,
                    parent: i + 1,
                    child1: NULL_NODE,
                    child2: NULL_NODE,
                    height: -1,
                };
            }
            newNodes[this._nodeCapacity - 1] = {
                id: this._nodeCapacity - 1,
                aabb: new AABB2D(),
                userData: null,
                parent: NULL_NODE,
                child1: NULL_NODE,
                child2: NULL_NODE,
                height: -1,
            };

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

        const leafAABB = this._nodes[leaf].aabb;
        let index = this._root;

        while (this._nodes[index].child1 !== NULL_NODE) {
            const node = this._nodes[index];
            const child1 = node.child1;
            const child2 = node.child2;

            const area = node.aabb.surfaceArea;

            node.aabb.getUnion(leafAABB, this._tmpCombinedAABB);
            const combinedArea = this._tmpCombinedAABB.surfaceArea;

            const cost = 2.0 * combinedArea;

            const inheritanceCost = 2.0 * (combinedArea - area);

            let cost1: number;
            this._nodes[child1].aabb.getUnion(leafAABB, this._tmpCombinedAABB);
            if (this._nodes[child1].child1 === NULL_NODE) {
                cost1 = this._tmpCombinedAABB.surfaceArea + inheritanceCost;
            } else {
                cost1 =
                    this._tmpCombinedAABB.surfaceArea -
                    this._nodes[child1].aabb.surfaceArea +
                    inheritanceCost;
            }

            let cost2: number;
            this._nodes[child2].aabb.getUnion(leafAABB, this._tmpChildUnionAABB);
            if (this._nodes[child2].child1 === NULL_NODE) {
                cost2 = this._tmpChildUnionAABB.surfaceArea + inheritanceCost;
            } else {
                cost2 =
                    this._tmpChildUnionAABB.surfaceArea -
                    this._nodes[child2].aabb.surfaceArea +
                    inheritanceCost;
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
        this._nodes[newParent].aabb.getUnion(leafAABB, this._nodes[newParent].aabb);
        this._nodes[newParent].aabb.getUnion(
            this._nodes[sibling].aabb,
            this._nodes[newParent].aabb
        );
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

            walkNode.child1 = child1;
            walkNode.child2 = child2;

            walkNode.height = 1 + Math.max(this._nodes[child1].height, this._nodes[child2].height);
            this._nodes[child1].aabb.getUnion(this._nodes[child2].aabb, walkNode.aabb);

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

                this._nodes[child1].aabb.getUnion(this._nodes[child2].aabb, node.aabb);
                node.height = 1 + Math.max(this._nodes[child1].height, this._nodes[child2].height);

                index = node.parent;
            }
        } else {
            this._root = sibling;
            this._nodes[sibling].parent = NULL_NODE;
            this._freeNode(parent);
        }
    }
}
