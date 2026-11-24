namespace Axrone.Scene.Rendering.OpenGL;

/// <summary>
/// Built-in post-process effects, numbered exactly as the <c>u_effectMode</c> branches of the
/// post-process uber fragment shader and as the render requirements document lists them.
/// </summary>
public enum ScenePostProcessEffect
{
    /// <summary>
    /// No effect. This is also the presentation mode: the shader's mode 0 branch falls through every
    /// effect test and copies the input, which is exactly what the final draw to the default
    /// framebuffer needs.
    /// </summary>
    None = 0,

    /// <summary>FXAA, 9-tap luma edge filter.</summary>
    Fxaa = 1,

    /// <summary>Vignette darkening toward the frame edges.</summary>
    Vignette = 2,

    /// <summary>Film grain modulated by a frame-seeded noise field.</summary>
    FilmGrain = 3,

    /// <summary>Radial chromatic aberration.</summary>
    ChromaticAberration = 4,

    /// <summary>Temperature, tint, contrast, saturation and lift/gamma/gain.</summary>
    ColorGrading = 5,

    /// <summary>Threshold knee bloom.</summary>
    Bloom = 6,

    /// <summary>Screen-space ambient occlusion from the scene depth.</summary>
    Ssao = 7,

    /// <summary>Circle-of-confusion depth of field.</summary>
    DepthOfField = 8,

    /// <summary>Temporal accumulation with neighborhood-clamped history and a sharpen pass.</summary>
    Taa = 9,
}

/// <summary>Where in the tone-mapping order an effect belongs.</summary>
public enum ScenePostProcessPhase
{
    /// <summary>Linear HDR, before tone mapping.</summary>
    BeforeTonemap = 0,

    /// <summary>Display-referred, after tone mapping.</summary>
    AfterTonemap = 1,
}

/// <summary>
/// One enabled effect and its settings. Built-in effects take at most two vec4 uniforms plus the
/// colour-grading triples, so settings travel packed rather than as one type per effect; the
/// packing table is documented on the chain.
/// </summary>
/// <param name="Effect">The effect.</param>
/// <param name="Phase">Tone-mapping phase.</param>
/// <param name="Primary">Packed <c>u_primary</c>.</param>
/// <param name="Secondary">Packed <c>u_secondary</c>.</param>
/// <param name="Lift">Colour-grading lift; neutral when unused.</param>
/// <param name="Gamma">Colour-grading gamma; neutral when unused.</param>
/// <param name="Gain">Colour-grading gain; neutral when unused.</param>
public readonly record struct ScenePostProcessEntry(
    ScenePostProcessEffect Effect,
    ScenePostProcessPhase Phase,
    Vec4 Primary,
    Vec4 Secondary,
    Vec3 Lift,
    Vec3 Gamma,
    Vec3 Gain);

/// <summary>
/// The offscreen post-process stage: the scene renders into an HDR target, the enabled effects run
/// in phase order through one uber fragment shader, and the final result is presented with a
/// fullscreen draw to the default framebuffer.
/// </summary>
/// <remarks>
/// <para><b>Packing table (mode → uniforms).</b> 1 FXAA <c>primary=(subpixel, edgeThreshold,
/// edgeThresholdMin, 0)</c>; 2 vignette <c>primary=(intensity, smoothness, roundness, 0)</c>,
/// <c>secondary=(color.rgb, 0)</c>; 3 film grain <c>primary=(intensity, response, 0, 0)</c>; 4
/// chromatic aberration <c>primary=(intensity, 0, 0, 0)</c>; 5 colour grading
/// <c>primary=(temperature, tint, contrast, saturation)</c> plus <c>u_lift/u_gamma/u_gain</c>;
/// 6 bloom <c>primary=(threshold, knee, intensity, radius)</c>; 7 SSAO
/// <c>primary=(radius, intensity, bias, sampleCount)</c>; 8 depth of field
/// <c>primary=(focusDistance, aperture, focalLength, maxCoC)</c>; 9 TAA
/// <c>primary=(blendFactor, sharpen, jitterScale, 0)</c>.</para>
/// <para><b>Scratch and history are different things.</b> Non-temporal effects ping-pong between
/// two scratch buffers inside one frame. TAA reads the history buffer that the previous frame wrote
/// and writes the other one, then hands its own output to the rest of the chain, so a frame never
/// reads the texture it is writing.</para>
/// <para><b>Order.</b> Before-tonemap entries run first (SSAO, TAA, DoF, bloom), then
/// after-tonemap entries, each group in insertion order.</para>
/// <para><b>Present.</b> The final texture is drawn to the default framebuffer with mode 0, which
/// the shader compiles to a straight copy. A blit would need the destination FBO of the last write
/// to be tracked across the ping-pong, and a copy draw is the same pixel work with less bookkeeping.</para>
/// </remarks>
public sealed class SceneGlPostProcessChain : IDisposable
{
    private const string VertexSource = """
        #version 330 core
        void main()
        {
            vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
            gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
        }
        """;

    private const string FragmentSource = """
        #version 330 core

        uniform sampler2D u_inputTexture;
        uniform sampler2D u_history;
        uniform sampler2D u_depth;
        uniform int u_effectMode;
        uniform vec4 u_primary;
        uniform vec4 u_secondary;
        uniform vec3 u_lift;
        uniform vec3 u_gamma;
        uniform vec3 u_gain;
        uniform vec2 u_texel;
        uniform float u_frameSeed;

        out vec4 fragColor;

        const float k_pi = 3.141592653589793;

        float luma(vec3 c)
        {
            return dot(c, vec3(0.2126, 0.7152, 0.0722));
        }

        float hash(vec2 p)
        {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123 + u_frameSeed);
        }

        vec3 fxaa(vec3 c, vec2 uv)
        {
            float subpixel = clamp(u_primary.x, 0.0, 1.0);
            float threshold = max(u_primary.y, 0.0);
            float thresholdMin = max(u_primary.z, 0.0);

            vec3 nw = textureOffset(u_inputTexture, uv, ivec2(-1, -1)).rgb;
            vec3 ne = textureOffset(u_inputTexture, uv, ivec2(1, -1)).rgb;
            vec3 sw = textureOffset(u_inputTexture, uv, ivec2(-1, 1)).rgb;
            vec3 se = textureOffset(u_inputTexture, uv, ivec2(1, 1)).rgb;
            vec3 n = textureOffset(u_inputTexture, uv, ivec2(0, -1)).rgb;
            vec3 s = textureOffset(u_inputTexture, uv, ivec2(0, 1)).rgb;
            vec3 w = textureOffset(u_inputTexture, uv, ivec2(-1, 0)).rgb;
            vec3 e = textureOffset(u_inputTexture, uv, ivec2(1, 0)).rgb;

            float lNW = luma(nw), lNE = luma(ne), lSW = luma(sw), lSE = luma(se);
            float lN = luma(n), lS = luma(s), lW = luma(w), lE = luma(e), lC = luma(c);

            float lMin = min(lC, min(min(min(lNW, lNE), min(lSW, lSE)), min(min(lN, lS), min(lW, lE))));
            float lMax = max(lC, max(max(max(lNW, lNE), max(lSW, lSE)), max(max(lN, lS), max(lW, lE))));
            float range = lMax - lMin;
            if (range < max(thresholdMin, threshold * lMax))
            {
                return c;
            }

            float dirX = abs((lNW + lNE) - (lSW + lSE)) + 2.0 * abs(lW - lE);
            float dirY = abs((lNW + lSW) - (lNE + lSE)) + 2.0 * abs(lN - lS);
            float signX = (lNW + lSW) - (lNE + lSE) > lW - lE ? -1.0 : 1.0;
            float signY = (lNW + lNE) - (lSW + lSE) > lN - lS ? -1.0 : 1.0;
            float offset = 1.0 / max(min(dirX, dirY), 1e-5);
            offset = clamp(offset * subpixel, 0.0, 0.5);

            vec2 off = vec2(dirX * signX, dirY * signY) * offset * u_texel;
            vec3 blend = 0.5 * (texture(u_inputTexture, uv + off).rgb + texture(u_inputTexture, uv - off).rgb);
            return mix(c, blend, clamp(range / max(lMax, 1e-5), 0.0, 1.0));
        }

        vec3 bloom(vec3 c)
        {
            float threshold = max(u_primary.x, 0.0);
            float knee = max(u_primary.y, 1e-4);
            float intensity = u_primary.z;
            float radius = max(u_primary.w, 1e-4);

            vec3 sum = vec3(0.0);
            float weight = 0.0;
            for (int i = 0; i < 8; i++)
            {
                float a = float(i) * (2.0 * k_pi / 8.0);
                vec2 o = vec2(cos(a), sin(a)) * radius * u_texel * 4.0;
                vec3 s = texture(u_inputTexture, gl_FragCoord.xy * u_texel + o).rgb;
                float contribution = max(luma(s) - threshold, 0.0);
                contribution = contribution * contribution / (contribution + knee);
                sum += s * contribution;
                weight += contribution;
            }

            vec3 blurred = weight > 0.0 ? sum / weight : vec3(0.0);
            return c + blurred * intensity;
        }

        vec3 ssao(vec3 c, vec2 uv)
        {
            float radius = max(u_primary.x, 1e-4);
            float intensity = u_primary.y;
            float bias = u_primary.z;
            int samples = int(clamp(u_primary.w, 1.0, 8.0));

            float centre = texture(u_depth, uv).r;
            if (centre <= 0.0)
            {
                return c;
            }

            float occlusion = 0.0;
            for (int i = 0; i < samples; i++)
            {
                float angle = float(i) * 2.39996323 + u_frameSeed;
                vec2 o = vec2(cos(angle), sin(angle)) * radius * u_texel * (1.0 + float(i) * 0.25);
                float sampleDepth = texture(u_depth, uv + o).r;
                occlusion += sampleDepth > centre + bias ? 1.0 : 0.0;
            }

            return c * clamp(1.0 - (occlusion / float(samples)) * intensity, 0.0, 1.0);
        }

        vec3 depthOfField(vec3 c, vec2 uv)
        {
            float focus = max(u_primary.x, 1e-4);
            float aperture = max(u_primary.y, 1e-4);
            float focalLength = max(u_primary.z, 1e-4);
            float maxCoC = max(u_primary.w, 1e-4);

            float depth = texture(u_depth, uv).r;
            float coc = clamp(abs(depth - focus) * (focalLength / aperture) * 0.01, 0.0, maxCoC);
            vec2 radius = coc * u_texel;

            vec3 sum = c;
            for (int i = 0; i < 8; i++)
            {
                float a = float(i) * (2.0 * k_pi / 8.0);
                sum += texture(u_inputTexture, uv + vec2(cos(a), sin(a)) * radius).rgb;
            }

            return sum / 9.0;
        }

        vec3 colorGrading(vec3 c)
        {
            float temperature = u_primary.x;
            float tint = u_primary.y;
            float contrast = max(u_primary.z, 0.0);
            float saturation = u_primary.w;

            c *= vec3(1.0 + temperature * 0.2, 1.0, 1.0 - temperature * 0.2);
            c.g += tint * 0.1;
            c = (c - 0.5) * contrast + 0.5;
            c = mix(vec3(luma(c)), c, saturation);
            c = (c * u_gain) + u_lift;
            return clamp(pow(max(c, vec3(0.0)), 1.0 / max(u_gamma, vec3(1e-4))), 0.0, 1.0);
        }

        vec3 taa(vec3 c, vec2 uv)
        {
            float blendFactor = clamp(u_primary.x, 0.0, 1.0);
            float sharpen = clamp(u_primary.y, 0.0, 1.0);

            vec3 history = texture(u_history, uv).rgb;
            vec3 mn = c;
            vec3 mx = c;
            for (int i = 0; i < 4; i++)
            {
                ivec2 o = ivec2(i / 2, i % 2) * 2 - 1;
                vec3 n = textureOffset(u_inputTexture, uv, o).rgb;
                mn = min(mn, n);
                mx = max(mx, n);
            }

            vec3 clamped = clamp(history, mn, mx);
            vec3 accumulated = mix(c, clamped, blendFactor);

            vec3 laplacian = 4.0 * c
                - textureOffset(u_inputTexture, uv, ivec2(1, 0)).rgb
                - textureOffset(u_inputTexture, uv, ivec2(-1, 0)).rgb
                - textureOffset(u_inputTexture, uv, ivec2(0, 1)).rgb
                - textureOffset(u_inputTexture, uv, ivec2(0, -1)).rgb;
            return clamp(accumulated + laplacian * sharpen, 0.0, 1.0);
        }

        void main()
        {
            vec2 uv = gl_FragCoord.xy * u_texel;
            vec3 c = texture(u_inputTexture, uv).rgb;

            if (u_effectMode == 1)
            {
                c = fxaa(c, uv);
            }
            else if (u_effectMode == 2)
            {
                float intensity = u_primary.x;
                float smoothness = max(u_primary.y, 1e-4);
                float roundness = max(u_primary.z, 1e-4);
                vec2 d = (uv - 0.5) * vec2(roundness, 1.0);
                float falloff = pow(clamp(1.0 - dot(d, d) * smoothness * 4.0, 0.0, 1.0), intensity);
                c = mix(u_secondary.rgb, c, falloff);
            }
            else if (u_effectMode == 3)
            {
                float intensity = u_primary.x;
                float response = clamp(u_primary.y, 0.0, 1.0);
                float grain = hash(gl_FragCoord.xy) - 0.5;
                c += grain * intensity * (1.0 - luma(c) * response);
            }
            else if (u_effectMode == 4)
            {
                float intensity = u_primary.x;
                vec2 dir = uv - 0.5;
                float r = texture(u_inputTexture, uv - dir * intensity).r;
                float b = texture(u_inputTexture, uv + dir * intensity).b;
                c = vec3(r, c.g, b);
            }
            else if (u_effectMode == 5)
            {
                c = colorGrading(c);
            }
            else if (u_effectMode == 6)
            {
                c = bloom(c);
            }
            else if (u_effectMode == 7)
            {
                c = ssao(c, uv);
            }
            else if (u_effectMode == 8)
            {
                c = depthOfField(c, uv);
            }
            else if (u_effectMode == 9)
            {
                c = taa(c, uv);
            }

            fragColor = vec4(max(c, vec3(0.0)), 1.0);
        }
        """;

    private readonly GLContext _context;
    private readonly GLProgram _program;
    private readonly GLVertexArray _fullscreenVao;
    private readonly List<ScenePostProcessEntry> _entries = [];
    private readonly GLTexture _sceneColor;
    private readonly GLTexture _sceneDepth;
    private readonly GLFramebuffer _sceneTarget;
    private readonly GLTexture[] _scratch = new GLTexture[2];
    private readonly GLFramebuffer[] _scratchTargets = new GLFramebuffer[2];
    private readonly GLTexture[] _history = new GLTexture[2];
    private readonly GLFramebuffer[] _historyTargets = new GLFramebuffer[2];
    private int _drawCount;
    private int _inputLocation;
    private int _historyLocation;
    private int _depthLocation;
    private int _modeLocation;
    private int _primaryLocation;
    private int _secondaryLocation;
    private int _liftLocation;
    private int _gammaLocation;
    private int _gainLocation;
    private int _texelLocation;
    private int _frameSeedLocation;
    private bool _locationsResolved;
    private bool _disposed;

    /// <summary>Creates a chain sized to one render resolution.</summary>
    /// <param name="context">Render-thread GL context.</param>
    /// <param name="width">Target width in pixels.</param>
    /// <param name="height">Target height in pixels.</param>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="width"/> or <paramref name="height"/> is not positive.</exception>
    public SceneGlPostProcessChain(GLContext context, int width, int height)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(width);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(height);

        _context = context;
        Width = width;
        Height = height;
        _context.AssertRenderThread();

        _program = new GLProgram(context, VertexSource, FragmentSource);
        _fullscreenVao = new GLVertexArray(context);
        _sceneColor = NewColorTexture(width, height, TextureFormat.Rgba16f, "scene-postprocess-hdr");
        _sceneDepth = NewColorTexture(width, height, TextureFormat.Depth24, "scene-postprocess-depth");
        for (int i = 0; i < 2; i++)
        {
            _scratch[i] = NewColorTexture(width, height, TextureFormat.Rgba16f, $"scene-postprocess-scratch-{i}");
            _scratchTargets[i] = new GLFramebuffer(context, width, height, $"scene-postprocess-scratch-fb-{i}");
            _scratchTargets[i].AttachColor(_scratch[i]);
            _history[i] = NewColorTexture(width, height, TextureFormat.Rgba16f, $"scene-postprocess-history-{i}");
            _historyTargets[i] = new GLFramebuffer(context, width, height, $"scene-postprocess-history-fb-{i}");
            _historyTargets[i].AttachColor(_history[i]);
        }

        _sceneTarget = new GLFramebuffer(context, width, height, "scene-postprocess-target");
        _sceneTarget.AttachColor(_sceneColor);
        _sceneTarget.AttachDepth(_sceneDepth);
    }

    /// <summary>Target width in pixels.</summary>
    public int Width { get; }

    /// <summary>Target height in pixels.</summary>
    public int Height { get; }

    /// <summary>HDR color texture the scene renders into.</summary>
    public GLTexture SceneColor => _sceneColor;

    /// <summary>Depth texture paired with <see cref="SceneColor"/>.</summary>
    public GLTexture SceneDepth => _sceneDepth;

    /// <summary>Framebuffer the scene binds before drawing.</summary>
    public GLFramebuffer SceneTarget => _sceneTarget;

    /// <summary>Compiled uber program.</summary>
    public GLProgram Program => _program;

    /// <summary>Fullscreen draws issued by the most recent <see cref="Submit"/> call.</summary>
    public int LastDrawCount => _drawCount;

    /// <summary>Enabled effects in execution order.</summary>
    public IReadOnlyList<ScenePostProcessEntry> Entries
    {
        get
        {
            ThrowIfDisposed();
            // OrderBy is a stable sort, so insertion order survives inside each phase group.
            return [.. _entries.OrderBy(entry => (int)entry.Phase)];
        }
    }

    /// <summary>Enables an effect, replacing any existing entry for it.</summary>
    /// <param name="effect">Effect to enable.</param>
    /// <param name="primary">Packed <c>u_primary</c> settings.</param>
    /// <param name="secondary">Packed <c>u_secondary</c> settings.</param>
    /// <param name="phase">Phase override; null takes the built-in default for the effect.</param>
    /// <param name="lift">Colour-grading lift; ignored by every other effect.</param>
    /// <param name="gamma">Colour-grading gamma; ignored by every other effect.</param>
    /// <param name="gain">Colour-grading gain; ignored by every other effect.</param>
    public void Enable(
        ScenePostProcessEffect effect,
        Vec4 primary = default,
        Vec4 secondary = default,
        ScenePostProcessPhase? phase = null,
        Vec3 lift = default,
        Vec3 gamma = default,
        Vec3 gain = default)
    {
        ThrowIfDisposed();
        _ = Disable(effect);
        _entries.Add(new ScenePostProcessEntry(
            effect,
            phase ?? DefaultPhase(effect),
            primary,
            secondary,
            lift,
            gamma == default ? new Vec3(1f, 1f, 1f) : gamma,
            gain == default ? new Vec3(1f, 1f, 1f) : gain));
    }

    /// <summary>Drops an effect from the chain.</summary>
    /// <param name="effect">Effect to disable.</param>
    /// <returns><see langword="true"/> when the effect had been enabled.</returns>
    public bool Disable(ScenePostProcessEffect effect)
    {
        ThrowIfDisposed();
        for (int i = 0; i < _entries.Count; i++)
        {
            if (_entries[i].Effect == effect)
            {
                _entries.RemoveAt(i);
                return true;
            }
        }

        return false;
    }

    /// <summary>Binds the HDR scene target so the scene renders offscreen.</summary>
    public void BeginScene()
    {
        ThrowIfDisposed();
        _context.AssertRenderThread();
        _sceneTarget.Bind();
        _context.State.SetViewport(0, 0, Width, Height);
    }

    /// <summary>
    /// Runs the enabled effects in phase then insertion order and presents the result to the
    /// default framebuffer.
    /// </summary>
    /// <param name="frameIndex">Frame counter; seeds the noise effects and selects the history parity.</param>
    /// <returns>The number of fullscreen draws issued, presentation draw included.</returns>
    /// <exception cref="SceneConfigurationException">
    /// The compiled uber program does not expose every uniform the chain sets.
    /// </exception>
    public int Submit(int frameIndex)
    {
        ThrowIfDisposed();
        _context.AssertRenderThread();
        ResolveUniformLocations();

        _drawCount = 0;
        IReadOnlyList<ScenePostProcessEntry> ordered = Entries;
        int historyParity = frameIndex & 1;
        GLTexture source = _sceneColor;
        int scratchParity = 0;

        _context.State.UseProgram(_program.Id);
        _context.State.BindVertexArray(_fullscreenVao.Id);
        _context.State.SetDepthTest(false);
        _context.State.SetDepthMask(false);
        _context.State.SetBlend(false);
        _context.State.SetCullFace(false);
        _context.State.SetColorMask(true, true, true, true);
        SetUniform(_texelLocation, 1f / Width, 1f / Height);
        SetUniform(_frameSeedLocation, (float)frameIndex);
        BindTexture(2, _sceneDepth);
        SetSampler(_depthLocation, 2);

        for (int i = 0; i < ordered.Count; i++)
        {
            ScenePostProcessEntry entry = ordered[i];
            bool temporal = entry.Effect == ScenePostProcessEffect.Taa;
            GLTexture destination = temporal ? _history[historyParity] : _scratch[scratchParity];

            Draw(entry.Effect, source, destination, entry, temporal ? _history[1 - historyParity] : null);

            source = destination;
            scratchParity ^= 1;
        }

        _context.State.BindFramebuffer(GLConst.Framebuffer, 0u);
        _context.State.SetViewport(0, 0, Width, Height);
        DrawPresentation(source);
        _context.State.BindVertexArray(0u);
        _context.State.SetDepthMask(true);
        return _drawCount;
    }

    /// <summary>Releases every GPU resource the chain owns.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        for (int i = 0; i < 2; i++)
        {
            _historyTargets[i].Dispose();
            _history[i].Dispose();
            _scratchTargets[i].Dispose();
            _scratch[i].Dispose();
        }

        _sceneTarget.Dispose();
        _sceneDepth.Dispose();
        _sceneColor.Dispose();
        _fullscreenVao.Dispose();
        _program.Dispose();
    }

    private static ScenePostProcessPhase DefaultPhase(ScenePostProcessEffect effect) => effect switch
    {
        ScenePostProcessEffect.Bloom => ScenePostProcessPhase.BeforeTonemap,
        ScenePostProcessEffect.DepthOfField => ScenePostProcessPhase.BeforeTonemap,
        ScenePostProcessEffect.Ssao => ScenePostProcessPhase.BeforeTonemap,
        ScenePostProcessEffect.Taa => ScenePostProcessPhase.BeforeTonemap,
        _ => ScenePostProcessPhase.AfterTonemap,
    };

    private void Draw(
        ScenePostProcessEffect effect,
        GLTexture source,
        GLTexture destination,
        in ScenePostProcessEntry entry,
        GLTexture? history)
    {
        GLFramebuffer target = ReferenceEquals(destination, _history[0])
            ? _historyTargets[0]
            : ReferenceEquals(destination, _history[1])
                ? _historyTargets[1]
                : ReferenceEquals(destination, _scratch[0])
                    ? _scratchTargets[0]
                    : _scratchTargets[1];

        _context.State.BindFramebuffer(GLConst.Framebuffer, target.Id);
        _context.State.SetViewport(0, 0, Width, Height);
        SetUniform(_modeLocation, (int)effect);
        SetUniform(_primaryLocation, entry.Primary);
        SetUniform(_secondaryLocation, entry.Secondary);
        if (effect == ScenePostProcessEffect.ColorGrading)
        {
            SetUniform(_liftLocation, entry.Lift);
            SetUniform(_gammaLocation, entry.Gamma);
            SetUniform(_gainLocation, entry.Gain);
        }

        BindTexture(0, source);
        SetSampler(_inputLocation, 0);
        if (history is not null)
        {
            BindTexture(1, history);
            SetSampler(_historyLocation, 1);
        }

        _context.GL.DrawArrays(GLConst.Triangles, 0, 3);
        _drawCount++;
    }

    private void DrawPresentation(GLTexture source)
    {
        SetUniform(_modeLocation, 0);
        BindTexture(0, source);
        SetSampler(_inputLocation, 0);
        _context.GL.DrawArrays(GLConst.Triangles, 0, 3);
        _drawCount++;
    }

    private GLTexture NewColorTexture(int width, int height, TextureFormat format, string label)
    {
        var texture = new GLTexture(
            _context,
            GLConst.Texture2D,
            format,
            width,
            height,
            depth: 1,
            mipLevels: 1,
            label: label);
        texture.SetParameter(GLConst.TextureMinFilter, (int)GLConst.Linear);
        texture.SetParameter(GLConst.TextureMagFilter, (int)GLConst.Linear);
        texture.SetParameter(GLConst.TextureWrapS, (int)GLConst.ClampToEdge);
        texture.SetParameter(GLConst.TextureWrapT, (int)GLConst.ClampToEdge);
        return texture;
    }

    private void BindTexture(int slot, GLTexture? texture)
    {
        if (texture is not null)
        {
            _context.State.BindTexture2D((uint)slot, texture.Id);
        }
    }

    /// <summary>
    /// Reflects the uniform locations once per program. Every name is required: a location that
    /// resolves to -1 turns a setting into a silent no-op, which renders the effect with whatever
    /// the driver left in the uniform, so the chain reports it instead of drawing.
    /// </summary>
    private void ResolveUniformLocations()
    {
        if (_locationsResolved)
        {
            return;
        }

        var missing = new List<string>();
        _inputLocation = Require("u_inputTexture", missing);
        _historyLocation = Require("u_history", missing);
        _depthLocation = Require("u_depth", missing);
        _modeLocation = Require("u_effectMode", missing);
        _primaryLocation = Require("u_primary", missing);
        _secondaryLocation = Require("u_secondary", missing);
        _liftLocation = Require("u_lift", missing);
        _gammaLocation = Require("u_gamma", missing);
        _gainLocation = Require("u_gain", missing);
        _texelLocation = Require("u_texel", missing);
        _frameSeedLocation = Require("u_frameSeed", missing);

        if (missing.Count > 0)
        {
            throw new SceneConfigurationException(
                $"The post-process uber program does not expose {string.Join(", ", missing)}.");
        }

        _locationsResolved = true;
    }

    private int Require(string name, List<string> missing)
    {
        int location = _program.GetUniformLocation(name);
        if (location < 0)
        {
            missing.Add(name);
        }

        return location;
    }

    private void SetSampler(int location, int slot) => _context.GL.Uniform1(location, slot);

    private void SetUniform(int location, int value) => _context.GL.Uniform1(location, value);

    private void SetUniform(int location, float value) => _context.GL.Uniform1(location, value);

    private void SetUniform(int location, float x, float y) => _context.GL.Uniform2(location, x, y);

    private void SetUniform(int location, in Vec4 value) =>
        _context.GL.Uniform4(location, value.X, value.Y, value.Z, value.W);

    private void SetUniform(int location, in Vec3 value) =>
        _context.GL.Uniform3(location, value.X, value.Y, value.Z);

    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(_disposed, this);
}
