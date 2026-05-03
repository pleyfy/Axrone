import { AnimationValidationError } from './errors';
import { clamp, quatApplyToVec3, quatCopy, quatDot, quatIdentity, quatInvert, quatMultiply, quatNormalize, quatSlerp, vec3Add, vec3Copy, vec3Lerp, vec3Multiply } from './math';
import type { AnimationCurveBindingDefinition } from './types';
import type { AnimationRig } from './rig';

export interface AnimationCurveBinding {
    readonly id: string;
    readonly componentCount: number;
    readonly offset: number;
}

export class AnimationCurveLayout {
    readonly bindings: readonly AnimationCurveBinding[];
    readonly componentCount: number;

    private readonly _bindingById = new Map<string, AnimationCurveBinding>();

    constructor(definitions: readonly AnimationCurveBindingDefinition[] = []) {
        let offset = 0;
        const bindings: AnimationCurveBinding[] = [];
        for (let index = 0; index < definitions.length; index += 1) {
            const definition = definitions[index]!;
            if (!definition || typeof definition.id !== 'string' || definition.id.length === 0) {
                throw new AnimationValidationError('Animation curves require a non-empty id');
            }
            if (!Number.isInteger(definition.componentCount) || definition.componentCount <= 0) {
                throw new AnimationValidationError(
                    `Animation curve '${definition.id}' requires a positive componentCount`
                );
            }
            if (this._bindingById.has(definition.id)) {
                throw new AnimationValidationError(`Duplicate animation curve '${definition.id}'`);
            }
            const binding = Object.freeze({
                id: definition.id,
                componentCount: definition.componentCount,
                offset,
            });
            bindings.push(binding);
            this._bindingById.set(binding.id, binding);
            offset += binding.componentCount;
        }
        this.bindings = Object.freeze(bindings);
        this.componentCount = offset;
    }

    has(id: string): boolean {
        return this._bindingById.has(id);
    }

    get(id: string): AnimationCurveBinding | undefined {
        return this._bindingById.get(id);
    }
}

export class AnimationCurveStore {
    readonly values: Float32Array;

    constructor(
        readonly layout: AnimationCurveLayout,
        initialValues?: ArrayLike<number>
    ) {
        this.values = new Float32Array(layout.componentCount);
        if (initialValues) {
            this.values.set(Array.from(initialValues).slice(0, layout.componentCount));
        }
    }

    reset(defaultValues?: ArrayLike<number>): this {
        this.values.fill(0);
        if (defaultValues) {
            this.values.set(Array.from(defaultValues).slice(0, this.values.length));
        }
        return this;
    }

    copyFrom(other: AnimationCurveStore): this {
        if (other.values.length !== this.values.length) {
            throw new AnimationValidationError('Animation curve layouts are incompatible');
        }
        this.values.set(other.values);
        return this;
    }

    read(id: string): Float32Array | null {
        const binding = this.layout.get(id);
        if (!binding) {
            return null;
        }
        return this.values.subarray(binding.offset, binding.offset + binding.componentCount);
    }

    write(id: string, value: ArrayLike<number>): this {
        const binding = this.layout.get(id);
        if (!binding) {
            throw new AnimationValidationError(`Unknown animation curve '${id}'`);
        }
        for (let componentIndex = 0; componentIndex < binding.componentCount; componentIndex += 1) {
            this.values[binding.offset + componentIndex] = Number(value[componentIndex] ?? 0);
        }
        return this;
    }
}

export class AnimationPose {
    readonly translations: Float32Array;
    readonly rotations: Float32Array;
    readonly scales: Float32Array;

    constructor(readonly boneCount: number) {
        this.translations = new Float32Array(boneCount * 3);
        this.rotations = new Float32Array(boneCount * 4);
        this.scales = new Float32Array(boneCount * 3);
    }

    copyFrom(other: AnimationPose): this {
        if (other.boneCount !== this.boneCount) {
            throw new AnimationValidationError('Animation poses have different bone counts');
        }
        this.translations.set(other.translations);
        this.rotations.set(other.rotations);
        this.scales.set(other.scales);
        return this;
    }

    reset(rig: AnimationRig): this {
        this.translations.set(rig.restTranslations);
        this.rotations.set(rig.restRotations);
        this.scales.set(rig.restScales);
        return this;
    }
}

export class AnimationFrame {
    readonly pose: AnimationPose;
    readonly curves: AnimationCurveStore;

    constructor(rig: AnimationRig, curveLayout: AnimationCurveLayout) {
        this.pose = new AnimationPose(rig.boneCount).reset(rig);
        this.curves = new AnimationCurveStore(curveLayout);
    }

    reset(rig: AnimationRig, curveDefaults?: ArrayLike<number>): this {
        this.pose.reset(rig);
        this.curves.reset(curveDefaults);
        return this;
    }

    copyFrom(other: AnimationFrame): this {
        this.pose.copyFrom(other.pose);
        this.curves.copyFrom(other.curves);
        return this;
    }
}

export class AnimationMask {
    private readonly _bits: Uint32Array;

    constructor(readonly boneCount: number, fill: boolean = false) {
        this._bits = new Uint32Array(Math.max(1, Math.ceil(boneCount / 32)));
        if (fill) {
            this.fill(true);
        }
    }

    has(index: number): boolean {
        const bucket = index >> 5;
        const bit = index & 31;
        return (this._bits[bucket] & (1 << bit)) !== 0;
    }

    set(index: number, enabled: boolean): this {
        const bucket = index >> 5;
        const bit = index & 31;
        if (enabled) {
            this._bits[bucket] |= 1 << bit;
        } else {
            this._bits[bucket] &= ~(1 << bit);
        }
        return this;
    }

    fill(enabled: boolean): this {
        this._bits.fill(enabled ? 0xffffffff : 0);
        return this;
    }
}

export class AnimationWorldPose {
    readonly translations: Float32Array;
    readonly rotations: Float32Array;
    readonly scales: Float32Array;

    private readonly _scratchVector = new Float32Array(3);

    constructor(readonly boneCount: number) {
        this.translations = new Float32Array(boneCount * 3);
        this.rotations = new Float32Array(boneCount * 4);
        this.scales = new Float32Array(boneCount * 3);
    }

    update(rig: AnimationRig, pose: AnimationPose): this {
        for (let orderIndex = 0; orderIndex < rig.evaluationOrder.length; orderIndex += 1) {
            const boneIndex = rig.evaluationOrder[orderIndex]!;
            const localTranslationOffset = boneIndex * 3;
            const localRotationOffset = boneIndex * 4;
            const parentIndex = rig.parentIndices[boneIndex]!;
            if (parentIndex < 0) {
                this.translations.set(
                    pose.translations.subarray(localTranslationOffset, localTranslationOffset + 3),
                    localTranslationOffset
                );
                this.rotations.set(
                    pose.rotations.subarray(localRotationOffset, localRotationOffset + 4),
                    localRotationOffset
                );
                this.scales.set(
                    pose.scales.subarray(localTranslationOffset, localTranslationOffset + 3),
                    localTranslationOffset
                );
                continue;
            }

            const parentTranslationOffset = parentIndex * 3;
            const parentRotationOffset = parentIndex * 4;
            vec3Multiply(
                this._scratchVector,
                0,
                pose.translations,
                localTranslationOffset,
                this.scales,
                parentTranslationOffset
            );
            quatApplyToVec3(
                this._scratchVector,
                0,
                this.rotations,
                parentRotationOffset,
                this._scratchVector,
                0
            );
            vec3Add(
                this.translations,
                localTranslationOffset,
                this.translations,
                parentTranslationOffset,
                this._scratchVector,
                0
            );
            quatMultiply(
                this.rotations,
                localRotationOffset,
                this.rotations,
                parentRotationOffset,
                pose.rotations,
                localRotationOffset
            );
            quatNormalize(this.rotations, localRotationOffset, this.rotations, localRotationOffset);
            vec3Multiply(
                this.scales,
                localTranslationOffset,
                this.scales,
                parentTranslationOffset,
                pose.scales,
                localTranslationOffset
            );
        }

        return this;
    }
}

export const blendFrame = (
    target: AnimationFrame,
    base: AnimationFrame,
    overlay: AnimationFrame,
    weight: number,
    mask?: AnimationMask
): AnimationFrame => {
    const alpha = clamp(weight, 0, 1);
    if (alpha <= 0) {
        return target.copyFrom(base);
    }
    if (alpha >= 1 && !mask) {
        return target.copyFrom(overlay);
    }

    target.copyFrom(base);
    for (let boneIndex = 0; boneIndex < target.pose.boneCount; boneIndex += 1) {
        if (mask && !mask.has(boneIndex)) {
            continue;
        }
        const translationOffset = boneIndex * 3;
        const rotationOffset = boneIndex * 4;
        vec3Lerp(
            target.pose.translations,
            translationOffset,
            base.pose.translations,
            translationOffset,
            overlay.pose.translations,
            translationOffset,
            alpha
        );
        quatSlerp(
            target.pose.rotations,
            rotationOffset,
            base.pose.rotations,
            rotationOffset,
            overlay.pose.rotations,
            rotationOffset,
            alpha
        );
        vec3Lerp(
            target.pose.scales,
            translationOffset,
            base.pose.scales,
            translationOffset,
            overlay.pose.scales,
            translationOffset,
            alpha
        );
    }
    for (let index = 0; index < target.curves.values.length; index += 1) {
        target.curves.values[index] =
            base.curves.values[index]! +
            (overlay.curves.values[index]! - base.curves.values[index]!) * alpha;
    }
    return target;
};

export const blendWeightedFrames = (
    target: AnimationFrame,
    frames: readonly AnimationFrame[],
    weights: readonly number[],
    restFrame: AnimationFrame,
    mask?: AnimationMask
): AnimationFrame => {
    target.copyFrom(restFrame);
    const boneCount = target.pose.boneCount;
    for (let boneIndex = 0; boneIndex < boneCount; boneIndex += 1) {
        if (mask && !mask.has(boneIndex)) {
            continue;
        }
        const translationOffset = boneIndex * 3;
        const rotationOffset = boneIndex * 4;
        let totalWeight = 0;
        let tx = 0;
        let ty = 0;
        let tz = 0;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let qx = 0;
        let qy = 0;
        let qz = 0;
        let qw = 0;
        let referenceIndex = -1;

        for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
            const frame = frames[frameIndex]!;
            const weight = Math.max(0, weights[frameIndex] ?? 0);
            if (weight <= 0) {
                continue;
            }
            totalWeight += weight;
            tx += frame.pose.translations[translationOffset]! * weight;
            ty += frame.pose.translations[translationOffset + 1]! * weight;
            tz += frame.pose.translations[translationOffset + 2]! * weight;
            sx += frame.pose.scales[translationOffset]! * weight;
            sy += frame.pose.scales[translationOffset + 1]! * weight;
            sz += frame.pose.scales[translationOffset + 2]! * weight;
            const sign =
                referenceIndex >= 0 &&
                quatDot(
                    frames[referenceIndex]!.pose.rotations,
                    rotationOffset,
                    frame.pose.rotations,
                    rotationOffset
                ) < 0
                    ? -1
                    : 1;
            qx += frame.pose.rotations[rotationOffset]! * weight * sign;
            qy += frame.pose.rotations[rotationOffset + 1]! * weight * sign;
            qz += frame.pose.rotations[rotationOffset + 2]! * weight * sign;
            qw += frame.pose.rotations[rotationOffset + 3]! * weight * sign;
            if (referenceIndex < 0) {
                referenceIndex = frameIndex;
            }
        }

        if (totalWeight <= 0) {
            continue;
        }

        const inverseWeight = 1 / totalWeight;
        target.pose.translations[translationOffset] = tx * inverseWeight;
        target.pose.translations[translationOffset + 1] = ty * inverseWeight;
        target.pose.translations[translationOffset + 2] = tz * inverseWeight;
        target.pose.scales[translationOffset] = sx * inverseWeight;
        target.pose.scales[translationOffset + 1] = sy * inverseWeight;
        target.pose.scales[translationOffset + 2] = sz * inverseWeight;
        target.pose.rotations[rotationOffset] = qx * inverseWeight;
        target.pose.rotations[rotationOffset + 1] = qy * inverseWeight;
        target.pose.rotations[rotationOffset + 2] = qz * inverseWeight;
        target.pose.rotations[rotationOffset + 3] = qw * inverseWeight;
        quatNormalize(target.pose.rotations, rotationOffset, target.pose.rotations, rotationOffset);
    }

    for (let curveIndex = 0; curveIndex < target.curves.values.length; curveIndex += 1) {
        let totalWeight = 0;
        let accumulated = 0;
        for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
            const weight = Math.max(0, weights[frameIndex] ?? 0);
            if (weight <= 0) {
                continue;
            }
            totalWeight += weight;
            accumulated += frames[frameIndex]!.curves.values[curveIndex]! * weight;
        }
        target.curves.values[curveIndex] = totalWeight > 0 ? accumulated / totalWeight : 0;
    }
    return target;
};

export const applyAdditiveFrame = (
    target: AnimationFrame,
    base: AnimationFrame,
    additive: AnimationFrame,
    restFrame: AnimationFrame,
    weight: number,
    mask?: AnimationMask
): AnimationFrame => {
    const alpha = clamp(weight, 0, 1);
    target.copyFrom(base);
    if (alpha <= 0) {
        return target;
    }
    const inverseRest = new Float32Array(4);
    const deltaRotation = new Float32Array(4);
    const scaledRotation = new Float32Array(4);

    for (let boneIndex = 0; boneIndex < target.pose.boneCount; boneIndex += 1) {
        if (mask && !mask.has(boneIndex)) {
            continue;
        }
        const translationOffset = boneIndex * 3;
        const rotationOffset = boneIndex * 4;
        target.pose.translations[translationOffset] +=
            (additive.pose.translations[translationOffset]! - restFrame.pose.translations[translationOffset]!) * alpha;
        target.pose.translations[translationOffset + 1] +=
            (additive.pose.translations[translationOffset + 1]! -
                restFrame.pose.translations[translationOffset + 1]!) *
            alpha;
        target.pose.translations[translationOffset + 2] +=
            (additive.pose.translations[translationOffset + 2]! -
                restFrame.pose.translations[translationOffset + 2]!) *
            alpha;
        target.pose.scales[translationOffset] +=
            (additive.pose.scales[translationOffset]! - restFrame.pose.scales[translationOffset]!) * alpha;
        target.pose.scales[translationOffset + 1] +=
            (additive.pose.scales[translationOffset + 1]! - restFrame.pose.scales[translationOffset + 1]!) * alpha;
        target.pose.scales[translationOffset + 2] +=
            (additive.pose.scales[translationOffset + 2]! - restFrame.pose.scales[translationOffset + 2]!) * alpha;
        quatIdentity(scaledRotation, 0);
        quatInvert(inverseRest, 0, restFrame.pose.rotations, rotationOffset);
        quatMultiply(deltaRotation, 0, inverseRest, 0, additive.pose.rotations, rotationOffset);
        quatSlerp(scaledRotation, 0, scaledRotation, 0, deltaRotation, 0, alpha);
        quatMultiply(
            target.pose.rotations,
            rotationOffset,
            base.pose.rotations,
            rotationOffset,
            scaledRotation,
            0
        );
        quatNormalize(target.pose.rotations, rotationOffset, target.pose.rotations, rotationOffset);
    }

    for (let curveIndex = 0; curveIndex < target.curves.values.length; curveIndex += 1) {
        target.curves.values[curveIndex] +=
            (additive.curves.values[curveIndex]! - restFrame.curves.values[curveIndex]!) * alpha;
    }
    return target;
};