import type { AnimatorClipConfig } from './components/animator';

/**
 * One addressable animation clip asset: a named group of clips that a scene
 * document references by id instead of embedding the keyframes.
 */
export interface SceneAnimationClipAsset {
    readonly id: string;
    readonly clips: readonly AnimatorClipConfig[];
}

/**
 * Addressable store for animation clip assets. A scene document carries
 * {@link AnimatorClipAssetReference}s; the runtime resolves them here once, so
 * documents stay small and several prefabs share one clip set.
 */
export class SceneAnimationClipAssetLibrary {
    private readonly _assets = new Map<string, readonly AnimatorClipConfig[]>();

    /** Number of registered assets. */
    get size(): number {
        return this._assets.size;
    }

    /** Registers or replaces an asset. */
    register(asset: SceneAnimationClipAsset): this {
        if (!asset || typeof asset.id !== 'string' || asset.id.length === 0) {
            throw new Error('Animation clip assets require a non-empty id');
        }
        if (!Array.isArray(asset.clips)) {
            throw new Error(`Animation clip asset '${asset.id}' requires a clips array`);
        }

        this._assets.set(
            asset.id,
            Object.freeze(
                asset.clips
                    .filter(
                        (clip): clip is AnimatorClipConfig =>
                            Boolean(clip && typeof clip.id === 'string' && Array.isArray(clip.tracks))
                    )
                    .map((clip) => Object.freeze({ ...clip }))
            )
        );
        return this;
    }

    /** Whether an asset is registered. */
    has(id: string): boolean {
        return this._assets.has(id);
    }

    /** Clips of an asset, if it is registered. */
    get(id: string): readonly AnimatorClipConfig[] | undefined {
        return this._assets.get(id);
    }

    /** Removes an asset. */
    unregister(id: string): boolean {
        return this._assets.delete(id);
    }

    /** Drops every asset. */
    clear(): void {
        this._assets.clear();
    }
}

/**
 * Library the runtime resolves animator clip references from by default. A host
 * registers its clip assets here at startup; a test or a second scene graph can
 * use its own instance and pass it explicitly.
 */
export const sceneAnimationClipAssets = new SceneAnimationClipAssetLibrary();

/**
 * A scene document's reference to an addressable clip asset.
 */
export interface AnimatorClipAssetReference {
    readonly assetId: string;
}

/**
 * Resolves clip asset references against a library, preserving reference order
 * and skipping unknown ids. Later duplicates of a clip id keep the first clip.
 */
export const resolveAnimationClipAssets = (
    references: readonly (string | AnimatorClipAssetReference)[],
    library: SceneAnimationClipAssetLibrary = sceneAnimationClipAssets
): readonly AnimatorClipConfig[] => {
    const clips: AnimatorClipConfig[] = [];
    const seen = new Set<string>();

    for (let index = 0; index < references.length; index += 1) {
        const reference = references[index]!;
        const assetId = typeof reference === 'string' ? reference : reference?.assetId;
        if (typeof assetId !== 'string' || assetId.length === 0) {
            continue;
        }

        const assetClips = library.get(assetId);
        if (!assetClips) {
            continue;
        }

        for (let clipIndex = 0; clipIndex < assetClips.length; clipIndex += 1) {
            const clip = assetClips[clipIndex]!;
            if (seen.has(clip.id)) {
                continue;
            }
            seen.add(clip.id);
            clips.push(clip);
        }
    }

    return Object.freeze(clips);
};
