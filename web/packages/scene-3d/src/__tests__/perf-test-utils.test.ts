import { describe, expect, it } from 'vitest';
import {
    ANY_ALLOCATION_PATTERN,
    VECTOR_ALLOCATION_PATTERN,
    extractMethodBody,
    median,
} from './perf-test-utils';

/**
 * Shape mirrors what Class.toString() returns inside vitest: esbuild
 * strips types and rewrites imports to __vite_ssr_import_N__, methods sit
 * at 2-space indent, and call sites reference the same names as definitions.
 */
const TRANSPILED_SHAPE = `class extends __vite_ssr_import_1__.Component {
  constructor(config = {}) {
    this._smoothedTarget = new __vite_ssr_import_0__.Vec3();
    this._desiredTarget = new __vite_ssr_import_0__.Vec3();
  }
  lateUpdate(deltaTime) {
    const transform = this.transform;
    if (!transform) {
      return;
    }
    const desiredTarget = this._resolveDesiredTarget(this._desiredTarget);
    this._applyCameraTransform(transform, this._desiredPosition, this._smoothedTarget);
    return desiredTarget;
  }
  _resolveDesiredTarget(out) {
    __vite_ssr_import_0__.Vec3.copy(this._target, out);
    return out;
  }
  _applyCameraTransform(transform, position, target) {
    const up = this._resolveUp(position);
    if (up.x === 0 && up.y === 1 && up.z === "0}") {
      return;
    }
    transform.position = position;
  }
}`;

describe('perf-test-utils', () => {
    describe('extractMethodBody', () => {
        it('extracts the full method body without truncation', () => {
            const body = extractMethodBody(TRANSPILED_SHAPE, 'lateUpdate');
            expect(body).toContain('if (!transform)');
            expect(body).toContain('this._resolveDesiredTarget');
            expect(body).toContain('this._applyCameraTransform');
            expect(body).toContain('return desiredTarget');
            // Must NOT bleed into the next method
            expect(body).not.toContain('_resolveDesiredTarget(out)');
        });

        it('anchors on the definition, not call sites', () => {
            // `_applyCameraTransform` is called inside lateUpdate BEFORE its
            // definition; extraction must still land on the definition body.
            const body = extractMethodBody(TRANSPILED_SHAPE, '_applyCameraTransform');
            expect(body).toContain('const up = this._resolveUp(position)');
            expect(body).toContain('transform.position = position');
            expect(body).not.toContain('lateUpdate');
        });

        it('handles braces inside string literals', () => {
            const body = extractMethodBody(TRANSPILED_SHAPE, '_applyCameraTransform');
            expect(body).toContain('"0}"');
        });

        it('throws when the method is missing (no vacuous passes)', () => {
            expect(() => extractMethodBody(TRANSPILED_SHAPE, '_doesNotExist')).toThrow(
                /not found in class source/,
            );
        });
    });

    describe('allocation patterns', () => {
        it('ANY_ALLOCATION_PATTERN catches transpiled namespaced allocations', () => {
            const body = extractMethodBody(TRANSPILED_SHAPE, 'constructor');
            expect(body.match(ANY_ALLOCATION_PATTERN)).toEqual([
                'new __vite_ssr_import_0__.Vec3',
                'new __vite_ssr_import_0__.Vec3',
            ]);
        });

        it('VECTOR_ALLOCATION_PATTERN catches both source and transpiled Vec3/Quat', () => {
            expect('const v = new Vec3();'.match(VECTOR_ALLOCATION_PATTERN)).toEqual([
                'new Vec3',
            ]);
            expect('const q = new __vite_ssr_import_0__.Quat();'.match(VECTOR_ALLOCATION_PATTERN))
                .toEqual(['new __vite_ssr_import_0__.Quat']);
            // Non-vector allocations are not flagged by the vector pattern
            expect('const t = new Transform();'.match(VECTOR_ALLOCATION_PATTERN)).toBeNull();
        });
    });

    describe('median', () => {
        it('returns the middle value for odd-length input', () => {
            expect(median([5, 1, 3])).toBe(3);
        });

        it('returns the mean of middle values for even-length input', () => {
            expect(median([4, 1, 3, 2])).toBe(2.5);
        });

        it('ignores spikes that would poison the mean', () => {
            const samples = [1, 1, 1, 1, 100];
            expect(median(samples)).toBe(1);
        });

        it('returns 0 for empty input', () => {
            expect(median([])).toBe(0);
        });
    });
});
