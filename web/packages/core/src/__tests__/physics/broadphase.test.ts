import { describe, it, expect, beforeEach } from 'vitest';
import { DynamicAABBTree2D } from '../../physics/core/broadphase';
import { AABB2D } from '../../geometry/aabb';

describe('DynamicAABBTree2D', () => {
    let tree: DynamicAABBTree2D;

    beforeEach(() => {
        tree = new DynamicAABBTree2D(64);
    });

    describe('Construction', () => {
        it('initializes with default capacity', () => {
            const defaultTree = new DynamicAABBTree2D();
            expect(defaultTree).toBeDefined();
        });

        it('initializes with custom capacity', () => {
            const customTree = new DynamicAABBTree2D(256);
            expect(customTree).toBeDefined();
        });

        it('starts with zero height', () => {
            expect(tree.getHeight()).toBe(0);
        });
    });

    describe('Proxy Creation', () => {
        it('creates a proxy', () => {
            const aabb = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });
            const userData = { id: 1 };
            const proxyId = tree.createProxy(aabb, userData);
            expect(proxyId).toBeGreaterThanOrEqual(0);
        });

        it('creates multiple proxies', () => {
            const aabb1 = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });
            const aabb2 = new AABB2D({ x: 2, y: 2 }, { x: 3, y: 3 });
            const aabb3 = new AABB2D({ x: 4, y: 4 }, { x: 5, y: 5 });

            const id1 = tree.createProxy(aabb1, { id: 1 });
            const id2 = tree.createProxy(aabb2, { id: 2 });
            const id3 = tree.createProxy(aabb3, { id: 3 });

            expect(id1).not.toBe(id2);
            expect(id2).not.toBe(id3);
            expect(id1).not.toBe(id3);
        });

        it('updates tree height after creation', () => {
            const aabb1 = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });
            tree.createProxy(aabb1, {});
            expect(tree.getHeight()).toBe(0);

            const aabb2 = new AABB2D({ x: 2, y: 2 }, { x: 3, y: 3 });
            tree.createProxy(aabb2, {});
            expect(tree.getHeight()).toBeGreaterThan(0);
        });

        it('stores user data', () => {
            const aabb = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });
            const userData = { value: 42, name: 'test' };
            const proxyId = tree.createProxy(aabb, userData);
            expect(tree.getUserData(proxyId)).toBe(userData);
        });

        it('creates fattened AABB', () => {
            const aabb = new AABB2D({ x: 1, y: 1 }, { x: 2, y: 2 });
            const proxyId = tree.createProxy(aabb, {});
            const storedAABB = tree.getAABB(proxyId);

            expect(storedAABB.min.x).toBeLessThan(aabb.min.x);
            expect(storedAABB.min.y).toBeLessThan(aabb.min.y);
            expect(storedAABB.max.x).toBeGreaterThan(aabb.max.x);
            expect(storedAABB.max.y).toBeGreaterThan(aabb.max.y);
        });
    });

    describe('Proxy Destruction', () => {
        it('destroys a proxy', () => {
            const aabb = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });
            const proxyId = tree.createProxy(aabb, {});
            tree.destroyProxy(proxyId);
            expect(tree.getHeight()).toBe(0);
        });

        it('destroys multiple proxies', () => {
            const aabb1 = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });
            const aabb2 = new AABB2D({ x: 2, y: 2 }, { x: 3, y: 3 });

            const id1 = tree.createProxy(aabb1, {});
            const id2 = tree.createProxy(aabb2, {});

            tree.destroyProxy(id1);
            tree.destroyProxy(id2);
            expect(tree.getHeight()).toBe(0);
        });

        it('reuses node indices after destruction', () => {
            const aabb = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });
            const id1 = tree.createProxy(aabb, { id: 1 });
            tree.destroyProxy(id1);
            const id2 = tree.createProxy(aabb, { id: 2 });
            expect(id2).toBe(id1);
        });
    });

    describe('Proxy Movement', () => {
        it('moves proxy with no displacement', () => {
            const aabb = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });
            const proxyId = tree.createProxy(aabb, {});

            const newAABB = new AABB2D({ x: 0.05, y: 0.05 }, { x: 1.05, y: 1.05 });
            const moved = tree.moveProxy(proxyId, newAABB, { x: 0, y: 0 });
            expect(moved).toBe(false);
        });

        it('moves proxy outside fattened bounds', () => {
            const aabb = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });
            const proxyId = tree.createProxy(aabb, {});

            const newAABB = new AABB2D({ x: 5, y: 5 }, { x: 6, y: 6 });
            const moved = tree.moveProxy(proxyId, newAABB, { x: 5, y: 5 });
            expect(moved).toBe(true);
        });

        it('updates AABB after move', () => {
            const aabb = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });
            const proxyId = tree.createProxy(aabb, {});

            const newAABB = new AABB2D({ x: 10, y: 10 }, { x: 11, y: 11 });
            tree.moveProxy(proxyId, newAABB, { x: 10, y: 10 });

            const storedAABB = tree.getAABB(proxyId);
            expect(storedAABB.containsAABB(newAABB)).toBe(true);
        });

        it('applies displacement prediction', () => {
            const aabb = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });
            const proxyId = tree.createProxy(aabb, {});

            const newAABB = new AABB2D({ x: 10, y: 10 }, { x: 11, y: 11 });
            tree.moveProxy(proxyId, newAABB, { x: 2, y: 2 });

            const storedAABB = tree.getAABB(proxyId);
            expect(storedAABB.max.x).toBeGreaterThan(newAABB.max.x);
            expect(storedAABB.max.y).toBeGreaterThan(newAABB.max.y);
        });
    });

    describe('AABB Queries', () => {
        it('queries empty tree', () => {
            const queryAABB = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });
            const results: number[] = [];
            tree.query((proxyId) => {
                results.push(proxyId);
                return true;
            }, queryAABB);
            expect(results).toHaveLength(0);
        });

        it('queries single proxy', () => {
            const aabb = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });
            const proxyId = tree.createProxy(aabb, {});

            const queryAABB = new AABB2D({ x: 0.5, y: 0.5 }, { x: 1.5, y: 1.5 });
            const results: number[] = [];
            tree.query((id) => {
                results.push(id);
                return true;
            }, queryAABB);

            expect(results).toContain(proxyId);
        });

        it('queries multiple overlapping proxies', () => {
            const aabb1 = new AABB2D({ x: 0, y: 0 }, { x: 2, y: 2 });
            const aabb2 = new AABB2D({ x: 1, y: 1 }, { x: 3, y: 3 });
            const aabb3 = new AABB2D({ x: 2, y: 2 }, { x: 4, y: 4 });

            const id1 = tree.createProxy(aabb1, { id: 1 });
            const id2 = tree.createProxy(aabb2, { id: 2 });
            const id3 = tree.createProxy(aabb3, { id: 3 });

            const queryAABB = new AABB2D({ x: 1.5, y: 1.5 }, { x: 2.5, y: 2.5 });
            const results: number[] = [];
            tree.query((id) => {
                results.push(id);
                return true;
            }, queryAABB);

            expect(results).toContain(id1);
            expect(results).toContain(id2);
            expect(results).toContain(id3);
        });

        it('queries non-overlapping proxies', () => {
            const aabb1 = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });
            const aabb2 = new AABB2D({ x: 10, y: 10 }, { x: 11, y: 11 });

            tree.createProxy(aabb1, { id: 1 });
            tree.createProxy(aabb2, { id: 2 });

            const queryAABB = new AABB2D({ x: 5, y: 5 }, { x: 6, y: 6 });
            const results: number[] = [];
            tree.query((id) => {
                results.push(id);
                return true;
            }, queryAABB);

            expect(results).toHaveLength(0);
        });

        it('supports early termination', () => {
            const aabb1 = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });
            const aabb2 = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });
            const aabb3 = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });

            tree.createProxy(aabb1, { id: 1 });
            tree.createProxy(aabb2, { id: 2 });
            tree.createProxy(aabb3, { id: 3 });

            const queryAABB = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });
            const results: number[] = [];
            tree.query((id) => {
                results.push(id);
                return results.length < 2;
            }, queryAABB);

            expect(results.length).toBeLessThanOrEqual(2);
        });
    });

    describe('Tree Properties', () => {
        it('has correct height with balanced insertions', () => {
            for (let i = 0; i < 15; i++) {
                const aabb = new AABB2D({ x: i, y: i }, { x: i + 1, y: i + 1 });
                tree.createProxy(aabb, { id: i });
            }
            expect(tree.getHeight()).toBeGreaterThan(0);
            expect(tree.getHeight()).toBeLessThan(15);
        });

        it('has correct height after deletions', () => {
            const ids: number[] = [];
            for (let i = 0; i < 10; i++) {
                const aabb = new AABB2D({ x: i, y: i }, { x: i + 1, y: i + 1 });
                ids.push(tree.createProxy(aabb, { id: i }));
            }

            const heightBefore = tree.getHeight();

            for (let i = 0; i < 5; i++) {
                tree.destroyProxy(ids[i]);
            }

            const heightAfter = tree.getHeight();
            expect(heightAfter).toBeLessThanOrEqual(heightBefore);
        });
    });

    describe('AABB Access', () => {
        it('gets AABB for proxy', () => {
            const aabb = new AABB2D({ x: 1, y: 2 }, { x: 3, y: 4 });
            const proxyId = tree.createProxy(aabb, {});
            const storedAABB = tree.getAABB(proxyId);
            expect(storedAABB).toBeDefined();
            expect(storedAABB.min.x).toBeLessThanOrEqual(aabb.min.x);
            expect(storedAABB.max.x).toBeGreaterThanOrEqual(aabb.max.x);
        });

        it('gets user data for proxy', () => {
            const aabb = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });
            const userData = { test: 'value' };
            const proxyId = tree.createProxy(aabb, userData);
            expect(tree.getUserData(proxyId)).toBe(userData);
        });
    });

    describe('Capacity Management', () => {
        it('grows capacity when needed', () => {
            const smallTree = new DynamicAABBTree2D(4);
            for (let i = 0; i < 10; i++) {
                const aabb = new AABB2D({ x: i, y: i }, { x: i + 1, y: i + 1 });
                smallTree.createProxy(aabb, { id: i });
            }
        });

        it('handles many proxies', () => {
            const largeTree = new DynamicAABBTree2D(512);
            for (let i = 0; i < 200; i++) {
                const aabb = new AABB2D({ x: i, y: i }, { x: i + 1, y: i + 1 });
                largeTree.createProxy(aabb, { id: i });
            }
            expect(largeTree.getHeight()).toBeGreaterThan(0);
        });
    });

    describe('Edge Cases', () => {
        it('handles zero-size AABB', () => {
            const aabb = new AABB2D({ x: 1, y: 1 }, { x: 1, y: 1 });
            const proxyId = tree.createProxy(aabb, {});
            expect(proxyId).toBeGreaterThanOrEqual(0);
        });

        it('handles very large AABB', () => {
            const aabb = new AABB2D({ x: -1e6, y: -1e6 }, { x: 1e6, y: 1e6 });
            const proxyId = tree.createProxy(aabb, {});
            expect(proxyId).toBeGreaterThanOrEqual(0);
        });

        it('handles negative coordinates', () => {
            const aabb = new AABB2D({ x: -10, y: -10 }, { x: -5, y: -5 });
            const proxyId = tree.createProxy(aabb, {});
            const storedAABB = tree.getAABB(proxyId);
            expect(storedAABB.min.x).toBeLessThan(-5);
        });

        it('handles overlapping insertions', () => {
            for (let i = 0; i < 10; i++) {
                const aabb = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });
                tree.createProxy(aabb, { id: i });
            }
            expect(tree.getHeight()).toBeGreaterThan(0);
        });

        it('handles alternating creates and destroys', () => {
            for (let i = 0; i < 20; i++) {
                const aabb = new AABB2D({ x: i, y: i }, { x: i + 1, y: i + 1 });
                const proxyId = tree.createProxy(aabb, { id: i });
                if (i % 2 === 0) {
                    tree.destroyProxy(proxyId);
                }
            }
        });
    });

    describe('Query Performance', () => {
        it('queries large tree efficiently', () => {
            for (let i = 0; i < 100; i++) {
                const x = Math.floor(i / 10);
                const y = i % 10;
                const aabb = new AABB2D({ x, y }, { x: x + 1, y: y + 1 });
                tree.createProxy(aabb, { id: i });
            }

            const queryAABB = new AABB2D({ x: 5, y: 5 }, { x: 6, y: 6 });
            const results: number[] = [];
            tree.query((id) => {
                results.push(id);
                return true;
            }, queryAABB);

            expect(results.length).toBeLessThan(100);
        });

        it('queries with small AABB', () => {
            for (let i = 0; i < 50; i++) {
                const aabb = new AABB2D({ x: i * 2, y: i * 2 }, { x: i * 2 + 1, y: i * 2 + 1 });
                tree.createProxy(aabb, { id: i });
            }

            const queryAABB = new AABB2D({ x: 10.5, y: 10.5 }, { x: 10.6, y: 10.6 });
            const results: number[] = [];
            tree.query((id) => {
                results.push(id);
                return true;
            }, queryAABB);

            expect(results.length).toBeLessThan(10);
        });
    });
});
