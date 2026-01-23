import { AABB2D } from '../../geometry/aabb';
import type { ShapeId, BodyId } from '../types';
import type { IAABBQueryCallback, IQueryFilter } from '../types/world';

export interface BroadphaseProxy {
    id: number;
    aabb: AABB2D;
    userData: any;
    isMoved: boolean;
}

interface TreeNode {
    id: number;
    aabb: AABB2D;
    userData: any;
    parent: number; 
    child1: number;
    child2: number;
    height: number;
}

const NULL_NODE = -1;

export class DynamicAABBTree2D {
    private _nodes: TreeNode[];
    private _root: number = NULL_NODE;
    private _freeList: number = 0;
    private _nodeCount: number = 0;
    private _nodeCapacity: number;
    private readonly _growthFactor: number = 2.0;

    constructor(initialCapacity: number = 1024) {
        this._nodeCapacity = initialCapacity;
        this._nodes = new Array(initialCapacity);

        for (let i = 0; i < initialCapacity - 1; ++i) {
            this._nodes[i] = {
                id: i,
                aabb: new AABB2D(),
                userData: null,
                parent: i,
                child1: NULL_NODE,
                child2: NULL_NODE,
                height: -1
            };
            this._nodes[i].parent = i + 1;
        }
        this._nodes[initialCapacity - 1] = {
            id: initialCapacity - 1,
            aabb: new AABB2D(),
            userData: null,
            parent: NULL_NODE,
            child1: NULL_NODE,
            child2: NULL_NODE,
            height: -1
        };
    }

    createProxy(aabb: AABB2D, userData: any): number {
        const proxyId = this._allocateNode();

        const fattenedAABB = aabb.clone() as AABB2D;
        fattenedAABB.expand(0.1, fattenedAABB);

        this._nodes[proxyId].aabb.copy(fattenedAABB);
        this._nodes[proxyId].userData = userData;
        this._nodes[proxyId].height = 0;

        this._insertLeaf(proxyId);

        return proxyId;
    }

    destroyProxy(proxyId: number): void {
        this._removeLeaf(proxyId);
        this._freeNode(proxyId);
    }

    moveProxy(proxyId: number, aabb: AABB2D, displacement: { x: number, y: number }): boolean {
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
                if (node.child1 === NULL_NODE) { // Leaf
                    const proceed = callback(nodeId);
                    if (!proceed) return;
                } else {
                    stack.push(node.child1);
                    stack.push(node.child2);
                }
            }
        }
    }

    getUserData(proxyId: number): any {
        return this._nodes[proxyId].userData;
    }

    getAABB(proxyId: number): AABB2D {
        return this._nodes[proxyId].aabb;
    }
    
    getHeight(): number {
        if (this._root === NULL_NODE) return 0;
        return this._nodes[this._root].height;
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
                    height: -1
                };
            }
             newNodes[this._nodeCapacity - 1] = {
                 id: this._nodeCapacity - 1,
                 aabb: new AABB2D(),
                 userData: null,
                 parent: NULL_NODE,
                 child1: NULL_NODE,
                 child2: NULL_NODE,
                 height: -1
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
            
            const combinedAABB = new AABB2D();
            node.aabb.getUnion(leafAABB, combinedAABB);
            const combinedArea = combinedAABB.surfaceArea;
            
            const cost = 2.0 * combinedArea;
            
            const inheritanceCost = 2.0 * (combinedArea - area);
            
            let cost1;
            const combinedAABB1 = new AABB2D();
            this._nodes[child1].aabb.getUnion(leafAABB, combinedAABB1);
            if (this._nodes[child1].child1 === NULL_NODE) {
                cost1 = combinedAABB1.surfaceArea + inheritanceCost;
            } else {
                cost1 = (combinedAABB1.surfaceArea - this._nodes[child1].aabb.surfaceArea) + inheritanceCost;
            }
            
            let cost2;
            const combinedAABB2 = new AABB2D();
            this._nodes[child2].aabb.getUnion(leafAABB, combinedAABB2);
            if (this._nodes[child2].child1 === NULL_NODE) {
                cost2 = combinedAABB2.surfaceArea + inheritanceCost;
            } else {
                cost2 = (combinedAABB2.surfaceArea - this._nodes[child2].aabb.surfaceArea) + inheritanceCost;
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
        this._nodes[newParent].aabb.getUnion(this._nodes[sibling].aabb, this._nodes[newParent].aabb);
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
        
        // TODO: Validate tree balance if needed
    }

    private _removeLeaf(leaf: number): void {
        if (leaf === this._root) {
            this._root = NULL_NODE;
            return;
        }
        
        const parent = this._nodes[leaf].parent;
        const grandParent = this._nodes[parent].parent;
        const sibling = this._nodes[parent].child1 === leaf ? this._nodes[parent].child2 : this._nodes[parent].child1;
        
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
                
                node.aabb.getUnion(this._nodes[child1].aabb, node.aabb);
                node.aabb.getUnion(this._nodes[child2].aabb, node.aabb); // Redundant if getUnion overwrites? Careful with implementation
                // Actually:
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
