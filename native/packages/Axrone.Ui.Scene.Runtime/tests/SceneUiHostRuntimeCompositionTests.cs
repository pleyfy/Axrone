namespace Axrone.Ui.Scene.Runtime.Tests;

using System.Buffers;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Rendering;
using Axrone.Scene.Runtime;
using Axrone.Ui.Assets;
using Axrone.Ui.Rendering;
using Axrone.Ui.Scene;
using FluentAssertions;
using Xunit;

public sealed class SceneUiHostRuntimeCompositionTests
{
    private const string AssetId = "UI/hud.ui.json";

    [Fact]
    public void AttachWiresCodecsBridgeAndRendererOnce()
    {
        using SceneRuntime runtime = CreateRuntime();
        FakeRendererFactory factory = new();
        int baseline = runtime.Codecs.Count;

        SceneUiHostsRuntime first = runtime.AttachUiHosts(Options(factory));
        SceneUiHostsRuntime second = runtime.AttachUiHosts(Options(factory));

        ReferenceEquals(first, second).Should().BeTrue();
        first.Bridge.Should().NotBeNull();
        first.Renderer.Should().BeSameAs(factory.Renderer);
        factory.CreateCount.Should().Be(1);
        runtime.Codecs.TryGet("SceneUiHost", out _).Should().BeTrue();
        runtime.Codecs.Count.Should().Be(baseline + 1);
    }

    [Fact]
    public void AttachFailsWithoutAssets()
    {
        using SceneRuntime runtime = CreateRuntime();

        bool attached = runtime.TryAttachUiHosts(
            new SceneUiHostRuntimeOptions { RendererFactory = new FakeRendererFactory() },
            out SceneUiHostsRuntime? hosts,
            out SceneUiHostComposeResult result);

        attached.Should().BeFalse();
        hosts.Should().BeNull();
        result.Error.Should().Be(SceneUiHostComposeError.MissingAssets);
        runtime.Codecs.TryGet("SceneUiHost", out _).Should().BeFalse();
    }

    [Fact]
    public void AttachFailsWithoutProfileComponent()
    {
        using SceneRuntime runtime = new(new SceneRuntimeOptions { RuntimeProfile = SceneRuntimeProfiles.Core });

        bool attached = runtime.TryAttachUiHosts(
            Options(new FakeRendererFactory()),
            out _,
            out SceneUiHostComposeResult result);

        attached.Should().BeFalse();
        result.Error.Should().Be(SceneUiHostComposeError.MissingProfileComponent);
    }

    [Fact]
    public void AttachFailsWithoutRenderer()
    {
        using SceneRuntime runtime = CreateRuntime();

        bool attached = runtime.TryAttachUiHosts(
            new SceneUiHostRuntimeOptions { Assets = CreateTable() },
            out _,
            out SceneUiHostComposeResult result);

        attached.Should().BeFalse();
        result.Error.Should().Be(SceneUiHostComposeError.MissingRenderer);
    }

    [Fact]
    public void HeadlessAttachSkipsTheRenderer()
    {
        using SceneRuntime runtime = CreateRuntime();

        bool attached = runtime.TryAttachUiHosts(
            new SceneUiHostRuntimeOptions { Assets = CreateTable(), EnableRendering = false },
            out SceneUiHostsRuntime? hosts,
            out _);

        attached.Should().BeTrue();
        hosts!.HasRenderer.Should().BeFalse();
        hosts.Render().Should().BeFalse();
    }

    [Fact]
    public void ThrowingRendererFactoryLeavesNoPartialBinding()
    {
        using SceneRuntime runtime = CreateRuntime();
        FakeRendererFactory failing = new() { Throw = true };

        runtime.TryAttachUiHosts(Options(failing), out _, out SceneUiHostComposeResult result)
            .Should().BeFalse();
        result.Error.Should().Be(SceneUiHostComposeError.RendererFailed);

        FakeRendererFactory healthy = new();
        SceneUiHostsRuntime attached = runtime.AttachUiHosts(Options(healthy));
        attached.Bridge.Should().NotBeNull();
    }

    [Fact]
    public void DetachAndHandleDisposeAreIdempotent()
    {
        using SceneRuntime runtime = CreateRuntime();
        FakeRendererFactory factory = new();
        SceneUiHostsRuntime hosts = runtime.AttachUiHosts(Options(factory));

        runtime.TryDetachUiHosts().Should().BeTrue();
        hosts.IsDisposed.Should().BeTrue();
        factory.Renderer.Disposed.Should().Be(1);
        runtime.TryDetachUiHosts().Should().BeFalse();

        SceneUiHostsRuntime reattached = runtime.AttachUiHosts(Options(new FakeRendererFactory()));
        ReferenceEquals(reattached, hosts).Should().BeFalse();
        reattached.Dispose();
        reattached.Dispose();
        runtime.Codecs.TryGet("SceneUiHost", out _).Should().BeTrue();
    }

    [Fact]
    public void UpdateRenderAndReloadDriveTheBridge()
    {
        using SceneRuntime runtime = CreateRuntime();
        FakeRendererFactory factory = new();
        factory.Renderer.BuildFrames = true;
        SceneUiHostsRuntime hosts = runtime.AttachUiHosts(Options(factory));
        AddHost(runtime.World);

        hosts.Update().Should().BeGreaterThan(0);
        hosts.Render().Should().BeTrue();
        factory.Renderer.RenderCount.Should().Be(1);
        factory.Renderer.LastFrameCommands.Should().BeGreaterThan(0);

        int revision = hosts.Bridge.Revision;
        hosts.ReloadAll().Should().BeTrue();
        hosts.Bridge.Revision.Should().BeGreaterThan(revision);
    }

    [Fact]
    public void RenderFailureIsIsolatedAndRecoverable()
    {
        using SceneRuntime runtime = CreateRuntime();
        FakeRendererFactory factory = new();
        factory.Renderer.Throw = true;
        SceneUiHostsRuntime hosts = runtime.AttachUiHosts(Options(factory));
        AddHost(runtime.World);
        hosts.Update();

        hosts.Render().Should().BeFalse();
        hosts.LastError.Should().BeOfType<InvalidOperationException>();

        factory.Renderer.Throw = false;
        hosts.Render().Should().BeTrue();
        hosts.LastError.Should().BeNull();
    }

    [Fact]
    public void SteadyStateUpdateAndRenderAllocateNothing()
    {
        using SceneRuntime runtime = CreateRuntime();
        FakeRendererFactory factory = new();
        factory.Renderer.BuildFrames = true;
        SceneUiHostsRuntime hosts = runtime.AttachUiHosts(Options(factory));
        AddHost(runtime.World);
        hosts.Update();

        for (int i = 0; i < 4; i++)
        {
            hosts.Update();
            hosts.Render();
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 100; i++)
        {
            hosts.Update();
            hosts.Render();
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
    }

    [Fact]
    public void SequentialFramesAreDeterministic()
    {
        using SceneRuntime firstRuntime = CreateRuntime();
        using SceneRuntime secondRuntime = CreateRuntime();
        FakeRendererFactory firstFactory = new();
        FakeRendererFactory secondFactory = new();
        firstFactory.Renderer.BuildFrames = true;
        firstFactory.Renderer.HashFrames = true;
        secondFactory.Renderer.BuildFrames = true;
        secondFactory.Renderer.HashFrames = true;
        SceneUiHostsRuntime first = firstRuntime.AttachUiHosts(Options(firstFactory));
        SceneUiHostsRuntime second = secondRuntime.AttachUiHosts(Options(secondFactory));
        AddHost(firstRuntime.World);
        AddHost(secondRuntime.World);

        for (int i = 0; i < 3; i++)
        {
            first.Update();
            first.Render();
            second.Update();
            second.Render();
        }

        firstFactory.Renderer.FrameHashes.Should().Equal(secondFactory.Renderer.FrameHashes);
    }

    [Fact]
    public void OptInProfilesAddTheHostComponent()
    {
        SceneUiHostRuntimeProfiles.ThreeD.Profile.Registry.TryGetDataByType(typeof(SceneUiHost), out _).Should().BeTrue();
        SceneUiHostRuntimeProfiles.Mixed.Profile.Registry.TryGetDataByType(typeof(SceneUiHost), out _).Should().BeTrue();
        SceneUiHostRuntimeProfiles.Full.Profile.Registry.TryGetDataByType(typeof(SceneUiHost), out _).Should().BeTrue();

        SceneRuntimeProfiles.ThreeD.Profile.Registry.TryGetDataByType(typeof(SceneUiHost), out _).Should().BeFalse();
        SceneRuntimeProfiles.Mixed.Profile.Registry.TryGetDataByType(typeof(SceneUiHost), out _).Should().BeFalse();
        SceneRuntimeProfiles.Full.Profile.Registry.TryGetDataByType(typeof(SceneUiHost), out _).Should().BeFalse();

        SceneUiHostRuntimeProfiles.Create(SceneRuntimeProfileKind.ThreeD).Should().BeSameAs(SceneUiHostRuntimeProfiles.ThreeD);
        Action unsupported = () => SceneUiHostRuntimeProfiles.Create(SceneRuntimeProfileKind.Core);
        unsupported.Should().Throw<SceneConfigurationException>();
    }

    [Fact]
    public void AddUiHosts3DExtendsACustomBuilder()
    {
        SceneProfile profile = new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/custom-ui-host")))
            .AddTransform3D()
            .AddUiHosts3D()
            .Build();

        profile.Registry.TryGetDataByType(typeof(SceneUiHost), out _).Should().BeTrue();
    }

    private static SceneRuntime CreateRuntime() =>
        new(new SceneRuntimeOptions
        {
            Profile = new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/ui-host-runtime")))
                .AddTransform3D()
                .AddRendering3D()
                .AddUiHosts()
                .Build(),
        });

    private static SceneUiHostRuntimeOptions Options(ISceneUiHostRendererFactory factory) =>
        new() { Assets = CreateTable(), RendererFactory = factory };

    private static SceneActor AddHost(SceneWorld world)
    {
        SceneActor actor = world.CreateActor("Hud");
        SceneUiHost component = SceneUiHost.Default;
        component.AssetId = SceneStringId.FromName(AssetId);
        world.AddData(actor, component);
        world.UpdateTransforms();
        return actor;
    }

    private static UiHostAssetTable CreateTable()
    {
        var builder = new UiAssetDocumentBuilder { AssetId = AssetId };
        UiNodeId root = builder.CreateNode(UiNodeKind.Root, UiNodeFlags.Visible | UiNodeFlags.Enabled);
        builder.TrySetLayout(root, UiLayoutStyle.Default with
        {
            Width = UiLength.Stretch(1.0f),
            Height = UiLength.Stretch(1.0f),
            AlignItems = UiAlign.Stretch,
        });
        UiNodeId panel = builder.CreateNode(UiNodeKind.Container, UiNodeFlags.Visible | UiNodeFlags.Enabled);
        builder.TryAppendChild(root, panel);
        builder.TrySetLayout(panel, UiLayoutStyle.Default with
        {
            Width = UiLength.Px(100.0f),
            Height = UiLength.Px(50.0f),
        });

        UiCanvasConfig canvas = new(1920.0f, 1080.0f, UiCanvasScaleMode.MatchWidthOrHeight, 0.5f, UiEdgeInsets.Zero);
        UiAssetDocument document = builder.Build(new UiDocumentInfo(new UiDocumentId(1), "hud", 1, canvas));
        ArrayBufferWriter<byte> buffer = new();
        using (var codec = new UiDocumentJsonCodec(reuseStorage: false))
        {
            codec.Write(document, buffer);
        }

        UiHostAssetTable table = new();
        table.Add(AssetId, buffer.WrittenSpan);
        return table;
    }

    private sealed class FakeRendererFactory : ISceneUiHostRendererFactory
    {
        public FakeRenderer Renderer { get; } = new();

        public int CreateCount { get; private set; }

        public bool Throw { get; set; }

        public ISceneUiHostRenderer? Create(SceneRuntime runtime, SceneUiHostBridge bridge)
        {
            _ = runtime;
            _ = bridge;
            CreateCount++;
            if (Throw)
            {
                throw new InvalidOperationException("renderer factory failure");
            }

            return Renderer;
        }
    }

    private sealed class FakeRenderer : ISceneUiHostRenderer
    {
        public int RenderCount { get; private set; }

        public int Disposed { get; private set; }

        public bool BuildFrames { get; set; }

        public bool HashFrames { get; set; }

        public bool Throw { get; set; }

        public int LastFrameCommands { get; private set; }

        public List<uint> FrameHashes { get; } = new();

        public void Render(SceneWorld world, SceneCameraFrame? camera, in UiViewport viewport, SceneUiHostBridge hosts)
        {
            _ = world;
            _ = camera;
            RenderCount++;
            if (Throw)
            {
                throw new InvalidOperationException("renderer failure");
            }

            if (!BuildFrames)
            {
                return;
            }

            uint hash = 2166136261u;
            for (int i = 0; i < hosts.HostCount; i++)
            {
                if (!hosts.TryGetHostAt(i, out SceneUiHostInstance? host))
                {
                    continue;
                }

                UiFrame frame = host.BuildFrame(in viewport);
                LastFrameCommands = frame.Commands.Length;
                for (int c = 0; c < frame.Commands.Length; c++)
                {
                    UiRenderCommand command = frame.Commands[c];
                    hash = (hash ^ (uint)command.Kind) * 16777619u;
                    hash = (hash ^ (uint)command.Bounds.X) * 16777619u;
                    hash = (hash ^ (uint)command.Bounds.Y) * 16777619u;
                }
            }

            if (HashFrames)
            {
                FrameHashes.Add(hash);
            }
        }

        public void Dispose() => Disposed++;
    }
}
