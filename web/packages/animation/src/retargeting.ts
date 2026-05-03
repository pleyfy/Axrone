import { AnimationRetargetingError, AnimationValidationError } from './errors';
import { quatCopy, quatInvert, quatMultiply, quatNormalize, vec3Copy } from './math';
import { AnimationFrame, type AnimationCurveLayout } from './pose';
import { AnimationRig } from './rig';
import type {
    AnimationRetargetBoneMappingDefinition,
    AnimationRetargetProfileDefinition,
    AnimationRetargetRotationMode,
    AnimationRetargetTranslationMode,
} from './types';

interface AnimationCompiledRetargetMapping {
    readonly sourceIndex: number;
    readonly targetIndex: number;
    readonly translationMode: AnimationRetargetTranslationMode;
    readonly rotationMode: AnimationRetargetRotationMode;
    readonly translationScale: number;
    readonly rotationOffset: Float32Array;
}

const createAutomaticMappings = (
    sourceRig: AnimationRig,
    targetRig: AnimationRig
): readonly AnimationRetargetBoneMappingDefinition[] =>
    Object.freeze(
        sourceRig.boneNames
            .filter((name) => targetRig.hasBone(name))
            .map((name) => Object.freeze({ sourceBone: name, targetBone: name }))
    );

export class AnimationRetargeter {
    readonly sourceRig: AnimationRig;
    readonly targetRig: AnimationRig;
    readonly mappings: readonly AnimationCompiledRetargetMapping[];
    private readonly _scratchInverse = new Float32Array(4);

    constructor(definition: AnimationRetargetProfileDefinition) {
        this.sourceRig = new AnimationRig(definition.sourceRig);
        this.targetRig = new AnimationRig(definition.targetRig);
        const mappings = definition.mappings ?? createAutomaticMappings(this.sourceRig, this.targetRig);
        if (mappings.length === 0) {
            throw new AnimationValidationError('Animation retargeting requires at least one mapping');
        }
        this.mappings = Object.freeze(
            mappings.map((mapping) => {
                const sourceIndex = this.sourceRig.indexOfBone(mapping.sourceBone);
                const targetIndex = this.targetRig.indexOfBone(mapping.targetBone);
                const sourceRotationOffset = sourceIndex * 4;
                const targetRotationOffset = targetIndex * 4;
                const inverse = new Float32Array(4);
                const rotationOffset = new Float32Array(4);
                quatInvert(inverse, 0, this.sourceRig.restRotations, sourceRotationOffset);
                quatMultiply(
                    rotationOffset,
                    0,
                    this.targetRig.restRotations,
                    targetRotationOffset,
                    inverse,
                    0
                );
                quatNormalize(rotationOffset, 0, rotationOffset, 0);
                return Object.freeze({
                    sourceIndex,
                    targetIndex,
                    translationMode: mapping.translationMode ?? 'scaled',
                    rotationMode: mapping.rotationMode ?? 'offset',
                    translationScale:
                        typeof mapping.scaleTranslation === 'number' && Number.isFinite(mapping.scaleTranslation)
                            ? mapping.scaleTranslation
                            : 1,
                    rotationOffset,
                });
            })
        );
    }

    retargetPose(sourceFrame: AnimationFrame, out?: AnimationFrame): AnimationFrame {
        const targetFrame = out ?? new AnimationFrame(this.targetRig, sourceFrame.curves.layout as AnimationCurveLayout);
        targetFrame.reset(this.targetRig, sourceFrame.curves.values);
        targetFrame.curves.copyFrom(sourceFrame.curves);
        for (let index = 0; index < this.mappings.length; index += 1) {
            const mapping = this.mappings[index]!;
            const sourceTranslationOffset = mapping.sourceIndex * 3;
            const sourceRotationOffset = mapping.sourceIndex * 4;
            const targetTranslationOffset = mapping.targetIndex * 3;
            const targetRotationOffset = mapping.targetIndex * 4;
            switch (mapping.translationMode) {
                case 'none':
                    vec3Copy(
                        targetFrame.pose.translations,
                        targetTranslationOffset,
                        this.targetRig.restTranslations,
                        targetTranslationOffset
                    );
                    break;
                case 'absolute':
                    vec3Copy(
                        targetFrame.pose.translations,
                        targetTranslationOffset,
                        sourceFrame.pose.translations,
                        sourceTranslationOffset
                    );
                    break;
                case 'scaled':
                default:
                    targetFrame.pose.translations[targetTranslationOffset] =
                        sourceFrame.pose.translations[sourceTranslationOffset]! * mapping.translationScale;
                    targetFrame.pose.translations[targetTranslationOffset + 1] =
                        sourceFrame.pose.translations[sourceTranslationOffset + 1]! * mapping.translationScale;
                    targetFrame.pose.translations[targetTranslationOffset + 2] =
                        sourceFrame.pose.translations[sourceTranslationOffset + 2]! * mapping.translationScale;
                    break;
            }

            switch (mapping.rotationMode) {
                case 'copy':
                    quatCopy(
                        targetFrame.pose.rotations,
                        targetRotationOffset,
                        sourceFrame.pose.rotations,
                        sourceRotationOffset
                    );
                    break;
                case 'offset':
                default:
                    quatMultiply(
                        targetFrame.pose.rotations,
                        targetRotationOffset,
                        mapping.rotationOffset,
                        0,
                        sourceFrame.pose.rotations,
                        sourceRotationOffset
                    );
                    quatNormalize(
                        targetFrame.pose.rotations,
                        targetRotationOffset,
                        targetFrame.pose.rotations,
                        targetRotationOffset
                    );
                    break;
            }

            targetFrame.pose.scales[targetTranslationOffset] =
                sourceFrame.pose.scales[sourceTranslationOffset]!;
            targetFrame.pose.scales[targetTranslationOffset + 1] =
                sourceFrame.pose.scales[sourceTranslationOffset + 1]!;
            targetFrame.pose.scales[targetTranslationOffset + 2] =
                sourceFrame.pose.scales[sourceTranslationOffset + 2]!;
        }
        return targetFrame;
    }

    retargetInto(sourceFrame: AnimationFrame, targetFrame: AnimationFrame): AnimationFrame {
        if (targetFrame.pose.boneCount !== this.targetRig.boneCount) {
            throw new AnimationRetargetingError('Target frame is not compatible with the retarget target rig');
        }
        return this.retargetPose(sourceFrame, targetFrame);
    }
}