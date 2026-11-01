namespace Axrone.Ui.Scene;

/// <summary>Where a hosted UI document is composited.</summary>
public enum SceneUiHostRenderMode
{
    /// <summary>Drawn over the scene viewport.</summary>
    ScreenOverlay = 0,

    /// <summary>Rendered to an offscreen surface and drawn on a scene quad.</summary>
    WorldSpace = 1,
}

/// <summary>How a world-space host quad orients itself.</summary>
public enum SceneUiHostBillboard
{
    /// <summary>Follows the host actor's rotation.</summary>
    None = 0,

    /// <summary>Faces the active camera while keeping the host position.</summary>
    CameraFacing = 1,
}

/// <summary>Supported ranges shared by the component, codec and runtime.</summary>
public static class SceneUiHostLimits
{
    /// <summary>Minimum world-space quad extent.</summary>
    public const float MinWorldSize = 0.01f;

    /// <summary>Maximum world-space quad extent.</summary>
    public const float MaxWorldSize = 1000.0f;

    /// <summary>Minimum offscreen pixels per world unit.</summary>
    public const float MinTextureScale = 64.0f;

    /// <summary>Maximum offscreen pixels per world unit.</summary>
    public const float MaxTextureScale = 4096.0f;

    /// <summary>Maximum offscreen surface dimension.</summary>
    public const int MaxSurfaceDimension = 2048;

    /// <summary>Clamps a world extent into the supported range.</summary>
    public static float ClampWorldSize(float value) =>
        float.IsFinite(value) ? Math.Clamp(value, MinWorldSize, MaxWorldSize) : MinWorldSize;

    /// <summary>Clamps a texture scale into the supported range.</summary>
    public static float ClampTextureScale(float value) =>
        float.IsFinite(value) ? Math.Clamp(value, MinTextureScale, MaxTextureScale) : MinTextureScale;

    /// <summary>Resolves the offscreen surface width in pixels.</summary>
    public static int SurfaceWidth(float worldWidth, float textureScale) =>
        Math.Clamp((int)MathF.Round(ClampWorldSize(worldWidth) * ClampTextureScale(textureScale)), 1, MaxSurfaceDimension);

    /// <summary>Resolves the offscreen surface height in pixels.</summary>
    public static int SurfaceHeight(float worldHeight, float textureScale) =>
        Math.Clamp((int)MathF.Round(ClampWorldSize(worldHeight) * ClampTextureScale(textureScale)), 1, MaxSurfaceDimension);
}

/// <summary>
/// Scene component that mounts a standalone UI document on an actor. The asset
/// is resolved through <see cref="IUiHostAssetSource"/>; the bridge owns the
/// runtime and render resources.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneUiHost : ISceneDataComponent
{
    /// <summary>Symbol of the <c>.ui.json</c> asset; invalid until configured.</summary>
    public SceneStringId AssetId;

    /// <summary>Screen overlay or world-space quad.</summary>
    public SceneUiHostRenderMode RenderMode;

    /// <summary>World-space quad orientation.</summary>
    public SceneUiHostBillboard Billboard;

    /// <summary>World-space quad width in world units.</summary>
    public float WorldWidth;

    /// <summary>World-space quad height in world units.</summary>
    public float WorldHeight;

    /// <summary>Offscreen pixels per world unit.</summary>
    public float TextureScale;

    /// <summary>Whether pointer and key events are forwarded to the document.</summary>
    public bool ReceiveInput;

    /// <summary>Whether the host is active at all.</summary>
    public bool Enabled;

    /// <summary>Whether screen overlays and world quads are submitted.</summary>
    public bool Visible;

    /// <summary>Ascending screen-overlay and world-quad order.</summary>
    public int SortingOrder;

    /// <summary>Default: screen overlay, input enabled, world-space fallbacks 1x0.5 at 512 px/unit.</summary>
    public static SceneUiHost Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            AssetId = SceneStringId.Invalid,
            RenderMode = SceneUiHostRenderMode.ScreenOverlay,
            Billboard = SceneUiHostBillboard.None,
            WorldWidth = 1.0f,
            WorldHeight = 0.5f,
            TextureScale = 512.0f,
            ReceiveInput = true,
            Enabled = true,
            Visible = true,
            SortingOrder = 0,
        };
    }

    /// <summary>Whether the host renders into an offscreen world surface.</summary>
    public readonly bool IsWorldSpace
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => RenderMode == SceneUiHostRenderMode.WorldSpace;
    }
}
