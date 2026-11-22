import { createAnimationClips, AnimationClip } from './clip';
import { AnimationScratchPool, BlendScratchContext, resolveMotionDuration, type AnimationMotionEvaluationContext } from './blend-tree';
import { AnimationStateMachineError, AnimationResolutionError, AnimationValidationError } from './errors';
import { AnimationIkLayer } from './ik';
import { AnimationMontage, type AnimationMontageOptions } from './montage';
import { AnimationParameterStore } from './parameters';
import {
    AnimationCurveLayout,
    AnimationMask,
    AnimationFrame,
    applyAdditiveFrame,
    blendFrame,
} from './pose';
import { createAdditiveFrameScratch } from './pose-blend';
import { AnimationRig } from './rig';
import {
    commitLayerRuntime,
    collectLayerClipActivities,
    collectLayerEvents,
    compileStateMachine,
    createLayerRuntime,
    crossFadeLayerState,
    dispatchLayerStateBehaviours,
    evaluateLayerRuntime,
    extractLayerRootDelta,
    forceLayerState,
    syncLayerRuntime,
    updateLayerRuntime,
    type AnimationCompiledStateMachine,
    type AnimationLayerRuntime,
} from './state-machine';
import { SoaQuatBuffer } from '@axrone/numeric';
import type {
    AnimationClipDefinition,
    AnimationControllerClipActivity,
    AnimationControllerEvent,
    AnimationControllerDefinition,
    AnimationControllerLayerProfile,
    AnimationControllerProfile,
    AnimationCurveBindingDefinition,
    AnimationLayerBlendMode,
    AnimationLayerSyncMode,
    AnimationParameterDefinition,
    AnimationRootMotionDelta,
    AnimationStateSignal,
} from './types';

interface AnimationCompiledLayer {
    readonly id: string;
    readonly mode: AnimationLayerBlendMode;
    readonly machine: AnimationCompiledStateMachine;
    readonly mask: AnimationMask | null;
    readonly ikLayers: readonly AnimationIkLayer[];
    readonly syncSourceIndex: number;
    readonly syncMode: AnimationLayerSyncMode;
    readonly syncTimeOffset: number;
}

export interface AnimationControllerUpdateResult {
    readonly frame: AnimationFrame;
    readonly rootMotion: AnimationRootMotionDelta;
    readonly events: readonly AnimationControllerEvent[];
    readonly activeClips: readonly AnimationControllerClipActivity[];
    readonly profile: AnimationControllerProfile;
}

interface MutableUpdateResult {
    frame: AnimationFrame;
    rootMotion: AnimationRootMotionDelta;
    events: readonly AnimationControllerEvent[];
    activeClips: readonly AnimationControllerClipActivity[];
    profile: AnimationControllerProfile;
}

interface MutableLayerProfile {
    layerId: string;
    stateId: string;
    normalizedTime: number;
    weight: number;
    transitioning: boolean;
    transitionProgress?: number;
}

interface MutableProfile {
    evaluationTimeMs: number;
    sampledTrackCount: number;
    activeClipCount: number;
    emittedEventCount: number;
    rootMotionTranslationMagnitude: number;
    rootMotionRotationW: number;
    activeLayers: MutableLayerProfile[];
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

    private readonly _previousFrame: AnimationFrame;
    private readonly _interpolatedFrame: AnimationFrame;

    private readonly _restFrame: AnimationFrame;
    private readonly _scratchPool: AnimationScratchPool;
    private readonly _blendScratch: BlendScratchContext;
    private _layers: AnimationCompiledLayer[];
    private _layerRuntimes: AnimationLayerRuntime[];
    private _layerWeights: number[];
    private _layerSyncOrder: number[];
    private readonly _stateSignalScratch: AnimationStateSignal[] = [];
    private _stateSignals: readonly AnimationStateSignal[] = [];
    private readonly _evaluationContext: AnimationMotionEvaluationContext;
    private readonly _rootMotionTranslation = new Float32Array(3);
    private readonly _rootMotionRotation = new Float32Array([0, 0, 0, 1]);
    private readonly _rootMotionConfig: NonNullable<AnimationControllerDefinition['rootMotion']> | null;
    private readonly _rootMotionBoneIndex: number;
    private readonly _additiveScratch = createAdditiveFrameScratch();
    private readonly _layerIndexById: Map<string, number>;
    private readonly _eventScratch: AnimationControllerEvent[] = [];
    private readonly _activeClipScratch: AnimationControllerClipActivity[] = [];
    private _events: readonly AnimationControllerEvent[] = [];
    private _activeClips: readonly AnimationControllerClipActivity[] = [];
    private readonly _rootMotionTranslationTuple: [number, number, number] = [0, 0, 0];
    private readonly _rootMotionRotationTuple: [number, number, number, number] = [0, 0, 0, 1];
    private readonly _rootMotionDelta: AnimationRootMotionDelta = {
        translation: this._rootMotionTranslationTuple,
        rotation: this._rootMotionRotationTuple,
    };
    private readonly _activeLayerProfiles: MutableLayerProfile[] = [];
    private readonly _profileState: MutableProfile = {
        evaluationTimeMs: 0,
        sampledTrackCount: 0,
        activeClipCount: 0,
        emittedEventCount: 0,
        rootMotionTranslationMagnitude: 0,
        rootMotionRotationW: 1,
        activeLayers: [],
    };
    private _updateResult: MutableUpdateResult | null = null;
    private readonly _transitionLabelCache = new Map<string, Map<string, string>>();
    private readonly _montages: AnimationMontage[] = [];
    private _montageSequence = 0;

    constructor(definition: AnimationControllerDefinition<TParameters>) {
        this.rig = new AnimationRig(definition.rig);
        this.parameters = new AnimationParameterStore(definition.parameters ?? ([] as unknown as TParameters));
        this.curveLayout = new AnimationCurveLayout(inferCurveBindings(definition.clips));
        this.clips = createAnimationClips(definition.clips, this.rig, this.curveLayout);
        this._restFrame = new AnimationFrame(this.rig, this.curveLayout);
        this.currentFrame = new AnimationFrame(this.rig, this.curveLayout);
        this._previousFrame = new AnimationFrame(this.rig, this.curveLayout);
        this._interpolatedFrame = new AnimationFrame(this.rig, this.curveLayout);
        this._scratchPool = new AnimationScratchPool(this.rig, this.curveLayout, this._restFrame.curves.values);
        this._blendScratch = new BlendScratchContext();
        this._evaluationContext = {
            rig: this.rig,
            parameters: this.parameters,
            restFrame: this._restFrame,
            scratch: this._scratchPool,
            blendScratch: this._blendScratch,
        };
        this._layers = definition.layers.map((layer) => {
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
                syncSourceIndex: -1,
                syncMode: layer.syncMode ?? 'stateAndTime',
                syncTimeOffset:
                    typeof layer.syncTimeOffset === 'number' && Number.isFinite(layer.syncTimeOffset)
                        ? layer.syncTimeOffset
                        : 0,
            } satisfies AnimationCompiledLayer);
        });
        if (this._layers.length === 0) {
            throw new AnimationValidationError('Animation controllers require at least one layer');
        }
        this._layerIndexById = new Map<string, number>();
        for (let layerIndex = 0; layerIndex < this._layers.length; layerIndex += 1) {
            this._layerIndexById.set(this._layers[layerIndex]!.id, layerIndex);
        }
        this._layers = this._layers.map((layer, layerIndex) => {
            const syncSourceId = definition.layers[layerIndex]?.syncSourceLayerId;
            if (syncSourceId === undefined) {
                return layer;
            }
            const resolved = String(syncSourceId);
            if (resolved === layer.id) {
                throw new AnimationValidationError(`Animation layer '${layer.id}' cannot sync to itself`);
            }
            const syncSourceIndex = this._layerIndexById.get(resolved);
            if (syncSourceIndex === undefined) {
                throw new AnimationValidationError(
                    `Animation layer '${layer.id}' syncs to unknown layer '${resolved}'`
                );
            }
            return Object.freeze({ ...layer, syncSourceIndex });
        });
        this._layerRuntimes = this._layers.map((layer) => createLayerRuntime(layer.machine));
        this._layerSyncOrder = this._buildLayerSyncOrder();
        this._layerWeights = this._layers.map((_, layerIndex) => definition.layers[layerIndex]?.weight ?? 1);
        this._rootMotionConfig = definition.rootMotion ?? null;
        this._rootMotionBoneIndex =
            this._rootMotionConfig && typeof this._rootMotionConfig.bone === 'string'
                ? this.rig.indexOfBone(this._rootMotionConfig.bone)
                : -1;
        this.evaluate();
    }

    get rootMotion(): AnimationRootMotionDelta {
        const translation = this._rootMotionTranslationTuple;
        translation[0] = this._rootMotionTranslation[0]!;
        translation[1] = this._rootMotionTranslation[1]!;
        translation[2] = this._rootMotionTranslation[2]!;
        const rotation = this._rootMotionRotationTuple;
        rotation[0] = this._rootMotionRotation[0]!;
        rotation[1] = this._rootMotionRotation[1]!;
        rotation[2] = this._rootMotionRotation[2]!;
        rotation[3] = this._rootMotionRotation[3]!;
        return this._rootMotionDelta;
    }

    get events(): readonly AnimationControllerEvent[] {
        return this._events;
    }

    get activeClips(): readonly AnimationControllerClipActivity[] {
        return this._activeClips;
    }

    /** Signals raised by state behaviours during the last update. */
    get stateSignals(): readonly AnimationStateSignal[] {
        return this._stateSignals;
    }

    get profile(): AnimationControllerProfile {
        return this._profileState;
    }

    /** Montages the controller owns, including finished ones awaiting release. */
    get montages(): readonly AnimationMontage[] {
        return this._montages;
    }

    /**
     * Plays a clip as an authored one-shot layer. The montage owns a dedicated
     * controller layer, fades in and out, and is released automatically when it
     * completes; events still reach the controller's normal sink.
     */
    playMontage(clipId: string, options: AnimationMontageOptions = {}): AnimationMontage {
        const resolvedClipId = String(clipId);
        const clip = this.clips.get(resolvedClipId);
        if (!clip) {
            throw new AnimationResolutionError(`Unknown animation clip '${resolvedClipId}'`, resolvedClipId);
        }

        if (options.replaceExisting ?? true) {
            this.stopAllMontages();
        }

        const sequence = ++this._montageSequence;
        const stateId = `montage:${clip.id}:${sequence}`;
        const speed = Math.max(Math.abs(options.speed ?? 1), 1e-3);
        const machine = compileStateMachine(
            {
                entryState: stateId,
                states: [
                    {
                        id: stateId,
                        motion: { kind: 'clip', clipId: clip.id },
                        loop: options.loop ?? false,
                        speed,
                    },
                ],
            },
            this.clips
        );
        const mask = options.boneMask
            ? options.boneMask.reduce((accumulator, boneName) => {
                  accumulator.set(this.rig.indexOfBone(boneName), true);
                  return accumulator;
              }, new AnimationMask(this.rig.boneCount, false))
            : null;
        const layer: AnimationCompiledLayer = Object.freeze({
            id: stateId,
            mode: options.mode ?? 'override',
            machine,
            mask,
            ikLayers: Object.freeze([]) as readonly AnimationIkLayer[],
            syncSourceIndex: -1,
            syncMode: 'stateAndTime' as const,
            syncTimeOffset: 0,
        });

        this._layers.push(layer);
        this._layerRuntimes.push(createLayerRuntime(machine));
        this._layerWeights.push(0);
        this._layerIndexById.set(stateId, this._layers.length - 1);

        const montage = new AnimationMontage(
            stateId,
            clip.id,
            clip.duration,
            Math.max(0, options.fadeInSeconds ?? 0.1),
            Math.max(0, options.fadeOutSeconds ?? 0.1),
            speed,
            options.loop ?? false
        );
        this._montages.push(montage);
        this.evaluate();
        return montage;
    }

    /** Stops a montage; its layer is released on the next update. */
    stopMontage(montage: AnimationMontage): this {
        montage.stop();
        return this;
    }

    /** Stops every playing montage. */
    stopAllMontages(): this {
        for (let index = 0; index < this._montages.length; index += 1) {
            this._montages[index]!.stop();
        }
        return this;
    }

    update(deltaSeconds: number): AnimationControllerUpdateResult {
        const startTime = now();
        this._previousFrame.pose.copyFrom(this.currentFrame.pose);
        this._previousFrame.curves.copyFrom(this.currentFrame.curves);
        this._advanceMontages(Math.max(0, deltaSeconds));
        if (this._layerSyncOrder.length !== this._layers.length) {
            this._layerSyncOrder = this._buildLayerSyncOrder();
        }
        for (let order = 0; order < this._layerSyncOrder.length; order += 1) {
            const layerIndex = this._layerSyncOrder[order]!;
            const layer = this._layers[layerIndex]!;
            if (layer.syncSourceIndex < 0) {
                continue;
            }
            syncLayerRuntime(
                layer.machine,
                this._layerRuntimes[layerIndex]!,
                this._layers[layer.syncSourceIndex]!.machine,
                this._layerRuntimes[layer.syncSourceIndex]!,
                { mode: layer.syncMode, timeOffset: layer.syncTimeOffset }
            );
        }
        for (let layerIndex = 0; layerIndex < this._layers.length; layerIndex += 1) {
            updateLayerRuntime(
                this._layers[layerIndex]!.machine,
                this._layerRuntimes[layerIndex]!,
                this.parameters,
                Math.max(0, deltaSeconds)
            );
        }
        const signals = this._stateSignalScratch;
        signals.length = 0;
        for (let layerIndex = 0; layerIndex < this._layers.length; layerIndex += 1) {
            const layer = this._layers[layerIndex]!;
            if (!layer.machine.hasStateBehaviours) {
                continue;
            }
            dispatchLayerStateBehaviours(
                layer.machine,
                this._layerRuntimes[layerIndex]!,
                this.parameters,
                layer.id,
                Math.max(0, deltaSeconds),
                signals
            );
        }
        this._stateSignals = signals;
        this._composeCurrentFrame(true);
        for (let layerIndex = 0; layerIndex < this._layers.length; layerIndex += 1) {
            commitLayerRuntime(this._layerRuntimes[layerIndex]!);
        }
        this._releaseFinishedMontages();
        this._updateProfile(now() - startTime);
        const rootMotion = this.rootMotion;
        if (this._updateResult === null) {
            this._updateResult = {
                frame: this.currentFrame,
                rootMotion,
                events: this.events,
                activeClips: this.activeClips,
                profile: this.profile,
            };
        } else {
            this._updateResult.frame = this.currentFrame;
            this._updateResult.rootMotion = rootMotion;
            this._updateResult.events = this.events;
            this._updateResult.activeClips = this.activeClips;
            this._updateResult.profile = this.profile;
        }
        return this._updateResult;
    }

    evaluate(): AnimationFrame {
        const startTime = now();
        this._composeCurrentFrame(false);
        this._updateProfile(now() - startTime);
        return this.currentFrame;
    }

    /**
     * Samples the pose between the previous and the current step. The render
     * phase uses this to remove the judder between fixed steps; alpha 0 selects
     * the previous pose, alpha 1 the current one.
     */
    sampleInterpolatedPose(alpha: number): AnimationFrame {
        const t = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 0));
        const previous = this._previousFrame.pose;
        const current = this.currentFrame.pose;
        const out = this._interpolatedFrame.pose;

        for (let bone = 0; bone < current.boneCount; bone += 1) {
            const translationOffset = bone * 3;
            const rotationOffset = bone * 4;
            out.translations[translationOffset] =
                previous.translations[translationOffset]! +
                (current.translations[translationOffset]! - previous.translations[translationOffset]!) * t;
            out.translations[translationOffset + 1] =
                previous.translations[translationOffset + 1]! +
                (current.translations[translationOffset + 1]! - previous.translations[translationOffset + 1]!) * t;
            out.translations[translationOffset + 2] =
                previous.translations[translationOffset + 2]! +
                (current.translations[translationOffset + 2]! - previous.translations[translationOffset + 2]!) * t;
            out.scales[translationOffset] =
                previous.scales[translationOffset]! +
                (current.scales[translationOffset]! - previous.scales[translationOffset]!) * t;
            out.scales[translationOffset + 1] =
                previous.scales[translationOffset + 1]! +
                (current.scales[translationOffset + 1]! - previous.scales[translationOffset + 1]!) * t;
            out.scales[translationOffset + 2] =
                previous.scales[translationOffset + 2]! +
                (current.scales[translationOffset + 2]! - previous.scales[translationOffset + 2]!) * t;
            SoaQuatBuffer.quatSlerp(
                out.rotations,
                rotationOffset,
                previous.rotations,
                rotationOffset,
                current.rotations,
                rotationOffset,
                t
            );
        }

        const previousCurves = this._previousFrame.curves.values;
        const currentCurves = this.currentFrame.curves.values;
        const outCurves = this._interpolatedFrame.curves.values;
        for (let index = 0; index < outCurves.length; index += 1) {
            outCurves[index] = previousCurves[index]! + (currentCurves[index]! - previousCurves[index]!) * t;
        }

        return this._interpolatedFrame;
    }

    play(stateId: string, layerId: string | undefined = this._layers[0]!.id): this {
        const layerIndex = this._resolveLayerIndex(layerId);
        forceLayerState(this._layers[layerIndex]!.machine, this._layerRuntimes[layerIndex]!, stateId, 0);
        this.evaluate();
        return this;
    }

    crossFade(
        stateId: string,
        durationSeconds: number,
        layerId: string | undefined = this._layers[0]!.id,
        options: { canInterrupt?: boolean } = {}
    ): this {
        const layerIndex = this._resolveLayerIndex(layerId);
        crossFadeLayerState(
            this._layers[layerIndex]!.machine,
            this._layerRuntimes[layerIndex]!,
            stateId,
            durationSeconds,
            0,
            options.canInterrupt ?? false
        );
        return this;
    }

    seek(timeSeconds: number, layerId: string | undefined = this._layers[0]!.id): this {
        const layerIndex = this._resolveLayerIndex(layerId);
        const runtime = this._layerRuntimes[layerIndex]!;
        const state = this._layers[layerIndex]!.machine.states[runtime.currentStateIndex]!;
        const duration = Math.max(1e-6, resolveMotionDuration(state.motion, this.parameters));
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
        SoaQuatBuffer.quatCopy(this._rootMotionRotation, 0, [0, 0, 0, 1], 0);
    }

    private _resolveLayerIndex(layerId: string | undefined): number {
        const resolvedId = layerId ?? this._layers[0]!.id;
        const layerIndex = this._layerIndexById.get(resolvedId);
        if (layerIndex === undefined) {
            throw new AnimationStateMachineError(`Unknown animation layer '${resolvedId}'`);
        }
        return layerIndex;
    }

    private _advanceMontages(deltaSeconds: number): void {
        if (this._montages.length === 0) {
            return;
        }
        for (let index = 0; index < this._montages.length; index += 1) {
            const montage = this._montages[index]!;
            montage.advance(deltaSeconds);
            const layerIndex = this._layerIndexById.get(montage.layerId);
            if (layerIndex !== undefined) {
                this._layerWeights[layerIndex] = montage.weight;
            }
        }
    }

    private _releaseFinishedMontages(): void {
        if (this._montages.length === 0) {
            return;
        }

        let write = 0;
        for (let read = 0; read < this._montages.length; read += 1) {
            const montage = this._montages[read]!;
            if (montage.removeRequested) {
                this._removeLayer(montage.layerId);
                continue;
            }
            this._montages[write] = montage;
            write += 1;
        }
        this._montages.length = write;
    }

    /**
     * Layers ordered so a sync source is always mirrored before the layers that
     * borrow from it. Cycles, which the validator rejects, fall back to declaration order.
     */
    private _buildLayerSyncOrder(): number[] {
        const order: number[] = [];
        const visited = new Uint8Array(this._layers.length);
        const visit = (layerIndex: number): void => {
            if (visited[layerIndex] === 1) {
                return;
            }
            visited[layerIndex] = 1;
            const sourceIndex = this._layers[layerIndex]?.syncSourceIndex ?? -1;
            if (sourceIndex >= 0 && sourceIndex !== layerIndex) {
                visit(sourceIndex);
            }
            order.push(layerIndex);
        };
        for (let layerIndex = 0; layerIndex < this._layers.length; layerIndex += 1) {
            visit(layerIndex);
        }
        return order;
    }

    private _removeLayer(layerId: string): void {
        const layerIndex = this._layerIndexById.get(layerId);
        if (layerIndex === undefined) {
            return;
        }

        this._layers.splice(layerIndex, 1);
        this._layerRuntimes.splice(layerIndex, 1);
        this._layerWeights.splice(layerIndex, 1);
        this._layerIndexById.delete(layerId);

        // Every layer after the removed one shifts down; a layer that synced
        // to the removed one loses its source instead of pointing at a stranger.
        for (let index = layerIndex; index < this._layers.length; index += 1) {
            const layer = this._layers[index]!;
            this._layerIndexById.set(layer.id, index);
            if (layer.syncSourceIndex === layerIndex) {
                this._layers[index] = Object.freeze({ ...layer, syncSourceIndex: -1 });
            } else if (layer.syncSourceIndex > layerIndex) {
                this._layers[index] = Object.freeze({ ...layer, syncSourceIndex: layer.syncSourceIndex - 1 });
            }
        }
    }

    private _composeCurrentFrame(updateRootMotion: boolean): void {
        this.currentFrame.reset(this.rig, this._restFrame.curves.values);
        this._rootMotionTranslation.fill(0);
        SoaQuatBuffer.quatCopy(this._rootMotionRotation, 0, [0, 0, 0, 1], 0);
        const events = this._eventScratch;
        events.length = 0;
        const activeClips = this._activeClipScratch;
        activeClips.length = 0;
        const additiveScratch = this._additiveScratch;

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
                        additiveScratch,
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
                    additiveScratch,
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
                    SoaQuatBuffer.quatCopy(
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
                SoaQuatBuffer.quatCopy(this._rootMotionRotation, 0, [0, 0, 0, 1], 0);
            }
        }

        events.sort(
            (left, right) =>
                left.time - right.time ||
                left.layerId.localeCompare(right.layerId) ||
                left.stateId.localeCompare(right.stateId)
        );
        this._events = events;
        activeClips.sort(
            (left, right) =>
                right.motionWeight - left.motionWeight ||
                left.layerId.localeCompare(right.layerId) ||
                right.stateId.localeCompare(right.stateId) ||
                left.clipId.localeCompare(right.clipId)
        );
        this._activeClips = activeClips;
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
        const profiles = this._activeLayerProfiles;
        while (profiles.length < this._layers.length) {
            profiles.push({
                layerId: '',
                stateId: '',
                normalizedTime: 0,
                weight: 0,
                transitioning: false,
            });
        }
        profiles.length = this._layers.length;
        for (let index = 0; index < this._layers.length; index += 1) {
            const layer = this._layers[index]!;
            const runtime = this._layerRuntimes[index]!;
            const profile = profiles[index]!;
            if (!runtime.transition) {
                const state = layer.machine.states[runtime.currentStateIndex]!;
                profile.layerId = layer.id;
                profile.stateId = state.id;
                profile.normalizedTime = runtime.currentNormalizedTime;
                profile.weight = this._layerWeights[index] ?? 1;
                profile.transitioning = false;
                delete profile.transitionProgress;
                continue;
            }

            const sourceState = layer.machine.states[runtime.transition.sourceStateIndex]!;
            const targetState = layer.machine.states[runtime.transition.targetStateIndex]!;
            profile.layerId = layer.id;
            profile.stateId = this._transitionLabel(sourceState.id, targetState.id);
            profile.normalizedTime = runtime.transition.targetNormalizedTime;
            profile.weight = this._layerWeights[index] ?? 1;
            profile.transitioning = true;
            profile.transitionProgress = runtime.transition.progress;
        }

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

        this._profileState.evaluationTimeMs = evaluationTimeMs;
        this._profileState.sampledTrackCount = sampledTrackCount;
        this._profileState.activeClipCount = this._activeClips.length;
        this._profileState.emittedEventCount = this._events.length;
        this._profileState.rootMotionTranslationMagnitude = Math.hypot(
            this._rootMotionTranslation[0],
            this._rootMotionTranslation[1],
            this._rootMotionTranslation[2]
        );
        this._profileState.rootMotionRotationW = this._rootMotionRotation[3] ?? 1;
        this._profileState.activeLayers = profiles;
    }

    private _transitionLabel(sourceId: string, targetId: string): string {
        let inner = this._transitionLabelCache.get(sourceId);
        if (inner === undefined) {
            inner = new Map<string, string>();
            this._transitionLabelCache.set(sourceId, inner);
        }
        let label = inner.get(targetId);
        if (label === undefined) {
            label = `${sourceId}->${targetId}`;
            inner.set(targetId, label);
        }
        return label;
    }
}
