import {
    buildAnimationMotionDefinition,
    type AnimationMotionBuilder,
    validateAnimationMotionDefinition,
} from './blend-graph';
import type {
    AnimationConditionDefinition,
    AnimationControllerDefinition,
    AnimationIkJobDefinition,
    AnimationIkLayerDefinition,
    AnimationLayerBlendMode,
    AnimationLayerDefinition,
    AnimationMotionDefinition,
    AnimationParameterDefinition,
    AnimationParameterKind,
    AnimationParameterValue,
    AnimationRigDefinition,
    AnimationRootMotionDefinition,
    AnimationStateDefinition,
    AnimationStateMachineDefinition,
    AnimationTransitionDefinition,
    AnimationTransitionOperator,
} from './types';

export interface AnimationControllerGraphDiagnostic {
    readonly code: string;
    readonly message: string;
    readonly path: string;
}

export interface AnimationControllerGraphValidationOptions {
    readonly knownClipIds?: readonly string[];
    readonly knownParameters?: readonly string[];
    readonly knownBones?: readonly string[];
}

type AnimationMotionInput = AnimationMotionDefinition | AnimationMotionBuilder;
type AnimationTransitionInput = AnimationTransitionDefinition | AnimationTransitionBuilder;
type AnimationStateInput = AnimationStateDefinition | AnimationStateBuilder;
type AnimationStateMachineInput = AnimationStateMachineDefinition | AnimationStateMachineBuilder;
type AnimationIkLayerInput = AnimationIkLayerDefinition | AnimationIkLayerBuilder;
type AnimationLayerInput = AnimationLayerDefinition | AnimationLayerBuilder;
type AnimationControllerInput =
    | AnimationControllerDefinition<readonly AnimationParameterDefinition[]>
    | AnimationControllerBuilder;

const VALID_LAYER_MODES = new Set<AnimationLayerBlendMode>(['override', 'additive']);

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

const pushDiagnostic = (
    diagnostics: AnimationControllerGraphDiagnostic[],
    code: string,
    message: string,
    path: string
): void => {
    diagnostics.push(Object.freeze({ code, message, path }));
};

const cloneCondition = (condition: AnimationConditionDefinition): AnimationConditionDefinition => {
    switch (condition.kind) {
        case 'float':
        case 'int':
            return Object.freeze({
                kind: condition.kind,
                parameter: condition.parameter,
                operator: condition.operator,
                value: condition.value,
            });
        case 'bool':
            return Object.freeze({
                kind: 'bool',
                parameter: condition.parameter,
                value: condition.value,
            });
        case 'trigger':
            return Object.freeze({
                kind: 'trigger',
                parameter: condition.parameter,
            });
        default:
            return condition;
    }
};

const cloneRigDefinition = (rig: AnimationRigDefinition): AnimationRigDefinition =>
    Object.freeze({
        ...(typeof rig.id === 'string' ? { id: rig.id } : {}),
        bones: Object.freeze(
            rig.bones.map((bone) =>
                Object.freeze({
                    name: bone.name,
                    ...(bone.parent !== undefined ? { parent: bone.parent } : {}),
                    ...(bone.translation ? { translation: Object.freeze([...bone.translation]) as readonly [number, number, number] } : {}),
                    ...(bone.rotation
                        ? { rotation: Object.freeze([...bone.rotation]) as readonly [number, number, number, number] }
                        : {}),
                    ...(bone.scale ? { scale: Object.freeze([...bone.scale]) as readonly [number, number, number] } : {}),
                    ...(bone.inverseBindMatrix
                        ? {
                              inverseBindMatrix:
                                  bone.inverseBindMatrix instanceof Float32Array
                                      ? new Float32Array(bone.inverseBindMatrix)
                                      : Object.freeze([...bone.inverseBindMatrix]),
                          }
                        : {}),
                })
            )
        ),
    });

const cloneParameterDefinition = (
    parameter: AnimationParameterDefinition
): AnimationParameterDefinition =>
    Object.freeze({
        name: parameter.name,
        kind: parameter.kind,
        ...(parameter.defaultValue !== undefined ? { defaultValue: parameter.defaultValue } : {}),
    });

const cloneRootMotionDefinition = (
    rootMotion: AnimationRootMotionDefinition
): AnimationRootMotionDefinition =>
    Object.freeze({
        bone: rootMotion.bone,
        ...(typeof rootMotion.consume === 'boolean' ? { consume: rootMotion.consume } : {}),
        ...(rootMotion.projectTranslationAxes
            ? {
                  projectTranslationAxes: Object.freeze([
                      rootMotion.projectTranslationAxes[0],
                      rootMotion.projectTranslationAxes[1],
                      rootMotion.projectTranslationAxes[2],
                  ]) as readonly [boolean, boolean, boolean],
              }
            : {}),
        ...(typeof rootMotion.extractRotation === 'boolean'
            ? { extractRotation: rootMotion.extractRotation }
            : {}),
    });

const cloneClipDefinition = (
    clip: AnimationControllerDefinition['clips'][number]
): AnimationControllerDefinition['clips'][number] =>
    Object.freeze({
        id: clip.id,
        ...(isFiniteNumber(clip.duration) ? { duration: clip.duration } : {}),
        tracks: Object.freeze(
            clip.tracks.map((track) =>
                Object.freeze({
                    target: track.target,
                    path: track.path,
                    ...(typeof track.interpolation === 'string'
                        ? { interpolation: track.interpolation }
                        : {}),
                    times: track.times instanceof Float32Array ? new Float32Array(track.times) : [...track.times],
                    values:
                        track.values instanceof Float32Array
                            ? new Float32Array(track.values)
                            : [...track.values],
                    ...(isFiniteNumber(track.keyframeCount) ? { keyframeCount: track.keyframeCount } : {}),
                    ...(isFiniteNumber(track.sampleStride) ? { sampleStride: track.sampleStride } : {}),
                    ...(isFiniteNumber(track.valueComponentCount)
                        ? { valueComponentCount: track.valueComponentCount }
                        : {}),
                })
            )
        ),
        ...(clip.events
            ? {
                  events: Object.freeze(
                      clip.events.map((event) =>
                          Object.freeze({
                              ...(typeof event.id === 'string' ? { id: event.id } : {}),
                              name: event.name,
                              time: event.time,
                              ...(event.payload ? { payload: Object.freeze({ ...event.payload }) } : {}),
                              ...(event.tags ? { tags: Object.freeze([...event.tags]) } : {}),
                          })
                      )
                  ),
              }
            : {}),
        ...(clip.footContacts
            ? {
                  footContacts: Object.freeze(
                      clip.footContacts.map((contact) =>
                          Object.freeze({
                              bone: contact.bone,
                              startTime: contact.startTime,
                              endTime: contact.endTime,
                              ...(contact.lockTranslationAxes
                                  ? {
                                        lockTranslationAxes: Object.freeze([
                                            contact.lockTranslationAxes[0],
                                            contact.lockTranslationAxes[1],
                                            contact.lockTranslationAxes[2],
                                        ]) as readonly [boolean, boolean, boolean],
                                    }
                                  : {}),
                              ...(contact.metadata
                                  ? { metadata: Object.freeze({ ...contact.metadata }) }
                                  : {}),
                          })
                      )
                  ),
              }
            : {}),
        ...(clip.tags ? { tags: Object.freeze([...clip.tags]) } : {}),
        ...(clip.features
            ? {
                  features: Object.freeze(
                      clip.features.map((feature) =>
                          Object.freeze({
                              time: feature.time,
                              ...(feature.trajectoryPosition
                                  ? {
                                        trajectoryPosition: Object.freeze([
                                            feature.trajectoryPosition[0],
                                            feature.trajectoryPosition[1],
                                            feature.trajectoryPosition[2],
                                        ]) as readonly [number, number, number],
                                    }
                                  : {}),
                              ...(feature.facingDirection
                                  ? {
                                        facingDirection: Object.freeze([
                                            feature.facingDirection[0],
                                            feature.facingDirection[1],
                                            feature.facingDirection[2],
                                        ]) as readonly [number, number, number],
                                    }
                                  : {}),
                              ...(feature.tags ? { tags: Object.freeze([...feature.tags]) } : {}),
                              ...(isFiniteNumber(feature.costBias) ? { costBias: feature.costBias } : {}),
                          })
                      )
                  ),
              }
            : {}),
        ...(clip.compression ? { compression: Object.freeze({ ...clip.compression }) } : {}),
        ...(clip.streaming ? { streaming: Object.freeze({ ...clip.streaming }) } : {}),
    });

export class AnimationTransitionBuilder {
    private _duration?: number;
    private _offset?: number;
    private _exitTime?: number;
    private _fixedDuration?: boolean;
    private _canInterrupt?: boolean;
    private _priority?: number;
    private readonly _conditions: AnimationConditionDefinition[] = [];

    constructor(public readonly to: string) {}

    withDuration(duration: number): this {
        this._duration = duration;
        return this;
    }

    withOffset(offset: number): this {
        this._offset = offset;
        return this;
    }

    withExitTime(exitTime: number): this {
        this._exitTime = exitTime;
        return this;
    }

    withFixedDuration(fixedDuration = true): this {
        this._fixedDuration = fixedDuration;
        return this;
    }

    withInterruptible(canInterrupt = true): this {
        this._canInterrupt = canInterrupt;
        return this;
    }

    withPriority(priority: number): this {
        this._priority = priority;
        return this;
    }

    addCondition(condition: AnimationConditionDefinition): this {
        this._conditions.push(cloneCondition(condition));
        return this;
    }

    whenFloat(parameter: string, operator: AnimationTransitionOperator, value: number): this {
        return this.addCondition({ kind: 'float', parameter, operator, value });
    }

    whenInt(parameter: string, operator: AnimationTransitionOperator, value: number): this {
        return this.addCondition({ kind: 'int', parameter, operator, value });
    }

    whenBool(parameter: string, value: boolean): this {
        return this.addCondition({ kind: 'bool', parameter, value });
    }

    whenTriggered(parameter: string): this {
        return this.addCondition({ kind: 'trigger', parameter });
    }

    build(): AnimationTransitionDefinition {
        return buildAnimationTransitionDefinition({
            to: this.to,
            ...(isFiniteNumber(this._duration) ? { duration: this._duration } : {}),
            ...(isFiniteNumber(this._offset) ? { offset: this._offset } : {}),
            ...(isFiniteNumber(this._exitTime) ? { exitTime: this._exitTime } : {}),
            ...(typeof this._fixedDuration === 'boolean' ? { fixedDuration: this._fixedDuration } : {}),
            ...(typeof this._canInterrupt === 'boolean' ? { canInterrupt: this._canInterrupt } : {}),
            ...(isFiniteNumber(this._priority) ? { priority: this._priority } : {}),
            ...(this._conditions.length > 0 ? { conditions: Object.freeze([...this._conditions]) } : {}),
        });
    }
}

export class AnimationStateBuilder {
    private _speed?: number;
    private _loop?: boolean;
    private readonly _transitions: AnimationTransitionInput[] = [];

    constructor(
        public readonly id: string,
        private _motion: AnimationMotionInput
    ) {}

    withMotion(motion: AnimationMotionInput): this {
        this._motion = motion;
        return this;
    }

    withSpeed(speed: number): this {
        this._speed = speed;
        return this;
    }

    withLoop(loop: boolean): this {
        this._loop = loop;
        return this;
    }

    addTransition(transition: AnimationTransitionInput): this {
        this._transitions.push(transition);
        return this;
    }

    transitionTo(
        to: string,
        configure?: (transition: AnimationTransitionBuilder) => void
    ): this {
        const transition = new AnimationTransitionBuilder(to);
        configure?.(transition);
        return this.addTransition(transition);
    }

    build(): AnimationStateDefinition {
        return Object.freeze({
            id: this.id,
            motion: buildAnimationMotionDefinition(this._motion),
            ...(isFiniteNumber(this._speed) ? { speed: this._speed } : {}),
            ...(typeof this._loop === 'boolean' ? { loop: this._loop } : {}),
            ...(this._transitions.length > 0
                ? { transitions: Object.freeze(this._transitions.map(buildAnimationTransitionDefinition)) }
                : {}),
        });
    }
}

export class AnimationStateMachineBuilder {
    private _entryState?: string;
    private readonly _states: AnimationStateInput[] = [];
    private readonly _anyStateTransitions: AnimationTransitionInput[] = [];

    constructor(entryState?: string) {
        this._entryState = entryState;
    }

    withEntryState(entryState: string): this {
        this._entryState = entryState;
        return this;
    }

    addState(state: AnimationStateInput): this {
        this._states.push(state);
        if (!this._entryState) {
            this._entryState = 'build' in state ? state.id : state.id;
        }
        return this;
    }

    state(
        id: string,
        motion: AnimationMotionInput,
        configure?: (state: AnimationStateBuilder) => void
    ): this {
        const state = new AnimationStateBuilder(id, motion);
        configure?.(state);
        return this.addState(state);
    }

    addAnyStateTransition(transition: AnimationTransitionInput): this {
        this._anyStateTransitions.push(transition);
        return this;
    }

    anyState(
        to: string,
        configure?: (transition: AnimationTransitionBuilder) => void
    ): this {
        const transition = new AnimationTransitionBuilder(to);
        configure?.(transition);
        return this.addAnyStateTransition(transition);
    }

    build(): AnimationStateMachineDefinition {
        return buildAnimationStateMachineDefinition({
            entryState: this._entryState ?? this._states[0]?.id ?? '',
            states: Object.freeze(this._states.map(buildAnimationStateDefinition)),
            ...(this._anyStateTransitions.length > 0
                ? {
                      anyStateTransitions: Object.freeze(
                          this._anyStateTransitions.map(buildAnimationTransitionDefinition)
                      ),
                  }
                : {}),
        });
    }
}

export class AnimationIkLayerBuilder {
    private _weight?: number;
    private readonly _jobs: AnimationIkJobDefinition[] = [];

    constructor(public readonly id: string) {}

    withWeight(weight: number): this {
        this._weight = weight;
        return this;
    }

    addJob(job: AnimationIkJobDefinition): this {
        this._jobs.push(Object.freeze({ ...job }));
        return this;
    }

    build(): AnimationIkLayerDefinition {
        return buildAnimationIkLayerDefinition({
            id: this.id,
            ...(isFiniteNumber(this._weight) ? { weight: this._weight } : {}),
            jobs: Object.freeze(this._jobs.map((job) => Object.freeze({ ...job }))),
        });
    }
}

export class AnimationLayerBuilder {
    private _weight?: number;
    private _mode?: AnimationLayerBlendMode;
    private _boneMask?: string[];
    private _stateMachine: AnimationStateMachineInput;
    private readonly _ikLayers: AnimationIkLayerInput[] = [];

    constructor(
        public readonly id: string,
        stateMachine: AnimationStateMachineInput
    ) {
        this._stateMachine = stateMachine;
    }

    withWeight(weight: number): this {
        this._weight = weight;
        return this;
    }

    withMode(mode: AnimationLayerBlendMode): this {
        this._mode = mode;
        return this;
    }

    withBoneMask(bones: readonly string[]): this {
        this._boneMask = [...bones];
        return this;
    }

    withStateMachine(stateMachine: AnimationStateMachineInput): this {
        this._stateMachine = stateMachine;
        return this;
    }

    addIkLayer(layer: AnimationIkLayerInput): this {
        this._ikLayers.push(layer);
        return this;
    }

    build(): AnimationLayerDefinition {
        return Object.freeze({
            id: this.id,
            ...(isFiniteNumber(this._weight) ? { weight: this._weight } : {}),
            ...(this._mode ? { mode: this._mode } : {}),
            ...(this._boneMask ? { boneMask: Object.freeze([...this._boneMask]) } : {}),
            stateMachine: buildAnimationStateMachineDefinition(this._stateMachine),
            ...(this._ikLayers.length > 0
                ? { ikLayers: Object.freeze(this._ikLayers.map(buildAnimationIkLayerDefinition)) }
                : {}),
        });
    }
}

export class AnimationControllerBuilder {
    private readonly _clips: AnimationControllerDefinition<readonly AnimationParameterDefinition[]>['clips'][number][] = [];
    private readonly _parameters: AnimationParameterDefinition[] = [];
    private readonly _layers: AnimationLayerInput[] = [];
    private _rootMotion?: AnimationRootMotionDefinition | null;

    constructor(private readonly _rig: AnimationRigDefinition) {}

    addClip(clip: AnimationControllerDefinition<readonly AnimationParameterDefinition[]>['clips'][number]): this {
        this._clips.push(clip);
        return this;
    }

    addParameter(parameter: AnimationParameterDefinition): this {
        this._parameters.push(parameter);
        return this;
    }

    parameter<TKind extends AnimationParameterKind>(
        name: string,
        kind: TKind,
        defaultValue?: AnimationParameterValue<TKind>
    ): this {
        return this.addParameter({
            name,
            kind,
            ...(defaultValue !== undefined ? { defaultValue } : {}),
        });
    }

    addLayer(layer: AnimationLayerInput): this {
        this._layers.push(layer);
        return this;
    }

    layer(
        id: string,
        stateMachine: AnimationStateMachineInput,
        configure?: (layer: AnimationLayerBuilder) => void
    ): this {
        const layer = new AnimationLayerBuilder(id, stateMachine);
        configure?.(layer);
        return this.addLayer(layer);
    }

    withRootMotion(rootMotion: AnimationRootMotionDefinition | null): this {
        this._rootMotion = rootMotion;
        return this;
    }

    build(): AnimationControllerDefinition<readonly AnimationParameterDefinition[]> {
        return buildAnimationControllerDefinition({
            rig: this._rig,
            clips: Object.freeze(this._clips.map(cloneClipDefinition)),
            layers: Object.freeze(this._layers.map(buildAnimationLayerDefinition)),
            ...(this._parameters.length > 0
                ? { parameters: Object.freeze(this._parameters.map(cloneParameterDefinition)) }
                : {}),
            ...(this._rootMotion !== undefined
                ? { rootMotion: this._rootMotion ? cloneRootMotionDefinition(this._rootMotion) : null }
                : {}),
        });
    }
}

export const createAnimationTransition = (to: string): AnimationTransitionBuilder =>
    new AnimationTransitionBuilder(to);

export const createAnimationState = (
    id: string,
    motion: AnimationMotionInput
): AnimationStateBuilder => new AnimationStateBuilder(id, motion);

export const createAnimationStateMachine = (
    entryState?: string
): AnimationStateMachineBuilder => new AnimationStateMachineBuilder(entryState);

export const createAnimationIkLayer = (id: string): AnimationIkLayerBuilder =>
    new AnimationIkLayerBuilder(id);

export const createAnimationLayer = (
    id: string,
    stateMachine: AnimationStateMachineInput
): AnimationLayerBuilder => new AnimationLayerBuilder(id, stateMachine);

export const createAnimationController = (
    rig: AnimationRigDefinition
): AnimationControllerBuilder => new AnimationControllerBuilder(rig);

export const buildAnimationTransitionDefinition = (
    transition: AnimationTransitionInput
): AnimationTransitionDefinition =>
    transition instanceof AnimationTransitionBuilder
        ? transition.build()
        : Object.freeze({
              to: transition.to,
              ...(isFiniteNumber(transition.duration) ? { duration: transition.duration } : {}),
              ...(isFiniteNumber(transition.offset) ? { offset: transition.offset } : {}),
              ...(isFiniteNumber(transition.exitTime) ? { exitTime: transition.exitTime } : {}),
              ...(typeof transition.fixedDuration === 'boolean'
                  ? { fixedDuration: transition.fixedDuration }
                  : {}),
              ...(typeof transition.canInterrupt === 'boolean'
                  ? { canInterrupt: transition.canInterrupt }
                  : {}),
              ...(isFiniteNumber(transition.priority) ? { priority: transition.priority } : {}),
              ...(transition.conditions
                  ? { conditions: Object.freeze(transition.conditions.map(cloneCondition)) }
                  : {}),
          });

export const buildAnimationStateDefinition = (state: AnimationStateInput): AnimationStateDefinition =>
    state instanceof AnimationStateBuilder
        ? state.build()
        : Object.freeze({
              id: state.id,
              motion: buildAnimationMotionDefinition(state.motion),
              ...(isFiniteNumber(state.speed) ? { speed: state.speed } : {}),
              ...(typeof state.loop === 'boolean' ? { loop: state.loop } : {}),
              ...(state.transitions
                  ? {
                        transitions: Object.freeze(
                            state.transitions.map(buildAnimationTransitionDefinition)
                        ),
                    }
                  : {}),
          });

export const buildAnimationStateMachineDefinition = (
    stateMachine: AnimationStateMachineInput
): AnimationStateMachineDefinition =>
    stateMachine instanceof AnimationStateMachineBuilder
        ? stateMachine.build()
        : Object.freeze({
              entryState: stateMachine.entryState,
              states: Object.freeze(stateMachine.states.map(buildAnimationStateDefinition)),
              ...(stateMachine.anyStateTransitions
                  ? {
                        anyStateTransitions: Object.freeze(
                            stateMachine.anyStateTransitions.map(buildAnimationTransitionDefinition)
                        ),
                    }
                  : {}),
          });

export const buildAnimationIkLayerDefinition = (
    layer: AnimationIkLayerInput
): AnimationIkLayerDefinition =>
    layer instanceof AnimationIkLayerBuilder
        ? layer.build()
        : Object.freeze({
              id: layer.id,
              ...(isFiniteNumber(layer.weight) ? { weight: layer.weight } : {}),
              jobs: Object.freeze(layer.jobs.map((job) => Object.freeze({ ...job }))),
          });

export const buildAnimationLayerDefinition = (layer: AnimationLayerInput): AnimationLayerDefinition =>
    layer instanceof AnimationLayerBuilder
        ? layer.build()
        : Object.freeze({
              id: layer.id,
              ...(isFiniteNumber(layer.weight) ? { weight: layer.weight } : {}),
              ...(layer.mode ? { mode: layer.mode } : {}),
              ...(layer.boneMask ? { boneMask: Object.freeze([...layer.boneMask]) } : {}),
              stateMachine: buildAnimationStateMachineDefinition(layer.stateMachine),
              ...(layer.ikLayers
                  ? { ikLayers: Object.freeze(layer.ikLayers.map(buildAnimationIkLayerDefinition)) }
                  : {}),
          });

export const buildAnimationControllerDefinition = (
    controller: AnimationControllerInput
): AnimationControllerDefinition<readonly AnimationParameterDefinition[]> =>
    controller instanceof AnimationControllerBuilder
        ? controller.build()
        : Object.freeze({
              rig: cloneRigDefinition(controller.rig),
              clips: Object.freeze(controller.clips.map(cloneClipDefinition)),
              layers: Object.freeze(controller.layers.map(buildAnimationLayerDefinition)),
              ...(controller.parameters
                  ? { parameters: Object.freeze(controller.parameters.map(cloneParameterDefinition)) }
                  : {}),
              ...(controller.rootMotion !== undefined
                  ? {
                        rootMotion: controller.rootMotion
                            ? cloneRootMotionDefinition(controller.rootMotion)
                            : null,
                    }
                  : {}),
          });

const validateCondition = (
    condition: AnimationConditionDefinition,
    diagnostics: AnimationControllerGraphDiagnostic[],
    options: AnimationControllerGraphValidationOptions,
    path: string
): void => {
    if (
        options.knownParameters &&
        options.knownParameters.includes(String(condition.parameter)) === false
    ) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.parameter.unknown',
            `Unknown parameter '${condition.parameter}'`,
            `${path}.parameter`
        );
    }
    switch (condition.kind) {
        case 'float':
        case 'int':
            if (!isFiniteNumber(condition.value)) {
                pushDiagnostic(
                    diagnostics,
                    'animation.controller.condition.value.invalid',
                    'Numeric transition conditions require a finite value',
                    `${path}.value`
                );
            }
            break;
        case 'bool':
        case 'trigger':
            break;
        default:
            pushDiagnostic(
                diagnostics,
                'animation.controller.condition.kind.unsupported',
                `Unsupported condition kind '${String((condition as { kind?: unknown }).kind)}'`,
                path
            );
            break;
    }
};

const validateTransition = (
    transition: AnimationTransitionDefinition,
    diagnostics: AnimationControllerGraphDiagnostic[],
    options: AnimationControllerGraphValidationOptions,
    knownStates: ReadonlySet<string>,
    path: string
): void => {
    if (knownStates.has(String(transition.to)) === false) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.state.unknown',
            `Unknown transition target '${transition.to}'`,
            `${path}.to`
        );
    }
    if (transition.duration !== undefined && !isFiniteNumber(transition.duration)) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.transition.duration.invalid',
            'Transition duration must be finite',
            `${path}.duration`
        );
    }
    if (transition.offset !== undefined && !isFiniteNumber(transition.offset)) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.transition.offset.invalid',
            'Transition offset must be finite',
            `${path}.offset`
        );
    }
    if (transition.exitTime !== undefined && !isFiniteNumber(transition.exitTime)) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.transition.exitTime.invalid',
            'Transition exitTime must be finite',
            `${path}.exitTime`
        );
    }
    if (transition.priority !== undefined && !isFiniteNumber(transition.priority)) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.transition.priority.invalid',
            'Transition priority must be finite',
            `${path}.priority`
        );
    }
    for (let index = 0; index < (transition.conditions?.length ?? 0); index += 1) {
        validateCondition(
            transition.conditions![index]!,
            diagnostics,
            options,
            `${path}.conditions[${index}]`
        );
    }
};

const validateState = (
    state: AnimationStateDefinition,
    diagnostics: AnimationControllerGraphDiagnostic[],
    options: AnimationControllerGraphValidationOptions,
    knownStates: ReadonlySet<string>,
    path: string
): void => {
    if (!String(state.id)) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.state.id.empty',
            'States require a non-empty id',
            `${path}.id`
        );
    }
    if (state.speed !== undefined && !isFiniteNumber(state.speed)) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.state.speed.invalid',
            'State speed must be finite',
            `${path}.speed`
        );
    }
    const motionDiagnostics = validateAnimationMotionDefinition(state.motion, {
        knownClipIds: options.knownClipIds,
        knownParameters: options.knownParameters,
    });
    for (let index = 0; index < motionDiagnostics.length; index += 1) {
        const diagnostic = motionDiagnostics[index]!;
        pushDiagnostic(
            diagnostics,
            diagnostic.code.replace('animation.blendGraph', 'animation.controller.motion'),
            diagnostic.message,
            `${path}.motion${diagnostic.path === 'motion' ? '' : diagnostic.path.slice('motion'.length)}`
        );
    }
    for (let index = 0; index < (state.transitions?.length ?? 0); index += 1) {
        validateTransition(
            state.transitions![index]!,
            diagnostics,
            options,
            knownStates,
            `${path}.transitions[${index}]`
        );
    }
};

export const validateAnimationStateMachineDefinition = (
    stateMachine: AnimationStateMachineInput,
    options: AnimationControllerGraphValidationOptions = {}
): readonly AnimationControllerGraphDiagnostic[] => {
    const diagnostics: AnimationControllerGraphDiagnostic[] = [];
    const resolved = buildAnimationStateMachineDefinition(stateMachine);

    if (resolved.states.length === 0) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.states.empty',
            'State machines require at least one state',
            'stateMachine.states'
        );
    }

    const knownStates = new Set<string>();
    for (let index = 0; index < resolved.states.length; index += 1) {
        const state = resolved.states[index]!;
        if (knownStates.has(String(state.id))) {
            pushDiagnostic(
                diagnostics,
                'animation.controller.state.duplicate',
                `Duplicate state '${state.id}'`,
                `stateMachine.states[${index}].id`
            );
        }
        knownStates.add(String(state.id));
    }

    if (knownStates.has(String(resolved.entryState)) === false) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.state.entry.unknown',
            `Unknown entry state '${resolved.entryState}'`,
            'stateMachine.entryState'
        );
    }

    for (let index = 0; index < resolved.states.length; index += 1) {
        validateState(
            resolved.states[index]!,
            diagnostics,
            options,
            knownStates,
            `stateMachine.states[${index}]`
        );
    }

    for (let index = 0; index < (resolved.anyStateTransitions?.length ?? 0); index += 1) {
        validateTransition(
            resolved.anyStateTransitions![index]!,
            diagnostics,
            options,
            knownStates,
            `stateMachine.anyStateTransitions[${index}]`
        );
    }

    return Object.freeze(diagnostics);
};

const validateIkLayer = (
    layer: AnimationIkLayerDefinition,
    diagnostics: AnimationControllerGraphDiagnostic[],
    options: AnimationControllerGraphValidationOptions,
    path: string
): void => {
    if (!String(layer.id)) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.ikLayer.id.empty',
            'IK layers require a non-empty id',
            `${path}.id`
        );
    }
    if (layer.weight !== undefined && !isFiniteNumber(layer.weight)) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.ikLayer.weight.invalid',
            'IK layer weight must be finite',
            `${path}.weight`
        );
    }
    if (layer.jobs.length === 0) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.ikLayer.jobs.empty',
            'IK layers require at least one job',
            `${path}.jobs`
        );
    }
    for (let index = 0; index < layer.jobs.length; index += 1) {
        const job = layer.jobs[index]!;
        if (
            options.knownBones &&
            options.knownBones.includes(job.rootBone) === false
        ) {
            pushDiagnostic(
                diagnostics,
                'animation.controller.bone.unknown',
                `Unknown bone '${job.rootBone}'`,
                `${path}.jobs[${index}].rootBone`
            );
        }
        if (
            options.knownBones &&
            options.knownBones.includes(job.tipBone) === false
        ) {
            pushDiagnostic(
                diagnostics,
                'animation.controller.bone.unknown',
                `Unknown bone '${job.tipBone}'`,
                `${path}.jobs[${index}].tipBone`
            );
        }
        if (
            typeof job.targetBone === 'string' &&
            options.knownBones &&
            options.knownBones.includes(job.targetBone) === false
        ) {
            pushDiagnostic(
                diagnostics,
                'animation.controller.bone.unknown',
                `Unknown bone '${job.targetBone}'`,
                `${path}.jobs[${index}].targetBone`
            );
        }
    }
};

export const validateAnimationLayerDefinition = (
    layer: AnimationLayerInput,
    options: AnimationControllerGraphValidationOptions = {}
): readonly AnimationControllerGraphDiagnostic[] => {
    const diagnostics: AnimationControllerGraphDiagnostic[] = [];
    const resolved = buildAnimationLayerDefinition(layer);

    if (!String(resolved.id)) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.layer.id.empty',
            'Layers require a non-empty id',
            'layer.id'
        );
    }
    if (resolved.weight !== undefined && !isFiniteNumber(resolved.weight)) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.layer.weight.invalid',
            'Layer weight must be finite',
            'layer.weight'
        );
    }
    if (resolved.mode !== undefined && VALID_LAYER_MODES.has(resolved.mode) === false) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.layer.mode.invalid',
            `Unsupported layer mode '${String(resolved.mode)}'`,
            'layer.mode'
        );
    }
    for (let index = 0; index < (resolved.boneMask?.length ?? 0); index += 1) {
        const bone = resolved.boneMask![index]!;
        if (options.knownBones && options.knownBones.includes(bone) === false) {
            pushDiagnostic(
                diagnostics,
                'animation.controller.bone.unknown',
                `Unknown bone '${bone}'`,
                `layer.boneMask[${index}]`
            );
        }
    }

    diagnostics.push(
        ...validateAnimationStateMachineDefinition(resolved.stateMachine, options).map((diagnostic) =>
            Object.freeze({
                code: diagnostic.code,
                message: diagnostic.message,
                path: `layer.${diagnostic.path}`,
            })
        )
    );

    for (let index = 0; index < (resolved.ikLayers?.length ?? 0); index += 1) {
        validateIkLayer(resolved.ikLayers![index]!, diagnostics, options, `layer.ikLayers[${index}]`);
    }

    return Object.freeze(diagnostics);
};

export const validateAnimationControllerDefinition = (
    controller: AnimationControllerInput,
    options: AnimationControllerGraphValidationOptions = {}
): readonly AnimationControllerGraphDiagnostic[] => {
    const diagnostics: AnimationControllerGraphDiagnostic[] = [];
    const resolved = buildAnimationControllerDefinition(controller);
    const knownClipIds = options.knownClipIds ?? resolved.clips.map((clip) => String(clip.id));
    const knownParameters =
        options.knownParameters ?? resolved.parameters?.map((parameter) => parameter.name) ?? [];
    const knownBones = options.knownBones ?? resolved.rig.bones.map((bone) => bone.name);

    if (resolved.rig.bones.length === 0) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.rig.bones.empty',
            'Controllers require at least one rig bone',
            'controller.rig.bones'
        );
    }
    const seenBones = new Set<string>();
    for (let index = 0; index < resolved.rig.bones.length; index += 1) {
        const bone = resolved.rig.bones[index]!;
        if (!bone.name) {
            pushDiagnostic(
                diagnostics,
                'animation.controller.bone.name.empty',
                'Rig bones require a non-empty name',
                `controller.rig.bones[${index}].name`
            );
        }
        if (seenBones.has(bone.name)) {
            pushDiagnostic(
                diagnostics,
                'animation.controller.bone.duplicate',
                `Duplicate rig bone '${bone.name}'`,
                `controller.rig.bones[${index}].name`
            );
        }
        seenBones.add(bone.name);
    }

    if (resolved.clips.length === 0) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.clips.empty',
            'Controllers require at least one clip',
            'controller.clips'
        );
    }
    const seenClips = new Set<string>();
    for (let index = 0; index < resolved.clips.length; index += 1) {
        const clipId = String(resolved.clips[index]!.id);
        if (seenClips.has(clipId)) {
            pushDiagnostic(
                diagnostics,
                'animation.controller.clip.duplicate',
                `Duplicate clip '${clipId}'`,
                `controller.clips[${index}].id`
            );
        }
        seenClips.add(clipId);
    }

    const seenParameters = new Set<string>();
    for (let index = 0; index < (resolved.parameters?.length ?? 0); index += 1) {
        const parameter = resolved.parameters![index]!;
        if (seenParameters.has(parameter.name)) {
            pushDiagnostic(
                diagnostics,
                'animation.controller.parameter.duplicate',
                `Duplicate parameter '${parameter.name}'`,
                `controller.parameters[${index}].name`
            );
        }
        seenParameters.add(parameter.name);
    }

    if (resolved.layers.length === 0) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.layers.empty',
            'Controllers require at least one layer',
            'controller.layers'
        );
    }
    const seenLayers = new Set<string>();
    for (let index = 0; index < resolved.layers.length; index += 1) {
        const layer = resolved.layers[index]!;
        if (seenLayers.has(String(layer.id))) {
            pushDiagnostic(
                diagnostics,
                'animation.controller.layer.duplicate',
                `Duplicate layer '${layer.id}'`,
                `controller.layers[${index}].id`
            );
        }
        seenLayers.add(String(layer.id));

        diagnostics.push(
            ...validateAnimationLayerDefinition(layer, {
                knownClipIds,
                knownParameters,
                knownBones,
            }).map((diagnostic) =>
                Object.freeze({
                    code: diagnostic.code,
                    message: diagnostic.message,
                    path: diagnostic.path.replace(/^layer\./, `controller.layers[${index}].`),
                })
            )
        );
    }

    if (
        resolved.rootMotion &&
        knownBones.includes(resolved.rootMotion.bone) === false
    ) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.rootMotion.bone.unknown',
            `Unknown root motion bone '${resolved.rootMotion.bone}'`,
            'controller.rootMotion.bone'
        );
    }

    return Object.freeze(diagnostics);
};

export const AnimationControllerGraph = Object.freeze({
    transition: createAnimationTransition,
    state: createAnimationState,
    machine: createAnimationStateMachine,
    ikLayer: createAnimationIkLayer,
    layer: createAnimationLayer,
    controller: createAnimationController,
    buildTransition: buildAnimationTransitionDefinition,
    buildState: buildAnimationStateDefinition,
    buildMachine: buildAnimationStateMachineDefinition,
    buildIkLayer: buildAnimationIkLayerDefinition,
    buildLayer: buildAnimationLayerDefinition,
    buildController: buildAnimationControllerDefinition,
    validateMachine: validateAnimationStateMachineDefinition,
    validateLayer: validateAnimationLayerDefinition,
    validateController: validateAnimationControllerDefinition,
});