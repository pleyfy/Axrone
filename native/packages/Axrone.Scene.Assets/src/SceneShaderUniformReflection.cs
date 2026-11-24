namespace Axrone.Scene.Assets;

using System.Collections.Immutable;
using Axrone.AssetShader;

/// <summary>GLSL uniform types a material may bind.</summary>
public enum SceneShaderUniformType : byte
{
    /// <summary>Type could not be recognised from the declaration.</summary>
    Unsupported = 0,

    /// <summary><c>float</c>.</summary>
    Float,

    /// <summary><c>vec2</c>.</summary>
    Vec2,

    /// <summary><c>vec3</c>.</summary>
    Vec3,

    /// <summary><c>vec4</c>.</summary>
    Vec4,

    /// <summary><c>int</c>.</summary>
    Int,

    /// <summary><c>uint</c>.</summary>
    UInt,

    /// <summary><c>bool</c>.</summary>
    Bool,

    /// <summary><c>mat3</c>.</summary>
    Mat3,

    /// <summary><c>mat4</c>.</summary>
    Mat4,

    /// <summary><c>ivec2</c>.</summary>
    Ivec2,

    /// <summary><c>ivec3</c>.</summary>
    Ivec3,

    /// <summary><c>ivec4</c>.</summary>
    Ivec4,

    /// <summary><c>uvec2</c>.</summary>
    Uvec2,

    /// <summary><c>uvec3</c>.</summary>
    Uvec3,

    /// <summary><c>uvec4</c>.</summary>
    Uvec4,

    /// <summary><c>sampler2D</c>.</summary>
    Sampler2D,

    /// <summary><c>samplerCube</c>.</summary>
    SamplerCube,

    /// <summary><c>sampler3D</c>.</summary>
    Sampler3D,
}

/// <summary>One reflected uniform: name, declared type and array length.</summary>
/// <param name="Name">Uniform name as declared in the source.</param>
/// <param name="Type">Recognised GLSL type.</param>
/// <param name="ArrayLength">Declared element count, or zero for a scalar uniform.</param>
public readonly record struct SceneShaderUniform(string Name, SceneShaderUniformType Type, int ArrayLength);

/// <summary>
/// Uniform reflection over a shader's GLSL sources. The scan is done at upload time, so a
/// dynamically generated material shader needs no metadata to describe its own inputs.
/// </summary>
public sealed class SceneShaderUniformReflection
{
    private static readonly SceneShaderUniformReflection s_empty =
        new(ImmutableArray<SceneShaderUniform>.Empty);

    private readonly ImmutableArray<SceneShaderUniform> _uniforms;
    private ImmutableArray<string>? _samplerNames;

    private SceneShaderUniformReflection(ImmutableArray<SceneShaderUniform> uniforms)
    {
        _uniforms = uniforms;
    }

    /// <summary>A reflection with no uniforms.</summary>
    public static SceneShaderUniformReflection Empty => s_empty;

    /// <summary>Whether the sources declare no uniforms at all.</summary>
    public bool IsEmpty => _uniforms.IsDefaultOrEmpty;

    /// <summary>Reflected uniforms in declaration order.</summary>
    public IReadOnlyList<SceneShaderUniform> Uniforms => _uniforms;

    /// <summary>Names of the sampler uniforms, in declaration order.</summary>
    public IReadOnlyList<string> SamplerNames
    {
        get
        {
            if (_samplerNames is null)
            {
                ImmutableArray<string>.Builder builder = ImmutableArray.CreateBuilder<string>();
                for (int i = 0; i < _uniforms.Length; i++)
                {
                    if (IsSampler(_uniforms[i].Type))
                    {
                        builder.Add(_uniforms[i].Name);
                    }
                }

                _samplerNames = builder.ToImmutable();
            }

            return _samplerNames;
        }
    }

    /// <summary>Scans both stages for uniform declarations.</summary>
    /// <param name="vertexSource">Vertex stage source.</param>
    /// <param name="fragmentSource">Fragment stage source.</param>
    /// <returns>Reflected uniforms, deduplicated by name.</returns>
    public static SceneShaderUniformReflection FromSources(string vertexSource, string fragmentSource)
    {
        ArgumentNullException.ThrowIfNull(vertexSource);
        ArgumentNullException.ThrowIfNull(fragmentSource);

        ImmutableArray<ShaderUniformScanResult> scanned = UniformExtractor.ScanUniforms(
            vertexSource.AsSpan(),
            fragmentSource.AsSpan());
        if (scanned.IsDefaultOrEmpty)
        {
            return s_empty;
        }

        ImmutableArray<SceneShaderUniform>.Builder builder =
            ImmutableArray.CreateBuilder<SceneShaderUniform>(scanned.Length);
        for (int i = 0; i < scanned.Length; i++)
        {
            ShaderUniformScanResult result = scanned[i];
            builder.Add(new SceneShaderUniform(
                result.Name.Name,
                MapType(result.Type.Name),
                result.ArrayLength));
        }

        return new SceneShaderUniformReflection(builder.ToImmutable());
    }

    /// <summary>Builds a reflection from already scanned declarations.</summary>
    /// <param name="scanned">Scan results from a baked variant.</param>
    /// <returns>Reflected uniforms, deduplicated by name.</returns>
    public static SceneShaderUniformReflection FromScan(ImmutableArray<ShaderUniformScanResult> scanned)
    {
        if (scanned.IsDefaultOrEmpty)
        {
            return s_empty;
        }

        ImmutableArray<SceneShaderUniform>.Builder builder =
            ImmutableArray.CreateBuilder<SceneShaderUniform>(scanned.Length);
        for (int i = 0; i < scanned.Length; i++)
        {
            ShaderUniformScanResult result = scanned[i];
            builder.Add(new SceneShaderUniform(
                result.Name.Name,
                MapType(result.Type.Name),
                result.ArrayLength));
        }

        return new SceneShaderUniformReflection(builder.ToImmutable());
    }

    /// <summary>Looks up one reflected uniform.</summary>
    /// <param name="name">Uniform name.</param>
    /// <param name="uniform">Uniform metadata when found.</param>
    /// <returns>Whether the source declares the name.</returns>
    public bool TryGet(string name, out SceneShaderUniform uniform)
    {
        ArgumentNullException.ThrowIfNull(name);
        for (int i = 0; i < _uniforms.Length; i++)
        {
            if (string.Equals(_uniforms[i].Name, name, StringComparison.Ordinal))
            {
                uniform = _uniforms[i];
                return true;
            }
        }

        uniform = default;
        return false;
    }

    /// <summary>Maps a GLSL type name to the recognised uniform type.</summary>
    /// <param name="glslType">Type token as written in the declaration.</param>
    /// <returns>Mapped type, or <see cref="SceneShaderUniformType.Unsupported"/>.</returns>
    public static SceneShaderUniformType MapType(string? glslType) => glslType switch
    {
        "float" => SceneShaderUniformType.Float,
        "vec2" => SceneShaderUniformType.Vec2,
        "vec3" => SceneShaderUniformType.Vec3,
        "vec4" => SceneShaderUniformType.Vec4,
        "int" => SceneShaderUniformType.Int,
        "uint" => SceneShaderUniformType.UInt,
        "bool" => SceneShaderUniformType.Bool,
        "mat3" => SceneShaderUniformType.Mat3,
        "mat4" => SceneShaderUniformType.Mat4,
        "ivec2" => SceneShaderUniformType.Ivec2,
        "ivec3" => SceneShaderUniformType.Ivec3,
        "ivec4" => SceneShaderUniformType.Ivec4,
        "uvec2" => SceneShaderUniformType.Uvec2,
        "uvec3" => SceneShaderUniformType.Uvec3,
        "uvec4" => SceneShaderUniformType.Uvec4,
        "sampler2D" => SceneShaderUniformType.Sampler2D,
        "samplerCube" => SceneShaderUniformType.SamplerCube,
        "sampler3D" => SceneShaderUniformType.Sampler3D,
        _ => SceneShaderUniformType.Unsupported
    };

    /// <summary>Whether a type is a texture sampler.</summary>
    /// <param name="type">Uniform type.</param>
    /// <returns>Whether the uniform samples a texture.</returns>
    public static bool IsSampler(SceneShaderUniformType type) =>
        type is SceneShaderUniformType.Sampler2D
            or SceneShaderUniformType.SamplerCube
            or SceneShaderUniformType.Sampler3D;

    /// <summary>Maps a sampler type to its authored value kind, when expressible.</summary>
    /// <param name="type">Reflected uniform type.</param>
    /// <param name="kind">Matching authored value kind.</param>
    /// <returns>Whether a material value can carry this type.</returns>
    public static bool TryGetValueKind(SceneShaderUniformType type, out SceneUniformKind kind)
    {
        switch (type)
        {
            case SceneShaderUniformType.Float:
                kind = SceneUniformKind.Float;
                return true;
            case SceneShaderUniformType.Int:
                kind = SceneUniformKind.Int;
                return true;
            case SceneShaderUniformType.UInt:
                kind = SceneUniformKind.UInt;
                return true;
            case SceneShaderUniformType.Bool:
                kind = SceneUniformKind.Bool;
                return true;
            case SceneShaderUniformType.Vec2:
            case SceneShaderUniformType.Ivec2:
            case SceneShaderUniformType.Uvec2:
                kind = SceneUniformKind.Vec2;
                return true;
            case SceneShaderUniformType.Vec3:
            case SceneShaderUniformType.Ivec3:
            case SceneShaderUniformType.Uvec3:
                kind = SceneUniformKind.Vec3;
                return true;
            case SceneShaderUniformType.Vec4:
            case SceneShaderUniformType.Ivec4:
            case SceneShaderUniformType.Uvec4:
                kind = SceneUniformKind.Vec4;
                return true;
            default:
                kind = SceneUniformKind.Float;
                return false;
        }
    }
}
