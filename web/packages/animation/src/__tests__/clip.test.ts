import { describe, expect, it } from 'vitest';
import { AnimationClip, createAnimationClips } from '../clip';
import { AnimationCurveLayout, AnimationFrame } from '../pose';
import { AnimationRig } from '../rig';
import { AnimationValidationError } from '../errors';

const rig = new AnimationRig({
    bones: [
        { name: 'root' },
        { name: 'child', parent: 'root', translation: [1, 0, 0] },
    ],
});
const curveLayout = new AnimationCurveLayout([{ id: 'blend', componentCount: 1 }]);

const makeTranslationClip = (
    id: string,
    times: number[],
    values: number[],
    options: { duration?: number; interpolation?: string } = {}
): AnimationClip =>
    new AnimationClip(
        {
            id,
            ...(options.duration !== undefined ? { duration: options.duration } : {}),
            tracks: [
                {
                    target: 'root',
                    path: 'translation',
                    ...(options.interpolation ? { interpolation: options.interpolation as never } : {}),
                    times,
                    values,
                },
            ],
        },
        rig,
        curveLayout
    );

describe('AnimationClip constructor validation', () => {
    it('throws on empty id', () => {
        expect(
            () =>
                new AnimationClip(
                    { id: '', tracks: [] },
                    rig,
                    curveLayout
                )
        ).toThrow(AnimationValidationError);
    });

    it('throws on translation track with non-3 component count', () => {
        expect(
            () =>
                new AnimationClip(
                    {
                        id: 'bad',
                        tracks: [
                            {
                                target: 'root',
                                path: 'translation',
                                times: [0, 1],
                                values: [0, 0, 0, 0, 1, 0, 0, 0],
                                valueComponentCount: 4,
                                sampleStride: 4,
                            },
                        ],
                    },
                    rig,
                    curveLayout
                )
        ).toThrow(AnimationValidationError);
    });

    it('throws on rotation track with non-4 component count', () => {
        expect(
            () =>
                new AnimationClip(
                    {
                        id: 'bad',
                        tracks: [
                            {
                                target: 'root',
                                path: 'rotation',
                                times: [0, 1],
                                values: [0, 0, 0, 1, 0, 0, 0],
                                valueComponentCount: 3,
                                sampleStride: 3,
                            },
                        ],
                    },
                    rig,
                    curveLayout
                )
        ).toThrow(AnimationValidationError);
    });

    it('throws on inconsistent values length', () => {
        expect(
            () =>
                new AnimationClip(
                    {
                        id: 'bad',
                        tracks: [
                            {
                                target: 'root',
                                path: 'translation',
                                times: [0, 1],
                                values: [0, 0, 0],
                            },
                        ],
                    },
                    rig,
                    curveLayout
                )
        ).toThrow(AnimationValidationError);
    });

    it('throws on unknown bone target', () => {
        expect(
            () =>
                new AnimationClip(
                    {
                        id: 'bad',
                        tracks: [
                            {
                                target: 'nonexistent',
                                path: 'translation',
                                times: [0, 1],
                                values: [0, 0, 0, 1, 0, 0],
                            },
                        ],
                    },
                    rig,
                    curveLayout
                )
        ).toThrow(AnimationValidationError);
    });
});

describe('AnimationClip duration inference', () => {
    it('uses explicit duration when provided', () => {
        const clip = new AnimationClip(
            {
                id: 'test',
                duration: 5,
                tracks: [
                    {
                        target: 'root',
                        path: 'translation',
                        times: [0, 1],
                        values: [0, 0, 0, 1, 0, 0],
                    },
                ],
            },
            rig,
            curveLayout
        );
        expect(clip.duration).toBe(5);
    });

    it('infers duration from max track time', () => {
        const clip = makeTranslationClip('test', [0, 0.5, 2], [0, 0, 0, 1, 0, 0, 2, 0, 0]);
        expect(clip.duration).toBe(2);
    });
});

describe('AnimationClip LINEAR interpolation', () => {
    it('samples translation at midpoint', () => {
        const clip = makeTranslationClip('linear', [0, 1], [0, 0, 0, 10, 0, 0]);
        const frame = new AnimationFrame(rig, curveLayout);
        clip.sampleTime(0.5, frame);
        expect(frame.pose.translations[0]).toBeCloseTo(5, 5);
        expect(frame.pose.translations[1]).toBeCloseTo(0, 5);
    });

    it('samples translation at start', () => {
        const clip = makeTranslationClip('linear', [0, 1], [0, 0, 0, 10, 0, 0]);
        const frame = new AnimationFrame(rig, curveLayout);
        clip.sampleTime(0, frame);
        expect(frame.pose.translations[0]).toBeCloseTo(0, 5);
    });

    it('samples translation at end', () => {
        const clip = makeTranslationClip('linear', [0, 1], [0, 0, 0, 10, 0, 0]);
        const frame = new AnimationFrame(rig, curveLayout);
        clip.sampleTime(1, frame);
        expect(frame.pose.translations[0]).toBeCloseTo(10, 5);
    });
});

describe('AnimationClip STEP interpolation', () => {
    it('holds previous keyframe value', () => {
        const clip = makeTranslationClip('step', [0, 0.5, 1], [0, 0, 0, 5, 0, 0, 10, 0, 0], {
            interpolation: 'STEP',
        });
        const frame = new AnimationFrame(rig, curveLayout);
        clip.sampleTime(0.25, frame);
        expect(frame.pose.translations[0]).toBeCloseTo(0, 5);
        clip.sampleTime(0.75, frame);
        expect(frame.pose.translations[0]).toBeCloseTo(5, 5);
    });
});

describe('AnimationClip scale track', () => {
    it('interpolates scale values', () => {
        const clip = new AnimationClip(
            {
                id: 'scale-test',
                tracks: [
                    {
                        target: 'root',
                        path: 'scale',
                        times: [0, 1],
                        values: [1, 1, 1, 2, 2, 2],
                    },
                ],
            },
            rig,
            curveLayout
        );
        const frame = new AnimationFrame(rig, curveLayout);
        clip.sampleTime(0.5, frame);
        expect(frame.pose.scales[0]).toBeCloseTo(1.5, 5);
        expect(frame.pose.scales[1]).toBeCloseTo(1.5, 5);
    });
});

describe('AnimationClip event sanitization', () => {
    it('filters events with empty name', () => {
        const clip = new AnimationClip(
            {
                id: 'events',
                duration: 1,
                tracks: [],
                events: [
                    { name: 'valid', time: 0.5 },
                    { name: '', time: 0.3 },
                ],
            },
            rig,
            curveLayout
        );
        expect(clip.events).toHaveLength(1);
        expect(clip.events[0]!.name).toBe('valid');
    });

    it('filters events with non-finite time', () => {
        const clip = new AnimationClip(
            {
                id: 'events',
                duration: 1,
                tracks: [],
                events: [
                    { name: 'valid', time: 0.5 },
                    { name: 'nan', time: NaN },
                ],
            },
            rig,
            curveLayout
        );
        expect(clip.events).toHaveLength(1);
    });

    it('sorts events by time', () => {
        const clip = new AnimationClip(
            {
                id: 'events',
                duration: 2,
                tracks: [],
                events: [
                    { name: 'second', time: 1.5 },
                    { name: 'first', time: 0.5 },
                ],
            },
            rig,
            curveLayout
        );
        expect(clip.events[0]!.name).toBe('first');
        expect(clip.events[1]!.name).toBe('second');
    });
});

describe('AnimationClip foot contact sanitization', () => {
    it('filters invalid contacts', () => {
        const clip = new AnimationClip(
            {
                id: 'contacts',
                duration: 1,
                tracks: [],
                footContacts: [
                    { bone: 'foot', startTime: 0.2, endTime: 0.8 },
                    { bone: '', startTime: 0, endTime: 0.5 },
                ],
            },
            rig,
            curveLayout
        );
        expect(clip.footContacts).toHaveLength(1);
        expect(clip.footContacts[0]!.bone).toBe('foot');
    });
});

describe('AnimationClip sampleFootContacts', () => {
    it('returns active state within time range', () => {
        const clip = new AnimationClip(
            {
                id: 'contacts',
                duration: 1,
                tracks: [],
                footContacts: [{ bone: 'foot', startTime: 0.2, endTime: 0.8 }],
            },
            rig,
            curveLayout
        );
        const contacts = clip.sampleFootContacts(0.5);
        expect(contacts).toHaveLength(1);
        expect(contacts[0]!.active).toBe(true);
        expect(contacts[0]!.weight).toBeGreaterThan(0);
    });

    it('returns inactive state outside time range', () => {
        const clip = new AnimationClip(
            {
                id: 'contacts',
                duration: 1,
                tracks: [],
                footContacts: [{ bone: 'foot', startTime: 0.2, endTime: 0.8 }],
            },
            rig,
            curveLayout
        );
        const contacts = clip.sampleFootContacts(0.1);
        expect(contacts[0]!.active).toBe(false);
        expect(contacts[0]!.weight).toBe(0);
    });

    it('returns empty for clips without contacts', () => {
        const clip = new AnimationClip({ id: 'empty', duration: 1, tracks: [] }, rig, curveLayout);
        expect(clip.sampleFootContacts(0.5)).toHaveLength(0);
    });
});

describe('AnimationClip collectEvents', () => {
    it('collects events in time range', () => {
        const clip = new AnimationClip(
            {
                id: 'events',
                duration: 2,
                tracks: [],
                events: [
                    { name: 'a', time: 0.5 },
                    { name: 'b', time: 1.5 },
                ],
            },
            rig,
            curveLayout
        );
        const events = clip.collectEvents(0, 1, false);
        expect(events).toHaveLength(1);
        expect(events[0]!.name).toBe('a');
    });

    it('returns empty for empty events', () => {
        const clip = new AnimationClip({ id: 'noEvents', duration: 1, tracks: [] }, rig, curveLayout);
        expect(clip.collectEvents(0, 1, false)).toHaveLength(0);
    });

    it('handles loop wrap-around', () => {
        const clip = new AnimationClip(
            {
                id: 'loopEvents',
                duration: 1,
                tracks: [],
                events: [
                    { name: 'early', time: 0.1 },
                    { name: 'late', time: 0.9 },
                ],
            },
            rig,
            curveLayout
        );
        const events = clip.collectEvents(0.8, 0.2, true);
        expect(events).toHaveLength(2);
    });
});

describe('AnimationClip tag sanitization', () => {
    it('deduplicates tags', () => {
        const clip = new AnimationClip(
            {
                id: 'tags',
                duration: 1,
                tracks: [],
                tags: ['walk', 'walk', 'run'],
            },
            rig,
            curveLayout
        );
        expect(clip.tags).toEqual(['walk', 'run']);
    });

    it('filters empty strings', () => {
        const clip = new AnimationClip(
            {
                id: 'tags',
                duration: 1,
                tracks: [],
                tags: ['walk', '', 'run'],
            },
            rig,
            curveLayout
        );
        expect(clip.tags).toEqual(['walk', 'run']);
    });
});

describe('AnimationClip track validation', () => {
    it('rejects non-finite or descending key times', () => {
        expect(() => makeTranslationClip('nan', [0, Number.NaN, 2], new Array(9).fill(0))).toThrow(
            AnimationValidationError
        );
        expect(() => makeTranslationClip('descending', [0, 2, 1], new Array(9).fill(0))).toThrow(
            /descending|ascending/i
        );
    });

    it('shows the final key of a STEP track at and after its time', () => {
        const clip = makeTranslationClip('step-last', [0, 1], [0, 0, 0, 5, 0, 0], {
            interpolation: 'STEP',
        });
        const frame = new AnimationFrame(rig, curveLayout);
        clip.sampleTime(1, frame);
        expect(frame.pose.translations[0]).toBeCloseTo(5, 5);
        clip.sampleTime(1.5, frame);
        expect(frame.pose.translations[0]).toBeCloseTo(5, 5);
    });

    it('treats a zero-key track as inert', () => {
        const clip = new AnimationClip(
            {
                id: 'empty-track',
                duration: 1,
                tracks: [
                    { target: 'root', path: 'translation', times: [], values: [] },
                    {
                        target: 'child',
                        path: 'translation',
                        times: [0, 1],
                        values: [0, 0, 0, 4, 0, 0],
                    },
                ],
            },
            rig,
            curveLayout
        );
        const frame = new AnimationFrame(rig, curveLayout);
        clip.sampleTime(0.5, frame);
        expect(frame.pose.translations[0]).toBe(0);
        expect(frame.pose.translations[3]).toBeCloseTo(2, 5);
    });

    it('rejects duplicate bone tracks', () => {
        expect(
            () =>
                new AnimationClip(
                    {
                        id: 'duplicate-track',
                        duration: 1,
                        tracks: [
                            { target: 'root', path: 'translation', times: [0, 1], values: [0, 0, 0, 1, 0, 0] },
                            { target: 'root', path: 'translation', times: [0, 1], values: [0, 0, 0, 5, 0, 0] },
                        ],
                    },
                    rig,
                    curveLayout
                )
        ).toThrow(AnimationValidationError);
    });
});

describe('AnimationClip sampleBoneTransform', () => {
    it('returns correct transform for bone at time', () => {
        const clip = makeTranslationClip('bone', [0, 1], [0, 0, 0, 10, 0, 0]);
        const outTranslation = new Float32Array(3);
        const outRotation = new Float32Array(4);
        clip.sampleBoneTransform(rig.indexOfBone('root'), 0.5, rig, outTranslation, outRotation);
        expect(outTranslation[0]).toBeCloseTo(5, 5);
    });
});

describe('createAnimationClips', () => {
    it('creates multiple clips', () => {
        const clips = createAnimationClips(
            [
                {
                    id: 'a',
                    tracks: [{ target: 'root', path: 'translation', times: [0, 1], values: [0, 0, 0, 1, 0, 0] }],
                },
                {
                    id: 'b',
                    tracks: [{ target: 'root', path: 'translation', times: [0, 2], values: [0, 0, 0, 2, 0, 0] }],
                },
            ],
            rig,
            curveLayout
        );
        expect(clips.size).toBe(2);
        expect(clips.has('a')).toBe(true);
        expect(clips.has('b')).toBe(true);
    });

    it('throws on duplicate clip id', () => {
        expect(
            () =>
                createAnimationClips(
                    [
                        { id: 'dup', tracks: [] },
                        { id: 'dup', tracks: [] },
                    ],
                    rig,
                    curveLayout
                )
        ).toThrow(AnimationValidationError);
    });
});
