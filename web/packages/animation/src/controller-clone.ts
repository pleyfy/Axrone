import { assertNever } from './errors';
import { spreadIfFinite, spreadIfNonEmptyString } from './internal';
import { tuple3, tuple4 } from '@axrone/utility';
import type {
    AnimationConditionDefinition,
    AnimationControllerDefinition,
    AnimationParameterDefinition,
    AnimationRigDefinition,
    AnimationRootMotionDefinition,
    AnimationStateBehaviourActionDefinition,
    AnimationStateBehaviourDefinition,
} from './types';

export const cloneCondition = (condition: AnimationConditionDefinition): AnimationConditionDefinition => {
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
            return assertNever(condition, 'Unsupported transition condition kind');
    }
};

export const cloneRigDefinition = (rig: AnimationRigDefinition): AnimationRigDefinition =>
    Object.freeze({
        ...(typeof rig.id === 'string' ? { id: rig.id } : {}),
        bones: Object.freeze(
            rig.bones.map((bone) =>
                Object.freeze({
                    name: bone.name,
                    ...(bone.parent !== undefined ? { parent: bone.parent } : {}),
                    ...(bone.translation
                        ? { translation: tuple3(bone.translation[0], bone.translation[1], bone.translation[2]) }
                        : {}),
                    ...(bone.rotation
                        ? {
                              rotation: tuple4(
                                  bone.rotation[0],
                                  bone.rotation[1],
                                  bone.rotation[2],
                                  bone.rotation[3]
                              ),
                          }
                        : {}),
                    ...(bone.scale ? { scale: tuple3(bone.scale[0], bone.scale[1], bone.scale[2]) } : {}),
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

export const cloneParameterDefinition = (
    parameter: AnimationParameterDefinition
): AnimationParameterDefinition =>
    Object.freeze({
        name: parameter.name,
        kind: parameter.kind,
        ...(parameter.defaultValue !== undefined ? { defaultValue: parameter.defaultValue } : {}),
    });

export const cloneBehaviourAction = (
    action: AnimationStateBehaviourActionDefinition
): AnimationStateBehaviourActionDefinition => {
    switch (action.kind) {
        case 'writeParameter':
            return Object.freeze({
                kind: 'writeParameter',
                parameter: action.parameter,
                value: action.value,
            });
        case 'pulseTrigger':
            return Object.freeze({ kind: 'pulseTrigger', parameter: action.parameter });
        case 'emitSignal':
            return Object.freeze({
                kind: 'emitSignal',
                signal: action.signal,
                ...(action.payload ? { payload: Object.freeze({ ...action.payload }) } : {}),
            });
        default: {
            // An action outside the closed vocabulary must survive cloning: validation
            // reports it as `...behaviour.action.unsupported` and compilation rejects it.
            // Throwing here would hide every diagnostic behind an exception.
            const unknown = { ...(action as unknown as Record<string, unknown>) };
            return Object.freeze(unknown) as unknown as AnimationStateBehaviourActionDefinition;
        }
    }
};

export const cloneStateBehaviour = (
    behaviour: AnimationStateBehaviourDefinition
): AnimationStateBehaviourDefinition =>
    Object.freeze({
        ...(typeof behaviour.id === 'string' ? { id: behaviour.id } : {}),
        phase: behaviour.phase,
        actions: Object.freeze((behaviour.actions ?? []).map(cloneBehaviourAction)),
        ...(behaviour.conditionMatch !== undefined ? { conditionMatch: behaviour.conditionMatch } : {}),
        ...(behaviour.conditions
            ? { conditions: Object.freeze(behaviour.conditions.map(cloneCondition)) }
            : {}),
        ...(behaviour.intervalSeconds !== undefined ? { intervalSeconds: behaviour.intervalSeconds } : {}),
    });

export const cloneRootMotionDefinition = (
    rootMotion: AnimationRootMotionDefinition
): AnimationRootMotionDefinition =>
    Object.freeze({
        bone: rootMotion.bone,
        ...(typeof rootMotion.consume === 'boolean' ? { consume: rootMotion.consume } : {}),
        ...(rootMotion.projectTranslationAxes
            ? {
                  projectTranslationAxes: tuple3(
                      rootMotion.projectTranslationAxes[0],
                      rootMotion.projectTranslationAxes[1],
                      rootMotion.projectTranslationAxes[2]
                  ),
              }
            : {}),
        ...(typeof rootMotion.extractRotation === 'boolean'
            ? { extractRotation: rootMotion.extractRotation }
            : {}),
    });

export const cloneClipDefinition = (
    clip: AnimationControllerDefinition['clips'][number]
): AnimationControllerDefinition['clips'][number] =>
    Object.freeze({
        id: clip.id,
        ...spreadIfFinite('duration', clip.duration),
        tracks: Object.freeze(
            clip.tracks.map((track) =>
                Object.freeze({
                    target: track.target,
                    path: track.path,
                    ...spreadIfNonEmptyString('interpolation', track.interpolation),
                    times: track.times instanceof Float32Array ? new Float32Array(track.times) : [...track.times],
                    values:
                        track.values instanceof Float32Array
                            ? new Float32Array(track.values)
                            : [...track.values],
                    ...spreadIfFinite('keyframeCount', track.keyframeCount),
                    ...spreadIfFinite('sampleStride', track.sampleStride),
                    ...spreadIfFinite('valueComponentCount', track.valueComponentCount),
                })
            )
        ),
        ...(clip.events
            ? {
                  events: Object.freeze(
                      clip.events.map((event) =>
                          Object.freeze({
                              ...spreadIfNonEmptyString('id', event.id),
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
                                        lockTranslationAxes: tuple3(
                                            contact.lockTranslationAxes[0],
                                            contact.lockTranslationAxes[1],
                                            contact.lockTranslationAxes[2]
                                        ),
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
                                        trajectoryPosition: tuple3(
                                            feature.trajectoryPosition[0],
                                            feature.trajectoryPosition[1],
                                            feature.trajectoryPosition[2]
                                        ),
                                    }
                                  : {}),
                              ...(feature.facingDirection
                                  ? {
                                        facingDirection: tuple3(
                                            feature.facingDirection[0],
                                            feature.facingDirection[1],
                                            feature.facingDirection[2]
                                        ),
                                    }
                                  : {}),
                              ...(feature.tags ? { tags: Object.freeze([...feature.tags]) } : {}),
                              ...spreadIfFinite('costBias', feature.costBias),
                          })
                      )
                  ),
              }
            : {}),
        ...(clip.compression ? { compression: Object.freeze({ ...clip.compression }) } : {}),
        ...(clip.streaming ? { streaming: Object.freeze({ ...clip.streaming }) } : {}),
    });
