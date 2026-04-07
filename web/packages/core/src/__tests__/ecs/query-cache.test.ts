import { beforeEach, describe, expect, it } from 'vitest';
import { OptimizedQueryCache } from '../../component-system/archetype/query-cache';
import type { ArchetypeId, BitMask } from '../../component-system/types/core';

describe('OptimizedQueryCache', () => {
    let cache: OptimizedQueryCache;

    beforeEach(() => {
        cache = new OptimizedQueryCache();
    });

    describe('string query caching', () => {
        it('should store and retrieve string queries', () => {
            const key = 'Position,Velocity';
            const archetypes: ArchetypeId[] = ['Position|Velocity' as ArchetypeId];

            cache.setQuery(key, archetypes);
            const result = cache.getQuery(key);

            expect(result).toEqual(archetypes);
        });

        it('should return undefined for non-existent queries', () => {
            const result = cache.getQuery('NonExistent');
            expect(result).toBeUndefined();
        });

        it('should handle multiple different queries', () => {
            const queries = [
                { key: 'Position', archetypes: ['Position' as ArchetypeId] },
                { key: 'Position,Velocity', archetypes: ['Position|Velocity' as ArchetypeId] },
                { key: 'Health,Damage', archetypes: ['Health|Damage' as ArchetypeId] },
            ];

            queries.forEach(({ key, archetypes }) => {
                cache.setQuery(key, archetypes);
            });

            queries.forEach(({ key, archetypes }) => {
                expect(cache.getQuery(key)).toEqual(archetypes);
            });
        });

        it('should overwrite existing queries', () => {
            const key = 'Position';
            const archetypes1: ArchetypeId[] = ['Position' as ArchetypeId];
            const archetypes2: ArchetypeId[] = ['Position|Velocity' as ArchetypeId];

            cache.setQuery(key, archetypes1);
            expect(cache.getQuery(key)).toEqual(archetypes1);

            cache.setQuery(key, archetypes2);
            expect(cache.getQuery(key)).toEqual(archetypes2);
        });
    });

    describe('bit mask query caching', () => {
        it('should store and retrieve bit mask queries', () => {
            const mask: BitMask = 5n;
            const archetypes: ArchetypeId[] = ['Position|Health' as ArchetypeId];

            cache.setBitQuery(mask, archetypes);
            const result = cache.getBitQuery(mask);

            expect(result).toEqual(archetypes);
        });

        it('should return undefined for non-existent bit queries', () => {
            const result = cache.getBitQuery(999n);
            expect(result).toBeUndefined();
        });

        it('should handle multiple bit mask queries', () => {
            const queries = [
                { mask: 1n, archetypes: ['Position' as ArchetypeId] },
                { mask: 3n, archetypes: ['Position|Velocity' as ArchetypeId] },
                { mask: 7n, archetypes: ['Position|Velocity|Health' as ArchetypeId] },
            ];

            queries.forEach(({ mask, archetypes }) => {
                cache.setBitQuery(mask, archetypes);
            });

            queries.forEach(({ mask, archetypes }) => {
                expect(cache.getBitQuery(mask)).toEqual(archetypes);
            });
        });

        it('should handle large bit masks', () => {
            const largeMask: BitMask = 0xffffffffffffffffn;
            const archetypes: ArchetypeId[] = ['Complex' as ArchetypeId];

            cache.setBitQuery(largeMask, archetypes);
            expect(cache.getBitQuery(largeMask)).toEqual(archetypes);
        });
    });

    describe('cache invalidation', () => {
        it('should invalidate string queries on generation change', () => {
            const key = 'Position,Velocity';
            const archetypes: ArchetypeId[] = ['Position|Velocity' as ArchetypeId];

            cache.setQuery(key, archetypes);
            expect(cache.getQuery(key)).toEqual(archetypes);

            cache.invalidate();
            expect(cache.getQuery(key)).toBeUndefined();
        });

        it('should not affect bit queries during invalidation', () => {
            const mask: BitMask = 5n;
            const archetypes: ArchetypeId[] = ['Position|Health' as ArchetypeId];

            cache.setBitQuery(mask, archetypes);
            cache.invalidate();

            expect(cache.getBitQuery(mask)).toEqual(archetypes);
        });

        it('should handle multiple invalidations', () => {
            const key = 'Position';
            const archetypes: ArchetypeId[] = ['Position' as ArchetypeId];

            cache.setQuery(key, archetypes);
            cache.invalidate();
            cache.invalidate();
            cache.invalidate();

            expect(cache.getQuery(key)).toBeUndefined();
        });

        it('should allow re-caching after invalidation', () => {
            const key = 'Position,Velocity';
            const archetypes1: ArchetypeId[] = ['Position|Velocity' as ArchetypeId];
            const archetypes2: ArchetypeId[] = ['Position|Velocity|Health' as ArchetypeId];

            cache.setQuery(key, archetypes1);
            cache.invalidate();
            cache.setQuery(key, archetypes2);

            expect(cache.getQuery(key)).toEqual(archetypes2);
        });
    });

    describe('generation tracking', () => {
        it('should track query generations correctly', () => {
            const key1 = 'Position';
            const key2 = 'Velocity';
            const archetypes: ArchetypeId[] = ['Test' as ArchetypeId];

            cache.setQuery(key1, archetypes);
            cache.invalidate();
            cache.setQuery(key2, archetypes);

            expect(cache.getQuery(key1)).toBeUndefined();
            expect(cache.getQuery(key2)).toEqual(archetypes);
        });

        it('should handle concurrent query operations', () => {
            const queries = Array.from({ length: 100 }, (_, i) => ({
                key: `Query${i}`,
                archetypes: [`Archetype${i}` as ArchetypeId],
            }));

            queries.forEach(({ key, archetypes }) => {
                cache.setQuery(key, archetypes);
            });

            cache.invalidate();

            queries.forEach(({ key }) => {
                expect(cache.getQuery(key)).toBeUndefined();
            });
        });
    });

    describe('memory management', () => {
        it('should handle large numbers of queries efficiently', () => {
            const queryCount = 1000;
            const startTime = performance.now();

            for (let i = 0; i < queryCount; i++) {
                cache.setQuery(`Query${i}`, [`Archetype${i}` as ArchetypeId]);
            }

            for (let i = 0; i < queryCount; i++) {
                cache.getQuery(`Query${i}`);
            }

            const endTime = performance.now();
            expect(endTime - startTime).toBeLessThan(100);
        });

        it('should handle frequent invalidations efficiently', () => {
            const key = 'TestQuery';
            const archetypes: ArchetypeId[] = ['TestArchetype' as ArchetypeId];
            const iterations = 1000;

            const startTime = performance.now();

            for (let i = 0; i < iterations; i++) {
                cache.setQuery(key, archetypes);
                cache.invalidate();
            }

            const endTime = performance.now();
            expect(endTime - startTime).toBeLessThan(50);
        });

        it('should clean up invalidated queries properly', () => {
            const queries = Array.from({ length: 100 }, (_, i) => `Query${i}`);
            const archetypes: ArchetypeId[] = ['Test' as ArchetypeId];

            queries.forEach((key) => cache.setQuery(key, archetypes));
            cache.invalidate();

            queries.forEach((key) => {
                expect(cache.getQuery(key)).toBeUndefined();
            });
        });
    });

    describe('edge cases', () => {
        it('should handle empty query keys', () => {
            const key = '';
            const archetypes: ArchetypeId[] = ['Empty' as ArchetypeId];

            cache.setQuery(key, archetypes);
            expect(cache.getQuery(key)).toEqual(archetypes);
        });

        it('should handle empty archetype arrays', () => {
            const key = 'EmptyResult';
            const archetypes: ArchetypeId[] = [];

            cache.setQuery(key, archetypes);
            expect(cache.getQuery(key)).toEqual(archetypes);
        });

        it('should handle zero bit mask', () => {
            const mask: BitMask = 0n;
            const archetypes: ArchetypeId[] = ['Empty' as ArchetypeId];

            cache.setBitQuery(mask, archetypes);
            expect(cache.getBitQuery(mask)).toEqual(archetypes);
        });

        it('should handle special characters in query keys', () => {
            const specialKeys = ['Query|With|Pipes', 'Query,With,Commas', 'Query With Spaces'];
            const archetypes: ArchetypeId[] = ['Special' as ArchetypeId];

            specialKeys.forEach((key) => {
                cache.setQuery(key, archetypes);
                expect(cache.getQuery(key)).toEqual(archetypes);
            });
        });
    });

    describe('cache statistics', () => {
        it('should maintain separate storage for string and bit queries', () => {
            const stringKey = 'Position';
            const bitMask: BitMask = 1n;
            const stringArchetypes: ArchetypeId[] = ['StringArchetype' as ArchetypeId];
            const bitArchetypes: ArchetypeId[] = ['BitArchetype' as ArchetypeId];

            cache.setQuery(stringKey, stringArchetypes);
            cache.setBitQuery(bitMask, bitArchetypes);

            expect(cache.getQuery(stringKey)).toEqual(stringArchetypes);
            expect(cache.getBitQuery(bitMask)).toEqual(bitArchetypes);

            cache.invalidate();

            expect(cache.getQuery(stringKey)).toBeUndefined();
            expect(cache.getBitQuery(bitMask)).toEqual(bitArchetypes);
        });
    });
});
