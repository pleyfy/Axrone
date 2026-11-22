import { describe, expect, it } from 'vitest';
import { compileMotion } from '../blend-tree';
import { resolveMotionDuration } from '../blend-duration';
import { AnimationClip } from '../clip';
import { AnimationParameterStore } from '../parameters';
import { AnimationCurveLayout } from '../pose';
import { AnimationRig } from '../rig';
import type { AnimationMotionDefinition } from '../types';

const rig = new AnimationRig({ bones: [{ name: 'root' }] });
const curveLayout = new AnimationCurveLayout();

const makeClip = (id: string, duration: number): AnimationClip =>
    new AnimationClip({ id, duration, tracks: [] }, rig, curveLayout);

const clips = new Map<string, AnimationClip>([
    ['idle', makeClip('idle', 2)],
    ['walk', makeClip('walk', 1)],
    ['run', makeClip('run', 0.5)],
]);

const parameters = new AnimationParameterStore([
    { name: 'ox', kind: 'float', defaultValue: -0.5 },
    { name: 'oy', kind: 'float', defaultValue: 0 },
    { name: 'ix', kind: 'float', defaultValue: 0 },
    { name: 'iy', kind: 'float', defaultValue: 0 },
]);

const inner: AnimationMotionDefinition = {
    kind: 'blend2d',
    parameterX: 'ix',
    parameterY: 'iy',
    children: [
        { position: [-1, 0], motion: { kind: 'clip', clipId: 'walk' } },
        { position: [1, 0], motion: { kind: 'clip', clipId: 'run' } },
    ],
};

describe('nested blend duration', () => {
    it('keeps the parent weights when a child is itself a Blend2D', () => {
        const outer: AnimationMotionDefinition = {
            kind: 'blend2d',
            parameterX: 'ox',
            parameterY: 'oy',
            children: [
                { position: [-1, 0], motion: { kind: 'clip', clipId: 'idle' } },
                { position: [1, 0], motion: inner },
            ],
        };

        const duration = resolveMotionDuration(compileMotion(outer, clips), parameters);

        // IDW at (-0.5, 0): idle weight 0.75, inner weight 0.25.
        // Inner IDW at (0, 0): walk 0.5, run 0.5 -> 0.75 s.
        expect(duration).toBeCloseTo((2 * 0.75) + (0.75 * 0.25), 5);
        expect(Number.isFinite(duration)).toBe(true);
    });
});
