namespace Axrone.Scene.Assets;

using System.Collections.Immutable;
using Axrone.AssetShader;

/// <summary>
/// Options for turning a shader effect into a scene shader definition.
/// </summary>
/// <param name="Id">Scene shader identity; the effect id is used when unset.</param>
/// <param name="Version">GLSL version directive, or null for <see cref="SceneShaderEffectFactory.DefaultVersionDirective"/>.</param>
/// <param name="Attributes">Semantic-to-name bindings, or null for the scene defaults.</param>
/// <param name="Keywords">Keyword selection selecting the baked variant, or null for the effect defaults.</param>
/// <param name="ApplyRenderState">
/// Whether the effect render state seeds the definition defaults. Null means yes: a
/// <c>default</c> options value must not silently drop authored state, since record structs
/// ignore parameter defaults when zero-initialised.
/// </param>
public readonly record struct SceneShaderEffectOptions(
    SceneAssetId<ShaderAssetTag> Id = default,
    string? Version = null,
    IReadOnlyDictionary<SceneMeshSemantic, string>? Attributes = null,
    ShaderKeywordSelection? Keywords = null,
    bool? ApplyRenderState = null);

/// <summary>
/// Builds scene shader definitions from dynamically produced shader effects: the material
/// graph output, an imported <c>.effect.json</c> or a runtime-authored override.
/// </summary>
/// <remarks>
/// This is the native mirror of the Web <c>createSceneShaderDefinitionFromEffect</c> helper.
/// Baking happens here rather than in the renderer so a broken graph fails at authoring time
/// with source diagnostics, and never as a GPU compile error at the draw call.
/// </remarks>
public static class SceneShaderEffectFactory
{
    /// <summary>Version directive emitted when an effect declares none.</summary>
    public const string DefaultVersionDirective = "#version 330 core";

    private const string VersionPrefix = "#version";

    /// <summary>Default semantic-to-name table shared with the draw path.</summary>
    public static IReadOnlyDictionary<SceneMeshSemantic, string> DefaultAttributes =>
        SceneShaderAttributes.DefaultNames;

    /// <summary>
    /// Bakes an effect into a scene shader definition.
    /// </summary>
    /// <param name="effect">Effect to compile.</param>
    /// <param name="options">Identity, version, attribute and render-state options.</param>
    /// <returns>The definition, carrying the baked sources and the effect itself.</returns>
    /// <exception cref="SceneAssetException">Baking reported an error diagnostic.</exception>
    public static SceneShaderDefinition Create(ShaderEffect effect, SceneShaderEffectOptions options = default) =>
        Create(effect, options, out _);

    /// <summary>
    /// Bakes an effect into a scene shader definition and returns the bake diagnostics.
    /// </summary>
    /// <param name="effect">Effect to compile.</param>
    /// <param name="options">Identity, version, attribute and render-state options.</param>
    /// <param name="diagnostics">Diagnostics reported while baking.</param>
    /// <returns>The definition, carrying the baked sources and the effect itself.</returns>
    /// <exception cref="SceneAssetException">Baking reported an error diagnostic.</exception>
    public static SceneShaderDefinition Create(
        ShaderEffect effect,
        SceneShaderEffectOptions options,
        out ImmutableArray<ShaderDiagnostic> diagnostics)
    {
        if (!TryCreate(effect, options, out SceneShaderDefinition? definition, out diagnostics))
        {
            throw ShaderFailure(diagnostics);
        }

        return definition!;
    }

    /// <summary>
    /// Bakes an effect into a scene shader definition without throwing on source errors.
    /// </summary>
    /// <param name="effect">Effect to compile.</param>
    /// <param name="options">Identity, version, attribute and render-state options.</param>
    /// <param name="definition">Produced definition when baking reported no error.</param>
    /// <param name="diagnostics">Diagnostics reported while baking.</param>
    /// <returns>Whether the definition is usable.</returns>
    /// <exception cref="ArgumentNullException">No effect was supplied.</exception>
    public static bool TryCreate(
        ShaderEffect effect,
        SceneShaderEffectOptions options,
        out SceneShaderDefinition? definition,
        out ImmutableArray<ShaderDiagnostic> diagnostics)
    {
        ArgumentNullException.ThrowIfNull(effect);

        ShaderEffectDefinition bakedDefinition = WithVersion(effect.Definition, options.Version);
        var sink = new ShaderDiagnosticSink();
        ShaderVariant variant;
        try
        {
            variant = ShaderVariantSystem.BakeVariant(
                new ShaderEffect(bakedDefinition),
                options.Keywords,
                sink);
        }
        catch (ShaderPreprocessException error)
        {
            definition = null;
            diagnostics = error.Diagnostics;
            return false;
        }

        diagnostics = variant.Diagnostics.IsDefault ? ImmutableArray<ShaderDiagnostic>.Empty : variant.Diagnostics;
        if (HasErrors(diagnostics))
        {
            definition = null;
            return false;
        }

        SceneAssetId<ShaderAssetTag> id = options.Id.IsValid
            ? options.Id
            : SceneAssetId<ShaderAssetTag>.FromName(effect.Id.Name);

        bool depthTest = true;
        bool cull = true;
        bool blend = false;
        if ((options.ApplyRenderState ?? true) && bakedDefinition.RenderState is { } state)
        {
            ResolveRenderState(state, out depthTest, out cull, out blend);
        }

        string[] uniformNames = BuildUniformNames(variant.Uniforms);
        definition = new SceneShaderDefinition(
            id,
            variant.VertexSource,
            variant.FragmentSource,
            uniformNames,
            OverlayAttributes(options.Attributes),
            depthTest,
            cull,
            blend,
            new ShaderEffect(bakedDefinition));
        return true;
    }

    /// <summary>
    /// Overlays caller-provided attribute names on the scene defaults, so a graph that renames
    /// one input still binds every other semantic the mesh layout carries.
    /// </summary>
    /// <param name="overrides">Provided names, or null for the defaults alone.</param>
    /// <returns>The merged semantic-to-name table.</returns>
    public static IReadOnlyDictionary<SceneMeshSemantic, string> OverlayAttributes(
        IReadOnlyDictionary<SceneMeshSemantic, string>? overrides)
    {
        if (overrides is null || overrides.Count == 0)
        {
            return SceneShaderAttributes.DefaultNames;
        }

        var merged = new Dictionary<SceneMeshSemantic, string>(SceneShaderAttributes.DefaultNames);
        foreach (KeyValuePair<SceneMeshSemantic, string> pair in overrides)
        {
            merged[pair.Key] = pair.Value;
        }

        return merged;
    }

    /// <summary>
    /// Maps the authored effect render state onto the three scene state flags. Unknown values
    /// keep the scene default, so a partially specified state never disables more than it says.
    /// </summary>
    /// <param name="state">Authored render state.</param>
    /// <param name="depthTest">Whether depth testing runs.</param>
    /// <param name="cull">Whether faces are culled.</param>
    /// <param name="blend">Whether blending is enabled.</param>
    public static void ResolveRenderState(
        ShaderRenderState state,
        out bool depthTest,
        out bool cull,
        out bool blend)
    {
        depthTest = !ParseDisabled(state.DepthTest);
        cull = !string.Equals(state.CullMode, "none", StringComparison.OrdinalIgnoreCase);
        blend = !string.IsNullOrEmpty(state.BlendMode) && !ParseOpaque(state.BlendMode!);
    }

    /// <summary>
    /// Adds the version directive to any stage that lacks one, keeping authored stages byte
    /// identical so an existing effect bakes exactly as before.
    /// </summary>
    /// <param name="definition">Effect definition.</param>
    /// <param name="version">Version directive to add, or null for <see cref="DefaultVersionDirective"/>.</param>
    /// <returns>The definition with versioned stages.</returns>
    public static ShaderEffectDefinition WithVersion(in ShaderEffectDefinition definition, string? version)
    {
        string directive = string.IsNullOrWhiteSpace(version) ? DefaultVersionDirective : version!;
        return definition with
        {
            Vertex = WithVersion(definition.Vertex, directive),
            Fragment = WithVersion(definition.Fragment, directive),
        };
    }

    /// <summary>Whether a stage source already declares its GLSL version.</summary>
    /// <param name="stage">Stage definition.</param>
    /// <returns>Whether a version directive is declared.</returns>
    public static bool HasVersion(in ShaderStageDefinition stage)
    {
        if (stage.Directives.IsDefaultOrEmpty)
        {
            return false;
        }

        foreach (string directive in stage.Directives)
        {
            if (directive.AsSpan().TrimStart().StartsWith(VersionPrefix.AsSpan(), StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    private static ShaderStageDefinition WithVersion(in ShaderStageDefinition stage, string directive)
    {
        if (HasVersion(in stage))
        {
            return stage;
        }

        ImmutableArray<string>.Builder directives = ImmutableArray.CreateBuilder<string>();
        directives.Add(directive);
        if (!stage.Directives.IsDefaultOrEmpty)
        {
            directives.AddRange(stage.Directives);
        }

        return stage with { Directives = directives.ToImmutable() };
    }

    private static string[] BuildUniformNames(ImmutableArray<ShaderUniformScanResult> uniforms)
    {
        if (uniforms.IsDefaultOrEmpty)
        {
            return [];
        }

        var names = new string[uniforms.Length];
        for (int i = 0; i < uniforms.Length; i++)
        {
            names[i] = uniforms[i].Name.Name;
        }

        return names;
    }

    private static bool HasErrors(ImmutableArray<ShaderDiagnostic> diagnostics)
    {
        for (int i = 0; i < diagnostics.Length; i++)
        {
            if (diagnostics[i].Severity == ShaderDiagnosticSeverity.Error)
            {
                return true;
            }
        }

        return false;
    }

    private static SceneAssetException ShaderFailure(ImmutableArray<ShaderDiagnostic> diagnostics)
    {
        string message = "Shader effect failed to bake.";
        for (int i = 0; i < diagnostics.Length; i++)
        {
            if (diagnostics[i].Severity == ShaderDiagnosticSeverity.Error)
            {
                message = $"Shader effect failed to bake: {diagnostics[i].Message}";
                break;
            }
        }

        return new SceneAssetException(SceneAssetErrorCodes.Invalid, message);
    }

    private static bool ParseDisabled(string? value) =>
        value is not null &&
        (value.Equals("disabled", StringComparison.OrdinalIgnoreCase) ||
            value.Equals("off", StringComparison.OrdinalIgnoreCase) ||
            value.Equals("false", StringComparison.OrdinalIgnoreCase) ||
            value.Equals("none", StringComparison.OrdinalIgnoreCase));

    private static bool ParseOpaque(string value) =>
        value.Equals("opaque", StringComparison.OrdinalIgnoreCase) ||
        value.Equals("none", StringComparison.OrdinalIgnoreCase) ||
        value.Equals("off", StringComparison.OrdinalIgnoreCase) ||
        value.Equals("false", StringComparison.OrdinalIgnoreCase);
}
