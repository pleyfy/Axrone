import { World, Transform } from '@axrone/ecs-runtime';
import { describe, expect, it } from 'vitest';
import { SceneActorLifecycleRunner } from '../actor-lifecycle-runner';
import { SceneActorRuntime } from '../scene-actor-runtime';
import { createSceneRegistry } from '../scene-registry';
import { encodeSceneValue } from '../serialization';
import type { ScenePrefabDefinition } from '../types';
import { Animator } from '../components/animator';
import { MeshRenderer } from '../components/mesh-renderer';
import { SceneComponentCatalog } from '../component-catalog';

const createPrefabComponent = (type: string, data: unknown) => ({
    type,
    data: encodeSceneValue(data),
});

const createAnimatedRigPrefab = (
    animatorData: Record<string, unknown>
): ScenePrefabDefinition => ({
    id: 'prefab/animated-rig',
    actors: [
        {
            nodeId: 'node/0',
            parentNodeId: null,
            name: 'Rig Root',
            layer: 0,
            tag: 'default',
            active: true,
            persistent: false,
            pooled: false,
            components: [
                createPrefabComponent('Transform', {
                    position: [0, 0, 0],
                    rotation: [0, 0, 0, 1],
                    scale: [1, 1, 1],
                }),
                createPrefabComponent('Animator', animatorData),
            ],
        },
        {
            nodeId: 'node/1',
            parentNodeId: 'node/0',
            name: 'Hip',
            layer: 0,
            tag: 'default',
            active: true,
            persistent: false,
            pooled: false,
            components: [
                createPrefabComponent('Transform', {
                    position: [1, 0, 0],
                    rotation: [0, 0, 0, 1],
                    scale: [1, 1, 1],
                }),
            ],
        },
        {
            nodeId: 'node/2',
            parentNodeId: 'node/1',
            name: 'Tip',
            layer: 0,
            tag: 'default',
            active: true,
            persistent: false,
            pooled: false,
            components: [
                createPrefabComponent('Transform', {
                    position: [1, 0, 0],
                    rotation: [0, 0, 0, 1],
                    scale: [1, 1, 1],
                }),
            ],
        },
        {
            nodeId: 'node/3',
            parentNodeId: 'node/0',
            name: 'Skinned Mesh',
            layer: 0,
            tag: 'default',
            active: true,
            persistent: false,
            pooled: false,
            components: [
                createPrefabComponent('Transform', {
                    position: [0, 0, 0],
                    rotation: [0, 0, 0, 1],
                    scale: [1, 1, 1],
                }),
                createPrefabComponent('MeshRenderer', {
                    meshId: 'mesh/test',
                    materialId: 'material/test',
                    visible: true,
                    renderOrder: 0,
                    passId: 'main',
                    receiveLighting: true,
                    uniformOverrides: {},
                    skin: {
                        jointNodeIds: ['node/1', 'node/2'],
                        inverseBindMatrices: new Float32Array([
                            1, 0, 0, 0,
                            0, 1, 0, 0,
                            0, 0, 1, 0,
                            0, 0, 0, 1,
                            1, 0, 0, 0,
                            0, 1, 0, 0,
                            0, 0, 1, 0,
                            0, 0, 0, 1,
                        ]),
                    },
                }),
            ],
        },
    ],
});

const createPrefabHarness = () => {
    const registry = createSceneRegistry();
    const world = new World(registry);
    const actors = new SceneActorRuntime({
        world,
        componentCatalog: new SceneComponentCatalog(registry),
    });
    const lifecycle = new SceneActorLifecycleRunner({
        getActors: () => world.getAllActors(),
    });

    return {
        actors,
        lifecycle,
    };
};

describe('scene-runtime prefab animation integration', () => {
    it('instantiates prefab animators with custom parameters, layers, and root motion', () => {
        const harness = createPrefabHarness();
        const prefab = createAnimatedRigPrefab({
            clips: [
                {
                    id: 'Idle',
                    duration: 1,
                    tracks: [
                        {
                            targetNodeId: 'node/1',
                            path: 'translation',
                            times: [0, 1],
                            values: [1, 0, 0, 1, 0, 0],
                        },
                    ],
                },
                {
                    id: 'Run',
                    duration: 1,
                    tracks: [
                        {
                            targetNodeId: 'node/1',
                            path: 'translation',
                            times: [0, 1],
                            values: [1, 0, 0, 3, 0, 0],
                        },
                    ],
                },
            ],
            parameters: [{ name: 'speed', kind: 'float', defaultValue: 0 }],
            layers: [
                {
                    id: 'base',
                    weight: 1,
                    mode: 'override',
                    stateMachine: {
                        entryState: 'locomotion',
                        states: [
                            {
                                id: 'locomotion',
                                motion: {
                                    kind: 'blend1d',
                                    parameter: 'speed',
                                    children: [
                                        {
                                            threshold: 0,
                                            motion: { kind: 'clip', clipId: 'Idle' },
                                        },
                                        {
                                            threshold: 1,
                                            motion: { kind: 'clip', clipId: 'Run' },
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                },
            ],
            rootMotion: {
                bone: 'node/1',
                consume: true,
                projectTranslationAxes: [true, false, false],
            },
            clipId: 'Idle',
            playOnStart: true,
            playing: true,
            loop: true,
            speed: 1,
            time: 0,
        });

        const firstInstance = harness.actors.instantiatePrefab(prefab, { namePrefix: 'A ' });
        const secondInstance = harness.actors.instantiatePrefab(prefab, { namePrefix: 'B ' });

        const firstRoot = firstInstance.find((actor) => actor.name === 'A Rig Root');
        const firstHip = firstInstance.find((actor) => actor.name === 'A Hip');
        const firstMesh = firstInstance.find((actor) => actor.name === 'A Skinned Mesh');
        const secondRoot = secondInstance.find((actor) => actor.name === 'B Rig Root');
        const secondHip = secondInstance.find((actor) => actor.name === 'B Hip');

        const firstAnimator = firstRoot?.getComponent(Animator) ?? null;
        const secondAnimator = secondRoot?.getComponent(Animator) ?? null;

        firstAnimator?.setFloat('speed', 0.5);
        secondAnimator?.setFloat('speed', 0);

        harness.lifecycle.update(500);

        expect(firstRoot?.requireComponent(Transform).position.x).toBeCloseTo(0.5, 5);
        expect(secondRoot?.requireComponent(Transform).position.x).toBeCloseTo(0, 5);
        expect(firstHip?.requireComponent(Transform).position.x).toBeCloseTo(1, 5);
        expect(secondHip?.requireComponent(Transform).position.x).toBeCloseTo(1, 5);
        expect(firstMesh?.getComponent(MeshRenderer)?.getSkinJointMatrixPalette()).not.toBeNull();
        expect(firstMesh?.getComponent(MeshRenderer)?.skinJointCount).toBe(2);
    });

    it('applies prefab-authored IK layer metadata through instantiated animators', () => {
        const harness = createPrefabHarness();
        const prefab = createAnimatedRigPrefab({
            clips: [
                {
                    id: 'Pose',
                    duration: 1,
                    tracks: [
                        {
                            targetNodeId: 'node/2',
                            path: 'translation',
                            times: [0, 1],
                            values: [1, 0, 0, 1, 0, 0],
                        },
                    ],
                },
            ],
            layers: [
                {
                    id: 'base',
                    weight: 1,
                    mode: 'override',
                    stateMachine: {
                        entryState: 'pose',
                        states: [
                            {
                                id: 'pose',
                                motion: { kind: 'clip', clipId: 'Pose' },
                                loop: true,
                            },
                        ],
                    },
                    ikLayers: [
                        {
                            id: 'reach',
                            jobs: [
                                {
                                    id: 'aim',
                                    solver: 'ccd',
                                    rootBone: 'node/0',
                                    tipBone: 'node/2',
                                    targetPosition: [1, 1, 0],
                                    precision: 1e-4,
                                    maxIterations: 24,
                                },
                            ],
                        },
                    ],
                },
            ],
            clipId: 'Pose',
            playOnStart: true,
            playing: true,
            loop: true,
            speed: 1,
            time: 0,
        });

        const actors = harness.actors.instantiatePrefab(prefab);
        const tip = actors.find((actor) => actor.name === 'Tip');

        harness.lifecycle.update(16);

        expect(tip?.requireComponent(Transform).worldPosition.x).toBeCloseTo(1, 3);
        expect(tip?.requireComponent(Transform).worldPosition.y).toBeCloseTo(1, 3);
        expect(tip?.requireComponent(Transform).worldPosition.z).toBeCloseTo(0, 3);
    });
});