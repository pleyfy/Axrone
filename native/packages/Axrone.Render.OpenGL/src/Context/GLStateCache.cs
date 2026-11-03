namespace Axrone.Render.OpenGL.Context;

/// <summary>
/// High-performance GL state cache that eliminates redundant GL calls.
/// Tracks all relevant GL state and only issues calls when state actually changes.
/// </summary>
/// <remarks>
/// A shadow-state mirror, not a lifecycle registry: no handles, no generations, no
/// reclamation. Intentionally separate from the descriptor-table registry.
/// </remarks>
public sealed class GLStateCache
{
    private readonly IGLApi _gl;
    private bool _isInvalidated;

    // Buffer bindings
    /// <summary>Cached GL state value.</summary>
    public uint BoundArrayBuffer { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint BoundElementBuffer { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint BoundUniformBuffer { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint BoundCopyReadBuffer { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint BoundCopyWriteBuffer { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint BoundPixelPackBuffer { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint BoundPixelUnpackBuffer { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint BoundTransformFeedbackBuffer { get; set; }

    // Vertex array
    /// <summary>Cached GL state value.</summary>
    public uint BoundVertexArray { get; set; }

    // Program
    /// <summary>Cached GL state value.</summary>
    public uint BoundProgram { get; set; }

    // Framebuffers
    /// <summary>Cached GL state value.</summary>
    public uint BoundReadFramebuffer { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint BoundDrawFramebuffer { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint BoundRenderbuffer { get; set; }

    // Textures and samplers (per unit)
    /// <summary>Cached GL state value.</summary>
    public uint ActiveUnit { get; set; }
    private readonly uint[] _boundTextures2D = new uint[32];
    private readonly uint[] _boundSamplers = new uint[32];

    // Viewport and scissor
    /// <summary>Cached GL state value.</summary>
    public int ViewportX { get; set; }
    /// <summary>Cached GL state value.</summary>
    public int ViewportY { get; set; }
    /// <summary>Cached GL state value.</summary>
    public int ViewportWidth { get; set; }
    /// <summary>Cached GL state value.</summary>
    public int ViewportHeight { get; set; }
    /// <summary>Cached GL state value.</summary>
    public int ScissorX { get; set; }
    /// <summary>Cached GL state value.</summary>
    public int ScissorY { get; set; }
    /// <summary>Cached GL state value.</summary>
    public int ScissorWidth { get; set; }
    /// <summary>Cached GL state value.</summary>
    public int ScissorHeight { get; set; }

    // Depth state
    /// <summary>Cached GL state value.</summary>
    public bool DepthTestEnabled { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint DepthFunc { get; set; }
    /// <summary>Cached GL state value.</summary>
    public bool DepthMask { get; set; }
    /// <summary>Cached GL state value.</summary>
    public double ClearDepth { get; set; }

    // Blend state
    /// <summary>Cached GL state value.</summary>
    public bool BlendEnabled { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint BlendSrcRGB { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint BlendDstRGB { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint BlendSrcAlpha { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint BlendDstAlpha { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint BlendEquationRGB { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint BlendEquationAlpha { get; set; }
    /// <summary>Cached GL state value.</summary>
    public float BlendColorR { get; set; }
    /// <summary>Cached GL state value.</summary>
    public float BlendColorG { get; set; }
    /// <summary>Cached GL state value.</summary>
    public float BlendColorB { get; set; }
    /// <summary>Cached GL state value.</summary>
    public float BlendColorA { get; set; }

    // Stencil state (per face)
    /// <summary>Cached GL state value.</summary>
    public bool StencilTestEnabled { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint StencilFuncFront { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint StencilFuncBack { get; set; }
    /// <summary>Cached GL state value.</summary>
    public int StencilRefFront { get; set; }
    /// <summary>Cached GL state value.</summary>
    public int StencilRefBack { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint StencilMaskFront { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint StencilMaskBack { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint StencilSfailFront { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint StencilDpfailFront { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint StencilDppassFront { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint StencilSfailBack { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint StencilDpfailBack { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint StencilDppassBack { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint StencilWriteMask { get; set; }
    /// <summary>Cached GL state value.</summary>
    public int ClearStencil { get; set; }

    // Cull state
    /// <summary>Cached GL state value.</summary>
    public bool CullFaceEnabled { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint CullMode { get; set; }
    /// <summary>Cached GL state value.</summary>
    public uint FrontFace { get; set; }

    // Color state
    /// <summary>Cached GL state value.</summary>
    public bool ColorMaskR { get; set; }
    /// <summary>Cached GL state value.</summary>
    public bool ColorMaskG { get; set; }
    /// <summary>Cached GL state value.</summary>
    public bool ColorMaskB { get; set; }
    /// <summary>Cached GL state value.</summary>
    public bool ColorMaskA { get; set; }
    /// <summary>Cached GL state value.</summary>
    public float ClearColorR { get; set; }
    /// <summary>Cached GL state value.</summary>
    public float ClearColorG { get; set; }
    /// <summary>Cached GL state value.</summary>
    public float ClearColorB { get; set; }
    /// <summary>Cached GL state value.</summary>
    public float ClearColorA { get; set; }

    // Polygon offset
    /// <summary>Cached GL state value.</summary>
    public bool PolygonOffsetFillEnabled { get; set; }
    /// <summary>Cached GL state value.</summary>
    public float PolygonOffsetFactor { get; set; }
    /// <summary>Cached GL state value.</summary>
    public float PolygonOffsetUnits { get; set; }

    // Line width
    /// <summary>Cached GL state value.</summary>
    public float LineWidth { get; set; }

    // Pixel store
    /// <summary>Cached GL state value.</summary>
    public int UnpackAlignment { get; set; }
    /// <summary>Cached GL state value.</summary>
    public int PackAlignment { get; set; }

    /// <summary>
    /// Initializes a new instance of the <see cref="GLStateCache"/> class.
    /// </summary>
    /// <param name="gl">The GL API.</param>
    public GLStateCache(IGLApi gl)
    {
        _gl = gl ?? throw new ArgumentNullException(nameof(gl));

        // Seed the shadow state to GL defaults with deduplication ACTIVE. A freshly created
        // context is already in the GL default state, so the sentinels Invalidate() installs
        // mirror it and the first real setter still issues its GL call (sentinel mismatch).
        // Leaving _isInvalidated set (a bare Invalidate) would force every setter to issue an
        // unconditional GL call forever, defeating the cache's entire purpose.
        Reset();
    }

    /// <summary>
    /// Invalidates all cached state, forcing the next operation to issue GL calls.
    /// </summary>
    public void Invalidate()
    {
        _isInvalidated = true;

        // Set all cached values to sentinel values that won't match real state
        BoundArrayBuffer = uint.MaxValue;
        BoundElementBuffer = uint.MaxValue;
        BoundUniformBuffer = uint.MaxValue;
        BoundCopyReadBuffer = uint.MaxValue;
        BoundCopyWriteBuffer = uint.MaxValue;
        BoundPixelPackBuffer = uint.MaxValue;
        BoundPixelUnpackBuffer = uint.MaxValue;
        BoundTransformFeedbackBuffer = uint.MaxValue;
        BoundVertexArray = uint.MaxValue;
        BoundProgram = uint.MaxValue;
        BoundReadFramebuffer = uint.MaxValue;
        BoundDrawFramebuffer = uint.MaxValue;
        BoundRenderbuffer = uint.MaxValue;
        ActiveUnit = uint.MaxValue;

        Array.Fill(_boundTextures2D, uint.MaxValue);
        Array.Fill(_boundSamplers, uint.MaxValue);

        ViewportX = ViewportY = ViewportWidth = ViewportHeight = -1;
        ScissorX = ScissorY = ScissorWidth = ScissorHeight = -1;

        DepthTestEnabled = false;
        DepthFunc = uint.MaxValue;
        DepthMask = true;
        ClearDepth = -1.0;

        BlendEnabled = false;
        BlendSrcRGB = BlendDstRGB = BlendSrcAlpha = BlendDstAlpha = uint.MaxValue;
        BlendEquationRGB = BlendEquationAlpha = uint.MaxValue;
        BlendColorR = BlendColorG = BlendColorB = BlendColorA = -1.0f;

        StencilTestEnabled = false;
        StencilFuncFront = StencilFuncBack = uint.MaxValue;
        StencilRefFront = StencilRefBack = -1;
        StencilMaskFront = StencilMaskBack = uint.MaxValue;
        StencilSfailFront = StencilDpfailFront = StencilDppassFront = uint.MaxValue;
        StencilSfailBack = StencilDpfailBack = StencilDppassBack = uint.MaxValue;
        StencilWriteMask = uint.MaxValue;
        ClearStencil = -1;

        CullFaceEnabled = false;
        CullMode = uint.MaxValue;
        FrontFace = uint.MaxValue;

        ColorMaskR = ColorMaskG = ColorMaskB = ColorMaskA = true;
        ClearColorR = ClearColorG = ClearColorB = ClearColorA = -1.0f;

        PolygonOffsetFillEnabled = false;
        PolygonOffsetFactor = PolygonOffsetUnits = float.NaN;

        LineWidth = -1.0f;

        UnpackAlignment = -1;
        PackAlignment = -1;
    }

    /// <summary>
    /// Resets the cache to GL defaults.
    /// </summary>
    public void Reset()
    {
        Invalidate();
        _isInvalidated = false;
    }

    // ========================================================================
    // Buffer Binding Operations
    // ========================================================================

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void BindBuffer(uint target, uint buffer)
    {
        // General-purpose buffer bind — dispatches to the correct cached target
        if (target == 0x8892) { BindArrayBuffer(buffer); return; } // GL_ARRAY_BUFFER
        if (target == 0x8893) { BindElementBuffer(buffer); return; } // GL_ELEMENT_ARRAY_BUFFER
        if (target == 0x8A11) { BindUniformBuffer(buffer); return; } // GL_UNIFORM_BUFFER
        if (target == 0x8F36) { BindCopyReadBuffer(buffer); return; } // GL_COPY_READ_BUFFER
        if (target == 0x8F37) { BindCopyWriteBuffer(buffer); return; } // GL_COPY_WRITE_BUFFER

        // Fallback: uncached direct call for less common targets
        _gl.BindBuffer(target, buffer);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void BindArrayBuffer(uint buffer)
    {
        if (_isInvalidated || BoundArrayBuffer != buffer)
        {
            BoundArrayBuffer = buffer;
            _gl.BindBuffer(0x8892, buffer); // GL_ARRAY_BUFFER
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void BindElementBuffer(uint buffer)
    {
        if (_isInvalidated || BoundElementBuffer != buffer)
        {
            BoundElementBuffer = buffer;
            _gl.BindBuffer(0x8893, buffer); // GL_ELEMENT_ARRAY_BUFFER
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void BindUniformBuffer(uint buffer)
    {
        if (_isInvalidated || BoundUniformBuffer != buffer)
        {
            BoundUniformBuffer = buffer;
            _gl.BindBuffer(0x8A11, buffer); // GL_UNIFORM_BUFFER
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void BindCopyReadBuffer(uint buffer)
    {
        if (_isInvalidated || BoundCopyReadBuffer != buffer)
        {
            BoundCopyReadBuffer = buffer;
            _gl.BindBuffer(0x8F36, buffer); // GL_COPY_READ_BUFFER
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void BindCopyWriteBuffer(uint buffer)
    {
        if (_isInvalidated || BoundCopyWriteBuffer != buffer)
        {
            BoundCopyWriteBuffer = buffer;
            _gl.BindBuffer(0x8F37, buffer); // GL_COPY_WRITE_BUFFER
        }
    }

    // ========================================================================
    // Vertex Array Operations
    // ========================================================================

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void BindVertexArray(uint array)
    {
        if (_isInvalidated || BoundVertexArray != array)
        {
            BoundVertexArray = array;
            _gl.BindVertexArray(array);
            // VAO bind also affects element buffer binding
            BoundElementBuffer = uint.MaxValue;
        }
    }

    // ========================================================================
    // Program Operations
    // ========================================================================

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void UseProgram(uint program)
    {
        if (_isInvalidated || BoundProgram != program)
        {
            BoundProgram = program;
            _gl.UseProgram(program);
        }
    }

    // ========================================================================
    // Framebuffer Operations
    // ========================================================================

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void BindFramebuffer(uint target, uint framebuffer)
    {
        if (target == 0x8D40) // GL_FRAMEBUFFER
        {
            if (_isInvalidated || BoundReadFramebuffer != framebuffer || BoundDrawFramebuffer != framebuffer)
            {
                BoundReadFramebuffer = framebuffer;
                BoundDrawFramebuffer = framebuffer;
                _gl.BindFramebuffer(target, framebuffer);
            }
        }
        else if (target == 0x8CA8) // GL_READ_FRAMEBUFFER
        {
            if (_isInvalidated || BoundReadFramebuffer != framebuffer)
            {
                BoundReadFramebuffer = framebuffer;
                _gl.BindFramebuffer(target, framebuffer);
            }
        }
        else if (target == 0x8CA9) // GL_DRAW_FRAMEBUFFER
        {
            if (_isInvalidated || BoundDrawFramebuffer != framebuffer)
            {
                BoundDrawFramebuffer = framebuffer;
                _gl.BindFramebuffer(target, framebuffer);
            }
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void BindRenderbuffer(uint renderbuffer)
    {
        if (_isInvalidated || BoundRenderbuffer != renderbuffer)
        {
            BoundRenderbuffer = renderbuffer;
            _gl.BindRenderbuffer(0x8D41, renderbuffer); // GL_RENDERBUFFER
        }
    }

    // ========================================================================
    // Texture Operations
    // ========================================================================

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void ActiveTexture(uint unitIndex)
    {
        if (_isInvalidated || ActiveUnit != unitIndex)
        {
            ActiveUnit = unitIndex;
            _gl.ActiveTexture(0x84C0 + unitIndex); // GL_TEXTURE0 + unitIndex
        }
    }

    /// <summary>
    /// Binds a texture to the currently active texture unit with the given target.
    /// Does NOT change the active unit — caller must set it first if needed.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void BindTexture(uint target, uint texture)
    {
        // Direct bind on the active unit; no unit-level caching for arbitrary targets
        _gl.BindTexture(target, texture);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void BindTexture2D(uint unitIndex, uint texture)
    {
        if (unitIndex >= 32) return;

        ActiveTexture(unitIndex);

        if (_isInvalidated || _boundTextures2D[unitIndex] != texture)
        {
            _boundTextures2D[unitIndex] = texture;
            _gl.BindTexture(0x0DE1, texture); // GL_TEXTURE_2D
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void BindSampler(uint unitIndex, uint sampler)
    {
        if (unitIndex >= 32) return;

        if (_isInvalidated || _boundSamplers[unitIndex] != sampler)
        {
            _boundSamplers[unitIndex] = sampler;
            _gl.BindSampler(unitIndex, sampler);
        }
    }
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetViewport(int x, int y, int width, int height)
    {
        if (_isInvalidated || ViewportX != x || ViewportY != y || ViewportWidth != width || ViewportHeight != height)
        {
            ViewportX = x;
            ViewportY = y;
            ViewportWidth = width;
            ViewportHeight = height;
            _gl.Viewport(x, y, (uint)width, (uint)height);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetScissor(int x, int y, int width, int height)
    {
        if (_isInvalidated || ScissorX != x || ScissorY != y || ScissorWidth != width || ScissorHeight != height)
        {
            ScissorX = x;
            ScissorY = y;
            ScissorWidth = width;
            ScissorHeight = height;
            _gl.Scissor(x, y, (uint)width, (uint)height);
        }
    }

    // ========================================================================
    // Depth State Operations
    // ========================================================================

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetDepthTest(bool enabled)
    {
        if (_isInvalidated || DepthTestEnabled != enabled)
        {
            DepthTestEnabled = enabled;
            if (enabled)
                _gl.Enable(0x0B71); // GL_DEPTH_TEST
            else
                _gl.Disable(0x0B71);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetDepthFunc(uint func)
    {
        if (_isInvalidated || DepthFunc != func)
        {
            DepthFunc = func;
            _gl.DepthFunc(func);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetDepthMask(bool mask)
    {
        if (_isInvalidated || DepthMask != mask)
        {
            DepthMask = mask;
            _gl.DepthMask(mask);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetClearDepth(double depth)
    {
        if (_isInvalidated || ClearDepth != depth)
        {
            ClearDepth = depth;
            _gl.ClearDepth(depth);
        }
    }

    // ========================================================================
    // Blend State Operations
    // ========================================================================

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetBlend(bool enabled)
    {
        if (_isInvalidated || BlendEnabled != enabled)
        {
            BlendEnabled = enabled;
            if (enabled)
                _gl.Enable(0x0BE2); // GL_BLEND
            else
                _gl.Disable(0x0BE2);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetBlendFuncSeparate(uint srcRGB, uint dstRGB, uint srcAlpha, uint dstAlpha)
    {
        if (_isInvalidated || BlendSrcRGB != srcRGB || BlendDstRGB != dstRGB ||
            BlendSrcAlpha != srcAlpha || BlendDstAlpha != dstAlpha)
        {
            BlendSrcRGB = srcRGB;
            BlendDstRGB = dstRGB;
            BlendSrcAlpha = srcAlpha;
            BlendDstAlpha = dstAlpha;
            _gl.BlendFuncSeparate(srcRGB, dstRGB, srcAlpha, dstAlpha);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetBlendEquationSeparate(uint modeRGB, uint modeAlpha)
    {
        if (_isInvalidated || BlendEquationRGB != modeRGB || BlendEquationAlpha != modeAlpha)
        {
            BlendEquationRGB = modeRGB;
            BlendEquationAlpha = modeAlpha;
            _gl.BlendEquationSeparate(modeRGB, modeAlpha);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetBlendColor(float r, float g, float b, float a)
    {
        if (_isInvalidated || BlendColorR != r || BlendColorG != g || BlendColorB != b || BlendColorA != a)
        {
            BlendColorR = r;
            BlendColorG = g;
            BlendColorB = b;
            BlendColorA = a;
            // Note: BlendColor not in IGLApi, would need to add it
        }
    }

    // ========================================================================
    // Stencil State Operations
    // ========================================================================

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetStencilTest(bool enabled)
    {
        if (_isInvalidated || StencilTestEnabled != enabled)
        {
            StencilTestEnabled = enabled;
            if (enabled)
                _gl.Enable(0x0B90); // GL_STENCIL_TEST
            else
                _gl.Disable(0x0B90);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetStencilFunc(uint func, int reference, uint mask)
    {
        SetStencilFuncSeparate(0x0408, func, reference, mask); // GL_FRONT_AND_BACK
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetStencilFuncSeparate(uint face, uint func, int reference, uint mask)
    {
        if (face == 0x0408 || face == 0x0404) // FRONT_AND_BACK or FRONT
        {
            if (_isInvalidated || StencilFuncFront != func || StencilRefFront != reference || StencilMaskFront != mask)
            {
                StencilFuncFront = func;
                StencilRefFront = reference;
                StencilMaskFront = mask;
                _gl.StencilFunc(func, reference, mask);
            }
        }

        if (face == 0x0408 || face == 0x0405) // FRONT_AND_BACK or BACK
        {
            if (_isInvalidated || StencilFuncBack != func || StencilRefBack != reference || StencilMaskBack != mask)
            {
                StencilFuncBack = func;
                StencilRefBack = reference;
                StencilMaskBack = mask;
                // Note: StencilFuncSeparate not in IGLApi, would need to add it
            }
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetStencilOp(uint sfail, uint dpfail, uint dppass)
    {
        SetStencilOpSeparate(0x0408, sfail, dpfail, dppass); // GL_FRONT_AND_BACK
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetStencilOpSeparate(uint face, uint sfail, uint dpfail, uint dppass)
    {
        if (face == 0x0408 || face == 0x0404) // FRONT_AND_BACK or FRONT
        {
            if (_isInvalidated || StencilSfailFront != sfail || StencilDpfailFront != dpfail || StencilDppassFront != dppass)
            {
                StencilSfailFront = sfail;
                StencilDpfailFront = dpfail;
                StencilDppassFront = dppass;
                _gl.StencilOp(sfail, dpfail, dppass);
            }
        }

        if (face == 0x0408 || face == 0x0405) // FRONT_AND_BACK or BACK
        {
            if (_isInvalidated || StencilSfailBack != sfail || StencilDpfailBack != dpfail || StencilDppassBack != dppass)
            {
                StencilSfailBack = sfail;
                StencilDpfailBack = dpfail;
                StencilDppassBack = dppass;
                // Note: StencilOpSeparate not in IGLApi, would need to add it
            }
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetStencilMask(uint mask)
    {
        if (_isInvalidated || StencilWriteMask != mask)
        {
            StencilWriteMask = mask;
            _gl.StencilMask(mask);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetClearStencil(int s)
    {
        if (_isInvalidated || ClearStencil != s)
        {
            ClearStencil = s;
            _gl.ClearStencil(s);
        }
    }

    // ========================================================================
    // Cull State Operations
    // ========================================================================

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetCullFace(bool enabled)
    {
        if (_isInvalidated || CullFaceEnabled != enabled)
        {
            CullFaceEnabled = enabled;
            if (enabled)
                _gl.Enable(0x0B44); // GL_CULL_FACE
            else
                _gl.Disable(0x0B44);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetCullMode(uint mode)
    {
        if (_isInvalidated || CullMode != mode)
        {
            CullMode = mode;
            _gl.CullFace(mode);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetFrontFace(uint mode)
    {
        if (_isInvalidated || FrontFace != mode)
        {
            FrontFace = mode;
            _gl.FrontFace(mode);
        }
    }

    // ========================================================================
    // Color State Operations
    // ========================================================================

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetColorMask(bool r, bool g, bool b, bool a)
    {
        if (_isInvalidated || ColorMaskR != r || ColorMaskG != g || ColorMaskB != b || ColorMaskA != a)
        {
            ColorMaskR = r;
            ColorMaskG = g;
            ColorMaskB = b;
            ColorMaskA = a;
            _gl.ColorMask(r, g, b, a);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetClearColor(float r, float g, float b, float a)
    {
        if (_isInvalidated || ClearColorR != r || ClearColorG != g || ClearColorB != b || ClearColorA != a)
        {
            ClearColorR = r;
            ClearColorG = g;
            ClearColorB = b;
            ClearColorA = a;
            _gl.ClearColor(r, g, b, a);
        }
    }

    // ========================================================================
    // Polygon Offset Operations
    // ========================================================================

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetPolygonOffsetFill(bool enabled)
    {
        if (_isInvalidated || PolygonOffsetFillEnabled != enabled)
        {
            PolygonOffsetFillEnabled = enabled;
            if (enabled)
                _gl.Enable(0x8037); // GL_POLYGON_OFFSET_FILL
            else
                _gl.Disable(0x8037);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetPolygonOffset(float factor, float units)
    {
        if (_isInvalidated || PolygonOffsetFactor != factor || PolygonOffsetUnits != units)
        {
            PolygonOffsetFactor = factor;
            PolygonOffsetUnits = units;
            _gl.PolygonOffset(factor, units);
        }
    }

    // ========================================================================
    // Line Width Operations
    // ========================================================================

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetLineWidth(float width)
    {
        if (_isInvalidated || LineWidth != width)
        {
            LineWidth = width;
            _gl.LineWidth(width);
        }
    }

    // ========================================================================
    // Pixel Store Operations
    // ========================================================================

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetUnpackAlignment(int alignment)
    {
        if (_isInvalidated || UnpackAlignment != alignment)
        {
            UnpackAlignment = alignment;
            _gl.PixelStore(0x0CF5, alignment); // GL_UNPACK_ALIGNMENT
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetPackAlignment(int alignment)
    {
        if (_isInvalidated || PackAlignment != alignment)
        {
            PackAlignment = alignment;
            _gl.PixelStore(0x0D05, alignment); // GL_PACK_ALIGNMENT
        }
    }
}
