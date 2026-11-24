namespace Axrone.Scene.Runtime;

using Axrone.Scene.Assets;

/// <summary>
/// Serialized animation source of a skinned actor. The scene document carries the
/// skin and default clip asset ids; a host resolves them through its asset registry
/// and rebuilds the runtime rig/controller with <see cref="SceneAnimationImporter"/>.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 8)]
public struct SceneAnimationBinding : ISceneDataComponent
{
    /// <summary>Skin asset that defines the joint order and inverse binds.</summary>
    public SceneAssetId<SkinAssetTag> Skin;

    /// <summary>Clip to start on; optional when the host selects a clip in code.</summary>
    public SceneAssetId<AnimationAssetTag> DefaultClip;

    /// <summary>Whether the binding names a skin.</summary>
    public readonly bool HasSkin => Skin.IsValid;

    /// <summary>Whether the binding names a default clip.</summary>
    public readonly bool HasDefaultClip => DefaultClip.IsValid;
}
