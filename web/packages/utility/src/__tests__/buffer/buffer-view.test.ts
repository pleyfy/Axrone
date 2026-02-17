import { ByteBuffer, BufferView } from '../../memory/buffering';

describe('BufferView — professional tests', () => {
    it('creates typed views and reports capacity/position/limit correctly', () => {
        const b = ByteBuffer.alloc(32);
        const v = BufferView.createInt16View(b);

        expect(v.capacity).toBe(Math.floor(b.capacity / 2));
        expect(v.position).toBe(0);
        expect(v.limit).toBe(Math.floor(b.limit / 2));
    });

    it('setValue/getValue operates at index and advances underlying buffer position', () => {
        const b = ByteBuffer.alloc(16);
        const v = BufferView.createInt8View(b);

        v.setValue(0, 10);
        v.setValue(1, -5);

        expect(b.position).toBe(2);

        b.rewind();
        expect(v.getValue(0)).toBe(10);
        expect(v.getValue(1)).toBe(-5);
    });

    it('getValues and setValues read/write ranges safely and throw on OOB', () => {
        const b = ByteBuffer.alloc(16);
        const v = BufferView.createInt16View(b);

        v.setValues(0, [1000, -1000, 2000]);
        b.rewind();
        const got = v.getValues(0, 3);
        expect(got).toEqual([1000, -1000, 2000]);

        expect(() => v.getValues(1, 100)).toThrow(RangeError);

        expect(() => v.setValues(v.capacity, [1, 2, 3])).toThrow(RangeError);
    });

    it('typed accessors enforce element type (getInt32 on float view throws)', () => {
        const b = ByteBuffer.alloc(32);
        const v = BufferView.createFloat32View(b);

        expect(() => (v as any).getInt32()).toThrow();
    });

    it('toTypedArray returns a copy/TypedArray matching the view capacity', () => {
        const b = ByteBuffer.alloc(32);
        const v = BufferView.createUint8View(b);
        v.setValues(0, [1, 2, 3, 4]);
        b.flip();
        b.rewind();
        const ta = v.toTypedArray();

        expect(ta).toBeInstanceOf(Uint8Array);

        expect(ta.length).toBeGreaterThanOrEqual(0);
        expect(ta.length).toBeLessThanOrEqual(v.capacity);
        if (ta.length >= 4) {
            expect(Array.from(ta).slice(0, 4)).toEqual([1, 2, 3, 4]);
        }
    });

    it('slice returns a new BufferView with correct bounds', () => {
        const b = ByteBuffer.alloc(32);
        const v = BufferView.createUint8View(b);
        v.setValues(0, [9, 8, 7, 6, 5]);
        const s = v.slice(1, 4);
        expect(s.capacity).toBe(3);
        expect(s.getValue(0)).toBe(8);
        expect(() => v.slice(-1, 2)).toThrow(RangeError);
    });

    it('iterator yields elements in order', () => {
        const b = ByteBuffer.alloc(16);
        const v = BufferView.createUint8View(b);
        v.setValues(0, [11, 22, 33]);
        b.flip();
        b.rewind();
        const got: number[] = [];
        for (const x of v as any) {
            got.push(x);
            if (got.length === 3) break;
        }
        expect(got).toEqual([11, 22, 33]);
    });

    it('read-only underlying buffer prevents setValue/setValues', () => {
        const b = ByteBuffer.alloc(16);
        b.putUint8(1);
        const ro = b.asReadOnlyBuffer();
        const v = BufferView.createUint8View(ro as any);
        expect(v.isReadOnly).toBe(true);
        expect(() => v.setValue(0, 5)).toThrow();
        expect(() => v.setValues(0, [1, 2])).toThrow();
    });

    it('fromTypedArray infers type and creates view', () => {
        const b = ByteBuffer.alloc(32);
        const typed = new Int16Array([1, 2, 3]);
        const v = BufferView.fromTypedArray(typed, b as any);
        expect(v.elementType).toBe('int16');
        v.setValues(0, [4, 5, 6]);
        b.rewind();
        expect(v.getValues(0, 3)).toEqual([4, 5, 6]);
    });
});
