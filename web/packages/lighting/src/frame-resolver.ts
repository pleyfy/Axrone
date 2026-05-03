import { Vec3 } from '@axrone/numeric';
import type { Disposable } from '@axrone/utility';
import type { ReadonlyTuple3 } from '@axrone/utility';
import { brandLightingRigId, brandLightingVersion } from './brands';
import { LightKind, LightSortMode, LightTypeCode } from './constants';
import type { LightSortMode as LightSortModeType } from './constants';
import { LightingDisposedError } from './errors';
import { LIGHTING_RIG_ACCESS, type InternalLightRecord, type LightingRigReadable } from './internal';
import type {
    DirectionalLightDefinition,
    LightingCapacity,
    LightingEnvironment,
    LightingFrameResolverOptions,
    LightingSelectionOptions,
    LightingSelectionState,
    LightingSelectionStats,
    PointLightDefinition,
    SpotLightDefinition,
    Vec3Input,
} from './types';
import { DEFAULT_LIGHTING_CAPACITY, resolveLightingCapacity } from './validation';

type RankedDirectional = InternalLightRecord<'directional'>;
type RankedLocal = InternalLightRecord<'point' | 'spot'>;

type Mutable<T> = {
    -readonly [K in keyof T]: T[K];
};

interface MutableLightingEnvironment {
    ambient: Vec3;
    sky: Vec3;
    ground: Vec3;
    exposure: number;
    gamma: number;
}

type MutableLightingSelectionStats = Mutable<LightingSelectionStats>;

type MutableLightingSelectionState = Mutable<
    Omit<LightingSelectionState, 'environment' | 'stats'>
> & {
    environment: MutableLightingEnvironment;
    stats: MutableLightingSelectionStats;
};

const createFloatViews = (source: Float32Array, capacity: number, stride: number): readonly Float32Array[] => {
    return Object.freeze(
        Array.from({ length: capacity + 1 }, (_, count) =>
            source.subarray(0, Math.max(1, count * stride))
        )
    );
};

const createIntViews = (source: Int32Array, capacity: number): readonly Int32Array[] => {
    return Object.freeze(
        Array.from({ length: capacity + 1 }, (_, count) => source.subarray(0, Math.max(1, count)))
    );
};

const createStats = (): MutableLightingSelectionStats => ({
    totalLightCount: 0,
    totalDirectionalCount: 0,
    totalPointCount: 0,
    totalSpotCount: 0,
    selectedDirectionalCount: 0,
    selectedPointCount: 0,
    selectedSpotCount: 0,
    selectedLocalLightCount: 0,
    omittedDirectionalCount: 0,
    omittedPointCount: 0,
    omittedSpotCount: 0,
    omittedLocalLightCount: 0,
});

const writeVec3 = (target: Vec3, source: Readonly<Vec3>): void => {
    target.x = source.x;
    target.y = source.y;
    target.z = source.z;
};

const isVec3TupleInput = (value: Vec3Input): value is ReadonlyTuple3<number> => Array.isArray(value);

const sameVec3Input = (camera: Vec3Input | undefined, lastCamera: Vec3, hasLastCamera: boolean): boolean => {
    if (camera === undefined) {
        return !hasLastCamera;
    }

    if (!hasLastCamera) {
        return false;
    }

    if (isVec3TupleInput(camera)) {
        return camera[0] === lastCamera.x && camera[1] === lastCamera.y && camera[2] === lastCamera.z;
    }

    return camera.x === lastCamera.x && camera.y === lastCamera.y && camera.z === lastCamera.z;
};

const writeCamera = (camera: Vec3, value: Vec3Input | undefined): boolean => {
    if (value === undefined) {
        camera.x = 0;
        camera.y = 0;
        camera.z = 0;
        return false;
    }

    if (isVec3TupleInput(value)) {
        camera.x = value[0];
        camera.y = value[1];
        camera.z = value[2];
        return true;
    }

    camera.x = value.x;
    camera.y = value.y;
    camera.z = value.z;
    return true;
};

const distanceSquared = (a: Readonly<Vec3>, b: Readonly<Vec3>): number => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
};

const pointInfluence = (light: PointLightDefinition, camera: Readonly<Vec3> | null): number => {
    if (!camera) {
        return light.intensity;
    }

    const radiusSq = light.range * light.range;
    if (radiusSq <= 0) {
        return 0;
    }

    const normalizedDistance = distanceSquared(light.position, camera) / radiusSq;
    return light.intensity / (1 + light.attenuation * normalizedDistance * normalizedDistance);
};

const spotInfluence = (light: SpotLightDefinition, camera: Readonly<Vec3> | null): number => {
    if (!camera) {
        return light.intensity;
    }

    const radiusSq = light.range * light.range;
    if (radiusSq <= 0) {
        return 0;
    }

    const offsetX = camera.x - light.position.x;
    const offsetY = camera.y - light.position.y;
    const offsetZ = camera.z - light.position.z;
    const length = Math.hypot(offsetX, offsetY, offsetZ);

    if (length <= 1e-8) {
        return light.intensity;
    }

    const directionDot =
        (offsetX / length) * light.direction.x +
        (offsetY / length) * light.direction.y +
        (offsetZ / length) * light.direction.z;

    if (directionDot <= light.outerConeCosine) {
        return 0;
    }

    const normalizedDistance = distanceSquared(light.position, camera) / radiusSq;
    const coneFactor =
        light.innerConeCosine <= light.outerConeCosine
            ? 1
            : Math.min(
                  1,
                  Math.max(
                      0,
                      (directionDot - light.outerConeCosine) /
                          (light.innerConeCosine - light.outerConeCosine)
                  )
              );

    return (light.intensity * coneFactor) / (1 + light.attenuation * normalizedDistance * normalizedDistance);
};

const directionalScore = (light: DirectionalLightDefinition): number => light.priority * 1024 + light.intensity;

const localScore = (
    entry: RankedLocal,
    mode: LightSortModeType,
    camera: Readonly<Vec3> | null
): number => {
    switch (mode) {
        case LightSortMode.None:
            return 0;
        case LightSortMode.Priority:
            return entry.definition.priority * 1024 + entry.definition.intensity;
        case LightSortMode.Influence:
            if (entry.definition.kind === LightKind.Point) {
                return entry.definition.priority * 1024 + pointInfluence(entry.definition, camera);
            }

            return entry.definition.priority * 1024 + spotInfluence(entry.definition, camera);
        default:
            return 0;
    }
};

const isDirectionalRecord = (entry: InternalLightRecord): entry is RankedDirectional => {
    return entry.definition.kind === LightKind.Directional;
};

const isPointRecord = (entry: InternalLightRecord): entry is InternalLightRecord<'point'> => {
    return entry.definition.kind === LightKind.Point;
};

const isSpotRecord = (entry: InternalLightRecord): entry is InternalLightRecord<'spot'> => {
    return entry.definition.kind === LightKind.Spot;
};

const shouldPrecede = (score: number, sequence: number, otherScore: number, otherSequence: number): boolean => {
    return score > otherScore || (score === otherScore && sequence < otherSequence);
};

const assignStats = (
    stats: MutableLightingSelectionStats,
    totalDirectionalCount: number,
    totalPointCount: number,
    totalSpotCount: number,
    selectedDirectionalCount: number,
    selectedPointCount: number,
    selectedSpotCount: number,
    selectedLocalLightCount: number
): void => {
    stats.totalDirectionalCount = totalDirectionalCount;
    stats.totalPointCount = totalPointCount;
    stats.totalSpotCount = totalSpotCount;
    stats.totalLightCount = totalDirectionalCount + totalPointCount + totalSpotCount;
    stats.selectedDirectionalCount = selectedDirectionalCount;
    stats.selectedPointCount = selectedPointCount;
    stats.selectedSpotCount = selectedSpotCount;
    stats.selectedLocalLightCount = selectedLocalLightCount;
    stats.omittedDirectionalCount = Math.max(0, totalDirectionalCount - selectedDirectionalCount);
    stats.omittedPointCount = Math.max(0, totalPointCount - selectedPointCount);
    stats.omittedSpotCount = Math.max(0, totalSpotCount - selectedSpotCount);
    stats.omittedLocalLightCount = Math.max(
        0,
        totalPointCount + totalSpotCount - selectedLocalLightCount
    );
};

export class LightingFrameResolver implements Disposable {
    readonly #capacity: Readonly<LightingCapacity>;
    readonly #defaultSortMode: LightSortModeType;

    readonly #directionalDirectionsBase: Float32Array;
    readonly #directionalColorsBase: Float32Array;
    readonly #directionalAmbientColorsBase: Float32Array;
    readonly #directionalIntensitiesBase: Float32Array;
    readonly #pointPositionsBase: Float32Array;
    readonly #pointColorsBase: Float32Array;
    readonly #pointIntensitiesBase: Float32Array;
    readonly #pointRangesBase: Float32Array;
    readonly #spotPositionsBase: Float32Array;
    readonly #spotDirectionsBase: Float32Array;
    readonly #spotColorsBase: Float32Array;
    readonly #spotIntensitiesBase: Float32Array;
    readonly #spotRangesBase: Float32Array;
    readonly #spotInnerConeCosinesBase: Float32Array;
    readonly #spotOuterConeCosinesBase: Float32Array;
    readonly #localLightKindsBase: Int32Array;
    readonly #localLightPositionsBase: Float32Array;
    readonly #localLightDirectionsBase: Float32Array;
    readonly #localLightColorsBase: Float32Array;
    readonly #localLightIntensitiesBase: Float32Array;
    readonly #localLightRangesBase: Float32Array;
    readonly #localLightInnerConeCosinesBase: Float32Array;
    readonly #localLightOuterConeCosinesBase: Float32Array;

    readonly #directionalDirectionsViews: readonly Float32Array[];
    readonly #directionalColorsViews: readonly Float32Array[];
    readonly #directionalAmbientColorsViews: readonly Float32Array[];
    readonly #directionalIntensitiesViews: readonly Float32Array[];
    readonly #pointPositionsViews: readonly Float32Array[];
    readonly #pointColorsViews: readonly Float32Array[];
    readonly #pointIntensitiesViews: readonly Float32Array[];
    readonly #pointRangesViews: readonly Float32Array[];
    readonly #spotPositionsViews: readonly Float32Array[];
    readonly #spotDirectionsViews: readonly Float32Array[];
    readonly #spotColorsViews: readonly Float32Array[];
    readonly #spotIntensitiesViews: readonly Float32Array[];
    readonly #spotRangesViews: readonly Float32Array[];
    readonly #spotInnerConeCosinesViews: readonly Float32Array[];
    readonly #spotOuterConeCosinesViews: readonly Float32Array[];
    readonly #localLightKindsViews: readonly Int32Array[];
    readonly #localLightPositionsViews: readonly Float32Array[];
    readonly #localLightDirectionsViews: readonly Float32Array[];
    readonly #localLightColorsViews: readonly Float32Array[];
    readonly #localLightIntensitiesViews: readonly Float32Array[];
    readonly #localLightRangesViews: readonly Float32Array[];
    readonly #localLightInnerConeCosinesViews: readonly Float32Array[];
    readonly #localLightOuterConeCosinesViews: readonly Float32Array[];

    readonly #state: MutableLightingSelectionState;
    readonly #directionalRanked: Array<RankedDirectional | null>;
    readonly #directionalScores: Float64Array;
    readonly #directionalSequences: Int32Array;
    readonly #pointRanked: Array<InternalLightRecord<'point'> | null>;
    readonly #pointScores: Float64Array;
    readonly #pointSequences: Int32Array;
    readonly #spotRanked: Array<InternalLightRecord<'spot'> | null>;
    readonly #spotScores: Float64Array;
    readonly #spotSequences: Int32Array;
    readonly #localRanked: Array<RankedLocal | null>;
    readonly #localScores: Float64Array;
    readonly #localSequences: Int32Array;

    readonly #lastCamera = new Vec3();

    #hasCachedCamera = false;
    #cachedRigId: string | null = null;
    #cachedVersion = -1;
    #cachedSortMode: LightSortModeType;
    #isDisposed = false;

    constructor(options: LightingFrameResolverOptions = {}) {
        this.#capacity = resolveLightingCapacity(options.capacity ?? DEFAULT_LIGHTING_CAPACITY);
        this.#defaultSortMode = options.sortMode ?? LightSortMode.Influence;
        this.#cachedSortMode = this.#defaultSortMode;

        this.#directionalDirectionsBase = new Float32Array(Math.max(1, this.#capacity.maxDirectionalLights * 3));
        this.#directionalColorsBase = new Float32Array(Math.max(1, this.#capacity.maxDirectionalLights * 3));
        this.#directionalAmbientColorsBase = new Float32Array(Math.max(1, this.#capacity.maxDirectionalLights * 3));
        this.#directionalIntensitiesBase = new Float32Array(Math.max(1, this.#capacity.maxDirectionalLights));
        this.#pointPositionsBase = new Float32Array(Math.max(1, this.#capacity.maxPointLights * 3));
        this.#pointColorsBase = new Float32Array(Math.max(1, this.#capacity.maxPointLights * 3));
        this.#pointIntensitiesBase = new Float32Array(Math.max(1, this.#capacity.maxPointLights));
        this.#pointRangesBase = new Float32Array(Math.max(1, this.#capacity.maxPointLights));
        this.#spotPositionsBase = new Float32Array(Math.max(1, this.#capacity.maxSpotLights * 3));
        this.#spotDirectionsBase = new Float32Array(Math.max(1, this.#capacity.maxSpotLights * 3));
        this.#spotColorsBase = new Float32Array(Math.max(1, this.#capacity.maxSpotLights * 3));
        this.#spotIntensitiesBase = new Float32Array(Math.max(1, this.#capacity.maxSpotLights));
        this.#spotRangesBase = new Float32Array(Math.max(1, this.#capacity.maxSpotLights));
        this.#spotInnerConeCosinesBase = new Float32Array(Math.max(1, this.#capacity.maxSpotLights));
        this.#spotOuterConeCosinesBase = new Float32Array(Math.max(1, this.#capacity.maxSpotLights));
        this.#localLightKindsBase = new Int32Array(Math.max(1, this.#capacity.maxLocalLights));
        this.#localLightPositionsBase = new Float32Array(Math.max(1, this.#capacity.maxLocalLights * 3));
        this.#localLightDirectionsBase = new Float32Array(Math.max(1, this.#capacity.maxLocalLights * 3));
        this.#localLightColorsBase = new Float32Array(Math.max(1, this.#capacity.maxLocalLights * 3));
        this.#localLightIntensitiesBase = new Float32Array(Math.max(1, this.#capacity.maxLocalLights));
        this.#localLightRangesBase = new Float32Array(Math.max(1, this.#capacity.maxLocalLights));
        this.#localLightInnerConeCosinesBase = new Float32Array(Math.max(1, this.#capacity.maxLocalLights));
        this.#localLightOuterConeCosinesBase = new Float32Array(Math.max(1, this.#capacity.maxLocalLights));

        this.#directionalDirectionsViews = createFloatViews(this.#directionalDirectionsBase, this.#capacity.maxDirectionalLights, 3);
        this.#directionalColorsViews = createFloatViews(this.#directionalColorsBase, this.#capacity.maxDirectionalLights, 3);
        this.#directionalAmbientColorsViews = createFloatViews(this.#directionalAmbientColorsBase, this.#capacity.maxDirectionalLights, 3);
        this.#directionalIntensitiesViews = createFloatViews(this.#directionalIntensitiesBase, this.#capacity.maxDirectionalLights, 1);
        this.#pointPositionsViews = createFloatViews(this.#pointPositionsBase, this.#capacity.maxPointLights, 3);
        this.#pointColorsViews = createFloatViews(this.#pointColorsBase, this.#capacity.maxPointLights, 3);
        this.#pointIntensitiesViews = createFloatViews(this.#pointIntensitiesBase, this.#capacity.maxPointLights, 1);
        this.#pointRangesViews = createFloatViews(this.#pointRangesBase, this.#capacity.maxPointLights, 1);
        this.#spotPositionsViews = createFloatViews(this.#spotPositionsBase, this.#capacity.maxSpotLights, 3);
        this.#spotDirectionsViews = createFloatViews(this.#spotDirectionsBase, this.#capacity.maxSpotLights, 3);
        this.#spotColorsViews = createFloatViews(this.#spotColorsBase, this.#capacity.maxSpotLights, 3);
        this.#spotIntensitiesViews = createFloatViews(this.#spotIntensitiesBase, this.#capacity.maxSpotLights, 1);
        this.#spotRangesViews = createFloatViews(this.#spotRangesBase, this.#capacity.maxSpotLights, 1);
        this.#spotInnerConeCosinesViews = createFloatViews(this.#spotInnerConeCosinesBase, this.#capacity.maxSpotLights, 1);
        this.#spotOuterConeCosinesViews = createFloatViews(this.#spotOuterConeCosinesBase, this.#capacity.maxSpotLights, 1);
        this.#localLightKindsViews = createIntViews(this.#localLightKindsBase, this.#capacity.maxLocalLights);
        this.#localLightPositionsViews = createFloatViews(this.#localLightPositionsBase, this.#capacity.maxLocalLights, 3);
        this.#localLightDirectionsViews = createFloatViews(this.#localLightDirectionsBase, this.#capacity.maxLocalLights, 3);
        this.#localLightColorsViews = createFloatViews(this.#localLightColorsBase, this.#capacity.maxLocalLights, 3);
        this.#localLightIntensitiesViews = createFloatViews(this.#localLightIntensitiesBase, this.#capacity.maxLocalLights, 1);
        this.#localLightRangesViews = createFloatViews(this.#localLightRangesBase, this.#capacity.maxLocalLights, 1);
        this.#localLightInnerConeCosinesViews = createFloatViews(this.#localLightInnerConeCosinesBase, this.#capacity.maxLocalLights, 1);
        this.#localLightOuterConeCosinesViews = createFloatViews(this.#localLightOuterConeCosinesBase, this.#capacity.maxLocalLights, 1);

        this.#directionalRanked = Array.from({ length: this.#capacity.maxDirectionalLights }, () => null);
        this.#directionalScores = new Float64Array(this.#capacity.maxDirectionalLights);
        this.#directionalSequences = new Int32Array(this.#capacity.maxDirectionalLights);
        this.#pointRanked = Array.from({ length: this.#capacity.maxPointLights }, () => null);
        this.#pointScores = new Float64Array(this.#capacity.maxPointLights);
        this.#pointSequences = new Int32Array(this.#capacity.maxPointLights);
        this.#spotRanked = Array.from({ length: this.#capacity.maxSpotLights }, () => null);
        this.#spotScores = new Float64Array(this.#capacity.maxSpotLights);
        this.#spotSequences = new Int32Array(this.#capacity.maxSpotLights);
        this.#localRanked = Array.from({ length: this.#capacity.maxLocalLights }, () => null);
        this.#localScores = new Float64Array(this.#capacity.maxLocalLights);
        this.#localSequences = new Int32Array(this.#capacity.maxLocalLights);

        const environment: MutableLightingEnvironment = {
            ambient: new Vec3(),
            sky: new Vec3(),
            ground: new Vec3(),
            exposure: 1,
            gamma: 2.2,
        };
        const stats = createStats();
        this.#state = {
            rigId: brandLightingRigId(''),
            version: brandLightingVersion(0),
            sortMode: this.#defaultSortMode,
            capacity: this.#capacity,
            environment,
            stats,
            directionalDirections: this.#directionalDirectionsViews[0]!,
            directionalColors: this.#directionalColorsViews[0]!,
            directionalAmbientColors: this.#directionalAmbientColorsViews[0]!,
            directionalIntensities: this.#directionalIntensitiesViews[0]!,
            pointPositions: this.#pointPositionsViews[0]!,
            pointColors: this.#pointColorsViews[0]!,
            pointIntensities: this.#pointIntensitiesViews[0]!,
            pointRanges: this.#pointRangesViews[0]!,
            spotPositions: this.#spotPositionsViews[0]!,
            spotDirections: this.#spotDirectionsViews[0]!,
            spotColors: this.#spotColorsViews[0]!,
            spotIntensities: this.#spotIntensitiesViews[0]!,
            spotRanges: this.#spotRangesViews[0]!,
            spotInnerConeCosines: this.#spotInnerConeCosinesViews[0]!,
            spotOuterConeCosines: this.#spotOuterConeCosinesViews[0]!,
            localLightKinds: this.#localLightKindsViews[0]!,
            localLightPositions: this.#localLightPositionsViews[0]!,
            localLightDirections: this.#localLightDirectionsViews[0]!,
            localLightColors: this.#localLightColorsViews[0]!,
            localLightIntensities: this.#localLightIntensitiesViews[0]!,
            localLightRanges: this.#localLightRangesViews[0]!,
            localLightInnerConeCosines: this.#localLightInnerConeCosinesViews[0]!,
            localLightOuterConeCosines: this.#localLightOuterConeCosinesViews[0]!,
        };
    }

    get capacity(): Readonly<LightingCapacity> {
        return this.#capacity;
    }

    get isDisposed(): boolean {
        return this.#isDisposed;
    }

    resolve(rig: LightingRigReadable, options: LightingSelectionOptions = {}): LightingSelectionState {
        this.#assertNotDisposed();
        const snapshot = rig[LIGHTING_RIG_ACCESS]();
        const sortMode = options.sortMode ?? this.#defaultSortMode;
        const currentVersion = Number(snapshot.version);

        if (
            this.#cachedRigId === String(snapshot.id) &&
            this.#cachedVersion === currentVersion &&
            this.#cachedSortMode === sortMode &&
            (sortMode !== LightSortMode.Influence || sameVec3Input(options.cameraPosition, this.#lastCamera, this.#hasCachedCamera))
        ) {
            return this.#state;
        }

        const hasCamera = writeCamera(this.#lastCamera, options.cameraPosition);
        const camera = hasCamera ? this.#lastCamera : null;
        this.#hasCachedCamera = hasCamera;
        this.#cachedRigId = String(snapshot.id);
        this.#cachedVersion = currentVersion;
        this.#cachedSortMode = sortMode;

        this.#clearBuffers();
        this.#syncEnvironment(snapshot.environment);

        let selectedDirectionalCount = 0;
        let selectedPointCount = 0;
        let selectedSpotCount = 0;
        let selectedLocalLightCount = 0;
        let totalDirectionalCount = 0;
        let totalPointCount = 0;
        let totalSpotCount = 0;

        if (sortMode === LightSortMode.None) {
            for (const entry of snapshot.entries) {
                const { definition } = entry;

                if (!definition.enabled) {
                    continue;
                }

                switch (definition.kind) {
                    case LightKind.Directional:
                        totalDirectionalCount += 1;
                        if (selectedDirectionalCount < this.#capacity.maxDirectionalLights) {
                            this.#writeDirectional(definition, selectedDirectionalCount);
                            selectedDirectionalCount += 1;
                        }
                        break;
                    case LightKind.Point:
                        totalPointCount += 1;
                        if (selectedPointCount < this.#capacity.maxPointLights) {
                            this.#writePoint(definition, selectedPointCount);
                            selectedPointCount += 1;
                        }
                        if (selectedLocalLightCount < this.#capacity.maxLocalLights) {
                            this.#writeLocalPoint(definition, selectedLocalLightCount);
                            selectedLocalLightCount += 1;
                        }
                        break;
                    case LightKind.Spot:
                        totalSpotCount += 1;
                        if (selectedSpotCount < this.#capacity.maxSpotLights) {
                            this.#writeSpot(definition, selectedSpotCount);
                            selectedSpotCount += 1;
                        }
                        if (selectedLocalLightCount < this.#capacity.maxLocalLights) {
                            this.#writeLocalSpot(definition, selectedLocalLightCount);
                            selectedLocalLightCount += 1;
                        }
                        break;
                }
            }
        } else {
            for (const entry of snapshot.entries) {
                if (!entry.definition.enabled) {
                    continue;
                }

                if (isDirectionalRecord(entry)) {
                    totalDirectionalCount += 1;
                    selectedDirectionalCount = this.#insertRanked(
                        this.#directionalRanked,
                        this.#directionalScores,
                        this.#directionalSequences,
                        selectedDirectionalCount,
                        entry,
                        directionalScore(entry.definition)
                    );
                    continue;
                }

                if (isPointRecord(entry)) {
                    const score = localScore(entry, sortMode, camera);
                    totalPointCount += 1;
                    selectedPointCount = this.#insertRanked(
                        this.#pointRanked,
                        this.#pointScores,
                        this.#pointSequences,
                        selectedPointCount,
                        entry,
                        score
                    );
                    selectedLocalLightCount = this.#insertRanked(
                        this.#localRanked,
                        this.#localScores,
                        this.#localSequences,
                        selectedLocalLightCount,
                        entry,
                        score
                    );
                    continue;
                }

                if (isSpotRecord(entry)) {
                    const score = localScore(entry, sortMode, camera);
                    totalSpotCount += 1;
                    selectedSpotCount = this.#insertRanked(
                        this.#spotRanked,
                        this.#spotScores,
                        this.#spotSequences,
                        selectedSpotCount,
                        entry,
                        score
                    );
                    selectedLocalLightCount = this.#insertRanked(
                        this.#localRanked,
                        this.#localScores,
                        this.#localSequences,
                        selectedLocalLightCount,
                        entry,
                        score
                    );
                }
            }

            for (let index = 0; index < selectedDirectionalCount; index += 1) {
                const entry = this.#directionalRanked[index]!;
                this.#writeDirectional(entry.definition, index);
            }

            for (let index = 0; index < selectedPointCount; index += 1) {
                const entry = this.#pointRanked[index]!;
                this.#writePoint(entry.definition, index);
            }

            for (let index = 0; index < selectedSpotCount; index += 1) {
                const entry = this.#spotRanked[index]!;
                this.#writeSpot(entry.definition, index);
            }

            for (let index = 0; index < selectedLocalLightCount; index += 1) {
                const entry = this.#localRanked[index]!;

                if (entry.definition.kind === LightKind.Point) {
                    this.#writeLocalPoint(entry.definition, index);
                } else {
                    this.#writeLocalSpot(entry.definition, index);
                }
            }
        }

        assignStats(
            this.#state.stats,
            totalDirectionalCount,
            totalPointCount,
            totalSpotCount,
            selectedDirectionalCount,
            selectedPointCount,
            selectedSpotCount,
            selectedLocalLightCount
        );

        this.#state.rigId = snapshot.id;
        this.#state.version = snapshot.version;
        this.#state.sortMode = sortMode;
        this.#state.directionalDirections = this.#directionalDirectionsViews[selectedDirectionalCount]!;
        this.#state.directionalColors = this.#directionalColorsViews[selectedDirectionalCount]!;
        this.#state.directionalAmbientColors = this.#directionalAmbientColorsViews[selectedDirectionalCount]!;
        this.#state.directionalIntensities = this.#directionalIntensitiesViews[selectedDirectionalCount]!;
        this.#state.pointPositions = this.#pointPositionsViews[selectedPointCount]!;
        this.#state.pointColors = this.#pointColorsViews[selectedPointCount]!;
        this.#state.pointIntensities = this.#pointIntensitiesViews[selectedPointCount]!;
        this.#state.pointRanges = this.#pointRangesViews[selectedPointCount]!;
        this.#state.spotPositions = this.#spotPositionsViews[selectedSpotCount]!;
        this.#state.spotDirections = this.#spotDirectionsViews[selectedSpotCount]!;
        this.#state.spotColors = this.#spotColorsViews[selectedSpotCount]!;
        this.#state.spotIntensities = this.#spotIntensitiesViews[selectedSpotCount]!;
        this.#state.spotRanges = this.#spotRangesViews[selectedSpotCount]!;
        this.#state.spotInnerConeCosines = this.#spotInnerConeCosinesViews[selectedSpotCount]!;
        this.#state.spotOuterConeCosines = this.#spotOuterConeCosinesViews[selectedSpotCount]!;
        this.#state.localLightKinds = this.#localLightKindsViews[selectedLocalLightCount]!;
        this.#state.localLightPositions = this.#localLightPositionsViews[selectedLocalLightCount]!;
        this.#state.localLightDirections = this.#localLightDirectionsViews[selectedLocalLightCount]!;
        this.#state.localLightColors = this.#localLightColorsViews[selectedLocalLightCount]!;
        this.#state.localLightIntensities = this.#localLightIntensitiesViews[selectedLocalLightCount]!;
        this.#state.localLightRanges = this.#localLightRangesViews[selectedLocalLightCount]!;
        this.#state.localLightInnerConeCosines = this.#localLightInnerConeCosinesViews[selectedLocalLightCount]!;
        this.#state.localLightOuterConeCosines = this.#localLightOuterConeCosinesViews[selectedLocalLightCount]!;

        return this.#state;
    }

    dispose(): void {
        if (this.#isDisposed) {
            return;
        }

        this.#isDisposed = true;
        this.#cachedRigId = null;
        this.#cachedVersion = -1;
    }

    #insertRanked<T extends InternalLightRecord>(
        records: Array<T | null>,
        scores: Float64Array,
        sequences: Int32Array,
        count: number,
        entry: T,
        score: number
    ): number {
        const capacity = records.length;

        if (capacity === 0) {
            return 0;
        }

        const sequence = entry.sequence;
        let insertIndex = count;

        while (
            insertIndex > 0 &&
            shouldPrecede(score, sequence, scores[insertIndex - 1]!, sequences[insertIndex - 1]!)
        ) {
            insertIndex -= 1;
        }

        if (count < capacity) {
            for (let index = count; index > insertIndex; index -= 1) {
                records[index] = records[index - 1];
                scores[index] = scores[index - 1]!;
                sequences[index] = sequences[index - 1]!;
            }

            records[insertIndex] = entry;
            scores[insertIndex] = score;
            sequences[insertIndex] = sequence;
            return count + 1;
        }

        if (insertIndex >= capacity) {
            return count;
        }

        for (let index = capacity - 1; index > insertIndex; index -= 1) {
            records[index] = records[index - 1];
            scores[index] = scores[index - 1]!;
            sequences[index] = sequences[index - 1]!;
        }

        records[insertIndex] = entry;
        scores[insertIndex] = score;
        sequences[insertIndex] = sequence;
        return count;
    }

    #syncEnvironment(environment: LightingEnvironment): void {
        writeVec3(this.#state.environment.ambient, environment.ambient);
        writeVec3(this.#state.environment.sky, environment.sky);
        writeVec3(this.#state.environment.ground, environment.ground);
        this.#state.environment.exposure = environment.exposure;
        this.#state.environment.gamma = environment.gamma;
    }

    #clearBuffers(): void {
        this.#directionalDirectionsBase.fill(0);
        this.#directionalColorsBase.fill(0);
        this.#directionalAmbientColorsBase.fill(0);
        this.#directionalIntensitiesBase.fill(0);
        this.#pointPositionsBase.fill(0);
        this.#pointColorsBase.fill(0);
        this.#pointIntensitiesBase.fill(0);
        this.#pointRangesBase.fill(0);
        this.#spotPositionsBase.fill(0);
        this.#spotDirectionsBase.fill(0);
        this.#spotColorsBase.fill(0);
        this.#spotIntensitiesBase.fill(0);
        this.#spotRangesBase.fill(0);
        this.#spotInnerConeCosinesBase.fill(0);
        this.#spotOuterConeCosinesBase.fill(0);
        this.#localLightKindsBase.fill(0);
        this.#localLightPositionsBase.fill(0);
        this.#localLightDirectionsBase.fill(0);
        this.#localLightColorsBase.fill(0);
        this.#localLightIntensitiesBase.fill(0);
        this.#localLightRangesBase.fill(0);
        this.#localLightInnerConeCosinesBase.fill(0);
        this.#localLightOuterConeCosinesBase.fill(0);
    }

    #writeDirectional(light: DirectionalLightDefinition, slot: number): void {
        const offset = slot * 3;
        this.#directionalDirectionsBase[offset] = light.direction.x;
        this.#directionalDirectionsBase[offset + 1] = light.direction.y;
        this.#directionalDirectionsBase[offset + 2] = light.direction.z;
        this.#directionalColorsBase[offset] = light.color.x;
        this.#directionalColorsBase[offset + 1] = light.color.y;
        this.#directionalColorsBase[offset + 2] = light.color.z;
        this.#directionalAmbientColorsBase[offset] = light.ambient.x;
        this.#directionalAmbientColorsBase[offset + 1] = light.ambient.y;
        this.#directionalAmbientColorsBase[offset + 2] = light.ambient.z;
        this.#directionalIntensitiesBase[slot] = light.intensity;
    }

    #writePoint(light: PointLightDefinition, slot: number): void {
        const offset = slot * 3;
        this.#pointPositionsBase[offset] = light.position.x;
        this.#pointPositionsBase[offset + 1] = light.position.y;
        this.#pointPositionsBase[offset + 2] = light.position.z;
        this.#pointColorsBase[offset] = light.color.x;
        this.#pointColorsBase[offset + 1] = light.color.y;
        this.#pointColorsBase[offset + 2] = light.color.z;
        this.#pointIntensitiesBase[slot] = light.intensity;
        this.#pointRangesBase[slot] = light.range;
    }

    #writeSpot(light: SpotLightDefinition, slot: number): void {
        const offset = slot * 3;
        this.#spotPositionsBase[offset] = light.position.x;
        this.#spotPositionsBase[offset + 1] = light.position.y;
        this.#spotPositionsBase[offset + 2] = light.position.z;
        this.#spotDirectionsBase[offset] = light.direction.x;
        this.#spotDirectionsBase[offset + 1] = light.direction.y;
        this.#spotDirectionsBase[offset + 2] = light.direction.z;
        this.#spotColorsBase[offset] = light.color.x;
        this.#spotColorsBase[offset + 1] = light.color.y;
        this.#spotColorsBase[offset + 2] = light.color.z;
        this.#spotIntensitiesBase[slot] = light.intensity;
        this.#spotRangesBase[slot] = light.range;
        this.#spotInnerConeCosinesBase[slot] = light.innerConeCosine;
        this.#spotOuterConeCosinesBase[slot] = light.outerConeCosine;
    }

    #writeLocalPoint(light: PointLightDefinition, slot: number): void {
        const offset = slot * 3;
        this.#localLightKindsBase[slot] = LightTypeCode[LightKind.Point];
        this.#localLightPositionsBase[offset] = light.position.x;
        this.#localLightPositionsBase[offset + 1] = light.position.y;
        this.#localLightPositionsBase[offset + 2] = light.position.z;
        this.#localLightColorsBase[offset] = light.color.x;
        this.#localLightColorsBase[offset + 1] = light.color.y;
        this.#localLightColorsBase[offset + 2] = light.color.z;
        this.#localLightIntensitiesBase[slot] = light.intensity;
        this.#localLightRangesBase[slot] = light.range;
        this.#localLightInnerConeCosinesBase[slot] = 0;
        this.#localLightOuterConeCosinesBase[slot] = 0;
    }

    #writeLocalSpot(light: SpotLightDefinition, slot: number): void {
        const offset = slot * 3;
        this.#localLightKindsBase[slot] = LightTypeCode[LightKind.Spot];
        this.#localLightPositionsBase[offset] = light.position.x;
        this.#localLightPositionsBase[offset + 1] = light.position.y;
        this.#localLightPositionsBase[offset + 2] = light.position.z;
        this.#localLightDirectionsBase[offset] = light.direction.x;
        this.#localLightDirectionsBase[offset + 1] = light.direction.y;
        this.#localLightDirectionsBase[offset + 2] = light.direction.z;
        this.#localLightColorsBase[offset] = light.color.x;
        this.#localLightColorsBase[offset + 1] = light.color.y;
        this.#localLightColorsBase[offset + 2] = light.color.z;
        this.#localLightIntensitiesBase[slot] = light.intensity;
        this.#localLightRangesBase[slot] = light.range;
        this.#localLightInnerConeCosinesBase[slot] = light.innerConeCosine;
        this.#localLightOuterConeCosinesBase[slot] = light.outerConeCosine;
    }

    #assertNotDisposed(): void {
        if (this.#isDisposed) {
            throw new LightingDisposedError('LightingFrameResolver');
        }
    }
}