import { World, Transform } from '@axrone/ecs-runtime';
import { describe, expect, it, vi } from 'vitest';
import {
    bindAnimationStreamingBridge,
    createFetchAnimationStreamingResolver,
} from '../animation-streaming-bridge';
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
        world,
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

    it('emits animation notify events and exposes controller profile debug info', () => {
        const harness = createPrefabHarness();
        const prefab = createAnimatedRigPrefab({
            clips: [
                {
                    id: 'Attack',
                    duration: 1,
                    events: [
                        {
                            id: 'swing',
                            name: 'attack:swing',
                            time: 0.5,
                            payload: { damage: 18 },
                            tags: ['combat'],
                        },
                    ],
                    tracks: [
                        {
                            targetNodeId: 'node/1',
                            path: 'translation',
                            times: [0, 1],
                            values: [1, 0, 0, 2, 0, 0],
                        },
                    ],
                },
            ],
            clipId: 'Attack',
            playOnStart: true,
            playing: true,
            loop: true,
            speed: 1,
            time: 0,
        });
        const received: Record<string, unknown>[] = [];
        const unsubscribe = harness.world.on('animation:notify', (event) => {
            received.push(event as Record<string, unknown>);
        });

        const actors = harness.actors.instantiatePrefab(prefab);
        const root = actors.find((actor) => actor.name === 'Rig Root');
        const animator = root?.getComponent(Animator) ?? null;

        harness.lifecycle.update(750);

        expect(received).toEqual([
            expect.objectContaining({
                clipId: 'Attack',
                layerId: 'base',
                stateId: 'Attack',
                name: 'attack:swing',
                id: 'swing',
                payload: { damage: 18 },
                tags: ['combat'],
            }),
        ]);
        expect(animator?.getDebugInfo()).toEqual(
            expect.objectContaining({
                clipId: 'Attack',
                profile: expect.objectContaining({
                    emittedEventCount: 1,
                }),
                pendingEvents: [
                    expect.objectContaining({
                        clipId: 'Attack',
                        name: 'attack:swing',
                    }),
                ],
            })
        );

        unsubscribe();
    });

    it('requests streamed animation chunks and blocks playback until the active chunk is loaded', () => {
        const harness = createPrefabHarness();
        const prefab = createAnimatedRigPrefab({
            clips: [
                {
                    id: 'Walk',
                    duration: 1,
                    streaming: {
                        mode: 'streamed',
                        sourceUri: 'clips/walk.anim',
                        chunkDuration: 1,
                        preloadWindow: 0.25,
                    },
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
            clipId: 'Walk',
            playOnStart: true,
            playing: true,
            loop: false,
            speed: 1,
            time: 0,
        });
        const received: Record<string, unknown>[] = [];
        const unsubscribe = harness.world.on('animation:streaming-request', (event) => {
            received.push(event as Record<string, unknown>);
        });

        const actors = harness.actors.instantiatePrefab(prefab);
        const root = actors.find((actor) => actor.name === 'Rig Root');
        const hip = actors.find((actor) => actor.name === 'Hip');
        const animator = root?.getComponent(Animator) ?? null;

        harness.lifecycle.update(16);

        expect(received).toEqual([
            expect.objectContaining({
                clipId: 'Walk',
                chunkId: 'Walk:virtual:0',
                reason: 'active',
            }),
        ]);
        expect(hip?.requireComponent(Transform).position.x).toBeCloseTo(1, 5);
        expect(animator?.getDebugInfo()).toEqual(
            expect.objectContaining({
                streaming: expect.objectContaining({
                    ready: false,
                }),
                pendingStreamingRequests: [
                    expect.objectContaining({
                        clipId: 'Walk',
                    }),
                ],
            })
        );

        animator?.markStreamingChunkLoaded('Walk', 'Walk:virtual:0');
        harness.lifecycle.update(500);

        expect(hip?.requireComponent(Transform).position.x).toBeCloseTo(2, 5);

        unsubscribe();
    });

    it('bridges streamed animation requests through async chunk resolvers', async () => {
        const harness = createPrefabHarness();
        const loaded: Record<string, unknown>[] = [];
        const received: Record<string, unknown>[] = [];
        const unsubscribe = harness.world.on('animation:streaming-loaded', (event) => {
            received.push(event as Record<string, unknown>);
        });
        const bridge = bindAnimationStreamingBridge(harness.world, {
            resolver: async (request) => ({
                bytes: new Uint8Array([1, 2, 3, 4]),
                mimeType: request.mimeType ?? 'application/octet-stream',
            }),
            onChunkLoaded: async (chunk) => {
                loaded.push({
                    clipId: chunk.request.clipId,
                    chunkId: chunk.request.chunkId,
                    byteLength: chunk.bytes.byteLength,
                });
            },
        });
        const prefab = createAnimatedRigPrefab({
            clips: [
                {
                    id: 'Walk',
                    duration: 1,
                    streaming: {
                        mode: 'streamed',
                        sourceUri: 'clips/walk.anim',
                        chunkDuration: 1,
                        preloadWindow: 0.25,
                    },
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
            clipId: 'Walk',
            playOnStart: true,
            playing: true,
            loop: false,
            speed: 1,
            time: 0,
        });

        const actors = harness.actors.instantiatePrefab(prefab);
        const hip = actors.find((actor) => actor.name === 'Hip');

        harness.lifecycle.update(16);
        await bridge.waitForIdle();
        harness.lifecycle.update(500);

        expect(loaded).toEqual([
            {
                clipId: 'Walk',
                chunkId: 'Walk:virtual:0',
                byteLength: 4,
            },
        ]);
        expect(received).toEqual([
            expect.objectContaining({
                clipId: 'Walk',
                chunkId: 'Walk:virtual:0',
                byteLength: 4,
            }),
        ]);
        expect(hip?.requireComponent(Transform).position.x).toBeCloseTo(2, 5);

        bridge.dispose();
        unsubscribe();
    });

    it('supports fetch-backed animation chunk loading with byte-range catalogs', async () => {
        const harness = createPrefabHarness();
        const loadedBytes: Uint8Array[] = [];
        const fetch = vi.fn(async () => ({
            ok: true,
            status: 200,
            headers: {
                get(name: string) {
                    return name.toLowerCase() === 'content-type'
                        ? 'application/octet-stream'
                        : null;
                },
            },
            async arrayBuffer() {
                return new Uint8Array([10, 20, 30, 40, 50, 60]).buffer;
            },
        }));
        const bridge = bindAnimationStreamingBridge(harness.world, {
            resolver: createFetchAnimationStreamingResolver({ fetch }),
            onChunkLoaded: (chunk) => {
                loadedBytes.push(chunk.bytes);
            },
        });
        const prefab = createAnimatedRigPrefab({
            clips: [
                {
                    id: 'Walk',
                    duration: 1,
                    streaming: {
                        mode: 'streamed',
                        sourceUri: 'https://cdn.local/clips/walk.anim',
                        preloadWindow: 0.25,
                        catalog: {
                            id: 'walk-catalog',
                            chunks: [
                                {
                                    id: 'walk:chunk:0',
                                    uri: 'https://cdn.local/clips/walk.anim',
                                    startTime: 0,
                                    endTime: 1,
                                    byteOffset: 2,
                                    byteLength: 3,
                                },
                            ],
                        },
                    },
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
            clipId: 'Walk',
            playOnStart: true,
            playing: true,
            loop: false,
            speed: 1,
            time: 0,
        });

        const actors = harness.actors.instantiatePrefab(prefab);
        const hip = actors.find((actor) => actor.name === 'Hip');

        harness.lifecycle.update(16);
        await bridge.waitForIdle();
        harness.lifecycle.update(500);

        expect(fetch).toHaveBeenCalledWith(
            'https://cdn.local/clips/walk.anim',
            expect.objectContaining({
                headers: expect.objectContaining({
                    Range: 'bytes=2-4',
                }),
            })
        );
        expect(loadedBytes).toEqual([new Uint8Array([30, 40, 50])]);
        expect(hip?.requireComponent(Transform).position.x).toBeCloseTo(2, 5);

        bridge.dispose();
    });
});