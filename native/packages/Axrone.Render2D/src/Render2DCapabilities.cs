namespace Axrone.Render2D;

/// <summary>Capability identity and default shader binding of the 2D render surface.</summary>
public static class Render2DCapabilities
{
    /// <summary>Capability token owned by the 2D render surface.</summary>
    public const string CapabilityId = "render/2d";

    /// <summary>Package name that provides the capability.</summary>
    public const string PackageName = "@axrone/render-2d";

    /// <summary>Package name that owns the capability contract.</summary>
    public const string OwnerPackage = "@axrone/render-core";

    /// <summary>Shader identity used when a sprite submission carries no material.</summary>
    public const string DefaultSpriteShaderId = "render/2d/sprite-default";

    /// <summary>Renderer-independent sprite shader contract identity.</summary>
    public const string SpriteShaderId = Render2DSpriteShaderContract.DefaultShaderId;

    /// <summary>Reports whether the given capability token resolves to this surface.</summary>
    public static bool OwnsCapability(string capabilityId) =>
        string.Equals(capabilityId, CapabilityId, StringComparison.Ordinal);
}
