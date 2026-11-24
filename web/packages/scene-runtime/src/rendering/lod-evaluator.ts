import { Vec3 } from '@axrone/numeric';
import { type EntityId } from '@axrone/ecs-runtime';
import type { SceneCameraFrameState } from '../camera-frame-state';
import { LODGroup } from '../components/lod-group';
import { MeshRenderer } from '../components/mesh-renderer';

export interface SceneLodEvaluateParams {
    readonly entities: readonly EntityId[];
    readonly cameraFrame: SceneCameraFrameState;
}

export interface SceneLodEvaluateStats {
    readonly evaluatedGroupCount: number;
    readonly controlledRendererCount: number;
}

interface LodControlledRenderer {
    readonly rendererId: string;
    readonly meshRenderer: MeshRenderer;
    originalVisible: boolean;
    tracked: boolean;
}

const DEG_TO_RAD = Math.PI / 180;

const resolveVerticalFieldOfViewRadians = (cameraFrame: SceneCameraFrameState): number => {
    const projection = cameraFrame.camera3D.projection;
    if (projection.kind === 'perspective') {
        return projection.verticalFieldOfView;
    }

    return cameraFrame.camera.fieldOfView * DEG_TO_RAD;
};

const computeDistanceSquared = (
    cameraPosition: Vec3,
    worldRefPoint: Vec3
): number => {
    const dx = cameraPosition.x - worldRefPoint.x;
    const dy = cameraPosition.y - worldRefPoint.y;
    const dz = cameraPosition.z - worldRefPoint.z;
    return dx * dx + dy * dy + dz * dz;
};

const clamp01 = (value: number): number => {
    if (value <= 0) {
        return 0;
    }
    if (value >= 1) {
        return 1;
    }
    return value;
};

/**
 * Evaluates LODGroup components each frame and toggles MeshRenderer visibility
 * based on screen-relative height.
 *
 * The evaluator runs before the render pipeline. For each active LODGroup it
 * calculates the object's projected screen size, selects the appropriate LOD
 * level, and shows/hides the MeshRenderer components registered in that level.
 *
 * Original visibility states are preserved so they can be restored when a
 * LODGroup is disabled or removed.
 */
export class SceneLodEvaluator {
    private readonly _controlledRenderers = new Map<string, LodControlledRenderer>();
    private readonly _activeRendererIdSet = new Set<string>();
    private readonly _tempCameraPos = new Vec3();

    /**
     * Evaluates all active LODGroup components and updates MeshRenderer visibility.
     *
     * @param params - The entities to evaluate and the current camera frame state.
     * @returns Statistics about the evaluation pass.
     */
    evaluate(params: SceneLodEvaluateParams): SceneLodEvaluateStats {
        const { entities, cameraFrame } = params;
        const fovRadians = resolveVerticalFieldOfViewRadians(cameraFrame);
        const tanHalfFov = Math.tan(fovRadians * 0.5);

        this._tempCameraPos.x = cameraFrame.camera3D.position.x;
        this._tempCameraPos.y = cameraFrame.camera3D.position.y;
        this._tempCameraPos.z = cameraFrame.camera3D.position.z;

        const cameraPosition = this._tempCameraPos;

        // Phase 1: Collect all LOD-controlled renderer IDs per LODGroup entity.
        this._activeRendererIdSet.clear();

        let evaluatedGroupCount = 0;

        for (const entity of entities) {
            if (!entity.active) {
                continue;
            }

            const lodGroup = entity.getComponent(LODGroup);
            if (!lodGroup || !lodGroup.enabled || !lodGroup.lodEnabled) {
                continue;
            }

            if (lodGroup.lodCount === 0) {
                continue;
            }

            const worldRefPoint = lodGroup.getWorldReferencePoint();
            const distanceSquared = computeDistanceSquared(cameraPosition, worldRefPoint);
            const distance = Math.sqrt(distanceSquared);

            let screenRelativeHeight: number;
            if (distance < 1e-6 || tanHalfFov < 1e-6) {
                screenRelativeHeight = 1;
            } else {
                screenRelativeHeight = lodGroup.size / (distance * tanHalfFov * 2);
                screenRelativeHeight = clamp01(screenRelativeHeight);
            }

            lodGroup.evaluateLOD(screenRelativeHeight);
            const activeRendererIds = lodGroup.getActiveRenderers();

            for (const rendererId of activeRendererIds) {
                this._activeRendererIdSet.add(rendererId);
            }

            evaluatedGroupCount += 1;
        }

        // Phase 2: Build the set of all renderer IDs referenced by any LODGroup
        // so we know which MeshRenderers are under LOD control.
        const allLodReferencedRendererIds = this._collectAllLodReferencedRendererIds(entities);

        // Phase 3: Apply visibility to MeshRenderers that are LOD-controlled.
        let controlledRendererCount = 0;

        for (const entity of entities) {
            if (!entity.active) {
                continue;
            }

            const meshRenderer = entity.getComponent(MeshRenderer);
            if (!meshRenderer) {
                continue;
            }

            const rendererId = meshRenderer.id as string;

            if (!allLodReferencedRendererIds.has(rendererId)) {
                // This renderer is not referenced by any LODGroup — restore
                // original visibility if we were previously controlling it.
                this._restoreRendererIfNeeded(meshRenderer, rendererId);
                continue;
            }

            // This renderer is under LOD control.
            const entry = this._ensureControlledEntry(meshRenderer, rendererId);
            const shouldBeVisible = this._activeRendererIdSet.has(rendererId);

            if (meshRenderer.visible !== shouldBeVisible) {
                meshRenderer.visible = shouldBeVisible;
            }

            controlledRendererCount += 1;
        }

        return {
            evaluatedGroupCount,
            controlledRendererCount,
        };
    }

    /**
     * Resets all tracked state, restoring original visibility on any
     * LOD-controlled MeshRenderers.
     */
    clear(): void {
        for (const [rendererId, entry] of this._controlledRenderers) {
            if (entry.tracked && entry.meshRenderer.visible !== entry.originalVisible) {
                entry.meshRenderer.visible = entry.originalVisible;
            }
        }

        this._controlledRenderers.clear();
        this._activeRendererIdSet.clear();
    }

    /**
     * Collects all renderer IDs referenced by any enabled LODGroup across all
     * LOD levels, not just the active level. This determines which
     * MeshRenderers are under LOD control.
     */
    private _collectAllLodReferencedRendererIds(entities: readonly EntityId[]): Set<string> {
        const referencedIds = new Set<string>();

        for (const entity of entities) {
            if (!entity.active) {
                continue;
            }

            const lodGroup = entity.getComponent(LODGroup);
            if (!lodGroup || !lodGroup.enabled || !lodGroup.lodEnabled) {
                continue;
            }

            const levels = lodGroup.getLODLevels();
            for (const level of levels) {
                for (const rendererId of level.renderers) {
                    referencedIds.add(rendererId);
                }
            }
        }

        return referencedIds;
    }

    /**
     * Ensures a tracking entry exists for a LOD-controlled MeshRenderer,
     * capturing its original visibility the first time.
     */
    private _ensureControlledEntry(
        meshRenderer: MeshRenderer,
        rendererId: string
    ): LodControlledRenderer {
        let entry = this._controlledRenderers.get(rendererId);
        if (!entry) {
            entry = {
                rendererId,
                meshRenderer,
                originalVisible: meshRenderer.visible,
                tracked: true,
            };
            this._controlledRenderers.set(rendererId, entry);
        } else {
            entry.tracked = true;
        }

        return entry;
    }

    /**
     * Restores original visibility for a renderer that was previously under
     * LOD control but is no longer referenced by any active LODGroup.
     */
    private _restoreRendererIfNeeded(meshRenderer: MeshRenderer, rendererId: string): void {
        const entry = this._controlledRenderers.get(rendererId);
        if (!entry || !entry.tracked) {
            return;
        }

        if (meshRenderer.visible !== entry.originalVisible) {
            meshRenderer.visible = entry.originalVisible;
        }

        entry.tracked = false;
    }
}
