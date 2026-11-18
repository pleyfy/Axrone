namespace Axrone.Scene.Assets;

using System.Collections.Frozen;

/// <summary>
/// Single source of truth for the scene vertex layout: which attribute name each mesh
/// semantic binds to, and which GPU location that semantic owns.
/// </summary>
/// <remarks>
/// The OpenGL backend uploads interleaved meshes with the semantic value as the attribute
/// location, so a generated shader whose inputs are declared without explicit locations has
/// to be qualified against this table before compiling. Keeping the names here means the
/// factory, the draw path and the preview geometry all agree without importing the renderer.
/// </remarks>
public static class SceneShaderAttributes
{
    /// <summary>Default attribute name for object-space position.</summary>
    public const string Position = "a_Position";

    /// <summary>Default attribute name for object-space normal.</summary>
    public const string Normal = "a_Normal";

    /// <summary>Default attribute name for the first texture coordinate set.</summary>
    public const string Uv0 = "a_UV0";

    /// <summary>Default attribute name for the second texture coordinate set.</summary>
    public const string Uv1 = "a_UV1";

    /// <summary>Default attribute name for the tangent frame.</summary>
    public const string Tangent = "a_Tangent";

    /// <summary>Default attribute name for vertex color.</summary>
    public const string Color0 = "a_Color0";

    /// <summary>Default attribute name for the first skinning joint set.</summary>
    public const string Joints0 = "a_Joints0";

    /// <summary>Default attribute name for the first skinning weight set.</summary>
    public const string Weights0 = "a_Weights0";

    /// <summary>Default attribute name for the second skinning joint set.</summary>
    public const string Joints1 = "a_Joints1";

    /// <summary>Default attribute name for the second skinning weight set.</summary>
    public const string Weights1 = "a_Weights1";

    private static readonly FrozenDictionary<SceneMeshSemantic, string> s_defaultNames =
        new Dictionary<SceneMeshSemantic, string>
        {
            [SceneMeshSemantic.Position] = Position,
            [SceneMeshSemantic.Normal] = Normal,
            [SceneMeshSemantic.Uv0] = Uv0,
            [SceneMeshSemantic.Uv1] = Uv1,
            [SceneMeshSemantic.Tangent] = Tangent,
            [SceneMeshSemantic.Color0] = Color0,
            [SceneMeshSemantic.Joints0] = Joints0,
            [SceneMeshSemantic.Weights0] = Weights0,
            [SceneMeshSemantic.Joints1] = Joints1,
            [SceneMeshSemantic.Weights1] = Weights1
        }.ToFrozenDictionary();

    /// <summary>Default attribute name per semantic, read-only and shared.</summary>
    public static IReadOnlyDictionary<SceneMeshSemantic, string> DefaultNames => s_defaultNames;

    /// <summary>Resolves the default attribute name for a semantic.</summary>
    /// <param name="semantic">Attribute semantic.</param>
    /// <returns>The default name.</returns>
    public static string DefaultName(SceneMeshSemantic semantic) =>
        s_defaultNames.TryGetValue(semantic, out string? name) ? name : semantic.ToString();

    /// <summary>Resolves the GPU attribute location a semantic owns.</summary>
    /// <param name="semantic">Attribute semantic.</param>
    /// <returns>The location index, identical to the semantic value.</returns>
    public static int LocationOf(SceneMeshSemantic semantic) => (int)semantic;

    /// <summary>Resolves the semantic behind an attribute location.</summary>
    /// <param name="location">Attribute location index.</param>
    /// <param name="semantic">Resolved semantic when the location is known.</param>
    /// <returns>Whether the location maps to a scene semantic.</returns>
    public static bool TryResolveLocation(int location, out SceneMeshSemantic semantic)
    {
        foreach (KeyValuePair<SceneMeshSemantic, string> pair in s_defaultNames)
        {
            if ((int)pair.Key == location)
            {
                semantic = pair.Key;
                return true;
            }
        }

        semantic = default;
        return false;
    }
}
