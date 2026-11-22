import { describe, expect, it } from 'vitest';
import {
    ByteBuffer,
    ByteChunk,
    ByteChunkPool,
    ByteChunkPoolSet,
    ByteLength,
    ByteOffset,
} from '../../buffering';

describe('ByteChunk lifecycle', () => {
    it('allocates, writes and reads with epoch guards', () => {
        const chunk = ByteChunk.allocate({ capacity: 64, mutability: 'MUT' });
        expect(chunk.writeUint32(ByteOffset(0), 1234).isOk()).toBe(true);

        const read = chunk.readUint32(ByteOffset(0));
        expect(read.isOk()).toBe(true);
        if (read.isOk()) {
            expect(read.get()).toBe(1234);
        }

        const cursor = chunk.cursor();
        cursor.writeUint32(7);
        cursor.seek(ByteOffset(0));
        expect(cursor.readUint32()).toBe(7);
        chunk.dispose();
    });

    it('rejects cursor use after dispose', () => {
        const chunk = ByteChunk.allocate({ capacity: 32, mutability: 'MUT' });
        const cursor = chunk.cursor();
        chunk.dispose();
        expect(() => cursor.readUint8()).toThrow(/Use-after-free/);
    });

    it('rejects lease access after dispose', () => {
        const chunk = ByteChunk.allocate({ capacity: 32, mutability: 'MUT' });
        const lease = chunk.acquireLease();
        expect(lease.isOk()).toBe(true);
        if (!lease.isOk()) return;

        const handle = lease.get();
        chunk.dispose();
        expect(() => handle.chunk).toThrow(/Use-after-free/);
        handle[Symbol.dispose]();
    });

    it('wraps an existing buffer without copying', () => {
        const buffer = new ArrayBuffer(128);
        const chunk = ByteChunk.wrap(buffer);
        expect(chunk.buffer).toBe(buffer);
        expect(chunk.byteLength).toBe(128);
        chunk.dispose();
    });
});

describe('ByteChunkPool', () => {
    it('reuses chunks and tracks counts', () => {
        const pool = new ByteChunkPool({ chunkSize: 64, maxIdle: 4 });
        const first = pool.acquire();
        expect(pool.getAllocatedCount()).toBe(1);
        first.dispose();
        expect(pool.getAllocatedCount()).toBe(0);
        expect(pool.getAvailableCount()).toBe(1);

        const second = pool.acquire();
        expect(second).toBe(first);
        second.dispose();
        pool[Symbol.dispose]();
    });

    it('is idempotent on double release (no underflow, no aliasing)', () => {
        const pool = new ByteChunkPool({ chunkSize: 64, maxIdle: 4 });
        const chunk = pool.acquire();
        chunk.dispose();
        pool.release(chunk as never);
        pool.release(chunk as never);
        expect(pool.getAllocatedCount()).toBe(0);
        expect(pool.getAvailableCount()).toBe(1);

        const a = pool.acquire();
        const b = pool.acquire();
        expect(a).not.toBe(b);
        a.dispose();
        b.dispose();
        pool[Symbol.dispose]();
    });

    it('rejects foreign chunks and borrowed slices', () => {
        const pool = new ByteChunkPool({ chunkSize: 64, maxIdle: 4 });
        const foreign = ByteChunk.allocate({ capacity: 64, mutability: 'MUT' });
        pool.release(foreign as never);
        expect(pool.getAvailableCount()).toBe(0);

        const owner = pool.acquire();
        const slice = owner.slice(ByteOffset(0), ByteLength(32));
        expect(slice.isOk()).toBe(true);
        if (slice.isOk()) {
            const view = slice.get();
            pool.release(view as never);
            expect(pool.getAvailableCount()).toBe(0);
            view.dispose();
        }
        owner.dispose();
        pool[Symbol.dispose]();
    });

    it('honours clearOnRelease', () => {
        const pool = new ByteChunkPool({ chunkSize: 64, maxIdle: 4, clearOnRelease: true });
        const first = pool.acquire();
        first.fill(0xaa, ByteOffset(0));
        first.dispose();
        const second = pool.acquire();
        expect(second.asUint8Array()[0]).toBe(0);
        second.dispose();
        pool[Symbol.dispose]();
    });

    it('tryAcquire returns null when the idle stack is empty', () => {
        const pool = new ByteChunkPool({ chunkSize: 64, maxIdle: 4 });
        expect(pool.tryAcquire()).toBeNull();
        const chunk = pool.acquire();
        chunk.dispose();
        expect(pool.tryAcquire()).toBe(chunk);
        pool[Symbol.dispose]();
    });
});

describe('ByteBuffer zero-copy borrow', () => {
    it('subarray returns a view without copying or moving position', () => {
        ByteChunkPoolSet.resetInstance();
        const buffer = ByteBuffer.alloc(64);
        buffer.putInt32(0x11223344);
        buffer.flip();

        const view = buffer.subarray(0, 4);
        expect(view.buffer).toBe(buffer.getBuffer());
        expect(view.byteLength).toBe(4);
        expect(view[0]).toBe(0x11);
        expect(buffer.position).toBe(0);

        buffer.release();
        ByteChunkPoolSet.resetInstance();
    });
});

describe('ByteChunkPoolSet', () => {
    it('buckets requests to powers of two and reuses buffers', () => {
        const set = new ByteChunkPoolSet({ clearOnRelease: false, maxIdlePerBucket: 4 });
        const buffer = set.allocate(100);
        expect(buffer.byteLength).toBe(128);
        set.release(buffer);
        const reused = set.allocate(100);
        expect(reused).toBe(buffer);
        set.release(reused);
        set[Symbol.dispose]();
    });

    it('tryAllocate returns null when no idle chunk exists', () => {
        const set = new ByteChunkPoolSet({ maxIdlePerBucket: 4 });
        expect(set.tryAllocate(64)).toBeNull();
        set[Symbol.dispose]();
    });

    it('backs ByteBuffer pooling', () => {
        ByteChunkPoolSet.resetInstance();
        const first = ByteBuffer.alloc(64);
        const raw = first.getBuffer();
        first.release();

        const second = ByteBuffer.alloc(64);
        expect(second.getBuffer()).toBe(raw);
        second.release();
        ByteChunkPoolSet.resetInstance();
    });

    it('preserves data across ensureCapacity growth', () => {
        ByteChunkPoolSet.resetInstance();
        const buffer = ByteBuffer.alloc(32);
        buffer.putInt32(0x11223344);
        buffer.putInt32(0x55667788);
        buffer.putInt32(0x99aabbcc);

        for (let i = 0; i < 32; i++) buffer.putInt32(i);
        buffer.flip();
        expect(buffer.getInt32()).toBe(0x11223344);
        buffer.release();
        ByteChunkPoolSet.resetInstance();
    });
});
