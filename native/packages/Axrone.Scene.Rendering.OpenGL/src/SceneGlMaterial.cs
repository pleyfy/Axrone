namespace Axrone.Scene.Rendering.OpenGL;

/// <summary>Resolved texture/sampler pair for one material slot.</summary>
public readonly record struct SceneGlTextureSlot(
    string UniformName,
    int Unit,
    GLTexture Texture,
    GLSampler Sampler);

/// <summary>Flattened custom uniform entry used by the allocation-free draw loop.</summary>
public readonly record struct SceneGlUniformEntry(string Name, SceneUniformValue Value);

/// <summary>
/// A material uniform the draw path deliberately skipped, with the reason it was skipped.
/// </summary>
/// <param name="Name">Authored uniform name.</param>
/// <param name="AuthoredKind">Kind the material value carries.</param>
/// <param name="DeclaredType">Type the compiled program declares.</param>
/// <param name="Reason">Why the value was not bound.</param>
public readonly record struct SceneGlUniformBindingDiagnostic(
    string Name,
    SceneUniformKind AuthoredKind,
    SceneShaderUniformType DeclaredType,
    string Reason);

/// <summary>
/// GPU-ready material: compiled shader, resolved texture slots and the canonical
/// definition used for uniform and state binding.
/// </summary>
public sealed class SceneGlMaterial
{
    /// <summary>Creates a GPU material.</summary>
    public SceneGlMaterial(
        SceneMaterialDefinition definition,
        SceneGlShader shader,
        SceneGlTextureSlot[] textureSlots,
        SceneGlShader? skinnedShader = null,
        SceneGlShaderState? shaderState = null,
        SceneGlUniformBindingDiagnostic[]? uniformDiagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(definition);
        ArgumentNullException.ThrowIfNull(shader);
        ArgumentNullException.ThrowIfNull(textureSlots);

        Definition = definition;
        Shader = shader;
        SkinnedShader = skinnedShader;
        TextureSlots = textureSlots;
        ShaderState = shaderState ?? SceneGlShaderState.Default;
        PrimaryPass = ResolvePrimaryPass(definition.Passes);
        var skipped = new List<SceneGlUniformBindingDiagnostic>();
        UniformEntries = FlattenUniforms(definition.Uniforms, shader.Reflection, skipped);
        UniformDiagnostics = UniformDiagnosticsFrom(skipped, uniformDiagnostics);
    }

    /// <summary>Canonical material definition.</summary>
    public SceneMaterialDefinition Definition { get; }

    /// <summary>Compiled shader.</summary>
    public SceneGlShader Shader { get; }

    /// <summary>Skinning variant of <see cref="Shader"/>, or null when the material vertex shader cannot be skinned.</summary>
    public SceneGlShader? SkinnedShader { get; }

    /// <summary>Resolved texture slots.</summary>
    public ReadOnlyMemory<SceneGlTextureSlot> TextureSlots { get; }

    /// <summary>Flattened custom uniforms in declaration order, excluding the ones the program cannot accept.</summary>
    public ReadOnlyMemory<SceneGlUniformEntry> UniformEntries { get; }

    /// <summary>Fixed-function state the material's shader authors for itself.</summary>
    public SceneGlShaderState ShaderState { get; }

    /// <summary>Material uniforms the draw path skipped, in declaration order.</summary>
    public ReadOnlyMemory<SceneGlUniformBindingDiagnostic> UniformDiagnostics { get; }

    /// <summary>Whether any material uniform was skipped during binding resolution.</summary>
    public bool HasUniformDiagnostics => UniformDiagnostics.Length > 0;

    /// <summary>Pass used for state overrides, if any.</summary>
    public SceneMaterialPass? PrimaryPass { get; }

    /// <summary>Surface parameters.</summary>
    public SceneMaterialSurface Surface => Definition.Surface;

    /// <summary>Custom uniform values.</summary>
    public IReadOnlyDictionary<string, SceneUniformValue> Uniforms => Definition.Uniforms;

    /// <summary>
    /// Whether the authored value kind can be uploaded to a uniform of the declared type.
    /// Sampler and matrix declarations never take a material value, and a mismatched width
    /// would raise a GL error on every draw, so both are rejected here instead.
    /// </summary>
    /// <param name="authoredKind">Kind the material value carries.</param>
    /// <param name="declaredType">Type the compiled program declares.</param>
    /// <returns>Whether the pair can be bound.</returns>
    public static bool IsBindable(SceneUniformKind authoredKind, SceneShaderUniformType declaredType)
    {
        if (SceneShaderUniformReflection.IsSampler(declaredType))
        {
            return false;
        }

        return declaredType switch
        {
            SceneShaderUniformType.Float => authoredKind == SceneUniformKind.Float,
            SceneShaderUniformType.Int => authoredKind is SceneUniformKind.Int or SceneUniformKind.UInt,
            SceneShaderUniformType.UInt => authoredKind is SceneUniformKind.UInt or SceneUniformKind.Int,
            SceneShaderUniformType.Bool => authoredKind is SceneUniformKind.Bool
                or SceneUniformKind.Int
                or SceneUniformKind.UInt,
            SceneShaderUniformType.Vec2 or SceneShaderUniformType.Ivec2 or SceneShaderUniformType.Uvec2 =>
                authoredKind == SceneUniformKind.Vec2,
            SceneShaderUniformType.Vec3 or SceneShaderUniformType.Ivec3 or SceneShaderUniformType.Uvec3 =>
                authoredKind == SceneUniformKind.Vec3,
            SceneShaderUniformType.Vec4 or SceneShaderUniformType.Ivec4 or SceneShaderUniformType.Uvec4 =>
                authoredKind == SceneUniformKind.Vec4,
            SceneShaderUniformType.Mat3 or SceneShaderUniformType.Mat4 => false,
            _ => true
        };
    }

    private static SceneMaterialPass? ResolvePrimaryPass(IReadOnlyList<SceneMaterialPass> passes)
    {
        if (passes.Count == 0)
        {
            return null;
        }

        for (int i = 0; i < passes.Count; i++)
        {
            if (string.Equals(passes[i].Id, "main", StringComparison.Ordinal))
            {
                return passes[i];
            }
        }

        return passes[0];
    }

    private static SceneGlUniformEntry[] FlattenUniforms(
        IReadOnlyDictionary<string, SceneUniformValue> uniforms,
        SceneShaderUniformReflection reflection,
        List<SceneGlUniformBindingDiagnostic> skipped)
    {
        if (uniforms.Count == 0)
        {
            return [];
        }

        var entries = new List<SceneGlUniformEntry>(uniforms.Count);
        foreach (KeyValuePair<string, SceneUniformValue> pair in uniforms)
        {
            if (!reflection.TryGet(pair.Key, out SceneShaderUniform declared))
            {
                entries.Add(new SceneGlUniformEntry(pair.Key, pair.Value));
                continue;
            }

            if (IsBindable(pair.Value.Kind, declared.Type))
            {
                entries.Add(new SceneGlUniformEntry(pair.Key, pair.Value));
                continue;
            }

            skipped.Add(new SceneGlUniformBindingDiagnostic(
                pair.Key,
                pair.Value.Kind,
                declared.Type,
                SkipReason(pair.Value.Kind, declared.Type)));
        }

        return entries.ToArray();
    }

    private static string SkipReason(SceneUniformKind authoredKind, SceneShaderUniformType declaredType) =>
        SceneShaderUniformReflection.IsSampler(declaredType)
            ? "Declared as a sampler; bind it through the material texture uniforms."
            : $"The program declares {declaredType}; the material value is {authoredKind}.";

    private static SceneGlUniformBindingDiagnostic[] UniformDiagnosticsFrom(
        List<SceneGlUniformBindingDiagnostic> skipped,
        SceneGlUniformBindingDiagnostic[]? extra)
    {
        if (extra is null || extra.Length == 0)
        {
            return skipped.ToArray();
        }

        var merged = new SceneGlUniformBindingDiagnostic[skipped.Count + extra.Length];
        skipped.CopyTo(merged, 0);
        extra.CopyTo(merged, skipped.Count);
        return merged;
    }
}
