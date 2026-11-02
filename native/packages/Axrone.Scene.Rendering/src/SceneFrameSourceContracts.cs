namespace Axrone.Scene.Rendering;

/// <summary>Optional frame-source extension for skinned meshes.</summary>
public interface ISceneSkinnedMeshFrameItemSource
{
    /// <summary>Collects skinned batches for one pass.</summary>
    ReadOnlySpan<SceneSkinnedMeshRenderItem> CollectSkinnedMeshes(SceneAssetId<RenderPassAssetTag> passId);
}

/// <summary>
/// Optional frame-source extension for LOD groups. The returned records feed the
/// existing mesh executor after the selected level has been resolved.
/// </summary>
public interface ISceneLodFrameItemSource
{
    /// <summary>Collects mesh items whose mesh/material were selected by LOD evaluation.</summary>
    ReadOnlySpan<SceneRenderItem> CollectLodMeshItems(SceneAssetId<RenderPassAssetTag> passId);
}

/// <summary>Optional frame-source extension for billboard, line and trail batches.</summary>
public interface IScenePrimitiveFrameItemSource
{
    /// <summary>Collects billboard quads for one pass.</summary>
    ReadOnlySpan<SceneBillboardRenderItem> CollectBillboards(SceneAssetId<RenderPassAssetTag> passId);

    /// <summary>Collects world-space line segments for one pass.</summary>
    ReadOnlySpan<SceneLineRenderItem> CollectLines(SceneAssetId<RenderPassAssetTag> passId);

    /// <summary>Collects fading trail segments for one pass.</summary>
    ReadOnlySpan<SceneTrailRenderItem> CollectTrails(SceneAssetId<RenderPassAssetTag> passId);
}

/// <summary>Optional frame-source extension for area lights.</summary>
public interface ISceneAreaLightSource
{
    /// <summary>Gets the area lights collected for the current frame.</summary>
    ReadOnlySpan<SceneAreaLightRenderItem> AreaLights { get; }
}
