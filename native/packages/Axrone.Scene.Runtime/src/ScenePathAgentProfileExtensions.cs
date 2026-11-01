namespace Axrone.Scene.Runtime;

/// <summary>Profile composition helpers for path agent components.</summary>
public static class ScenePathAgentProfileExtensions
{
    /// <summary>Registers the path agent component.</summary>
    public static SceneProfileBuilder AddPathAgents3D(this SceneProfileBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.AddData<ScenePathAgent>(
            "ScenePathAgent",
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 110);

        return builder;
    }
}
