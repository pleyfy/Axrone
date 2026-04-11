import { Transform } from '@axrone/ecs-runtime';
import {
    Camera,
    MeshRenderer,
    Scene,
    createUnlitColorShaderDefinition,
} from '@axrone/scene-3d';
import { Mat4, Quat, Vec3 } from '@axrone/numeric';
import * as THREE from 'three';

type WorkloadType = 'draw-call' | 'triangle' | 'mixed';
type WorkloadKind = 'box' | 'sphere';
type ComparisonMode = 'no-culling' | 'three-culling';

type WorkloadDescriptor = {
    readonly kind: WorkloadKind;
    readonly basePosition: Vec3;
    readonly scale: number;
    readonly color: readonly [number, number, number];
    readonly spin: Vec3;
    readonly bobAmplitude: number;
    readonly bobSpeed: number;
    readonly bobPhase: number;
};

type EngineStats = {
    frameCount: number;
    readonly frameTimes: number[];
    drawCalls: number;
    triangles: number;
    setupTimeMs: number;
};

type BenchmarkRuntime = {
    dispose(): void;
    pause(): void;
    resume(): void;
    resize(): void;
    syncMetrics(): void;
    readonly stats: EngineStats;
};

type BenchmarkSnapshot = {
    generatedAt: string;
    status: 'idle' | 'running';
    configuration: {
        workload: WorkloadType;
        workloadLabel: string;
        comparisonMode: ComparisonMode;
        comparisonModeLabel: string;
        objectCount: number;
        durationMs: number;
    };
    elapsedMs: number;
    metricSources: {
        axroneDrawCalls: 'scene.renderStats.drawCalls';
        axroneTriangles: 'scene.renderStats.trianglesSubmitted';
        threeDrawCalls: 'renderer.info.render.calls';
        threeTriangles: 'renderer.info.render.triangles';
    };
    engines: {
        axrone: {
            averageFps: number;
            p95FrameTimeMs: number;
            frameCount: number;
            drawCalls: number;
            triangles: number;
            setupTimeMs: number;
        };
        three: {
            averageFps: number;
            p95FrameTimeMs: number;
            frameCount: number;
            drawCalls: number;
            triangles: number;
            setupTimeMs: number;
        };
    };
    winners: {
        fps: string;
        p95FrameTime: string;
        drawCalls: string;
        triangles: string;
    };
};

const byId = <T extends HTMLElement>(id: string): T => {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Missing benchmark element: ${id}`);
    }
    return element as T;
};

const ui = {
    workload: byId<HTMLSelectElement>('workload'),
    workloadLabel: byId<HTMLElement>('workload-label'),
    comparisonMode: byId<HTMLSelectElement>('comparison-mode'),
    comparisonModeValue: byId<HTMLElement>('comparison-mode-value'),
    objectCount: byId<HTMLInputElement>('object-count'),
    objectCountValue: byId<HTMLElement>('object-count-value'),
    duration: byId<HTMLInputElement>('duration'),
    durationValue: byId<HTMLElement>('duration-value'),
    startButton: byId<HTMLButtonElement>('start-button'),
    stopButton: byId<HTMLButtonElement>('stop-button'),
    resetButton: byId<HTMLButtonElement>('reset-button'),
    copyJsonButton: byId<HTMLButtonElement>('copy-json-button'),
    runStatus: byId<HTMLElement>('run-status'),
    elapsedPill: byId<HTMLElement>('elapsed-pill'),
    statusText: byId<HTMLElement>('status-text'),
    errorText: byId<HTMLElement>('error-text'),
    summaryTitle: byId<HTMLElement>('summary-title'),
    summaryCopy: byId<HTMLElement>('summary-copy'),
    detailObjects: byId<HTMLElement>('detail-objects'),
    detailProfile: byId<HTMLElement>('detail-profile'),
    axroneFps: byId<HTMLElement>('axrone-fps'),
    threeFps: byId<HTMLElement>('three-fps'),
    axroneP95: byId<HTMLElement>('axrone-p95'),
    threeP95: byId<HTMLElement>('three-p95'),
    axroneDraws: byId<HTMLElement>('axrone-draws'),
    threeDraws: byId<HTMLElement>('three-draws'),
    axroneTris: byId<HTMLElement>('axrone-tris'),
    threeTris: byId<HTMLElement>('three-tris'),
    axroneSetup: byId<HTMLElement>('axrone-setup'),
    threeSetup: byId<HTMLElement>('three-setup'),
    fpsWinner: byId<HTMLElement>('fps-winner'),
    p95Winner: byId<HTMLElement>('p95-winner'),
    drawWinner: byId<HTMLElement>('draw-winner'),
    triWinner: byId<HTMLElement>('tri-winner'),
    axroneCanvas: byId<HTMLCanvasElement>('axrone-canvas'),
    threeCanvas: byId<HTMLCanvasElement>('three-canvas'),
    axroneShell: byId<HTMLElement>('axrone-shell'),
    threeShell: byId<HTMLElement>('three-shell'),
};

const workloadLabels: Record<WorkloadType, string> = {
    'draw-call': 'One draw per object, low-poly boxes.',
    triangle: 'Higher vertex pressure with sphere-heavy geometry.',
    mixed: 'Half boxes, half spheres for mixed scene behavior.',
};

const workloadTitles: Record<WorkloadType, string> = {
    'draw-call': 'Draw Call Stress',
    triangle: 'Triangle Stress',
    mixed: 'Mixed Scene',
};

const comparisonModeLabels: Record<ComparisonMode, string> = {
    'no-culling': 'Both engines submit the full visible set.',
    'three-culling': 'Three.js frustum culling enabled, Axrone current renderer path unchanged.',
};

const comparisonModeTitles: Record<ComparisonMode, string> = {
    'no-culling': 'No Culling Baseline',
    'three-culling': 'Three Culling Enabled',
};

const state = {
    running: false,
    durationMs: Number(ui.duration.value) * 1000,
    objectCount: Number(ui.objectCount.value),
    workload: ui.workload.value as WorkloadType,
    comparisonMode: ui.comparisonMode.value as ComparisonMode,
    startedAt: 0,
    monitorRaf: 0,
    lastRunConfiguration: null as
        | {
              workload: WorkloadType;
              comparisonMode: ComparisonMode;
              objectCount: number;
              durationMs: number;
          }
        | null,
    axrone: null as BenchmarkRuntime | null,
    three: null as BenchmarkRuntime | null,
};

const mean = (values: readonly number[]): number =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const percentile = (values: readonly number[], ratio: number): number => {
    if (values.length === 0) {
        return 0;
    }

    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
    return sorted[index];
};

const formatNumber = (value: number): string => value.toLocaleString('en-US');
const round = (value: number, digits = 2): number => Number(value.toFixed(digits));

const colorFromIndex = (index: number, count: number): readonly [number, number, number] => {
    const hue = (index / Math.max(1, count)) * 0.82;
    const saturation = 0.66;
    const lightness = 0.58;
    const q =
        lightness < 0.5
            ? lightness * (1 + saturation)
            : lightness + saturation - lightness * saturation;
    const p = 2 * lightness - q;

    const toRgb = (value: number) => {
        let x = value;
        if (x < 0) x += 1;
        if (x > 1) x -= 1;
        if (x < 1 / 6) return p + (q - p) * 6 * x;
        if (x < 1 / 2) return q;
        if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
        return p;
    };

    return [toRgb(hue + 1 / 3), toRgb(hue), toRgb(hue - 1 / 3)];
};

const createDescriptors = (count: number, workload: WorkloadType): readonly WorkloadDescriptor[] => {
    const columns = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / columns);
    const spacing = workload === 'triangle' ? 2.45 : 2.1;
    const descriptors: WorkloadDescriptor[] = [];

    for (let index = 0; index < count; index += 1) {
        const row = Math.floor(index / columns);
        const col = index % columns;
        const layer = index % 6;
        const centeredX = (col - columns * 0.5) * spacing;
        const centeredZ = (row - rows * 0.5) * spacing;
        const wave = Math.sin(index * 0.61) * 0.85;
        const height = layer * 0.95 + wave;
        const kind =
            workload === 'draw-call'
                ? 'box'
                : workload === 'triangle'
                  ? 'sphere'
                  : index % 2 === 0
                    ? 'box'
                    : 'sphere';

        descriptors.push({
            kind,
            basePosition: new Vec3(centeredX, height, centeredZ),
            scale: kind === 'sphere' ? 0.72 : 0.84,
            color: colorFromIndex(index, count),
            spin: new Vec3(
                0.00055 + (index % 7) * 0.00003,
                0.00082 + (index % 11) * 0.00002,
                0.00037 + (index % 5) * 0.000025
            ),
            bobAmplitude: 0.16 + (index % 5) * 0.025,
            bobSpeed: 0.001 + (index % 9) * 0.00008,
            bobPhase: index * 0.37,
        });
    }

    return descriptors;
};

const computeSceneOrbit = (
    descriptors: readonly WorkloadDescriptor[]
): { readonly target: Vec3; readonly radius: number; readonly height: number } => {
    if (descriptors.length === 0) {
        return {
            target: new Vec3(0, 0, 0),
            radius: 28,
            height: 18,
        };
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

    for (const descriptor of descriptors) {
        const halfExtent = descriptor.scale;
        minX = Math.min(minX, descriptor.basePosition.x - halfExtent);
        minY = Math.min(minY, descriptor.basePosition.y - descriptor.bobAmplitude - halfExtent);
        minZ = Math.min(minZ, descriptor.basePosition.z - halfExtent);
        maxX = Math.max(maxX, descriptor.basePosition.x + halfExtent);
        maxY = Math.max(maxY, descriptor.basePosition.y + descriptor.bobAmplitude + halfExtent);
        maxZ = Math.max(maxZ, descriptor.basePosition.z + halfExtent);
    }

    const extentX = maxX - minX;
    const extentY = maxY - minY;
    const extentZ = maxZ - minZ;
    const target = new Vec3((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5);
    const horizontalSpan = Math.max(extentX, extentZ);

    return {
        target,
        radius: Math.max(28, horizontalSpan * 0.9),
        height: Math.max(18, extentY * 1.75),
    };
};

const applyThreeStyleOrbitPose = (
    position: Readonly<Vec3>,
    target: Readonly<Vec3>,
    threeCamera: THREE.PerspectiveCamera,
    transform: Transform
): void => {
    threeCamera.position.set(position.x, position.y, position.z);
    threeCamera.lookAt(target.x, target.y, target.z);
    transform.position = new Vec3(position.x, position.y, position.z);
    transform.rotation = new Quat(
        threeCamera.quaternion.x,
        threeCamera.quaternion.y,
        threeCamera.quaternion.z,
        threeCamera.quaternion.w
    );
};

const resizeCanvas = (
    canvas: HTMLCanvasElement,
    host: HTMLElement,
    pixelRatio = Math.min(devicePixelRatio || 1, 2)
) => {
    const width = Math.max(1, Math.floor(host.clientWidth));
    const height = Math.max(1, Math.floor(host.clientHeight));
    canvas.width = Math.max(1, Math.floor(width * pixelRatio));
    canvas.height = Math.max(1, Math.floor(height * pixelRatio));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
};

const createAxroneRuntime = (
    canvas: HTMLCanvasElement,
    host: HTMLElement,
    descriptors: readonly WorkloadDescriptor[]
): BenchmarkRuntime => {
    resizeCanvas(canvas, host);

    const setupStartedAt = performance.now();
    const scene = new Scene({
        canvas,
        width: host.clientWidth,
        height: host.clientHeight,
        pixelRatio: Math.min(devicePixelRatio || 1, 2),
        worldConfig: {
            enableValidation: false,
        },
        autoStart: false,
        clearColor: [0.03, 0.06, 0.1, 1],
    });

    scene.registerShader(createUnlitColorShaderDefinition('benchmark/unlit-color'));
    scene.createMaterial({
        id: 'benchmark/material',
        shaderId: 'benchmark/unlit-color',
        uniforms: {
            u_Color: [1, 1, 1, 1],
        },
    });

    const boxMesh = scene.createBoxMesh('benchmark/box', 1, 1, 1);
    const sphereMesh = scene.createSphereMesh('benchmark/sphere', 0.65, 16);
    const cameraActor = scene.createCameraActor({ autoStart: false }, { primary: true, fieldOfView: 58 });
    const cameraComponent = cameraActor.requireComponent(Camera);
    const cameraTransform = cameraActor.requireComponent(Transform);
    const orbit = computeSceneOrbit(descriptors);
    const orbitCameraReference = new THREE.PerspectiveCamera(58, 1, 0.1, 1000);
    let currentCameraPosition = new Vec3(
        orbit.target.x + orbit.radius,
        orbit.target.y + orbit.height,
        orbit.target.z
    );

    cameraComponent.getViewMatrix = () =>
        Mat4.lookAt(currentCameraPosition, orbit.target, Vec3.UP, new Mat4());

    const renderables: { readonly transform: Transform; readonly descriptor: WorkloadDescriptor }[] = [];
    const sphereScale = new Vec3(0.72, 0.72, 0.72);
    const boxScale = new Vec3(0.84, 0.84, 0.84);

    scene.world.batchStructureChanges(() => {
        for (const descriptor of descriptors) {
            const actor = scene.createRenderableActor(
                { autoStart: false },
                {
                    meshId: descriptor.kind === 'sphere' ? sphereMesh.id : boxMesh.id,
                    materialId: 'benchmark/material',
                }
            );

            const transform = actor.requireComponent(Transform);
            transform.position = descriptor.basePosition;
            transform.scale = descriptor.kind === 'sphere' ? sphereScale : boxScale;

            const renderer = actor.getComponent(MeshRenderer);
            renderer?.setUniform('u_Color', [
                descriptor.color[0],
                descriptor.color[1],
                descriptor.color[2],
                1,
            ]);

            renderables.push({ transform, descriptor });
        }
    });

    const stats: EngineStats = {
        frameCount: 0,
        frameTimes: [],
        drawCalls: 0,
        triangles: 0,
        setupTimeMs: 0,
    };
    const syncMetrics = () => {
        const renderStats = scene.renderStats;
        stats.drawCalls = renderStats.drawCalls;
        stats.triangles = renderStats.trianglesSubmitted;
    };

    scene.addSystem(
        {
            id: 'benchmark/update',
            query: ['Transform'] as const,
            priority: 0,
            enabled: true,
            execute: (_entities, deltaTime) => {
                const elapsed = scene.loop.elapsed;
                currentCameraPosition = new Vec3(
                    orbit.target.x + Math.cos(elapsed * 0.00017) * orbit.radius,
                    orbit.target.y + orbit.height,
                    orbit.target.z + Math.sin(elapsed * 0.00017) * orbit.radius
                );
                applyThreeStyleOrbitPose(
                    currentCameraPosition,
                    orbit.target,
                    orbitCameraReference,
                    cameraTransform
                );

                for (const { transform, descriptor } of renderables) {
                    transform.position = new Vec3(
                        descriptor.basePosition.x,
                        descriptor.basePosition.y +
                            Math.sin(elapsed * descriptor.bobSpeed + descriptor.bobPhase) *
                                descriptor.bobAmplitude,
                        descriptor.basePosition.z
                    );
                    transform.rotation = Quat.fromEuler(
                        elapsed * descriptor.spin.x,
                        elapsed * descriptor.spin.y,
                        elapsed * descriptor.spin.z
                    );
                }

                if (deltaTime > 0) {
                    stats.frameTimes.push(deltaTime);
                }

                stats.frameCount += 1;
            },
        }
    );

    scene.renderNow();
    syncMetrics();
    stats.setupTimeMs = performance.now() - setupStartedAt;

    return {
        stats,
        syncMetrics,
        pause: () => {
            scene.pause();
        },
        resume: () => {
            scene.resume();
        },
        resize: () => {
            scene.resize(host.clientWidth, host.clientHeight, Math.min(devicePixelRatio || 1, 2));
            scene.renderNow();
            syncMetrics();
        },
        dispose: () => {
            scene.dispose();
        },
    };
};

const createThreeRuntime = (
    canvas: HTMLCanvasElement,
    host: HTMLElement,
    descriptors: readonly WorkloadDescriptor[],
    comparisonMode: ComparisonMode
): BenchmarkRuntime => {
    resizeCanvas(canvas, host);

    const stats: EngineStats = {
        frameCount: 0,
        frameTimes: [],
        drawCalls: 0,
        triangles: 0,
        setupTimeMs: 0,
    };
    const syncMetrics = () => {
        stats.drawCalls = renderer.info.render.calls;
        stats.triangles = renderer.info.render.triangles;
    };

    const setupStartedAt = performance.now();
    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: false,
        powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(host.clientWidth, host.clientHeight, false);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050b14);

    const camera = new THREE.PerspectiveCamera(
        58,
        host.clientWidth / Math.max(1, host.clientHeight),
        0.1,
        1000
    );
    scene.add(camera);

    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    const sphereGeometry = new THREE.SphereGeometry(0.65, 16, 16);
    const objects: { readonly mesh: THREE.Mesh; readonly descriptor: WorkloadDescriptor }[] = [];

    for (const descriptor of descriptors) {
        const material = new THREE.MeshBasicMaterial({
            color: new THREE.Color(...descriptor.color),
        });
        const mesh = new THREE.Mesh(
            descriptor.kind === 'sphere' ? sphereGeometry : boxGeometry,
            material
        );

        mesh.position.set(
            descriptor.basePosition.x,
            descriptor.basePosition.y,
            descriptor.basePosition.z
        );
        mesh.scale.setScalar(descriptor.scale);
        mesh.frustumCulled = comparisonMode === 'three-culling';
        scene.add(mesh);
        objects.push({ mesh, descriptor });
    }

    let rafId = 0;
    let previousFrameTime = 0;
    let paused = true;
    let logicalElapsed = 0;
    const orbit = computeSceneOrbit(descriptors);

    const frame = (timestamp: number) => {
        if (paused) {
            return;
        }

        if (previousFrameTime === 0) {
            previousFrameTime = timestamp;
        }

        const deltaTime = timestamp - previousFrameTime;
        previousFrameTime = timestamp;
        logicalElapsed += deltaTime;

        camera.position.set(
            orbit.target.x + Math.cos(logicalElapsed * 0.00017) * orbit.radius,
            orbit.target.y + orbit.height,
            orbit.target.z + Math.sin(logicalElapsed * 0.00017) * orbit.radius
        );
        camera.lookAt(orbit.target.x, orbit.target.y, orbit.target.z);

        for (const { mesh, descriptor } of objects) {
            mesh.position.y =
                descriptor.basePosition.y +
                Math.sin(logicalElapsed * descriptor.bobSpeed + descriptor.bobPhase) *
                    descriptor.bobAmplitude;
            mesh.rotation.set(
                logicalElapsed * descriptor.spin.x,
                logicalElapsed * descriptor.spin.y,
                logicalElapsed * descriptor.spin.z
            );
        }

        renderer.render(scene, camera);
        stats.frameCount += 1;
        if (deltaTime > 0) {
            stats.frameTimes.push(deltaTime);
        }
        syncMetrics();

        rafId = requestAnimationFrame(frame);
    };

    renderer.render(scene, camera);
    syncMetrics();
    stats.setupTimeMs = performance.now() - setupStartedAt;

    return {
        stats,
        syncMetrics,
        pause: () => {
            paused = true;
            if (rafId !== 0) {
                cancelAnimationFrame(rafId);
                rafId = 0;
            }
            previousFrameTime = 0;
        },
        resume: () => {
            if (!paused) {
                return;
            }
            paused = false;
            previousFrameTime = 0;
            rafId = requestAnimationFrame(frame);
        },
        resize: () => {
            renderer.setSize(host.clientWidth, host.clientHeight, false);
            camera.aspect = host.clientWidth / Math.max(1, host.clientHeight);
            camera.updateProjectionMatrix();
            renderer.render(scene, camera);
            syncMetrics();
        },
        dispose: () => {
            if (rafId !== 0) {
                cancelAnimationFrame(rafId);
            }
            for (const { mesh } of objects) {
                scene.remove(mesh);
                if (Array.isArray(mesh.material)) {
                    mesh.material.forEach((material) => material.dispose());
                } else {
                    mesh.material.dispose();
                }
            }
            boxGeometry.dispose();
            sphereGeometry.dispose();
            renderer.dispose();
        },
    };
};

const teardownRuntimes = () => {
    state.axrone?.dispose();
    state.three?.dispose();
    state.axrone = null;
    state.three = null;
};

const setIdleUi = () => {
    ui.runStatus.textContent = 'Idle';
    ui.runStatus.className = 'pill idle';
    ui.stopButton.disabled = true;
    ui.startButton.disabled = false;
};

const setRunningUi = () => {
    ui.runStatus.textContent = 'Running';
    ui.runStatus.className = 'pill running';
    ui.stopButton.disabled = false;
    ui.startButton.disabled = true;
};

const writeWinner = (
    element: HTMLElement,
    axroneValue: number,
    threeValue: number,
    higherIsBetter: boolean,
    unit: string
) => {
    if (axroneValue === 0 && threeValue === 0) {
        element.textContent = 'No result yet.';
        return;
    }

    if (Math.abs(axroneValue - threeValue) < 0.0001) {
        element.textContent = `Tie at ${axroneValue.toFixed(2)} ${unit}`.trim();
        return;
    }

    const axroneWins = higherIsBetter ? axroneValue > threeValue : axroneValue < threeValue;
    const delta = Math.abs(axroneValue - threeValue);
    element.textContent = axroneWins
        ? `Axrone leads by ${delta.toFixed(2)} ${unit}`.trim()
        : `Three.js leads by ${delta.toFixed(2)} ${unit}`.trim();
};

const refreshMetrics = () => {
    state.axrone?.syncMetrics();
    state.three?.syncMetrics();

    const axroneStats = state.axrone?.stats;
    const threeStats = state.three?.stats;

    const axroneAvgFrame = axroneStats ? mean(axroneStats.frameTimes) : 0;
    const threeAvgFrame = threeStats ? mean(threeStats.frameTimes) : 0;
    const axroneFps = axroneAvgFrame > 0 ? 1000 / axroneAvgFrame : 0;
    const threeFps = threeAvgFrame > 0 ? 1000 / threeAvgFrame : 0;
    const axroneP95 = axroneStats ? percentile(axroneStats.frameTimes, 0.95) : 0;
    const threeP95 = threeStats ? percentile(threeStats.frameTimes, 0.95) : 0;

    ui.axroneFps.textContent = axroneFps.toFixed(1);
    ui.threeFps.textContent = threeFps.toFixed(1);
    ui.axroneP95.textContent = axroneP95.toFixed(2);
    ui.threeP95.textContent = threeP95.toFixed(2);
    ui.axroneDraws.textContent = axroneStats ? formatNumber(axroneStats.drawCalls) : '0';
    ui.threeDraws.textContent = threeStats ? formatNumber(threeStats.drawCalls) : '0';
    ui.axroneTris.textContent = axroneStats ? formatNumber(axroneStats.triangles) : '0';
    ui.threeTris.textContent = threeStats ? formatNumber(threeStats.triangles) : '0';
    ui.axroneSetup.textContent = axroneStats ? `${axroneStats.setupTimeMs.toFixed(1)} ms` : '0 ms';
    ui.threeSetup.textContent = threeStats ? `${threeStats.setupTimeMs.toFixed(1)} ms` : '0 ms';

    writeWinner(ui.fpsWinner, axroneFps, threeFps, true, 'fps');
    writeWinner(ui.p95Winner, axroneP95, threeP95, false, 'ms');
    writeWinner(
        ui.drawWinner,
        axroneStats?.drawCalls ?? 0,
        threeStats?.drawCalls ?? 0,
        false,
        'draws'
    );
    writeWinner(
        ui.triWinner,
        axroneStats?.triangles ?? 0,
        threeStats?.triangles ?? 0,
        true,
        'tris'
    );
};

const computeEngineSummary = (stats: EngineStats | null | undefined) => {
    const avgFrame = stats ? mean(stats.frameTimes) : 0;
    const fps = avgFrame > 0 ? 1000 / avgFrame : 0;
    const p95 = stats ? percentile(stats.frameTimes, 0.95) : 0;

    return {
        averageFps: round(fps, 2),
        p95FrameTimeMs: round(p95, 2),
        frameCount: stats?.frameCount ?? 0,
        drawCalls: stats?.drawCalls ?? 0,
        triangles: stats?.triangles ?? 0,
        setupTimeMs: round(stats?.setupTimeMs ?? 0, 2),
    };
};

const getWinnerLabel = (
    axroneValue: number,
    threeValue: number,
    higherIsBetter: boolean
): 'axrone' | 'three' | 'tie' => {
    if (Math.abs(axroneValue - threeValue) < 0.0001) {
        return 'tie';
    }

    const axroneWins = higherIsBetter ? axroneValue > threeValue : axroneValue < threeValue;
    return axroneWins ? 'axrone' : 'three';
};

const createBenchmarkSnapshot = (): BenchmarkSnapshot => {
    state.axrone?.syncMetrics();
    state.three?.syncMetrics();

    const axrone = computeEngineSummary(state.axrone?.stats);
    const three = computeEngineSummary(state.three?.stats);
    const elapsedMs = state.running ? performance.now() - state.startedAt : 0;
    const configuration = state.lastRunConfiguration ?? {
        workload: state.workload,
        comparisonMode: state.comparisonMode,
        objectCount: state.objectCount,
        durationMs: state.durationMs,
    };

    return {
        generatedAt: new Date().toISOString(),
        status: state.running ? 'running' : 'idle',
        configuration: {
            workload: configuration.workload,
            workloadLabel: workloadTitles[configuration.workload],
            comparisonMode: configuration.comparisonMode,
            comparisonModeLabel: comparisonModeTitles[configuration.comparisonMode],
            objectCount: configuration.objectCount,
            durationMs: configuration.durationMs,
        },
        elapsedMs: round(elapsedMs, 2),
        metricSources: {
            axroneDrawCalls: 'scene.renderStats.drawCalls',
            axroneTriangles: 'scene.renderStats.trianglesSubmitted',
            threeDrawCalls: 'renderer.info.render.calls',
            threeTriangles: 'renderer.info.render.triangles',
        },
        engines: {
            axrone,
            three,
        },
        winners: {
            fps: getWinnerLabel(axrone.averageFps, three.averageFps, true),
            p95FrameTime: getWinnerLabel(axrone.p95FrameTimeMs, three.p95FrameTimeMs, false),
            drawCalls: getWinnerLabel(axrone.drawCalls, three.drawCalls, false),
            triangles: getWinnerLabel(axrone.triangles, three.triangles, true),
        },
    };
};

const copyText = async (value: string) => {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
};

const stopBenchmark = (reason: 'manual' | 'completed') => {
    if (!state.running) {
        return;
    }

    state.running = false;
    cancelAnimationFrame(state.monitorRaf);
    state.monitorRaf = 0;
    state.axrone?.pause();
    state.three?.pause();
    setIdleUi();
    refreshMetrics();

    ui.statusText.textContent =
        reason === 'completed'
            ? 'Benchmark completed. Results frozen for inspection.'
            : 'Benchmark stopped by user.';

    ui.summaryTitle.textContent =
        reason === 'completed' ? 'Benchmark completed' : 'Benchmark stopped';
    ui.summaryCopy.textContent =
        'Interpret the result as a workload-specific comparison. Draw-call heavy scenes and triangle-heavy scenes can favor different renderer architectures.';
};

const monitor = (timestamp: number) => {
    if (!state.running) {
        return;
    }

    const elapsed = timestamp - state.startedAt;
    ui.elapsedPill.textContent = `${(elapsed / 1000).toFixed(1)}s / ${(state.durationMs / 1000).toFixed(0)}s`;
    refreshMetrics();

    if (elapsed >= state.durationMs) {
        stopBenchmark('completed');
        return;
    }

    state.monitorRaf = requestAnimationFrame(monitor);
};

const startBenchmark = () => {
    teardownRuntimes();
    ui.errorText.textContent = '';
    ui.errorText.className = '';

    state.lastRunConfiguration = {
        workload: state.workload,
        comparisonMode: state.comparisonMode,
        objectCount: state.objectCount,
        durationMs: state.durationMs,
    };

    const descriptors = createDescriptors(
        state.lastRunConfiguration.objectCount,
        state.lastRunConfiguration.workload
    );
    state.axrone = createAxroneRuntime(ui.axroneCanvas, ui.axroneShell, descriptors);
    state.three = createThreeRuntime(
        ui.threeCanvas,
        ui.threeShell,
        descriptors,
        state.lastRunConfiguration.comparisonMode
    );

    state.running = true;
    state.startedAt = performance.now();

    ui.detailObjects.textContent = formatNumber(state.lastRunConfiguration.objectCount);
    ui.detailProfile.textContent = workloadTitles[state.lastRunConfiguration.workload];
    ui.statusText.textContent = 'Benchmark is sampling both engines live.';
    ui.summaryTitle.textContent = 'Benchmark running';
    ui.summaryCopy.textContent = `Same descriptors are active in both scenes. Mode: ${comparisonModeTitles[state.lastRunConfiguration.comparisonMode]}. Watch average FPS for throughput and P95 frame time for frame consistency.`;

    state.axrone.resume();
    state.three.resume();
    setRunningUi();
    refreshMetrics();
    state.monitorRaf = requestAnimationFrame(monitor);
};

const resetBenchmark = () => {
    if (state.running) {
        stopBenchmark('manual');
    }

    teardownRuntimes();
    ui.elapsedPill.textContent = `0.0s / ${(state.durationMs / 1000).toFixed(0)}s`;
    ui.statusText.textContent = 'Ready for a fresh run.';
    ui.summaryTitle.textContent = 'Waiting for benchmark run';
    ui.summaryCopy.textContent =
        'Configure workload and start the benchmark. Results will compare throughput, frame consistency and setup cost using the exact same scene descriptors for both engines.';
    ui.errorText.textContent = '';
    ui.errorText.className = '';

    [
        ui.axroneFps,
        ui.threeFps,
        ui.axroneP95,
        ui.threeP95,
        ui.axroneDraws,
        ui.threeDraws,
        ui.axroneTris,
        ui.threeTris,
    ].forEach((element) => {
        element.textContent = '0';
    });

    ui.axroneSetup.textContent = '0 ms';
    ui.threeSetup.textContent = '0 ms';
    ui.fpsWinner.textContent = 'No result yet.';
    ui.p95Winner.textContent = 'No result yet.';
    ui.drawWinner.textContent = 'No result yet.';
    ui.triWinner.textContent = 'No result yet.';
    setIdleUi();
};

const syncControls = () => {
    state.workload = ui.workload.value as WorkloadType;
    state.comparisonMode = ui.comparisonMode.value as ComparisonMode;
    state.objectCount = Number(ui.objectCount.value);
    state.durationMs = Number(ui.duration.value) * 1000;

    ui.workloadLabel.textContent = workloadLabels[state.workload];
    ui.comparisonModeValue.textContent = comparisonModeLabels[state.comparisonMode];
    ui.objectCountValue.textContent = `${formatNumber(state.objectCount)} objects`;
    ui.durationValue.textContent = `${state.durationMs / 1000} seconds`;
    ui.detailObjects.textContent = formatNumber(state.objectCount);
    ui.detailProfile.textContent = workloadTitles[state.workload];
    if (!state.running) {
        ui.elapsedPill.textContent = `0.0s / ${(state.durationMs / 1000).toFixed(0)}s`;
    }
};

const handleResize = () => {
    resizeCanvas(ui.axroneCanvas, ui.axroneShell);
    resizeCanvas(ui.threeCanvas, ui.threeShell);
    state.axrone?.resize();
    state.three?.resize();
};

ui.workload.addEventListener('change', syncControls);
ui.comparisonMode.addEventListener('change', syncControls);
ui.objectCount.addEventListener('input', syncControls);
ui.duration.addEventListener('input', syncControls);

ui.startButton.addEventListener('click', () => {
    try {
        startBenchmark();
    } catch (error) {
        state.running = false;
        teardownRuntimes();
        setIdleUi();
        ui.errorText.textContent = error instanceof Error ? error.message : String(error);
        ui.errorText.className = 'error';
        ui.statusText.textContent = 'Benchmark failed during setup.';
        ui.summaryTitle.textContent = 'Benchmark setup failed';
        ui.summaryCopy.textContent =
            'Check the error line and verify WebGL2 support plus local package resolution.';
    }
});

ui.stopButton.addEventListener('click', () => stopBenchmark('manual'));
ui.resetButton.addEventListener('click', resetBenchmark);
ui.copyJsonButton.addEventListener('click', async () => {
    try {
        const snapshot = createBenchmarkSnapshot();
        await copyText(JSON.stringify(snapshot, null, 2));
        ui.statusText.textContent = 'Benchmark JSON copied to clipboard.';
        ui.errorText.textContent = '';
        ui.errorText.className = '';
    } catch (error) {
        ui.errorText.textContent =
            error instanceof Error ? error.message : 'Failed to copy benchmark JSON.';
        ui.errorText.className = 'error';
    }
});

const resizeObserver = new ResizeObserver(() => handleResize());
resizeObserver.observe(ui.axroneShell);
resizeObserver.observe(ui.threeShell);
window.addEventListener('resize', handleResize);

syncControls();
resetBenchmark();
