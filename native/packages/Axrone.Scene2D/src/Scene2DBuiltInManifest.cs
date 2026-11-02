namespace Axrone.Scene2D;

/// <summary>Logical component identities published by the 2D scene surface.</summary>
public enum Scene2DBuiltInComponent : byte
{
    /// <summary>Shared camera settings component.</summary>
    Camera = 0,

    /// <summary>2D camera view-distance component.</summary>
    Camera2D = 1,

    /// <summary>Sprite renderer component.</summary>
    SpriteRenderer = 2,

    /// <summary>Sprite animation component.</summary>
    SpriteAnimator = 3,

    /// <summary>Sprite clipping-mask component.</summary>
    SpriteMask = 4
}

/// <summary>
/// Typed component identities matching the web engine's 2D registry names.
/// Names are the stable contract consumed by capability checks and by future
/// rendering bridges; the CLR payloads stay in this package.
/// </summary>
public static class Scene2DComponentIds
{
    /// <summary>Shared camera component name.</summary>
    public const string Camera = "Camera";

    /// <summary>2D camera component name.</summary>
    public const string Camera2D = "Camera2D";

    /// <summary>Sprite renderer component name.</summary>
    public const string SpriteRenderer = "SpriteRenderer";

    /// <summary>Sprite animator component name.</summary>
    public const string SpriteAnimator = "SpriteAnimator";

    /// <summary>Sprite mask component name.</summary>
    public const string SpriteMask = "SpriteMask";

    /// <summary>Resolves the stable registry name for a built-in component.</summary>
    public static string ToName(Scene2DBuiltInComponent component) => component switch
    {
        Scene2DBuiltInComponent.Camera => Camera,
        Scene2DBuiltInComponent.Camera2D => Camera2D,
        Scene2DBuiltInComponent.SpriteRenderer => SpriteRenderer,
        Scene2DBuiltInComponent.SpriteAnimator => SpriteAnimator,
        Scene2DBuiltInComponent.SpriteMask => SpriteMask,
        _ => throw new SceneValidationException(
            SceneErrorCodes.ValidationInvalid,
            $"Unknown Scene2D built-in component '{component}'.")
    };

    /// <summary>Resolves the facade payload type for a built-in component.</summary>
    public static Type GetComponentType(Scene2DBuiltInComponent component) => component switch
    {
        Scene2DBuiltInComponent.Camera => typeof(Scene2DCamera),
        Scene2DBuiltInComponent.Camera2D => typeof(Scene2DCamera2D),
        Scene2DBuiltInComponent.SpriteRenderer => typeof(Scene2DSpriteRenderer),
        Scene2DBuiltInComponent.SpriteAnimator => typeof(Scene2DSpriteAnimator),
        Scene2DBuiltInComponent.SpriteMask => typeof(Scene2DSpriteMask),
        _ => throw new SceneValidationException(
            SceneErrorCodes.ValidationInvalid,
            $"Unknown Scene2D built-in component '{component}'.")
    };
}

/// <summary>
/// Built-in 2D component manifest. This is the C# counterpart of the web
/// engine's <c>SCENE_2D_BUILT_IN_MANIFEST</c>: the facade checks these ids
/// before attaching payloads, and rendering bridges use them to match payloads
/// to their backend component types.
/// </summary>
public static class Scene2DBuiltInManifest
{
    /// <summary>Stable manifest id.</summary>
    public const string Id = "scene/2d";

    private static readonly Scene2DBuiltInComponent[] BuiltIns =
    [
        Scene2DBuiltInComponent.Camera,
        Scene2DBuiltInComponent.Camera2D,
        Scene2DBuiltInComponent.SpriteRenderer,
        Scene2DBuiltInComponent.SpriteAnimator,
        Scene2DBuiltInComponent.SpriteMask
    ];

    /// <summary>Built-in components in stable manifest order.</summary>
    public static ReadOnlySpan<Scene2DBuiltInComponent> Components => BuiltIns;

    /// <summary>Number of built-in components.</summary>
    public static int Count => BuiltIns.Length;

    /// <summary>Whether the manifest declares a component.</summary>
    public static bool Contains(Scene2DBuiltInComponent component) =>
        Components.IndexOf(component) >= 0;

    /// <summary>
    /// Whether a world registers both the manifest name and the facade payload
    /// type for a component. A name collision with a backend type fails the
    /// type check so callers get a capability error instead of a payload
    /// mismatch.
    /// </summary>
    public static bool IsRegistered(SceneWorld world, Scene2DBuiltInComponent component)
    {
        ArgumentNullException.ThrowIfNull(world);

        return world.Registry.TryGetDataByType(
                Scene2DComponentIds.GetComponentType(component),
                out _) &&
            world.Registry.TryGetByName(Scene2DComponentIds.ToName(component), out _);
    }

    /// <summary>Requires a registered built-in component.</summary>
    /// <exception cref="SceneCapabilityException">
    /// The active profile does not expose the component with its facade payload.
    /// </exception>
    public static void Require(SceneWorld world, Scene2DBuiltInComponent component)
    {
        if (!IsRegistered(world, component))
        {
            string name = Scene2DComponentIds.ToName(component);
            throw new SceneCapabilityException(
                name,
                "the active scene profile does not register the Scene2D component payload.");
        }
    }
}
