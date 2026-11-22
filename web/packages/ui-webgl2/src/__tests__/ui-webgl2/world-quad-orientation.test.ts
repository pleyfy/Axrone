import { describe, expect, it, vi } from 'vitest';
import { createUIWorldQuadRenderer, orientQuadTowardCamera } from '../../world-quad';
import { intersectRayWithUIQuad } from '../../world-input';
import { columnMajorIdentity, createMockWebGL2Context } from './support/ui-webgl2-harness';

describe('orientQuadTowardCamera', () => {
    it('adopts the camera rotation while keeping the entity position', () => {
        const model = columnMajorIdentity(2, 3, 4);
        // Camera rotated 90 degrees about Y, positioned elsewhere.
        const cameraWorld = new Float32Array([
            0, 0, -1, 0,
            0, 1, 0, 0,
            1, 0, 0, 0,
            9, 9, 9, 1,
        ]);

        const result = orientQuadTowardCamera(model, cameraWorld);

        // Rotation basis comes from the camera...
        expect(result[0]).toBeCloseTo(0);
        expect(result[2]).toBeCloseTo(-1);
        expect(result[8]).toBeCloseTo(1);
        // ...translation stays on the entity.
        expect(result[12]).toBe(2);
        expect(result[13]).toBe(3);
        expect(result[14]).toBe(4);
        expect(result[15]).toBe(1);
    });

    it('preserves the entity scale rather than inheriting the camera scale', () => {
        // Entity scaled 3x on X, camera scaled 2x on X.
        const model = new Float32Array([3, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
        const cameraWorld = new Float32Array([2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

        const result = orientQuadTowardCamera(model, cameraWorld);

        expect(Math.hypot(result[0], result[1], result[2])).toBeCloseTo(3);
    });

    it('keeps the billboarded quad facing a camera-aligned ray', () => {
        // A quad turned away from the camera still gets hit once billboarded.
        const turnedAway = new Float32Array([
            0, 0, -1, 0,
            0, 1, 0, 0,
            1, 0, 0, 0,
            0, 0, 0, 1,
        ]);
        const cameraWorld = columnMajorIdentity(0, 0, 6);
        const ray = { origin: [0, 0, 6] as const, direction: [0, 0, -1] as const };

        expect(intersectRayWithUIQuad(ray, turnedAway, 2, 1)).toBeNull();

        const billboarded = orientQuadTowardCamera(turnedAway, cameraWorld);
        const hit = intersectRayWithUIQuad(ray, billboarded, 2, 1);

        expect(hit).not.toBeNull();
        expect(hit!.u).toBeCloseTo(0.5);
        expect(hit!.v).toBeCloseTo(0.5);
    });
});


describe('world-quad active texture preservation', () => {
    it('restores the caller active texture unit after draw', () => {
        const gl = createMockWebGL2Context();
        const callerUnit = gl.TEXTURE1;
        // Simulate caller having TEXTURE1 active before draw.
        gl.activeTexture(callerUnit);
        const quadRenderer = createUIWorldQuadRenderer(gl);
        const texture = gl.createTexture()!;
        const vp = columnMajorIdentity();
        quadRenderer.draw(texture, {
            modelMatrix: vp,
            viewProjection: vp,
            width: 64,
            height: 64,
        });
        // The last activeTexture call must restore the caller's unit.
        const activeTextureCalls = (gl.activeTexture as ReturnType<typeof vi.fn>).mock.calls;
        const lastCall = activeTextureCalls[activeTextureCalls.length - 1][0];
        expect(lastCall).toBe(callerUnit);
        quadRenderer.dispose();
    });
});

