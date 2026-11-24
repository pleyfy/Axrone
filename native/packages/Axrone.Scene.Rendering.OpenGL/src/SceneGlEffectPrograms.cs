namespace Axrone.Scene.Rendering.OpenGL;

using System.Collections.Immutable;
using Axrone.AssetShader;

/// <summary>One resolved effect pass: its program and the fixed-function state it declares.</summary>
/// <param name="Id">Pass identity inside the technique.</param>
/// <param name="Shader">Compiled program for this pass and keyword selection.</param>
/// <param name="State">Pass state, or the effect state when the pass declares none.</param>
public readonly record struct SceneGlEffectPass(ShaderSymbol Id, SceneGlShader Shader, ShaderRenderState? State);

/// <summary>
/// Resolves effect techniques and passes into cached GPU programs. This is the seam that makes the
/// asset-layer effect model the source of scene shaders: a material selects a technique and a
/// keyword set, and the variant baker produces the GLSL that is compiled here.
/// </summary>
/// <remarks>
/// <para>Programs are cached per effect, technique, pass and keyword selection, so a material that
/// animates a keyword recompiles once per distinct selection and never per frame.</para>
/// <para>A variant that bakes with an error diagnostic throws. A broken effect must not silently
/// degrade to a raw shader string, because the failure would then be invisible at the draw call.</para>
/// <para>The resolver owns every program it compiles; a caller that stores one must not dispose it
/// independently.</para>
/// </remarks>
public sealed class SceneGlEffectPrograms : IDisposable
{
    private readonly record struct ProgramKey(
        ShaderSymbol Effect,
        ShaderSymbol Technique,
        ShaderSymbol Pass,
        ShaderKeywordSelection Keywords);

    private static readonly ShaderSymbol BasePassId = new("base");
    private static readonly ShaderSymbol DefaultTechniqueId = new("default");

    private readonly GLContext _context;
    private readonly Dictionary<ProgramKey, SceneGlShader> _programs = new();
    private bool _disposed;

    /// <summary>Creates a resolver over one GL context.</summary>
    /// <param name="context">Context that owns the compiled programs.</param>
    public SceneGlEffectPrograms(GLContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        _context = context;
    }

    /// <summary>Resolves every pass of a technique, in declaration order.</summary>
    /// <param name="effect">The effect to resolve.</param>
    /// <param name="techniqueId">Technique to select; null takes the default, then the first.</param>
    /// <param name="keywords">Keyword selection; null takes the effect defaults.</param>
    /// <returns>The resolved passes.</returns>
    /// <exception cref="ArgumentException">The requested technique does not exist.</exception>
    public ImmutableArray<SceneGlEffectPass> ResolveTechnique(
        ShaderEffect effect,
        ShaderSymbol? techniqueId,
        ShaderKeywordSelection? keywords)
    {
        ArgumentNullException.ThrowIfNull(effect);
        ObjectDisposedException.ThrowIf(_disposed, this);

        ImmutableArray<ShaderPassDefinition> passes = SelectPasses(effect, techniqueId, out ShaderSymbol technique);
        ImmutableArray<SceneGlEffectPass>.Builder builder = ImmutableArray.CreateBuilder<SceneGlEffectPass>(passes.Length);
        for (int i = 0; i < passes.Length; i++)
        {
            builder.Add(ResolvePassCore(effect, technique, passes[i], keywords));
        }

        return builder.MoveToImmutable();
    }

    /// <summary>
    /// Resolves only the pass a technique draws with: its first declared pass.
    /// </summary>
    /// <param name="effect">The effect to resolve.</param>
    /// <param name="techniqueId">Technique to select; null takes the default, then the first.</param>
    /// <param name="keywords">Keyword selection; null takes the effect defaults.</param>
    /// <returns>The resolved draw pass.</returns>
    /// <remarks>
    /// A technique's remaining passes describe stages the frame may run elsewhere; compiling them
    /// for every material that selects the technique would allocate programs no draw ever binds.
    /// Use <see cref="ResolveTechnique"/> when a host needs the whole declaration.
    /// </remarks>
    /// <exception cref="ArgumentException">The requested technique does not exist.</exception>
    public SceneGlEffectPass ResolveDrawPass(
        ShaderEffect effect,
        ShaderSymbol? techniqueId,
        ShaderKeywordSelection? keywords)
    {
        ArgumentNullException.ThrowIfNull(effect);
        ObjectDisposedException.ThrowIf(_disposed, this);

        ImmutableArray<ShaderPassDefinition> passes = SelectPasses(effect, techniqueId, out ShaderSymbol technique);
        return ResolvePassCore(effect, technique, passes[0], keywords);
    }

    /// <summary>Resolves one pass of a technique.</summary>
    /// <param name="effect">The effect to resolve.</param>
    /// <param name="techniqueId">Technique to select; null takes the default, then the first.</param>
    /// <param name="passId">Pass identity inside the technique.</param>
    /// <param name="keywords">Keyword selection; null takes the effect defaults.</param>
    /// <returns>The resolved pass.</returns>
    /// <exception cref="ArgumentException">The technique or the pass does not exist.</exception>
    public SceneGlEffectPass ResolvePass(
        ShaderEffect effect,
        ShaderSymbol? techniqueId,
        ShaderSymbol passId,
        ShaderKeywordSelection? keywords)
    {
        ArgumentNullException.ThrowIfNull(effect);
        ObjectDisposedException.ThrowIf(_disposed, this);

        ImmutableArray<ShaderPassDefinition> passes = SelectPasses(effect, techniqueId, out ShaderSymbol technique);
        for (int i = 0; i < passes.Length; i++)
        {
            if (passes[i].Id.Equals(passId))
            {
                return ResolvePassCore(effect, technique, passes[i], keywords);
            }
        }

        throw new ArgumentException(
            $"Effect '{effect.Id.Name}' technique '{technique.Name}' has no pass '{passId.Name}'.",
            nameof(passId));
    }

    /// <summary>Releases every compiled program.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        foreach (SceneGlShader shader in _programs.Values)
        {
            shader.Dispose();
        }

        _programs.Clear();
    }

    private static ImmutableArray<ShaderPassDefinition> SelectPasses(
        ShaderEffect effect,
        ShaderSymbol? techniqueId,
        out ShaderSymbol technique)
    {
        ImmutableArray<ShaderTechniqueDefinition> techniques = effect.Definition.Techniques;
        if (techniques.IsDefaultOrEmpty)
        {
            technique = DefaultTechniqueId;
            return [new ShaderPassDefinition(BasePassId)];
        }

        ShaderSymbol wanted = techniqueId ?? effect.Definition.DefaultTechnique ?? techniques[0].Id;
        for (int i = 0; i < techniques.Length; i++)
        {
            if (!techniques[i].Id.Equals(wanted))
            {
                continue;
            }

            technique = techniques[i].Id;
            ImmutableArray<ShaderPassDefinition> passes = techniques[i].Passes;
            return passes.IsDefaultOrEmpty ? [new ShaderPassDefinition(BasePassId)] : passes;
        }

        throw new ArgumentException($"Effect '{effect.Id.Name}' has no technique '{wanted.Name}'.", nameof(techniqueId));
    }

    private SceneGlEffectPass ResolvePassCore(
        ShaderEffect effect,
        ShaderSymbol technique,
        ShaderPassDefinition pass,
        ShaderKeywordSelection? keywords)
    {
        ShaderKeywordSelection selection = keywords ?? ShaderKeywordSelection.Empty;
        var key = new ProgramKey(effect.Id, technique, pass.Id, selection);
        ShaderRenderState? state = pass.RenderState ?? effect.Definition.RenderState;
        if (_programs.TryGetValue(key, out SceneGlShader? cached))
        {
            return new SceneGlEffectPass(pass.Id, cached, state);
        }

        ShaderEffectDefinition perPass = effect.Definition with
        {
            Vertex = pass.VertexOverride ?? effect.Definition.Vertex,
            Fragment = pass.FragmentOverride ?? effect.Definition.Fragment,
        };

        ShaderVariant variant = ShaderVariantSystem.BakeVariant(new ShaderEffect(perPass), selection);
        ImmutableArray<ShaderDiagnostic> diagnostics = variant.Diagnostics;
        if (!diagnostics.IsDefault)
        {
            for (int i = 0; i < diagnostics.Length; i++)
            {
                if (diagnostics[i].Severity == ShaderDiagnosticSeverity.Error)
                {
                    throw new InvalidOperationException(
                        $"Effect '{effect.Id.Name}' pass '{pass.Id.Name}' failed to bake: {diagnostics[i].Message}");
                }
            }
        }

        var shader = new SceneGlShader(
            _context,
            $"{effect.Id.Name}/{technique.Name}/{pass.Id.Name}",
            variant.VertexSource,
            variant.FragmentSource);
        _programs[key] = shader;
        return new SceneGlEffectPass(pass.Id, shader, state);
    }
}
