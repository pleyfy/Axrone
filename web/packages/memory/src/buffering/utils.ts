import { ByteOrder } from './types';

export class BufferUtils {
    private static readonly textEncoder = new TextEncoder();
    private static readonly textDecoder = new TextDecoder();
    private static crc32Table: Uint32Array | null = null;
    private static readonly nativeEndian = BufferUtils.detectNativeEndianness();

    private static detectNativeEndianness(): ByteOrder {
        const buffer = new ArrayBuffer(2);
        new DataView(buffer).setInt16(0, 1, true);
        return new Int16Array(buffer)[0] === 1 ? ByteOrder.Little : ByteOrder.Big;
    }

    static nativeEndianness(): ByteOrder {
        return BufferUtils.nativeEndian;
    }

    static getCrc32Table(): Uint32Array {
        if (!BufferUtils.crc32Table) {
            BufferUtils.crc32Table = BufferUtils.generateCrc32Table();
        }
        return BufferUtils.crc32Table;
    }

    private static generateCrc32Table(): Uint32Array {
        const table = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let crc = i;
            for (let j = 0; j < 8; j++) {
                crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
            }
            table[i] = crc;
        }
        return table;
    }

    static encodeString(str: string, encoding: 'utf8' | 'utf16' = 'utf8'): Uint8Array {
        if (encoding === 'utf16') {
            const buffer = new ArrayBuffer(str.length * 2);
            const view = new Uint16Array(buffer);
            for (let i = 0; i < str.length; i++) {
                view[i] = str.charCodeAt(i);
            }
            return new Uint8Array(buffer);
        }
        return BufferUtils.textEncoder.encode(str);
    }

    static decodeString(bytes: Uint8Array, encoding: 'utf8' | 'utf16' = 'utf8'): string {
        if (encoding === 'utf16') {
            const view = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
            return String.fromCharCode(...view);
        }
        return BufferUtils.textDecoder.decode(bytes);
    }

    static calculateHash(data: Uint8Array, algorithm: 'fnv1a' | 'djb2' = 'fnv1a'): number {
        if (algorithm === 'djb2') {
            let hash = 5381;
            for (let i = 0; i < data.length; i++) {
                hash = (hash << 5) + hash + data[i];
            }
            return hash >>> 0;
        }

        const fnvPrime = 0x01000193;
        let hash = 0x811c9dc5;
        for (let i = 0; i < data.length; i++) {
            hash ^= data[i];
            hash = Math.imul(hash, fnvPrime);
        }
        return hash >>> 0;
    }

    static calculateCrc32(data: Uint8Array): number {
        let crc = 0xffffffff;
        const table = BufferUtils.getCrc32Table();
        for (let i = 0; i < data.length; i++) {
            crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xff];
        }
        return (crc ^ 0xffffffff) >>> 0;
    }

    static isPowerOfTwo(value: number): boolean {
        return value > 0 && (value & (value - 1)) === 0;
    }

    static nextPowerOfTwo(value: number): number {
        if (value <= 0) return 1;
        if (BufferUtils.isPowerOfTwo(value)) return value;
        return 1 << (32 - Math.clz32(value - 1));
    }

    static alignTo(value: number, alignment: number): number {
        if (!BufferUtils.isPowerOfTwo(alignment)) {
            throw new Error('Alignment must be a power of 2');
        }
        return (value + alignment - 1) & ~(alignment - 1);
    }

    static compareBytes(a: Uint8Array, b: Uint8Array): number {
        const minLength = Math.min(a.length, b.length);
        for (let i = 0; i < minLength; i++) {
            const diff = a[i] - b[i];
            if (diff !== 0) return diff;
        }
        return a.length - b.length;
    }

    static equalBytes(a: Uint8Array, b: Uint8Array): boolean {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }

    static copyBytes(
        source: Uint8Array,
        target: Uint8Array,
        sourceOffset = 0,
        targetOffset = 0,
        length?: number
    ): void {
        const copyLength =
            length ?? Math.min(source.length - sourceOffset, target.length - targetOffset);
        target.set(source.subarray(sourceOffset, sourceOffset + copyLength), targetOffset);
    }

    static fillBytes(target: Uint8Array, value: number, offset = 0, length?: number): void {
        const fillLength = length ?? target.length - offset;
        target.fill(value, offset, offset + fillLength);
    }
}
