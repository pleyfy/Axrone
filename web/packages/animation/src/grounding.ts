import { AnimationClip } from './clip';
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
            rootOffset: Object.freeze([0, 0, 0]) as readonly [number, number, number],
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
        rootOffset: Object.freeze([0, rootYOffset, 0]) as readonly [number, number, number],
        contacts: Object.freeze(contacts),
    });
};