import { describe, expect, it } from 'vitest';
import { compileMotion } from '../blend-tree';
import { computeBlend2DWeights } from '../blend-helpers';
import { AnimationClip } from '../clip';
import { AnimationCurveLayout } from '../pose';
import { AnimationRig } from '../rig';
import type { AnimationMotionDefinition } from '../types';

const rig = new AnimationRig({ bones: [{ name: 'root' }] });
const curveLayout = new AnimationCurveLayout();
const clips = new Map<string, AnimationClip>([
    ['idle', new AnimationClip({ id: 'idle', duration: 1, tracks: [] }, rig, curveLayout)],
    ['left', new AnimationClip({ id: 'left', duration: 1, tracks: [] }, rig, curveLayout)],
    ['right', new AnimationClip({ id: 'right', duration: 1, tracks: [] }, rig, curveLayout)],
]);

describe('freeform 2D blend weights', () => {
    it('gives an interior point non-adjacent zero weight', () => {
        const children = [
            { x: 0, y: 1 },
            { x: -1, y: -1 },
            { x: 1, y: -1 },
        ];
        const weights = [0, 0, 0];

        computeBlend2DWeights(0, -0.99, children, weights, Int32Array.from([0, 1, 2]));

        expect(weights[0]).toBeLessThan(0.01);
        expect(weights[0]! + weights[1]! + weights[2]!).toBeCloseTo(1, 5);
    });

    it('compiles triangles only for the freeform mode', () => {
        const definition: AnimationMotionDefinition = {
            kind: 'blend2d',
            parameterX: 'x',
            parameterY: 'y',
            mode: 'freeform',
            children: [
                { position: [0, 1], motion: { kind: 'clip', clipId: 'idle' } },
                { position: [-1, -1], motion: { kind: 'clip', clipId: 'left' } },
                { position: [1, -1], motion: { kind: 'clip', clipId: 'right' } },
            ],
        };

        const compiled = compileMotion(definition, clips);
        expect(compiled.kind).toBe('blend2d');
        if (compiled.kind !== 'blend2d') return;
        expect(compiled.mode).toBe('freeform');
        expect(compiled.triangles.length).toBe(3);
    });
});
