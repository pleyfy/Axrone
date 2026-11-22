import { describe, expect, it } from 'vitest';
import { PrefabNodeBinding } from '../prefab-node-binding';

describe('PrefabNodeBinding', () => {
    describe('constructor', () => {
        it('initializes with both nodeId and instanceId as null by default', () => {
            const binding = new PrefabNodeBinding();
            expect(binding.nodeId).toBeNull();
            expect(binding.instanceId).toBeNull();
        });

        it('accepts initial nodeId and instanceId', () => {
            const binding = new PrefabNodeBinding({ nodeId: 'node-1', instanceId: 'inst-1' });
            expect(binding.nodeId).toBe('node-1');
            expect(binding.instanceId).toBe('inst-1');
        });
    });

    describe('getters and setters', () => {
        it('gets and sets nodeId', () => {
            const binding = new PrefabNodeBinding();
            expect(binding.nodeId).toBeNull();
            binding.nodeId = 'abc';
            expect(binding.nodeId).toBe('abc');
        });

        it('gets and sets instanceId', () => {
            const binding = new PrefabNodeBinding();
            expect(binding.instanceId).toBeNull();
            binding.instanceId = 'xyz';
            expect(binding.instanceId).toBe('xyz');
        });

        it('can set back to null', () => {
            const binding = new PrefabNodeBinding({ nodeId: 'a', instanceId: 'b' });
            binding.nodeId = null;
            binding.instanceId = null;
            expect(binding.nodeId).toBeNull();
            expect(binding.instanceId).toBeNull();
        });
    });

    describe('serialize', () => {
        it('returns object with nodeId and instanceId', () => {
            const binding = new PrefabNodeBinding({ nodeId: 'n1', instanceId: 'i1' });
            const serialized = binding.serialize();
            expect(serialized).toEqual({ nodeId: 'n1', instanceId: 'i1' });
        });

        it('serializes null nodeId', () => {
            const binding = new PrefabNodeBinding();
            expect(binding.serialize()).toEqual({ nodeId: null, instanceId: null });
        });
    });

    describe('deserialize', () => {
        it('restores nodeId from valid data', () => {
            const binding = new PrefabNodeBinding();
            binding.deserialize({ nodeId: 'restored' });
            expect(binding.nodeId).toBe('restored');
        });

        it('handles null nodeId', () => {
            const binding = new PrefabNodeBinding({ nodeId: 'old' });
            binding.deserialize({ nodeId: null });
            expect(binding.nodeId).toBeNull();
        });

        it('ignores non-string nodeId values', () => {
            const binding = new PrefabNodeBinding({ nodeId: 'keep' });
            binding.deserialize({ nodeId: 123 as any });
            expect(binding.nodeId).toBe('keep');
        });

        it('ignores undefined nodeId', () => {
            const binding = new PrefabNodeBinding({ nodeId: 'keep' });
            binding.deserialize({} as any);
            expect(binding.nodeId).toBe('keep');
        });

        it('also restores instanceId when provided in data', () => {
            const binding = new PrefabNodeBinding();
            binding.deserialize({ nodeId: 'n', instanceId: 'i' });
            expect(binding.nodeId).toBe('n');
            expect(binding.instanceId).toBe('i');
        });

        it('round-trip preserves instanceId in serialized form', () => {
            const binding = new PrefabNodeBinding({ nodeId: 'n1', instanceId: 'i1' });
            const serialized = binding.serialize();
            expect(serialized).toHaveProperty('instanceId', 'i1');
        });
    });

    describe('round-trip', () => {
        it('serialize -> deserialize restores nodeId and instanceId', () => {
            const original = new PrefabNodeBinding({ nodeId: 'round-trip', instanceId: 'inst-7' });
            const serialized = original.serialize();

            const restored = new PrefabNodeBinding();
            restored.deserialize(serialized);
            expect(restored.nodeId).toBe('round-trip');
            expect(restored.instanceId).toBe('inst-7');
        });
    });
});
