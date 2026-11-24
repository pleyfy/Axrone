namespace Axrone.Scene.Rendering.OpenGL;

/// <summary>Why a material vertex shader could not be converted into a skinned variant.</summary>
public enum SkinningInjectionFailure
{
    /// <summary>Injection succeeded.</summary>
    None = 0,

    /// <summary>The vertex source was empty.</summary>
    EmptySource = 1,

    /// <summary>The first line was not a #version directive.</summary>
    MissingVersionDirective = 2,

    /// <summary>No <c>in vec3 a_Position</c> attribute was found.</summary>
    MissingPositionAttribute = 3,

    /// <summary>The shader already declares skinning attributes or uniforms.</summary>
    ExistingSkinningDeclarations = 4,

    /// <summary>Attribute location 6 or 7 is already used by the material.</summary>
    AttributeLocationConflict = 5,

    /// <summary>The injected shader failed to compile or link.</summary>
    CompilationFailed = 6,

    /// <summary>
    /// An effect backs the shader, so its authored stages own skinning. Injection is skipped on
    /// purpose and reported here rather than silently producing an unskinned variant.
    /// </summary>
    EffectAuthored = 7
}

/// <summary>Per-shader skinning compilation status.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SkinningShaderDiagnostic(
    SceneAssetId<ShaderAssetTag> Shader,
    bool Skinned,
    SkinningInjectionFailure Failure);

/// <summary>How the skinned renderer reacts to a batch it cannot draw.</summary>
public enum SceneSkinningFailureMode
{
    /// <summary>Count the failure in diagnostics and skip the batch.</summary>
    Skip = 0,

    /// <summary>Throw a configuration exception on the first failure.</summary>
    Throw = 1
}

/// <summary>Reason for skipping a skinned batch.</summary>
public enum SceneSkinningFailureReason
{
    /// <summary>No failure.</summary>
    None = 0,

    /// <summary>Mesh asset was not uploaded.</summary>
    MissingMesh = 1,

    /// <summary>Material asset was not uploaded.</summary>
    MissingMaterial = 2,

    /// <summary>The material vertex shader cannot be skinned.</summary>
    UnskinnableMaterial = 3,

    /// <summary>No palette is resident for the actor.</summary>
    MissingPalette = 4,

    /// <summary>The resident palette is empty.</summary>
    EmptyPalette = 5,

    /// <summary>The palette exceeds the configured bone budget.</summary>
    PaletteOverflow = 6,

    /// <summary>Mesh lacks position, joint or weight attributes.</summary>
    MissingSkinAttributes = 7,

    /// <summary>A material texture slot uses the reserved bone texture unit.</summary>
    TextureUnitConflict = 8
}

/// <summary>Skinned renderer configuration.</summary>
public sealed class SceneSkinningOptions
{
    /// <summary>Default options: 256 bones on unit 15, skip failures.</summary>
    public static SceneSkinningOptions Default { get; } = new();

    /// <summary>Gets the maximum bone count carried by the bone texture.</summary>
    public int MaxBones { get; init; } = 256;

    /// <summary>Gets the texture unit reserved for the bone palette.</summary>
    public int TextureUnit { get; init; } = 15;

    /// <summary>Gets the failure behavior for unskinnable batches.</summary>
    public SceneSkinningFailureMode FailureMode { get; init; } = SceneSkinningFailureMode.Skip;

    internal void Validate(GLContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        if (MaxBones <= 0)
        {
            throw new SceneConfigurationException(
                $"Skinning bone budget must be positive; received {MaxBones}.");
        }

        long texelWidth = (long)MaxBones * SkinningShaderInjector.BoneTexelsPerBone;
        if (texelWidth > context.Capabilities.MaxTextureSize)
        {
            throw new SceneConfigurationException(
                $"Skinning bone budget {MaxBones} needs a {texelWidth}-texel bone texture, " +
                $"but the context supports {context.Capabilities.MaxTextureSize}.");
        }

        int unitLimit = context.Capabilities.MaxCombinedTextureImageUnits;
        if (TextureUnit < 0 || TextureUnit >= Math.Max(unitLimit, 1))
        {
            throw new SceneConfigurationException(
                $"Skinning texture unit {TextureUnit} is outside the supported range 0..{Math.Max(unitLimit, 1) - 1}.");
        }
    }
}

/// <summary>Counters for the last skinned render call.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SceneSkinningDiagnostics(
    int DrawnBatches,
    int SkippedBatches,
    int MissingMesh,
    int MissingMaterial,
    int UnskinnableMaterial,
    int MissingPalette,
    int EmptyPalette,
    int PaletteOverflow,
    int MissingSkinAttributes,
    int TextureUnitConflict,
    SceneSkinningFailureReason LastFailure);
