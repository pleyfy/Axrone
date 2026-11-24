namespace Axrone.Scene.Runtime;

/// <summary>Profile composition helpers for animator components.</summary>
public static class SceneAnimatorProfileExtensions
{
    /// <summary>Registers the animator component.</summary>
    public static SceneProfileBuilder AddAnimators3D(this SceneProfileBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.AddData<SceneAnimator>(
            "SceneAnimator",
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 110);

        builder.AddData<SceneAnimationBinding>(
            "SceneAnimationBinding",
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 111);

        return builder;
    }
}
