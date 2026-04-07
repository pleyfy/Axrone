import {
    ByteBuffer,
    BufferOverflowError,
    BufferUnderflowError,
    ReadOnlyBufferError,
    BufferAlignmentError,
    InvalidMarkError,
} from '../../memory/buffering';

describe('ByteBuffer core — professional tests', () => {
    it('allocates with a positive capacity and rounds to power of two', () => {
        const b = ByteBuffer.alloc(100);
        expect(b.capacity).toBeGreaterThanOrEqual(100);

        expect(b.capacity).toBeGreaterThanOrEqual(128);
    });

    it('wraps ArrayBuffer and caches the wrapper', () => {
        const ab = new ArrayBuffer(64);
        const w1 = ByteBuffer.wrap(ab);
        const w2 = ByteBuffer.wrap(ab);
        expect(w1).toBe(w2);
    });

    it('put/get primitive types respect byte order and position', () => {
        const b = ByteBuffer.alloc(32, 0);

        b.putInt8(-1)
            .putUint8(0xff)
            .putInt16(-12345)
            .putUint16(0xabcd)
            .putInt32(-12345678)
            .putUint32(0x90abcdef);

        b.rewind();

        expect(b.getInt8()).toBe(-1);
        expect(b.getUint8()).toBe(0xff);
        expect(b.getInt16()).toBe(-12345);
        expect(b.getUint16()).toBe(0xabcd);
        expect(b.getInt32()).toBe(-12345678);
        expect(b.getUint32()).toBe(0x90abcdef);
    });

    it('put/get float and bigint types', () => {
        const b = ByteBuffer.alloc(64);
        b.putFloat32(3.14159).putFloat64(2.718281828).putBigInt64(1234567890123456789n);
        b.rewind();
        const f32 = b.getFloat32();
        const f64 = b.getFloat64();
        const bi = b.getBigInt64();
        expect(Math.abs(f32 - 3.14159)).toBeLessThan(1e-6);
        expect(Math.abs(f64 - 2.718281828)).toBeLessThan(1e-12);
        expect(bi).toBe(1234567890123456789n);
    });

    it('putString/getString roundtrips and enforces max length', () => {
        const b = ByteBuffer.alloc(256);
        const s = 'Hello, ByteBuffer ✓';
        b.putString(s);
        b.rewind();
        const out = b.getString();
        expect(out).toBe(s);

        const big = 'x'.repeat(1024 * 1024 + 1);
        const b2 = ByteBuffer.alloc(8);
        expect(() => b2.putString(big)).toThrow(BufferOverflowError);
    });

    it('putCString/getCString handles null terminator and errors when missing', () => {
        const b = ByteBuffer.alloc(64);
        b.putCString('abc');
        b.rewind();
        expect(b.getCString()).toBe('abc');

        const b2 = ByteBuffer.alloc(3);
        b2.putUint8(1).putUint8(2).putUint8(3);
        b2.flip();
        b2.rewind();
        expect(() => b2.getCString()).toThrow(BufferUnderflowError);
    });

    it('varint encodes/decodes and throws on overly large varint', () => {
        const b = ByteBuffer.alloc(16);
        b.putVarInt(300).putVarInt(0xffffffff >>> 0);
        b.rewind();
        expect(b.getVarInt()).toBe(300);
        expect(b.getVarInt()).toBe(0xffffffff >>> 0);

        const b2 = ByteBuffer.alloc(16);

        b2.putUint8(0x80)
            .putUint8(0x80)
            .putUint8(0x80)
            .putUint8(0x80)
            .putUint8(0x80)
            .putUint8(0x80);
        b2.rewind();
        expect(() => b2.getVarInt()).toThrow(BufferUnderflowError);
    });

    it('sliceRange returns a slice and advances position', () => {
        const b = ByteBuffer.alloc(32);
        b.putAll([1, 2, 3, 4, 5, 6, 7, 8]);
        b.rewind();
        const s = b.sliceRange(4);
        expect(s.remaining).toBe(4);
        expect(s.getUint8()).toBe(1);
        expect(b.position).toBe(4);
    });

    it('compact moves unread bytes to start', () => {
        const b = ByteBuffer.alloc(16);
        b.putAll([10, 20, 30, 40]);
        b.flip();
        expect(b.remaining).toBe(4);
        expect(b.getUint8()).toBe(10);

        b.compact();
        expect(b.position).toBe(0);
        expect(b.limit).toBe(3);
        b.rewind();
        expect(b.getUint8()).toBe(20);
    });

    it('duplicate creates an independent view of the same buffer', () => {
        const b = ByteBuffer.alloc(16);
        b.putUint8(5).putUint8(6);
        const d = b.duplicate();
        expect(d.position).toBe(b.position);
        d.rewind();

        d.getUint8();
        expect(b.position).not.toBe(d.position);
    });

    it('reset/mark behavior and invalid resets', () => {
        const b = ByteBuffer.alloc(16);
        b.putAll([1, 2, 3, 4]);
        b.rewind();
        b.getUint8();
        b.mark();
        b.getUint8();
        b.reset();
        expect(b.position).toBe(1);

        const b2 = ByteBuffer.alloc(8);
        expect(() => b2.reset()).toThrow(InvalidMarkError);
    });

    it('align requires power-of-two and can align position', () => {
        const b = ByteBuffer.alloc(32);
        b.putUint8(1).putUint8(2).putUint8(3);
        expect(() => b.align(3)).toThrow(BufferAlignmentError);
        b.rewind();
        b.align(4);
        expect(b.position % 4).toBe(0);
    });

    it('get/put typed arrays (int32) roundtrip', () => {
        const b = ByteBuffer.alloc(64);
        b.putInt32Array([1, 2, 3, 4]);
        b.rewind();
        const arr = b.getInt32Array(4);
        expect(Array.from(arr)).toEqual([1, 2, 3, 4]);
    });

    it('compare and equals behave as expected', () => {
        const a = ByteBuffer.alloc(16);
        const b = ByteBuffer.alloc(16);
        a.putAll([1, 2, 3]);
        b.putAll([1, 2, 3]);
        a.rewind();
        b.rewind();
        expect(ByteBuffer.equals(a, b)).toBe(true);
        expect(ByteBuffer.compare(a, b)).toBe(0);

        b.rewind();
        b.putUint8(4);
        b.rewind();
        expect(ByteBuffer.equals(a, b)).toBe(false);
    });

    it('toUint8Array returns a view of remaining bytes', () => {
        const b = ByteBuffer.alloc(8);
        b.putAll([9, 8, 7, 6]);
        b.flip();
        b.rewind();
        const u = b.toUint8Array();
        expect(Array.from(u)).toEqual([9, 8, 7, 6]);
    });

    it('read-only buffers throw on write attempts', () => {
        const b = ByteBuffer.alloc(16);
        b.putUint8(1).rewind();
        const ro = b.asReadOnlyBuffer();
        expect(ro.isReadOnly).toBe(true);

        const writable: any = ro;
        expect(() => writable.putUint8(2)).toThrow(ReadOnlyBufferError);
    });
});
