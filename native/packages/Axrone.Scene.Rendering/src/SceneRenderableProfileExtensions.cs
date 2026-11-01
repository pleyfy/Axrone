namespace Axrone.Scene.Rendering;

/// <summary>Optional renderable component groups registered by a profile.</summary>
[Flags]
public enum SceneRenderableFeatures
{
    /// <summary>No optional renderables.</summary>
    None = 0,

    /// <summary>Camera-facing billboard quads.</summary>
    Billboard = 1 << 0,

    /// <summary>World-space polylines.</summary>
    Line = 1 << 1,

    /// <summary>Every optional renderable.</summary>
    All = Billboard | Line
}

/// <summary>Profile composition helpers for the optional renderable components.</summary>
public static class SceneRenderableProfileExtensions
{
    /// <summary>Registers the selected optional renderable data components.</summary>
    /// <param name="builder">Profile builder.</param>
    /// <param name="features">Component groups to register.</param>
    public static SceneProfileBuilder AddSceneRenderables(
        this SceneProfileBuilder builder,
        SceneRenderableFeatures features = SceneRenderableFeatures.All)
    {
        ArgumentNullException.ThrowIfNull(builder);

        if ((features & SceneRenderableFeatures.Billboard) != 0)
        {
            builder.AddData<SceneBillboardRenderer>(
                "BillboardRenderer",
                SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
                priority: 100);
        }

        if ((features & SceneRenderableFeatures.Line) != 0)
        {
            builder.AddData<SceneLineRenderer>(
                "LineRenderer",
                SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
                priority: 100);
        }

        return builder;
    }
}
