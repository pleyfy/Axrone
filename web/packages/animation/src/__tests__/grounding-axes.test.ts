import { describe, expect, it } from 'vitest';
import { AnimationClip } from '../clip';
import { solveGrounding } from '../grounding';
import { AnimationCurveLayout } from '../pose';
import { AnimationRig } from '../rig';

const rig = new AnimationRig({ bones: [{ name: 'root' }] });
const curveLayout = new AnimationCurveLayout();

const makeClip = (
    lockTranslationAxes?: readonly [boolean, boolean, boolean],
    startTime = 0,
    endTime = 1
): AnimationClip =>
    new AnimationClip(
        {
            id: 'walk',
            duration: 1,
            tracks: [],
            footContacts: [
                {
                    bone: 'foot',
                    startTime,
                    endTime,
                    ...(lockTranslationAxes ? { lockTranslationAxes } : {}),
                },
            ],
        },
        rig,
        curveLayout
    );

describe('axis-locked grounding', () => {
    it('corrects only the axes the contact leaves unlocked', () => {
        const clip = makeClip([false, true, false]);

        const result = solveGrounding(
            clip,
            0.5,
            { foot: [1, 2, 3] },
            [0, 0, 0],
            'all'
        );

        expect(result.rootOffset[0]).toBeCloseTo(-1, 5);
        expect(result.rootOffset[1]).toBeCloseTo(0, 5);
        expect(result.rootOffset[2]).toBeCloseTo(-3, 5);
    });

    it('keeps every axis when the solve mask excludes them', () => {
        const clip = makeClip();

        const result = solveGrounding(clip, 0.5, { foot: [1, 2, 3] }, [0, 0, 0], 'vertical');

        expect(result.rootOffset[0]).toBe(0);
        expect(result.rootOffset[1]).toBeCloseTo(-2, 5);
        expect(result.rootOffset[2]).toBe(0);
    });

    it('returns a zero offset when no contact is active', () => {
        const clip = new AnimationClip(
            { id: 'no-contact', duration: 1, tracks: [], footContacts: [] },
            rig,
            curveLayout
        );

        const result = solveGrounding(clip, 1, { foot: [1, 2, 3] }, [0, 0, 0], 'all');

        expect(result.rootOffset).toEqual([0, 0, 0]);
        expect(result.contacts).toHaveLength(0);
    });
});
