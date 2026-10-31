namespace Axrone.Ui.Rendering;

using Axrone.Render.Core.Abstractions;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Native;
using Axrone.Render.OpenGL.Resources;

/// <summary>Resolved GPU binding for one UI texture resource.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiTextureBinding(uint Texture, uint Sampler, int Width, int Height);

/// <summary>Resolves UI resource identities to backend textures.</summary>
public interface IUiTextureSource
{
    /// <summary>Resolves a texture resource.</summary>
    /// <param name="resource">UI resource identity.</param>
    /// <param name="binding">Backend texture, optional sampler, and source pixel size.</param>
    bool TryGetTexture(UiResourceId resource, out UiTextureBinding binding);
}

/// <summary>Resolves immutable shaped layouts referenced by text commands.</summary>
public interface IUiTextLayoutSource
{
    /// <summary>Resolves a layout and the font face it was shaped with.</summary>
    /// <param name="layout">Layout identity.</param>
    /// <param name="resolved">Resolved layout.</param>
    /// <param name="face">Font face used for glyph residency lookups.</param>
    bool TryGetLayout(UiTextLayoutId layout, out IUiTextLayout resolved, out UiFontFaceId face);
}

/// <summary>Executes application-defined stroke and custom commands.</summary>
public interface IUiCustomCommandHandler
{
    /// <summary>Executes one custom command on the render thread.</summary>
    void Execute(in UiRenderCommand command);
}

/// <summary>Construction options for <see cref="UiOpenGlBackend"/>.</summary>
public sealed class UiOpenGlBackendOptions
{
    /// <summary>Gets or initializes the quad instance capacity per draw run.</summary>
    public int QuadCapacity { get; init; } = 4096;

    /// <summary>Gets or initializes the image instance capacity per draw run.</summary>
    public int ImageCapacity { get; init; } = 2048;

    /// <summary>Gets or initializes the glyph instance capacity per draw run.</summary>
    public int GlyphCapacity { get; init; } = 8192;

    /// <summary>Gets or initializes the texture resolver.</summary>
    public IUiTextureSource? Textures { get; init; }

    /// <summary>Gets or initializes the glyph atlas used for text batches.</summary>
    public IUiGlyphAtlas? GlyphAtlas { get; init; }

    /// <summary>Gets or initializes the shaped-layout source used for text batches.</summary>
    public IUiTextLayoutSource? TextLayouts { get; init; }

    /// <summary>Gets or initializes the handler for stroke and custom commands.</summary>
    public IUiCustomCommandHandler? CustomCommands { get; init; }
}

/// <summary>
/// OpenGL backend drawing instanced quads, images and glyphs through
/// <see cref="GLBuffer"/>, <see cref="GLStateCache"/> and manual VAOs. Programs
/// and samplers are recreated after a context restore; instance buffers are
/// re-uploaded every batch, so no CPU state needs replay.
/// </summary>
/// <remarks>
/// Render-thread affine. The backend does not own the <see cref="GLContext"/>.
/// </remarks>
public sealed class UiOpenGlBackend : IUiRenderBackend, IDisposable
{
    private const int MaxCachedPipelines = 64;
    private const uint InstanceStrideBytes = 72;

    private static readonly float[] UnitQuad = [0.0f, 0.0f, 1.0f, 0.0f, 0.0f, 1.0f, 1.0f, 1.0f];

    private readonly GLContext _context;
    private readonly GLStateCache _state;
    private readonly IGLApi _gl;
    private readonly UiOpenGlBackendOptions _options;

    private readonly UiInstanceBuffer<UiQuadInstance> _quadBuffer;
    private readonly UiInstanceBuffer<UiImageInstance> _imageBuffer;
    private readonly UiInstanceBuffer<UiGlyphInstance> _glyphBuffer;

    private GLBuffer? _unitBuffer;
    private GLBuffer? _quadInstances;
    private GLBuffer? _imageInstances;
    private GLBuffer? _glyphInstances;

    private readonly UiPipelineDescriptor[] _pipelineDescriptors = new UiPipelineDescriptor[MaxCachedPipelines];
    private readonly UiOpenGlPipeline?[] _pipelines = new UiOpenGlPipeline?[MaxCachedPipelines];
    private int _pipelineCount;

    private uint _quadProgram;
    private uint _imageProgram;
    private uint _textProgram;
    private int _quadViewport;
    private int _imageViewport;
    private int _imageTexture;
    private int _textViewport;
    private int _textTexture;
    private uint _quadVao;
    private uint _imageVao;
    private uint _textVao;
    private uint _linearSampler;
    private uint _nearestSampler;

    private float _viewportWidth = 1.0f;
    private float _viewportHeight = 1.0f;
    private bool _resourcesValid;
    private bool _scissorEnabled;
    private bool _inFrame;
    private int _disposed;

    /// <summary>Initializes the backend for a live GL context.</summary>
    /// <param name="context">GL context.</param>
    /// <param name="options">Construction options.</param>
    public UiOpenGlBackend(GLContext context, UiOpenGlBackendOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(context);
        _context = context;
        _state = context.State;
        _options = options ?? new UiOpenGlBackendOptions();

        if (_options.QuadCapacity <= 0 || _options.ImageCapacity <= 0 || _options.GlyphCapacity <= 0)
        {
            UiRenderThrowHelper.ThrowArgumentOutOfRange(nameof(options), _options.QuadCapacity, "Instance capacities must be positive.");
        }

        if (Unsafe.SizeOf<UiQuadInstance>() != InstanceStrideBytes ||
            Unsafe.SizeOf<UiImageInstance>() != InstanceStrideBytes ||
            Unsafe.SizeOf<UiGlyphInstance>() != InstanceStrideBytes)
        {
            UiRenderThrowHelper.ThrowInvalidOperation("UI instance layouts must share the 72-byte stride the VAO configures.");
        }

        _quadBuffer = new UiInstanceBuffer<UiQuadInstance>(_options.QuadCapacity);
        _imageBuffer = new UiInstanceBuffer<UiImageInstance>(_options.ImageCapacity);
        _glyphBuffer = new UiInstanceBuffer<UiGlyphInstance>(_options.GlyphCapacity);
        _gl = context.GL;

        try
        {
            _unitBuffer = new GLBuffer(context, GLConst.ArrayBuffer, GLConst.StaticDraw, UnitQuad.Length * sizeof(float), "UiUnitQuad");
            _quadInstances = new GLBuffer(context, GLConst.ArrayBuffer, GLConst.DynamicDraw, (int)((long)_options.QuadCapacity * InstanceStrideBytes), "UiQuads");
            _imageInstances = new GLBuffer(context, GLConst.ArrayBuffer, GLConst.DynamicDraw, (int)((long)_options.ImageCapacity * InstanceStrideBytes), "UiImages");
            _glyphInstances = new GLBuffer(context, GLConst.ArrayBuffer, GLConst.DynamicDraw, (int)((long)_options.GlyphCapacity * InstanceStrideBytes), "UiGlyphs");

            EnsureResources();

            context.Lifecycle.ContextLost += OnContextLost;
            context.Lifecycle.ContextRestored += OnContextRestored;
        }
        catch
        {
            Dispose();
            throw;
        }
    }

    /// <summary>Gets the number of draw calls issued.</summary>
    public long DrawCalls { get; private set; }

    /// <summary>Gets the number of instances submitted.</summary>
    public long Instances { get; private set; }

    /// <summary>Gets the number of completed frames.</summary>
    public long FrameCount { get; private set; }

    /// <summary>Gets the number of glyphs skipped for a missing atlas entry.</summary>
    public long MissedGlyphs { get; private set; }

    /// <summary>Gets the number of commands skipped for an unresolvable texture.</summary>
    public long MissingTextures { get; private set; }

    /// <summary>Gets the number of stroke/custom commands skipped for want of a handler.</summary>
    public long UnsupportedCommands { get; private set; }

    /// <summary>Gets the number of stroke/custom commands dispatched to the handler.</summary>
    public long CustomCommands { get; private set; }

    /// <summary>Gets whether the backend is disposed.</summary>
    public bool IsDisposed => Volatile.Read(ref _disposed) != 0;

    /// <inheritdoc/>
    public bool IsReady => !IsDisposed && !_context.IsLost;

    /// <summary>Gets the number of cached pipelines.</summary>
    public int PipelineCount => _pipelineCount;

    /// <inheritdoc/>
    public IUiPipeline CreatePipeline(in UiPipelineDescriptor descriptor)
    {
        ObjectDisposedException.ThrowIf(IsDisposed, this);
        EnsureResources();

        for (int i = 0; i < _pipelineCount; i++)
        {
            UiOpenGlPipeline? cached = _pipelines[i];
            if (cached is not null && cached.IsValid && _pipelineDescriptors[i] == descriptor)
            {
                return cached;
            }
        }

        CompactInvalidPipelines();
        if (_pipelineCount == MaxCachedPipelines)
        {
            UiRenderThrowHelper.ThrowInvalidOperation("UI pipeline cache is exhausted.");
        }

        UiOpenGlPipeline pipeline = new(descriptor);
        _pipelineDescriptors[_pipelineCount] = descriptor;
        _pipelines[_pipelineCount] = pipeline;
        _pipelineCount++;
        return pipeline;
    }

    /// <inheritdoc/>
    public void BeginFrame(in UiViewport viewport)
    {
        ObjectDisposedException.ThrowIf(IsDisposed, this);
        if (_inFrame)
        {
            UiRenderThrowHelper.ThrowInvalidOperation("BeginFrame called while a frame is open.");
        }

        EnsureResources();
        _inFrame = true;
        _viewportWidth = MathF.Max(1.0f, viewport.Width);
        _viewportHeight = MathF.Max(1.0f, viewport.Height);

        _state.SetViewport(0, 0, (int)_viewportWidth, (int)_viewportHeight);
        _state.SetDepthTest(false);
        _state.SetDepthMask(false);
        _state.SetCullFace(false);
    }

    /// <inheritdoc/>
    public void DrawBatch(in UiBatchKey key, ReadOnlySpan<UiRenderCommand> commands)
    {
        ObjectDisposedException.ThrowIf(IsDisposed, this);
        if (!_inFrame)
        {
            UiRenderThrowHelper.ThrowInvalidOperation("DrawBatch called outside BeginFrame/EndFrame.");
        }

        if (commands.IsEmpty)
        {
            return;
        }

        switch (key.Kind)
        {
            case UiRenderCommandKind.Quad:
                DrawQuads(in key, commands);
                break;
            case UiRenderCommandKind.Image:
                DrawImages(in key, commands);
                break;
            case UiRenderCommandKind.Text:
                DrawText(in key, commands);
                break;
            default:
                DrawCustoms(commands);
                break;
        }
    }

    /// <inheritdoc/>
    public void EndFrame()
    {
        ObjectDisposedException.ThrowIf(IsDisposed, this);
        if (!_inFrame)
        {
            UiRenderThrowHelper.ThrowInvalidOperation("EndFrame called without BeginFrame.");
        }

        _inFrame = false;
        _state.BindVertexArray(0);
        if (_scissorEnabled)
        {
            _gl.Disable(UiGl.ScissorTest);
            _scissorEnabled = false;
        }

        FrameCount++;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        _context.Lifecycle.ContextLost -= OnContextLost;
        _context.Lifecycle.ContextRestored -= OnContextRestored;

        for (int i = 0; i < _pipelineCount; i++)
        {
            _pipelines[i]?.Dispose();
            _pipelines[i] = null;
        }

        _pipelineCount = 0;

        if (_resourcesValid)
        {
            DeleteProgram(ref _quadProgram);
            DeleteProgram(ref _imageProgram);
            DeleteProgram(ref _textProgram);
            DeleteVao(ref _quadVao);
            DeleteVao(ref _imageVao);
            DeleteVao(ref _textVao);
            DeleteSampler(ref _linearSampler);
            DeleteSampler(ref _nearestSampler);
            _resourcesValid = false;
        }

        _unitBuffer?.Dispose();
        _quadInstances?.Dispose();
        _imageInstances?.Dispose();
        _glyphInstances?.Dispose();
        _inFrame = false;
        _scissorEnabled = false;
    }

    private void DrawQuads(in UiBatchKey key, ReadOnlySpan<UiRenderCommand> commands)
    {
        Span<UiQuadInstance> scratch = stackalloc UiQuadInstance[1];
        _quadBuffer.Clear();

        for (int i = 0; i < commands.Length; i++)
        {
            ref readonly UiRenderCommand command = ref commands[i];
            if (UiInstanceEncoder.EncodeQuad(in command, scratch) == 0)
            {
                continue;
            }

            if (!_quadBuffer.TryAdd(scratch[0]))
            {
                FlushQuads(in key);
                _quadBuffer.TryAdd(scratch[0]);
            }
        }

        FlushQuads(in key);
    }

    private void FlushQuads(in UiBatchKey key)
    {
        if (_quadBuffer.Count == 0)
        {
            return;
        }

        _quadInstances!.Update(MemoryMarshal.AsBytes(_quadBuffer.Items));
        DrawInstances(_quadProgram, _quadVao, _quadViewport, -1, in key, _quadBuffer.Count, 0, 0);
        _quadBuffer.Clear();
    }

    private void DrawImages(in UiBatchKey key, ReadOnlySpan<UiRenderCommand> commands)
    {
        if (_options.Textures is null || !_options.Textures.TryGetTexture(key.Resource, out UiTextureBinding binding))
        {
            MissingTextures += commands.Length;
            return;
        }

        UiSize sourceSize = new(binding.Width, binding.Height);
        Span<UiImageInstance> scratch = stackalloc UiImageInstance[UiNineSlice.MaxInstances];
        _imageBuffer.Clear();

        for (int i = 0; i < commands.Length; i++)
        {
            ref readonly UiRenderCommand command = ref commands[i];
            int encoded = UiInstanceEncoder.EncodeImage(in command, sourceSize, scratch);
            for (int instance = 0; instance < encoded; instance++)
            {
                if (!_imageBuffer.TryAdd(scratch[instance]))
                {
                    FlushImages(in key, binding.Texture, binding.Sampler);
                    _imageBuffer.TryAdd(scratch[instance]);
                }
            }
        }

        FlushImages(in key, binding.Texture, binding.Sampler);
    }

    private void FlushImages(in UiBatchKey key, uint texture, uint sampler)
    {
        if (_imageBuffer.Count == 0)
        {
            return;
        }

        _imageInstances!.Update(MemoryMarshal.AsBytes(_imageBuffer.Items));
        DrawInstances(_imageProgram, _imageVao, _imageViewport, _imageTexture, in key, _imageBuffer.Count, texture, sampler);
        _imageBuffer.Clear();
    }

    private void DrawText(in UiBatchKey key, ReadOnlySpan<UiRenderCommand> commands)
    {
        IUiGlyphAtlas? atlas = _options.GlyphAtlas;
        IUiTextLayoutSource? layouts = _options.TextLayouts;
        IUiTextureSource? textures = _options.Textures;
        if (atlas is null || layouts is null || textures is null)
        {
            UnsupportedCommands += commands.Length;
            return;
        }

        _glyphBuffer.Clear();
        uint currentTexture = 0;

        for (int i = 0; i < commands.Length; i++)
        {
            ref readonly UiRenderCommand command = ref commands[i];
            if (!layouts.TryGetLayout(command.TextLayout, out IUiTextLayout layout, out UiFontFaceId face))
            {
                MissedGlyphs++;
                continue;
            }

            ReadOnlySpan<UiShapedGlyph> glyphs = layout.Glyphs;
            for (int g = 0; g < glyphs.Length; g++)
            {
                ref readonly UiShapedGlyph glyph = ref glyphs[g];
                if (!atlas.TryGetEntry(face, glyph.CodePoint, out UiGlyphAtlasEntry entry))
                {
                    MissedGlyphs++;
                    continue;
                }

                if (!textures.TryGetTexture(entry.Texture, out UiTextureBinding binding))
                {
                    MissingTextures++;
                    continue;
                }

                if (_glyphBuffer.Count != 0 && binding.Texture != currentTexture)
                {
                    FlushGlyphs(in key, currentTexture);
                }

                currentTexture = binding.Texture;
                UiGlyphInstance instance = new(
                    new Rect(
                        command.Bounds.X + glyph.X - entry.OriginX,
                        command.Bounds.Y + glyph.Y - entry.OriginY,
                        entry.Width,
                        entry.Height),
                    entry.UvRect,
                    command.Color,
                    command.BorderColor,
                    command.BorderWidth,
                    command.Opacity);

                if (!_glyphBuffer.TryAdd(instance))
                {
                    FlushGlyphs(in key, currentTexture);
                    _glyphBuffer.TryAdd(instance);
                }
            }
        }

        FlushGlyphs(in key, currentTexture);
    }

    private void FlushGlyphs(in UiBatchKey key, uint texture)
    {
        if (_glyphBuffer.Count == 0)
        {
            return;
        }

        _glyphInstances!.Update(MemoryMarshal.AsBytes(_glyphBuffer.Items));
        uint sampler = key.Sampling == UiImageSampling.Nearest ? _nearestSampler : _linearSampler;
        DrawInstances(_textProgram, _textVao, _textViewport, _textTexture, in key, _glyphBuffer.Count, texture, sampler);
        _glyphBuffer.Clear();
    }

    private void DrawCustoms(ReadOnlySpan<UiRenderCommand> commands)
    {
        IUiCustomCommandHandler? handler = _options.CustomCommands;
        if (handler is null)
        {
            UnsupportedCommands += commands.Length;
            return;
        }

        for (int i = 0; i < commands.Length; i++)
        {
            ref readonly UiRenderCommand command = ref commands[i];
            if (command.Kind is UiRenderCommandKind.Custom or UiRenderCommandKind.Stroke)
            {
                handler.Execute(in command);
                CustomCommands++;
            }
        }
    }

    private void DrawInstances(
        uint program,
        uint vao,
        int viewportLocation,
        int textureLocation,
        in UiBatchKey key,
        int instanceCount,
        uint texture,
        uint sampler)
    {
        if (instanceCount == 0 || !ApplyScissor(in key))
        {
            return;
        }

        _state.UseProgram(program);
        _gl.Uniform2(viewportLocation, _viewportWidth, _viewportHeight);

        if (textureLocation >= 0)
        {
            _state.BindTexture2D(0, texture);
            uint boundSampler = sampler != 0
                ? sampler
                : (key.Sampling == UiImageSampling.Nearest ? _nearestSampler : _linearSampler);
            _state.BindSampler(0, boundSampler);
            _gl.Uniform1(textureLocation, 0);
        }

        ApplyBlend(key.Blend);
        _state.BindVertexArray(vao);
        _gl.DrawArraysInstanced(GLConst.TriangleStrip, 0, 4, (uint)instanceCount);
        _state.BindVertexArray(0);

        DrawCalls++;
        Instances += instanceCount;
    }

    private void ApplyBlend(UiBlendMode blend)
    {
        switch (blend)
        {
            case UiBlendMode.Opaque:
                _state.SetBlend(false);
                break;
            case UiBlendMode.Additive:
                _state.SetBlend(true);
                _state.SetBlendFuncSeparate(UiGl.SrcAlpha, UiGl.One, UiGl.One, UiGl.One);
                break;
            case UiBlendMode.Multiply:
                _state.SetBlend(true);
                _state.SetBlendFuncSeparate(UiGl.DstColor, UiGl.Zero, UiGl.Zero, UiGl.One);
                break;
            default:
                _state.SetBlend(true);
                _state.SetBlendFuncSeparate(UiGl.SrcAlpha, UiGl.OneMinusSrcAlpha, UiGl.One, UiGl.OneMinusSrcAlpha);
                break;
        }
    }

    private bool ApplyScissor(in UiBatchKey key)
    {
        if (!key.HasClip)
        {
            if (_scissorEnabled)
            {
                _gl.Disable(UiGl.ScissorTest);
                _scissorEnabled = false;
            }

            return true;
        }

        Rect clip = key.Clip;
        int x0 = (int)MathF.Floor(clip.X);
        int x1 = (int)MathF.Ceiling(clip.Right);
        int y0 = (int)MathF.Floor(_viewportHeight - clip.Bottom);
        int y1 = (int)MathF.Ceiling(_viewportHeight - clip.Top);

        x0 = Math.Clamp(x0, 0, (int)_viewportWidth);
        x1 = Math.Clamp(x1, 0, (int)_viewportWidth);
        y0 = Math.Clamp(y0, 0, (int)_viewportHeight);
        y1 = Math.Clamp(y1, 0, (int)_viewportHeight);

        if (x1 <= x0 || y1 <= y0)
        {
            return false;
        }

        if (!_scissorEnabled)
        {
            _gl.Enable(UiGl.ScissorTest);
            _scissorEnabled = true;
        }

        _state.SetScissor(x0, y0, x1 - x0, y1 - y0);
        return true;
    }

    private void OnContextLost(object? sender, EventArgs e)
    {
        _resourcesValid = false;
        _scissorEnabled = false;
        _inFrame = false;
    }

    private void OnContextRestored(object? sender, EventArgs e) => _resourcesValid = false;

    private void EnsureResources()
    {
        if (_resourcesValid)
        {
            return;
        }

        if (_context.IsLost)
        {
            UiRenderThrowHelper.ThrowInvalidOperation("GL context is lost; UI resources cannot be created.");
        }

        _quadProgram = Compile(UiShaderSources.QuadVertex, UiShaderSources.QuadFragment, out _quadViewport, out _);
        _imageProgram = Compile(UiShaderSources.ImageVertex, UiShaderSources.ImageFragment, out _imageViewport, out _imageTexture);
        _textProgram = Compile(UiShaderSources.TextVertex, UiShaderSources.TextFragment, out _textViewport, out _textTexture);

        _linearSampler = CreateSampler(UiGl.Linear);
        _nearestSampler = CreateSampler(UiGl.Nearest);

        _unitBuffer!.Update(MemoryMarshal.AsBytes(UnitQuad.AsSpan()));
        _quadVao = ConfigureVao(_quadInstances!);
        _imageVao = ConfigureVao(_imageInstances!);
        _textVao = ConfigureVao(_glyphInstances!);

        _resourcesValid = true;
    }

    private unsafe uint ConfigureVao(GLBuffer instances)
    {
        uint vao = _gl.GenVertexArray();
        _state.BindVertexArray(vao);

        _state.BindArrayBuffer(_unitBuffer!.Id);
        _gl.EnableVertexAttribArray(0);
        _gl.VertexAttribPointer(0, 2, GLConst.Float, false, 2 * sizeof(float), null);

        _state.BindArrayBuffer(instances.Id);
        for (uint location = 1; location <= 6; location++)
        {
            int size = location <= 4 ? 4 : 1;
            int offset = (int)((location - 1) * 16);
            _gl.EnableVertexAttribArray(location);
            _gl.VertexAttribPointer(location, size, GLConst.Float, false, InstanceStrideBytes, (void*)offset);
            _gl.VertexAttribDivisor(location, 1);
        }

        _state.BindVertexArray(0);
        return vao;
    }

    private uint Compile(string vertexSource, string fragmentSource, out int viewportLocation, out int textureLocation)
    {
        uint vertex = CompileShader(GLConst.VertexShader, vertexSource, "vertex");
        uint fragment = CompileShader(GLConst.FragmentShader, fragmentSource, "fragment");

        uint program = _gl.CreateProgram();
        _gl.AttachShader(program, vertex);
        _gl.AttachShader(program, fragment);
        _gl.LinkProgram(program);
        _gl.GetProgram(program, UiGl.LinkStatus, out int linked);
        _gl.DeleteShader(vertex);
        _gl.DeleteShader(fragment);

        if (linked == 0)
        {
            string log = _gl.GetProgramInfoLog(program);
            _gl.DeleteProgram(program);
            UiRenderThrowHelper.ThrowInvalidOperation("UI program link failed: " + log);
        }

        viewportLocation = _gl.GetUniformLocation(program, "u_Viewport");
        textureLocation = _gl.GetUniformLocation(program, "u_Texture");
        return program;
    }

    private uint CompileShader(uint type, string source, string stage)
    {
        uint shader = _gl.CreateShader(type);
        _gl.ShaderSource(shader, source);
        _gl.CompileShader(shader);
        _gl.GetShader(shader, GLConst.CompileStatus, out int compiled);
        if (compiled == 0)
        {
            string log = _gl.GetShaderInfoLog(shader);
            _gl.DeleteShader(shader);
            UiRenderThrowHelper.ThrowInvalidOperation($"UI {stage} shader failed: {log}");
        }

        return shader;
    }

    private uint CreateSampler(uint filter)
    {
        uint sampler = _gl.GenSampler();
        _gl.SamplerParameter(sampler, UiGl.SamplerMinFilter, (int)filter);
        _gl.SamplerParameter(sampler, UiGl.SamplerMagFilter, (int)filter);
        _gl.SamplerParameter(sampler, UiGl.SamplerWrapS, (int)UiGl.ClampToEdge);
        _gl.SamplerParameter(sampler, UiGl.SamplerWrapT, (int)UiGl.ClampToEdge);
        return sampler;
    }

    private void DeleteProgram(ref uint program)
    {
        if (program != 0)
        {
            _gl.DeleteProgram(program);
            program = 0;
        }
    }

    private void DeleteVao(ref uint vao)
    {
        if (vao != 0)
        {
            _gl.DeleteVertexArray(vao);
            vao = 0;
        }
    }

    private void DeleteSampler(ref uint sampler)
    {
        if (sampler != 0)
        {
            _gl.DeleteSampler(sampler);
            sampler = 0;
        }
    }

    private void CompactInvalidPipelines()
    {
        int write = 0;
        for (int read = 0; read < _pipelineCount; read++)
        {
            UiOpenGlPipeline? pipeline = _pipelines[read];
            if (pipeline is null || !pipeline.IsValid)
            {
                continue;
            }

            if (write != read)
            {
                _pipelineDescriptors[write] = _pipelineDescriptors[read];
                _pipelines[write] = pipeline;
            }

            write++;
        }

        for (int i = write; i < _pipelineCount; i++)
        {
            _pipelines[i] = null;
        }

        _pipelineCount = write;
    }

}

/// <summary>OpenGL pipeline handle. Backend-owned; disposal only marks it invalid.</summary>
internal sealed class UiOpenGlPipeline : IUiPipeline
{
    private int _disposed;

    internal UiOpenGlPipeline(in UiPipelineDescriptor descriptor)
    {
        Descriptor = descriptor;
    }

    /// <inheritdoc/>
    public UiPipelineDescriptor Descriptor { get; }

    /// <inheritdoc/>
    public bool IsValid => Volatile.Read(ref _disposed) == 0;

    /// <inheritdoc/>
    public void Dispose() => Interlocked.Exchange(ref _disposed, 1);
}
