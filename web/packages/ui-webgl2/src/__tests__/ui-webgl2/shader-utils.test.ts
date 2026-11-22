import { describe, expect, it } from 'vitest';
import { normalizeShaderSource } from '../../shader-source';

describe('normalizeShaderSource version directive', () => {
    it('locates the #version directive precisely without matching es in comments', () => {
        const corrupted = '// testprecision esprecision mediump float;\n#version 300 esprecision mediump float;\nvoid main() {}';
        const result = normalizeShaderSource(corrupted);
        expect(result).toContain('#version 300 es');
        expect(result.indexOf('#version 300 es')).toBeGreaterThan(0);
    });

    it('returns intact source unchanged', () => {
        const intact = '#version 300 es\nprecision mediump float;\nvoid main() {}';
        expect(normalizeShaderSource(intact)).toBe(intact);
    });
});

describe('writeStrokeColor out-parameter API', () => {
    it('writes correct RGBA values into caller buffer from a hex string', async () => {
        const { writeStrokeColor } = await import('../../webgl-utils');
        const out = new Float32Array(4);
        writeStrokeColor('#ff8040', out);
        expect(out[0]).toBeCloseTo(1, 1);
        expect(out[1]).toBeCloseTo(0.502, 1);
        expect(out[2]).toBeCloseTo(0.251, 1);
        expect(out[3]).toBeCloseTo(1, 1);
    });

    it('writes into caller buffer at specified offset without aliasing', async () => {
        const { writeStrokeColor } = await import('../../webgl-utils');
        const out = new Float32Array(8);
        writeStrokeColor('#ff0000', out, 0);
        writeStrokeColor('#00ff00', out, 4);
        // First color preserved (no scratch aliasing)
        expect(out[0]).toBeCloseTo(1, 1);
        expect(out[1]).toBeCloseTo(0, 1);
        expect(out[2]).toBeCloseTo(0, 1);
        // Second color written correctly
        expect(out[4]).toBeCloseTo(0, 1);
        expect(out[5]).toBeCloseTo(1, 1);
        expect(out[6]).toBeCloseTo(0, 1);
    });
});

/**
 * Regression test for the flush-order bug: when a quad command follows a text
 * command (same clip), the text was flushed early and then the quad drew over
 * it, making labels on filled backgrounds invisible.
 *
 * The fix ensures text is NOT flushed when encountering quad/stroke commands.
 * Text is only flushed when encountering image commands (shared texture unit)
 * or at the end of the frame. This guarantees the draw order is always:
 * quad → image → text, so text appears on top of fills.
 */
