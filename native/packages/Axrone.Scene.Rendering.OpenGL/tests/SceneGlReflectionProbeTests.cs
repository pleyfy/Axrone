namespace Axrone.Scene.Rendering.OpenGL.Tests;

using Axrone.Numeric;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Mock;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using Axrone.Scene.Rendering.OpenGL;
using FluentAssertions;
using Xunit;

public sealed class SceneGlReflectionProbeTests
{
    private const string VertexShader = """
        #version 330 core
        void main()
        {
            gl_Position = vec4(0.0);
        }
        """;

    [Fact]
    public void CaptureWritesAllSixCubeFaces()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using var atlas = new SceneGlReflectionProbeAtlas(context, 16);
        using var capture = new SceneGlReflectionProbeCapture(context, atlas);
        var content = new RecordingContent();
        var probe = new SceneReflectionProbeRenderItem
        {
            CubemapId = SceneAssetId<TextureAssetTag>.FromName("cubemap/probe"),
            WorldCenter = new Vec3(1, 2, 3),
            WorldExtents = new Vec3(4, 5, 6),
            Intensity = 1.5f
        };

        capture.Capture(in probe, content).Should().Be(6);

        capture.LastFaceCount.Should().Be(6);
        content.Faces.Should().Be(6);
        content.LastViewProjection.IsAllFinite.Should().BeTrue();
        atlas.Count.Should().Be(1);
        atlas.TryGet(probe.CubemapId, out _).Should().BeTrue();
        api.CallLog.Should().Contain(call => call.StartsWith("FramebufferTexture2D(", StringComparison.Ordinal));
        api.CallLog.Should().Contain(call => call.StartsWith("Clear(", StringComparison.Ordinal));
    }

    [Fact]
    public void CaptureWithoutCubemapDoesNothing()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using var atlas = new SceneGlReflectionProbeAtlas(context, 16);
        using var capture = new SceneGlReflectionProbeCapture(context, atlas);
        var probe = new SceneReflectionProbeRenderItem();

        capture.Capture(in probe).Should().Be(0);
        atlas.Count.Should().Be(0);
        _ = api;
    }

    [Fact]
    public void BinderBindsCubemapAndClearsMissingProbe()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using var atlas = new SceneGlReflectionProbeAtlas(context, 16);
        using var shader = new SceneGlShader(context, "probe-sampling", VertexShader,
            "#version 330 core\nout vec4 c;\nvoid main(){c=vec4(1);}\n" + SceneGlShaderSnippets.ReflectionProbe);
        var cubemap = SceneAssetId<TextureAssetTag>.FromName("cubemap/bound");
        _ = atlas.GetOrCreate(cubemap);
        var probe = new SceneReflectionProbeRenderItem
        {
            CubemapId = cubemap,
            WorldCenter = new Vec3(1, 2, 3),
            WorldExtents = new Vec3(4, 5, 6),
            Intensity = 2.0f
        };

        SceneGlReflectionProbeBinder.Bind(context, shader, atlas, in probe).Should().BeTrue();
        api.CallLog.Should().Contain("ActiveTexture(33998)");
        api.CallLog.Should().Contain(call => call.StartsWith("BindTexture(34067,", StringComparison.Ordinal));

        var missing = new SceneReflectionProbeRenderItem { CubemapId = SceneAssetId<TextureAssetTag>.FromName("cubemap/missing") };
        SceneGlReflectionProbeBinder.Bind(context, shader, atlas, in missing).Should().BeFalse();
    }

    [Fact]
    public void AtlasValidatesResolutionAndDisposedUse()
    {
        var api = new MockGLApi { EnableCallLogging = false };
        using var context = new GLContext(api);

        Action zero = () => _ = new SceneGlReflectionProbeAtlas(context, 0);
        Action tooLarge = () => _ = new SceneGlReflectionProbeAtlas(context, 99999);
        zero.Should().Throw<SceneConfigurationException>();
        tooLarge.Should().Throw<SceneConfigurationException>();

        SceneGlReflectionProbeAtlas atlas = new(context, 8);
        Action invalidId = () => atlas.GetOrCreate(default);
        invalidId.Should().Throw<SceneConfigurationException>();
        atlas.Dispose();
        atlas.Dispose();
        Action afterDispose = () => atlas.GetOrCreate(SceneAssetId<TextureAssetTag>.FromName("cubemap/one"));
        afterDispose.Should().Throw<SceneDisposedException>();
    }

    private sealed class RecordingContent : IReflectionProbeContentSource
    {
        public int Faces { get; private set; }

        public Mat4 LastViewProjection { get; private set; }

        public void RenderFace(in SceneReflectionProbeRenderItem probe, int face, in Mat4 viewProjection)
        {
            Faces++;
            LastViewProjection = viewProjection;
        }
    }
}
