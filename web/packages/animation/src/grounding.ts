import { AnimationClip } from './clip';
import { tuple3 } from '@axrone/utility';
import type { AnimationGroundingContactResult, AnimationGroundingResult } from './types';

const resolveBoneHeight = (
    heights: Readonly<Record<string, number>> | ReadonlyMap<string, number>,
    bone: string
): number => {
    if (heights instanceof Map) {
        return heights.get(bone) ?? 0;
    }

    const value = (heights as Readonly<Record<string, number>>)[bone];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

export const solvePlanarGrounding = (
    clip: AnimationClip,
    timeSeconds: number,
    boneHeights: Readonly<Record<string, number>> | ReadonlyMap<string, number>,
    groundHeight: number = 0
): AnimationGroundingResult => {
    const contacts = clip.sampleFootContacts(timeSeconds)
        .filter((contact) => contact.active && contact.weight > 0)
        .map((contact) => {
            const groundOffset = groundHeight - resolveBoneHeight(boneHeights, contact.bone);
            return Object.freeze({
                bone: contact.bone,
                weight: contact.weight,
                groundOffset,
                ...(contact.lockTranslationAxes
                    ? { lockTranslationAxes: contact.lockTranslationAxes }
                    : {}),
            } satisfies AnimationGroundingContactResult);
        });

    if (contacts.length === 0) {
        return Object.freeze({
            rootOffset: tuple3(0, 0, 0),
            contacts: Object.freeze([]),
        });
    }

    let totalWeight = 0;
    let accumulatedOffset = 0;
    for (let index = 0; index < contacts.length; index += 1) {
        const contact = contacts[index]!;
        totalWeight += contact.weight;
        accumulatedOffset += contact.groundOffset * contact.weight;
    }

    const rootYOffset = totalWeight > 0 ? accumulatedOffset / totalWeight : 0;
    return Object.freeze({
        rootOffset: tuple3(0, rootYOffset, 0),
        contacts: Object.freeze(contacts),
    });
};

/**
 * Axes a grounding solve may write. The per-contact `lockTranslationAxes` of the
 * authored clip is the inner rule; this mask is the outer bound.
 */
export type AnimationGroundingAxes = 'none' | 'x' | 'y' | 'z' | 'vertical' | 'all';

const AXIS_MASK: Record<AnimationGroundingAxes, readonly [boolean, boolean, boolean]> = {
    none: [false, false, false],
    x: [true, false, false],
    y: [false, true, false],
    z: [false, false, true],
    vertical: [false, true, false],
    all: [true, true, true],
};

const resolveBonePosition = (
    positions: Readonly<Record<string, readonly [number, number, number]>> | ReadonlyMap<
        string,
        readonly [number, number, number]
    >,
    bone: string
): readonly [number, number, number] | undefined => {
    if (positions instanceof Map) {
        return positions.get(bone);
    }
    const value = (positions as Readonly<Record<string, readonly [number, number, number]>>)[bone];
    return Array.isArray(value) ? value : undefined;
};

/**
 * Solves a contact-weighted root offset on the axes the author left unlocked.
 * A contact may lock individual axes; the solve mask removes axes entirely.
 */
export const solveGrounding = (
    clip: AnimationClip,
    timeSeconds: number,
    bonePositions:
        | Readonly<Record<string, readonly [number, number, number]>>
        | ReadonlyMap<string, readonly [number, number, number]>,
    targetGround: readonly [number, number, number] = [0, 0, 0],
    axes: AnimationGroundingAxes = 'all'
): AnimationGroundingResult => {
    const mask = AXIS_MASK[axes];
    const sampled = clip.sampleFootContacts(timeSeconds).filter(
        (contact) => contact.active && contact.weight > 0
    );

    let totalWeight = 0;
    let accumulatedX = 0;
    let accumulatedY = 0;
    let accumulatedZ = 0;
    const contacts: AnimationGroundingContactResult[] = [];

    for (let index = 0; index < sampled.length; index += 1) {
        const contact = sampled[index]!;
        const position = resolveBonePosition(bonePositions, contact.bone);
        if (!position) {
            continue;
        }

        const locks = contact.lockTranslationAxes ?? [false, false, false];
        const deltaX = mask[0] && !locks[0] ? targetGround[0] - position[0] : 0;
        const deltaY = mask[1] && !locks[1] ? targetGround[1] - position[1] : 0;
        const deltaZ = mask[2] && !locks[2] ? targetGround[2] - position[2] : 0;

        totalWeight += contact.weight;
        accumulatedX += deltaX * contact.weight;
        accumulatedY += deltaY * contact.weight;
        accumulatedZ += deltaZ * contact.weight;

        contacts.push(
            Object.freeze({
                bone: contact.bone,
                weight: contact.weight,
                groundOffset: deltaY,
                ...(contact.lockTranslationAxes
                    ? { lockTranslationAxes: contact.lockTranslationAxes }
                    : {}),
            })
        );
    }

    if (totalWeight <= 0) {
        return Object.freeze({
            rootOffset: tuple3(0, 0, 0),
            contacts: Object.freeze([]),
        });
    }

    const inverse = 1 / totalWeight;
    return Object.freeze({
        rootOffset: tuple3(accumulatedX * inverse, accumulatedY * inverse, accumulatedZ * inverse),
        contacts: Object.freeze(contacts),
    });
};