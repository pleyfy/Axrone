import { describe, it, expect, beforeEach } from 'vitest';
import { Vec2, Vec3 } from '../../../../numeric/src';
import { QuadTree, Octree } from '../../geometry/spatial';

describe('Spatial Data Structures', () => {
    describe('QuadTree', () => {
        it('should create and insert items', () => {
            const bounds: readonly [{ x: number; y: number }, { x: number; y: number }] = [
                { x: 0, y: 0 },
                { x: 100, y: 100 },
            ];

            const quadTree = new QuadTree<string>(bounds);

            expect(quadTree.size).toBe(0);

            const itemBounds: readonly [{ x: number; y: number }, { x: number; y: number }] = [
                { x: 10, y: 10 },
                { x: 20, y: 20 },
            ];

            quadTree.insert(itemBounds, 'test-item');

            expect(quadTree.size).toBe(1);
        });

        it('should query items correctly', () => {
            const bounds: readonly [{ x: number; y: number }, { x: number; y: number }] = [
                { x: 0, y: 0 },
                { x: 100, y: 100 },
            ];

            const quadTree = new QuadTree<string>(bounds);

            quadTree.insert(
                [
                    { x: 10, y: 10 },
                    { x: 20, y: 20 },
                ],
                'item1'
            );
            quadTree.insert(
                [
                    { x: 30, y: 30 },
                    { x: 40, y: 40 },
                ],
                'item2'
            );
            quadTree.insert(
                [
                    { x: 80, y: 80 },
                    { x: 90, y: 90 },
                ],
                'item3'
            );

            const queryBounds: readonly [{ x: number; y: number }, { x: number; y: number }] = [
                { x: 15, y: 15 },
                { x: 35, y: 35 },
            ];

            const results = quadTree.query(queryBounds);

            expect(results.length).toBe(2);
            expect(results.map((r) => r.item)).toContain('item1');
            expect(results.map((r) => r.item)).toContain('item2');
        });

        it('should remove items correctly', () => {
            const bounds: readonly [{ x: number; y: number }, { x: number; y: number }] = [
                { x: 0, y: 0 },
                { x: 100, y: 100 },
            ];

            const quadTree = new QuadTree<string>(bounds);

            quadTree.insert(
                [
                    { x: 10, y: 10 },
                    { x: 20, y: 20 },
                ],
                'test-item'
            );
            expect(quadTree.size).toBe(1);

            const removed = quadTree.remove('test-item');
            expect(removed).toBe(true);
            expect(quadTree.size).toBe(0);

            const removedAgain = quadTree.remove('test-item');
            expect(removedAgain).toBe(false);
        });

        it('should provide correct statistics', () => {
            const bounds: readonly [{ x: number; y: number }, { x: number; y: number }] = [
                { x: 0, y: 0 },
                { x: 100, y: 100 },
            ];

            const quadTree = new QuadTree<string>(bounds);

            expect(quadTree.stats.nodeCount).toBe(1);
            expect(quadTree.stats.itemCount).toBe(0);
            expect(quadTree.stats.depth).toBe(0);
        });
    });

    describe('Octree', () => {
        it('should create and insert items', () => {
            const bounds: readonly [
                { x: number; y: number; z: number },
                { x: number; y: number; z: number },
            ] = [
                { x: 0, y: 0, z: 0 },
                { x: 100, y: 100, z: 100 },
            ];

            const octree = new Octree<string>(bounds);

            expect(octree.size).toBe(0);

            const itemBounds: readonly [
                { x: number; y: number; z: number },
                { x: number; y: number; z: number },
            ] = [
                { x: 10, y: 10, z: 10 },
                { x: 20, y: 20, z: 20 },
            ];

            octree.insert(itemBounds, 'test-item');

            expect(octree.size).toBe(1);
        });

        it('should query items correctly', () => {
            const bounds: readonly [
                { x: number; y: number; z: number },
                { x: number; y: number; z: number },
            ] = [
                { x: 0, y: 0, z: 0 },
                { x: 100, y: 100, z: 100 },
            ];

            const octree = new Octree<string>(bounds);

            octree.insert(
                [
                    { x: 10, y: 10, z: 10 },
                    { x: 20, y: 20, z: 20 },
                ],
                'item1'
            );
            octree.insert(
                [
                    { x: 30, y: 30, z: 30 },
                    { x: 40, y: 40, z: 40 },
                ],
                'item2'
            );
            octree.insert(
                [
                    { x: 80, y: 80, z: 80 },
                    { x: 90, y: 90, z: 90 },
                ],
                'item3'
            );

            const queryBounds: readonly [
                { x: number; y: number; z: number },
                { x: number; y: number; z: number },
            ] = [
                { x: 15, y: 15, z: 15 },
                { x: 35, y: 35, z: 35 },
            ];

            const results = octree.query(queryBounds);

            expect(results.length).toBe(2);
            expect(results.map((r) => r.item)).toContain('item1');
            expect(results.map((r) => r.item)).toContain('item2');
        });

        it('should provide correct statistics', () => {
            const bounds: readonly [
                { x: number; y: number; z: number },
                { x: number; y: number; z: number },
            ] = [
                { x: 0, y: 0, z: 0 },
                { x: 100, y: 100, z: 100 },
            ];

            const octree = new Octree<string>(bounds);

            expect(octree.stats.nodeCount).toBe(1);
            expect(octree.stats.itemCount).toBe(0);
            expect(octree.stats.depth).toBe(0);
        });
    });

    describe('Factory Functions', () => {
        it('should create QuadTree with factory functions', () => {
            const bounds: readonly [{ x: number; y: number }, { x: number; y: number }] = [
                { x: 0, y: 0 },
                { x: 100, y: 100 },
            ];

            const defaultQuadTree = QuadTree.create<string>(bounds);
            const smallObjectsQuadTree = QuadTree.createForSmallObjects<string>(bounds);
            const largeObjectsQuadTree = QuadTree.createForLargeObjects<string>(bounds);

            expect(defaultQuadTree.config.maxDepth).toBe(10);
            expect(smallObjectsQuadTree.config.maxDepth).toBe(8);
            expect(largeObjectsQuadTree.config.maxDepth).toBe(6);
        });

        it('should create Octree with factory functions', () => {
            const bounds: readonly [
                { x: number; y: number; z: number },
                { x: number; y: number; z: number },
            ] = [
                { x: 0, y: 0, z: 0 },
                { x: 100, y: 100, z: 100 },
            ];

            const defaultOctree = Octree.create<string>(bounds);
            const smallObjectsOctree = Octree.createForSmallObjects<string>(bounds);
            const largeObjectsOctree = Octree.createForLargeObjects<string>(bounds);

            expect(defaultOctree.config.maxDepth).toBe(10);
            expect(smallObjectsOctree.config.maxDepth).toBe(8);
            expect(largeObjectsOctree.config.maxDepth).toBe(6);
        });
    });
});
