namespace Axrone.Scene.Rendering;

/// <summary>
/// Compact planning record for one mesh renderer. The world matrix stays in the
/// transform store and is fetched by the backend at draw time.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneRenderItem
{
    /// <summary>Owning entity.</summary>
    public SceneEntity Entity;

    /// <summary>Mesh asset id.</summary>
    public SceneAssetId<MeshAssetTag> MeshId;

    /// <summary>Material asset id.</summary>
    public SceneAssetId<MaterialAssetTag> MaterialId;

    /// <summary>Queue order bias.</summary>
    public int RenderOrder;

    /// <summary>Squared distance from the camera.</summary>
    public float DistanceSquared;

    /// <summary>Whether the item belongs to the transparent queue.</summary>
    public bool Transparent;

    /// <summary>Whether lighting uniforms apply.</summary>
    public bool ReceiveLighting;

    /// <summary>Whether <see cref="WorldBounds"/> is valid.</summary>
    public bool HasBounds;

    /// <summary>World-space bounds used for culling.</summary>
    public BoundingSphere3 WorldBounds;
}
