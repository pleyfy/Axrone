import { createAnimationClips, AnimationClip } from './clip';
import { AnimationScratchPool, type AnimationMotionEvaluationContext } from './blend-tree';
import { AnimationStateMachineError, AnimationValidationError } from './errors';
import { AnimationIkLayer } from './ik';
import { AnimationParameterStore } from './parameters';
import {
    AnimationCurveLayout,
    AnimationMask,
    AnimationFrame,
    applyAdditiveFrame,
    blendFrame,
} from './pose';
import { AnimationRig } from './rig';
import {
    commitLayerRuntime,
    collectLayerClipActivities,
    collectLayerEvents,
    compileStateMachine,
    createLayerRuntime,
    crossFadeLayerState,
    evaluateLayerRuntime,
    extractLayerRootDelta,
    forceLayerState,
    updateLayerRuntime,
    type AnimationCompiledStateMachine,
    type AnimationLayerRuntime,
} from './state-machine';
import { quatCopy } from './math';
import type {
    AnimationClipDefinition,
    AnimationControllerClipActivity,
    AnimationControllerEvent,
    AnimationControllerDefinition,
    AnimationControllerProfile,
    AnimationCurveBindingDefinition,
    AnimationLayerBlendMode,
    AnimationParameterDefinition,
    AnimationRootMotionDelta,
} from './types';

interface AnimationCompiledLayer {
    readonly id: string;
    readonly mode: AnimationLayerBlendMode;
    readonly machine: AnimationCompiledStateMachine;
    readonly mask: AnimationMask | null;
    readonly ikLayers: readonly AnimationIkLayer[];
}

export interface AnimationControllerUpdateResult {
    readonly frame: AnimationFrame;
    readonly rootMotion: AnimationRootMotionDelta;
    readonly events: readonly AnimationControllerEvent[];
    readonly activeClips: readonly AnimationControllerClipActivity[];
    readonly profile: AnimationControllerProfile;
}

const now = (): number =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();

const inferCurveBindings = (
    clips: readonly AnimationClipDefinition[]
): readonly AnimationCurveBindingDefinition[] => {
    const bindings = new Map<string, number>();
    for (let clipIndex = 0; clipIndex < clips.length; clipIndex += 1) {
        const clip = clips[clipIndex]!;
        for (let trackIndex = 0; trackIndex < clip.tracks.length; trackIndex += 1) {
            const track = clip.tracks[trackIndex]!;
            if (track.path !== 'weights') {
                continue;
            }
            const keyframeCount = track.keyframeCount ?? track.times.length;
            const sampleStride =
                track.sampleStride ??
                (keyframeCount > 0 ? track.values.length / keyframeCount : track.valueComponentCount ?? 0);
            const componentCount =
                track.valueComponentCount ??
                (track.interpolation === 'CUBICSPLINE' ? sampleStride / 3 : sampleStride);
            if (!Number.isInteger(componentCount) || componentCount <= 0) {
                throw new AnimationValidationError(
                    `Animation curve binding '${track.target}' has invalid component count`
                );
            }
            bindings.set(track.target, Math.max(bindings.get(track.target) ?? 0, componentCount));
        }
    }
    return Object.freeze(
        [...bindings.entries()].map(([id, componentCount]) =>
            Object.freeze({ id, componentCount })
        )
    );
};

export class AnimationController<
    TParameters extends readonly AnimationParameterDefinition[] = readonly AnimationParameterDefinition[],
> {
    readonly rig: AnimationRig;
    readonly parameters: AnimationParameterStore<TParameters>;
    readonly curveLayout: AnimationCurveLayout;
    readonly clips: ReadonlyMap<string, AnimationClip>;
    readonly currentFrame: AnimationFrame;

    private readonly _restFrame: AnimationFrame;
    private readonly _scratchPool: AnimationScratchPool;
    private readonly _layers: readonly AnimationCompiledLayer[];
    private readonly _layerRuntimes: AnimationLayerRuntime[];
    private readonly _layerWeights: Float32Array;
    private readonly _evaluationContext: AnimationMotionEvaluationContext;
    private readonly _rootMotionTranslation = new Float32Array(3);
    private readonly _rootMotionRotation = new Float32Array([0, 0, 0, 1]);
    private readonly _rootMotionConfig: NonNullable<AnimationControllerDefinition['rootMotion']> | null;
    private readonly _rootMotionBoneIndex: number;
    private _events: readonly AnimationControllerEvent[] = Object.freeze([]);
    private _activeClips: readonly AnimationControllerClipActivity[] = Object.freeze([]);
    private _profile: AnimationControllerProfile = Object.freeze({
        evaluationTimeMs: 0,
        sampledTrackCount: 0,
        activeClipCount: 0,
        emittedEventCount: 0,
        rootMotionTranslationMagnitude: 0,
        rootMotionRotationW: 1,
        activeLayers: Object.freeze([]),
    });

    constructor(definition: AnimationControllerDefinition<TParameters>) {
        this.rig = new AnimationRig(definition.rig);
        this.parameters = new AnimationParameterStore(definition.parameters ?? ([] as unknown as TParameters));
        this.curveLayout = new AnimationCurveLayout(inferCurveBindings(definition.clips));
        this.clips = createAnimationClips(definition.clips, this.rig, this.curveLayout);
        this._restFrame = new AnimationFrame(this.rig, this.curveLayout);
        this.currentFrame = new AnimationFrame(this.rig, this.curveLayout);
        this._scratchPool = new AnimationScratchPool(this.rig, this.curveLayout, this._restFrame.curves.values);
        this._evaluationContext = {
            rig: this.rig,
            parameters: this.parameters,
            restFrame: this._restFrame,
            scratch: this._scratchPool,
        };
        this._layers = Object.freeze(
            definition.layers.map((layer) => {
                const mask = layer.boneMask
                    ? layer.boneMask.reduce((accumulator, boneName) => {
                          accumulator.set(this.rig.indexOfBone(boneName), true);
                          return accumulator;
                      }, new AnimationMask(this.rig.boneCount, false))
                    : null;
                return Object.freeze({
                    id: String(layer.id),
                    mode: layer.mode ?? 'override',
                    machine: compileStateMachine(layer.stateMachine, this.clips),
                    mask,
                    ikLayers: Object.freeze(
                        (layer.ikLayers ?? []).map((ikLayer) => new AnimationIkLayer(this.rig, ikLayer))
                    ),
                } satisfies AnimationCompiledLayer);
            })
        );
        if (this._layers.length === 0) {
            throw new AnimationValidationError('Animation controllers require at least one layer');
        }
        this._layerRuntimes = this._layers.map((layer) => createLayerRuntime(layer.machine));
        this._layerWeights = new Float32Array(this._layers.length);
        for (let layerIndex = 0; layerIndex < this._layers.length; layerIndex += 1) {
            this._layerWeights[layerIndex] = definition.layers[layerIndex]?.weight ?? 1;
        }
        this._rootMotionConfig = definition.rootMotion ?? null;
        this._rootMotionBoneIndex =
            this._rootMotionConfig && typeof this._rootMotionConfig.bone === 'string'
                ? this.rig.indexOfBone(this._rootMotionConfig.bone)
                : -1;
        this.evaluate();
    }

    get rootMotion(): AnimationRootMotionDelta {
        return {
            translation: [
                this._rootMotionTranslation[0],
                this._rootMotionTranslation[1],
                this._rootMotionTranslation[2],
            ],
            rotation: [
                this._rootMotionRotation[0],
                this._rootMotionRotation[1],
                this._rootMotionRotation[2],
                this._rootMotionRotation[3],
            ],
        };
    }

    get events(): readonly AnimationControllerEvent[] {
        return this._events;
    }

    get activeClips(): readonly AnimationControllerClipActivity[] {
        return this._activeClips;
    }

    get profile(): AnimationControllerProfile {
        return this._profile;
    }

    update(deltaSeconds: number): AnimationControllerUpdateResult {
        const startTime = now();
        for (let layerIndex = 0; layerIndex < this._layers.length; layerIndex += 1) {
            updateLayerRuntime(
                this._layers[layerIndex]!.machine,
                this._layerRuntimes[layerIndex]!,
                this.parameters,
                Math.max(0, deltaSeconds)
            );
        }
        this._composeCurrentFrame(true);
        for (let layerIndex = 0; layerIndex < this._layers.length; layerIndex += 1) {
            commitLayerRuntime(this._layerRuntimes[layerIndex]!);
        }
        this._updateProfile(now() - startTime);
        return {
            frame: this.currentFrame,
            rootMotion: this.rootMotion,
            events: this.events,
            activeClips: this.activeClips,
            profile: this.profile,
        };
    }

    evaluate(): AnimationFrame {
        const startTime = now();
        this._composeCurrentFrame(false);
        this._updateProfile(now() - startTime);
        return this.currentFrame;
    }

    play(stateId: string, layerId: string | undefined = this._layers[0]!.id): this {
        const layerIndex = this._resolveLayerIndex(layerId);
        forceLayerState(this._layers[layerIndex]!.machine, this._layerRuntimes[layerIndex]!, stateId, 0);
        this.evaluate();
        return this;
    }

    crossFade(stateId: string, durationSeconds: number, layerId: string | undefined = this._layers[0]!.id): this {
        const layerIndex = this._resolveLayerIndex(layerId);
        crossFadeLayerState(
            this._layers[layerIndex]!.machine,
            this._layerRuntimes[layerIndex]!,
            stateId,
            durationSeconds,
            0
        );
        return this;
    }

    seek(timeSeconds: number, layerId: string | undefined = this._layers[0]!.id): this {
        const layerIndex = this._resolveLayerIndex(layerId);
        const runtime = this._layerRuntimes[layerIndex]!;
        const state = this._layers[layerIndex]!.machine.states[runtime.currentStateIndex]!;
        const duration = Math.max(1e-6, state.motion.kind === 'clip' ? state.motion.clip.duration : 1);
        runtime.currentNormalizedTime = Math.max(0, timeSeconds) / duration;
        runtime.previousNormalizedTime = runtime.currentNormalizedTime;
        this.evaluate();
        return this;
    }

    setLayerWeight(layerId: string, weight: number): this {
        this._layerWeights[this._resolveLayerIndex(layerId)] = weight;
        return this;
    }

    dispose(): void {
        this._rootMotionTranslation.fill(0);
        quatCopy(this._rootMotionRotation, 0, [0, 0, 0, 1], 0);
    }

    private _resolveLayerIndex(layerId: string | undefined): number {
        const resolvedId = layerId ?? this._layers[0]!.id;
        const layerIndex = this._layers.findIndex((layer) => layer.id === resolvedId);
        if (layerIndex < 0) {
            throw new AnimationStateMachineError(`Unknown animation layer '${resolvedId}'`);
        }
        return layerIndex;
    }

    private _composeCurrentFrame(updateRootMotion: boolean): void {
        this.currentFrame.reset(this.rig, this._restFrame.curves.values);
        this._rootMotionTranslation.fill(0);
        quatCopy(this._rootMotionRotation, 0, [0, 0, 0, 1], 0);
        const events: AnimationControllerEvent[] = [];
        const activeClips: AnimationControllerClipActivity[] = [];

        for (let layerIndex = 0; layerIndex < this._layers.length; layerIndex += 1) {
            const layer = this._layers[layerIndex]!;
            const runtime = this._layerRuntimes[layerIndex]!;
            const layerWeight = Math.max(0, Math.min(1, this._layerWeights[layerIndex]!));
            if (layerWeight <= 0) {
                continue;
            }

            this._scratchPool.reset();
            const layerFrame = this._scratchPool.acquire();
            evaluateLayerRuntime(layer.machine, runtime, this._evaluationContext, layerFrame);
            for (let ikIndex = 0; ikIndex < layer.ikLayers.length; ikIndex += 1) {
                layer.ikLayers[ikIndex]!.apply(layerFrame.pose);
            }

            if (layerIndex === 0) {
                if (layer.mode === 'additive') {
                    applyAdditiveFrame(
                        this.currentFrame,
                        this.currentFrame,
                        layerFrame,
                        this._restFrame,
                        layerWeight,
                        layer.mask ?? undefined
                    );
                } else {
                    blendFrame(
                        this.currentFrame,
                        this._restFrame,
                        layerFrame,
                        layerWeight,
                        layer.mask ?? undefined
                    );
                }
            } else if (layer.mode === 'additive') {
                applyAdditiveFrame(
                    this.currentFrame,
                    this.currentFrame,
                    layerFrame,
                    this._restFrame,
                    layerWeight,
                    layer.mask ?? undefined
                );
            } else {
                const baseFrame = this._scratchPool.acquire().copyFrom(this.currentFrame);
                blendFrame(
                    this.currentFrame,
                    baseFrame,
                    layerFrame,
                    layerWeight,
                    layer.mask ?? undefined
                );
            }

            if (updateRootMotion && layerIndex === 0 && this._rootMotionBoneIndex >= 0 && this._rootMotionConfig) {
                extractLayerRootDelta(
                    layer.machine,
                    runtime,
                    this._rootMotionBoneIndex,
                    this._evaluationContext,
                    this._rootMotionTranslation,
                    this._rootMotionRotation
                );
            }

            if (updateRootMotion) {
                collectLayerEvents(
                    layer.machine,
                    runtime,
                    this._evaluationContext,
                    layer.id,
                    layerWeight,
                    events
                );
            }

            collectLayerClipActivities(
                layer.machine,
                runtime,
                this._evaluationContext,
                layer.id,
                layerWeight,
                activeClips
            );
        }

        if (this._rootMotionConfig && this._rootMotionBoneIndex >= 0) {
            const translationOffset = this._rootMotionBoneIndex * 3;
            const rotationOffset = this._rootMotionBoneIndex * 4;
            const axes = this._rootMotionConfig.projectTranslationAxes ?? [true, true, true] as const;
            if (this._rootMotionConfig.consume !== false) {
                for (let axisIndex = 0; axisIndex < 3; axisIndex += 1) {
                    if (axes[axisIndex]) {
                        this.currentFrame.pose.translations[translationOffset + axisIndex] =
                            this.rig.restTranslations[translationOffset + axisIndex]!;
                    }
                }
                if (this._rootMotionConfig.extractRotation !== false) {
                    quatCopy(
                        this.currentFrame.pose.rotations,
                        rotationOffset,
                        this.rig.restRotations,
                        rotationOffset
                    );
                }
            }
            for (let axisIndex = 0; axisIndex < 3; axisIndex += 1) {
                if (!axes[axisIndex]) {
                    this._rootMotionTranslation[axisIndex] = 0;
                }
            }
            if (this._rootMotionConfig.extractRotation === false) {
                quatCopy(this._rootMotionRotation, 0, [0, 0, 0, 1], 0);
            }
        }

        this._events = updateRootMotion
            ? Object.freeze(
                  [...events].sort(
                      (left, right) =>
                          left.time - right.time ||
                          left.layerId.localeCompare(right.layerId) ||
                          left.stateId.localeCompare(right.stateId)
                  )
              )
            : Object.freeze([]);
        this._activeClips = Object.freeze(
            [...activeClips].sort(
                (left, right) =>
                    right.motionWeight - left.motionWeight ||
                    left.layerId.localeCompare(right.layerId) ||
                    left.stateId.localeCompare(right.stateId) ||
                    left.clipId.localeCompare(right.clipId)
            )
        );
    }

    private _countMotionTracks(motion: AnimationCompiledStateMachine['states'][number]['motion']): number {
        switch (motion.kind) {
            case 'clip':
                return (
                    motion.clip.translationTracks.length +
                    motion.clip.rotationTracks.length +
                    motion.clip.scaleTracks.length +
                    motion.clip.curveTracks.length
                );
            case 'blend1d':
            case 'blend2d':
            case 'direct':
                return motion.children.reduce(
                    (sum, child) => sum + this._countMotionTracks(child.motion),
                    0
                );
            case 'additive':
                return this._countMotionTracks(motion.base) + this._countMotionTracks(motion.additive);
            default:
                return 0;
        }
    }

    private _updateProfile(evaluationTimeMs: number): void {
        const activeLayers = this._layers.map((layer, index) => {
            const runtime = this._layerRuntimes[index]!;
            if (!runtime.transition) {
                const state = layer.machine.states[runtime.currentStateIndex]!;
                return Object.freeze({
                    layerId: layer.id,
                    stateId: state.id,
                    normalizedTime: runtime.currentNormalizedTime,
                    weight: this._layerWeights[index] ?? 1,
                    transitioning: false,
                });
            }

            const sourceState = layer.machine.states[runtime.transition.sourceStateIndex]!;
            const targetState = layer.machine.states[runtime.transition.targetStateIndex]!;
            return Object.freeze({
                layerId: layer.id,
                stateId: `${sourceState.id}->${targetState.id}`,
                normalizedTime: runtime.transition.targetNormalizedTime,
                weight: this._layerWeights[index] ?? 1,
                transitioning: true,
                transitionProgress: runtime.transition.progress,
            });
        });

        const sampledTrackCount = this._layers.reduce((sum, layer, index) => {
            if ((this._layerWeights[index] ?? 0) <= 0) {
                return sum;
            }
            const runtime = this._layerRuntimes[index]!;
            if (!runtime.transition) {
                return sum + this._countMotionTracks(layer.machine.states[runtime.currentStateIndex]!.motion);
            }
            return (
                sum +
                this._countMotionTracks(layer.machine.states[runtime.transition.sourceStateIndex]!.motion) +
                this._countMotionTracks(layer.machine.states[runtime.transition.targetStateIndex]!.motion)
            );
        }, 0);

        this._profile = Object.freeze({
            evaluationTimeMs,
            sampledTrackCount,
            activeClipCount: this._activeClips.length,
            emittedEventCount: this._events.length,
            rootMotionTranslationMagnitude: Math.hypot(
                this._rootMotionTranslation[0],
                this._rootMotionTranslation[1],
                this._rootMotionTranslation[2]
            ),
            rootMotionRotationW: this._rootMotionRotation[3] ?? 1,
            activeLayers: Object.freeze(activeLayers),
        });
    }
}