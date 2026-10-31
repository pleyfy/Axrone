namespace Axrone.Ui.Rendering.OpenGL.Tests;

using Axrone.Numeric;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Mock;
using FluentAssertions;
using Xunit;

public sealed class UiOpenGlBackendTests
{
    private const int LayoutId = 1;

    private static UiFrame BuildFrame(UiViewport viewport, params UiRenderCommand[] commands)
    {
        UiDrawList list = new(commands.Length);
        for (int i = 0; i < commands.Length; i++)
        {
            list.Add(in commands[i]);
        }

        return list.Build(viewport, list.ComputeMetrics());
    }

    private static UiRenderCommand Quad(int z = 0) =>
        UiRenderCommand.Quad(new UiNodeId(1), new Rect(0, 0, 10, 10), UiColor.White, z);

    private static UiRenderCommand Image(ulong resource) =>
        UiRenderCommand.Image(new UiNodeId(2), new Rect(0, 0, 32, 32), new UiResourceId(resource), new Rect(0, 0, 1, 1), UiColor.White, 0);

    private static UiRenderCommand Text() =>
        UiRenderCommand.Text(new UiNodeId(3), new Rect(10, 20, 100, 20), new UiTextLayoutId(LayoutId), UiColor.White, 0);

    private static (MockGLApi Api, GLContext Context) CreateContext() 
    {
        MockGLApi api = new();
        return (api, new GLContext(api));
    }

    [Fact]
    public void QuadsAreDrawnAsOneInstancedCall()
    {
        (MockGLApi api, GLContext context) = CreateContext();
        using (context)
        using (UiOpenGlBackend backend = new(context))
        using (UiFrameRenderHost host = new(backend))
        {
            host.Submit(BuildFrame(new UiViewport(800, 600, 1, 0, 0), Quad(), Quad(1), Quad(2)));
            host.Flush();

            backend.FrameCount.Should().Be(1);
            backend.DrawCalls.Should().Be(1);
            backend.Instances.Should().Be(3);
            api.CallLog.Should().Contain(static call => call.StartsWith("DrawArraysInstanced(", StringComparison.Ordinal));
        }
    }

    [Fact]
    public void ImageBatchBindsTexture()
    {
        (MockGLApi api, GLContext context) = CreateContext();
        FakeTextures textures = new();
        textures.Add(5, 77, 0, 64, 64);

        using (context)
        using (UiOpenGlBackend backend = new(context, new UiOpenGlBackendOptions { Textures = textures }))
        using (UiFrameRenderHost host = new(backend))
        {
            host.Submit(BuildFrame(new UiViewport(100, 100, 1, 0, 0), Image(5)));
            host.Flush();

            backend.DrawCalls.Should().Be(1);
            backend.Instances.Should().Be(1);
            api.CallLog.Should().Contain(static call => call.StartsWith("BindTexture(", StringComparison.Ordinal));
        }
    }

    [Fact]
    public void NineSliceImageEmitsNineInstances()
    {
        (MockGLApi api, GLContext context) = CreateContext();
        _ = api;
        FakeTextures textures = new();
        textures.Add(5, 77, 0, 64, 64);
        UiRenderCommand sliced = Image(5).WithSliceBorder(new UiEdgeInsets(8, 8, 8, 8));

        using (context)
        using (UiOpenGlBackend backend = new(context, new UiOpenGlBackendOptions { Textures = textures }))
        using (UiFrameRenderHost host = new(backend))
        {
            host.Submit(BuildFrame(new UiViewport(100, 100, 1, 0, 0), sliced));
            host.Flush();

            backend.Instances.Should().Be(9);
        }
    }

    [Fact]
    public void TextBatchSplitsByAtlasPageTexture()
    {
        (MockGLApi api, GLContext context) = CreateContext();
        _ = api;
        FakeTextures textures = new();
        textures.Add(11, 101, 0, 64, 64);
        textures.Add(22, 102, 0, 64, 64);

        FixedAtlas atlas = new(new UiFontFaceId(1));
        atlas.Add(65, 11);
        atlas.Add(66, 22);
        FakeLayouts layouts = new();
        layouts.Add(LayoutId, new TestLayout(new UiShapedGlyph[]
        {
            new(65, 0, 0, 0, 9, 0),
            new(66, 1, 9, 0, 9, 0),
        }), new UiFontFaceId(1));

        UiOpenGlBackendOptions options = new()
        {
            Textures = textures,
            GlyphAtlas = atlas,
            TextLayouts = layouts,
        };

        using (context)
        using (UiOpenGlBackend backend = new(context, options))
        using (UiFrameRenderHost host = new(backend))
        {
            host.Submit(BuildFrame(new UiViewport(200, 100, 1, 0, 0), Text()));
            host.Flush();

            backend.DrawCalls.Should().Be(2);
            backend.Instances.Should().Be(2);
            backend.MissedGlyphs.Should().Be(0);
        }
    }

    [Fact]
    public void MissingGlyphsAndTexturesAreCounted()
    {
        (MockGLApi api, GLContext context) = CreateContext();
        _ = api;
        FixedAtlas atlas = new(new UiFontFaceId(1));
        atlas.Add(65, 11);
        FakeLayouts layouts = new();
        layouts.Add(LayoutId, new TestLayout(new UiShapedGlyph[] { new(65, 0, 0, 0, 9, 0), new(66, 9, 0, 0, 9, 0) }), new UiFontFaceId(1));

        // The texture source resolves nothing: resident glyphs fall through to a missing page texture.
        FakeTextures textures = new();
        UiOpenGlBackendOptions options = new() { Textures = textures, GlyphAtlas = atlas, TextLayouts = layouts };

        using (context)
        using (UiOpenGlBackend backend = new(context, options))
        using (UiFrameRenderHost host = new(backend))
        {
            host.Submit(BuildFrame(new UiViewport(200, 100, 1, 0, 0), Text()));
            host.Flush();

            backend.DrawCalls.Should().Be(0);
            backend.MissedGlyphs.Should().Be(1);
            backend.MissingTextures.Should().Be(1);
            backend.UnsupportedCommands.Should().Be(0);
        }

        (MockGLApi bareApi, GLContext bareContext) = CreateContext();
        _ = bareApi;
        using (bareContext)
        using (UiOpenGlBackend backend = new(bareContext, new UiOpenGlBackendOptions()))
        using (UiFrameRenderHost host = new(backend))
        {
            host.Submit(BuildFrame(new UiViewport(200, 100, 1, 0, 0), Text()));
            host.Flush();

            backend.DrawCalls.Should().Be(0);
            backend.UnsupportedCommands.Should().Be(1);
        }
    }

    [Fact]
    public void ClipEnablesScissorAndEmptyClipSkipsDraw()
    {
        (MockGLApi api, GLContext context) = CreateContext();
        UiRenderCommand clipped = Quad().WithClip(new Rect(10, 10, 20, 20));

        using (context)
        using (UiOpenGlBackend backend = new(context))
        using (UiFrameRenderHost host = new(backend))
        {
            host.Submit(BuildFrame(new UiViewport(100, 100, 1, 0, 0), clipped));
            host.Flush();

            backend.DrawCalls.Should().Be(1);
            api.CallLog.Should().Contain(static call => call.StartsWith("Scissor(", StringComparison.Ordinal));
            api.CallLog.Should().Contain("Enable(3089)");
        }

        (MockGLApi api2, GLContext context2) = CreateContext();
        UiRenderCommand empty = Quad().WithClip(new Rect(500, 500, 10, 10));
        using (context2)
        using (UiOpenGlBackend backend = new(context2))
        using (UiFrameRenderHost host = new(backend))
        {
            host.Submit(BuildFrame(new UiViewport(100, 100, 1, 0, 0), empty));
            host.Flush();

            backend.DrawCalls.Should().Be(0);
            api2.CallLog.Should().NotContain(static call => call.StartsWith("DrawArraysInstanced(", StringComparison.Ordinal));
        }
    }

    [Fact]
    public void InstanceOverflowFlushesSubRuns()
    {
        (MockGLApi api, GLContext context) = CreateContext();
        _ = api;
        UiOpenGlBackendOptions options = new() { QuadCapacity = 2 };

        using (context)
        using (UiOpenGlBackend backend = new(context, options))
        using (UiFrameRenderHost host = new(backend))
        {
            host.Submit(BuildFrame(new UiViewport(100, 100, 1, 0, 0), Quad(), Quad(), Quad(), Quad(), Quad()));
            host.Flush();

            backend.DrawCalls.Should().Be(3);
            backend.Instances.Should().Be(5);
        }
    }

    [Fact]
    public void CustomCommandsUseHandlerOrAreCountedUnsupported()
    {
        (MockGLApi api, GLContext context) = CreateContext();
        _ = api;
        UiRenderCommand custom = UiRenderCommand.Custom(new UiNodeId(9), new UiResourceId(1), 0);

        using (context)
        using (UiOpenGlBackend backend = new(context))
        using (UiFrameRenderHost host = new(backend))
        {
            host.Submit(BuildFrame(new UiViewport(100, 100, 1, 0, 0), custom));
            host.Flush();
            backend.UnsupportedCommands.Should().Be(1);
        }

        CountingHandler handler = new();
        (MockGLApi handlerApi, GLContext handlerContext) = CreateContext();
        _ = handlerApi;
        using (handlerContext)
        using (UiOpenGlBackend backend = new(handlerContext, new UiOpenGlBackendOptions { CustomCommands = handler }))
        using (UiFrameRenderHost host = new(backend))
        {
            host.Submit(BuildFrame(new UiViewport(100, 100, 1, 0, 0), custom));
            host.Flush();
            handler.Count.Should().Be(1);
            backend.CustomCommands.Should().Be(1);
        }
    }

    [Fact]
    public void ContextLossMakesBackendNotReadyAndRestoreRebuildsResources()
    {
        (MockGLApi api, GLContext context) = CreateContext();
        using (context)
        using (UiOpenGlBackend backend = new(context))
        using (UiFrameRenderHost host = new(backend))
        {
            host.Submit(BuildFrame(new UiViewport(100, 100, 1, 0, 0), Quad()));
            host.Flush();
            backend.FrameCount.Should().Be(1);
            int programsBefore = CountCalls(api, "CreateProgram()");

            context.NotifyContextLost();
            backend.IsReady.Should().BeFalse();

            host.Submit(BuildFrame(new UiViewport(100, 100, 1, 0, 0), Quad()));
            host.Flush();
            backend.FrameCount.Should().Be(1);
            host.SkippedFrames.Should().Be(1);

            context.NotifyContextRestored();
            backend.IsReady.Should().BeTrue();

            host.Submit(BuildFrame(new UiViewport(100, 100, 1, 0, 0), Quad()));
            host.Flush();

            backend.FrameCount.Should().Be(2);
            CountCalls(api, "CreateProgram()").Should().BeGreaterThan(programsBefore);
        }
    }

    [Fact]
    public void PipelinesAreCachedByFullDescriptor()
    {
        (MockGLApi api, GLContext context) = CreateContext();
        _ = api;
        using (context)
        using (UiOpenGlBackend backend = new(context))
        {
            UiPipelineDescriptor descriptor = new(new UiResourceId(1), UiBlendMode.Alpha, UiImageSampling.Linear, false);
            IUiPipeline first = backend.CreatePipeline(in descriptor);
            IUiPipeline second = backend.CreatePipeline(in descriptor);
            IUiPipeline other = backend.CreatePipeline(new UiPipelineDescriptor(new UiResourceId(1), UiBlendMode.Additive, UiImageSampling.Linear, false));

            ReferenceEquals(first, second).Should().BeTrue();
            ReferenceEquals(first, other).Should().BeFalse();
            backend.PipelineCount.Should().Be(2);
            backend.IsReady.Should().BeTrue();
        }
    }

    [Fact]
    public void DisposedBackendIsNotReadyAndRejectsPipelines()
    {
        (MockGLApi api, GLContext context) = CreateContext();
        _ = api;
        using (context)
        {
            UiOpenGlBackend backend = new(context);
            backend.Dispose();
            backend.Dispose();

            backend.IsReady.Should().BeFalse();
            UiPipelineDescriptor descriptor = new(new UiResourceId(1), UiBlendMode.Alpha, UiImageSampling.Linear, false);
            Action act = () => backend.CreatePipeline(in descriptor);
            act.Should().Throw<ObjectDisposedException>();
        }
    }

    [Fact]
    public void DrawBatchOutsideFrameThrows()
    {
        (MockGLApi api, GLContext context) = CreateContext();
        _ = api;
        using (context)
        using (UiOpenGlBackend backend = new(context))
        {
            UiBatchKey key = UiBatchKeyFactory.Create(Quad());
            Action act = () => backend.DrawBatch(in key, [Quad()]);
            act.Should().Throw<InvalidOperationException>();
        }
    }

    [Fact]
    public void ZeroViewportIsClampedToOnePixel()
    {
        (MockGLApi api, GLContext context) = CreateContext();
        _ = api;
        using (context)
        using (UiOpenGlBackend backend = new(context))
        using (UiFrameRenderHost host = new(backend))
        {
            host.Submit(BuildFrame(new UiViewport(0, 0, 1, 0, 0), Quad()));
            host.Flush();

            backend.FrameCount.Should().Be(1);
            backend.DrawCalls.Should().Be(1);
        }
    }

    private static int CountCalls(MockGLApi api, string prefix)
    {
        int count = 0;
        for (int i = 0; i < api.CallLog.Count; i++)
        {
            if (api.CallLog[i].StartsWith(prefix, StringComparison.Ordinal))
            {
                count++;
            }
        }

        return count;
    }

    private sealed class FakeTextures : IUiTextureSource
    {
        private readonly Dictionary<ulong, UiTextureBinding> _bindings = [];

        public void Add(ulong resource, uint texture, uint sampler, int width, int height) =>
            _bindings[resource] = new UiTextureBinding(texture, sampler, width, height);

        public bool TryGetTexture(UiResourceId resource, out UiTextureBinding binding) =>
            _bindings.TryGetValue(resource.Value, out binding);
    }

    private sealed class FixedAtlas(UiFontFaceId face) : IUiGlyphAtlas
    {
        private static readonly UiGlyphAtlasPageId[] PageIds = [new UiGlyphAtlasPageId(1)];
        private readonly Dictionary<int, UiGlyphAtlasEntry> _entries = [];

        public int PageCount => 1;

        public ReadOnlySpan<UiGlyphAtlasPageId> Pages => PageIds;

        public void Add(int codePoint, ulong texture) =>
            _entries[codePoint] = new UiGlyphAtlasEntry(
                face,
                codePoint,
                new UiGlyphAtlasPageId(1),
                new UiResourceId(texture),
                new Rect(0, 0, 0.1f, 0.1f),
                8,
                10,
                0,
                0,
                9,
                UiGlyphFormat.Alpha8);

        public bool TryGetPage(UiGlyphAtlasPageId page, out UiGlyphAtlasPageInfo info)
        {
            info = new UiGlyphAtlasPageInfo(page, new UiResourceId(1), 64, 64, _entries.Count, UiGlyphFormat.Alpha8);
            return page.Value == 1;
        }

        public bool TryGetEntry(UiFontFaceId query, int codePoint, out UiGlyphAtlasEntry entry)
        {
            if (query == face)
            {
                return _entries.TryGetValue(codePoint, out entry);
            }

            entry = default;
            return false;
        }
    }

    private sealed class FakeLayouts : IUiTextLayoutSource
    {
        private readonly Dictionary<uint, (IUiTextLayout Layout, UiFontFaceId Face)> _layouts = [];

        public void Add(uint id, IUiTextLayout layout, UiFontFaceId face) => _layouts[id] = (layout, face);

        public bool TryGetLayout(UiTextLayoutId layout, out IUiTextLayout resolved, out UiFontFaceId face)
        {
            if (_layouts.TryGetValue(layout.Value, out (IUiTextLayout Layout, UiFontFaceId Face) entry))
            {
                resolved = entry.Layout;
                face = entry.Face;
                return true;
            }

            resolved = null!;
            face = default;
            return false;
        }
    }

    private sealed class TestLayout(ReadOnlyMemory<UiShapedGlyph> glyphs) : IUiTextLayout
    {
        public UiTextLayoutId Id => new(LayoutId);

        public UiSize Size => new(100, 20);

        public UiTextMetrics Metrics => new(100, 20, 20, 15, 1, false);

        public ReadOnlySpan<UiShapedGlyph> Glyphs => glyphs.Span;
    }

    private sealed class CountingHandler : IUiCustomCommandHandler
    {
        public int Count { get; private set; }

        public void Execute(in UiRenderCommand command) => Count++;
    }
}
