namespace Axrone.Scene.Runtime.Tests;

using System.Buffers;
using System.Text.Json;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Prefab;
using Axrone.Scene.Runtime;
using Axrone.Scene.Snapshot;
using FluentAssertions;
using Xunit;

public sealed class SceneAnimatorCodecTests
{
    [Fact]
    public void AnimatorRoundTripsEveryField()
    {
        SceneAnimator value = new()
        {
            Handle = new SceneAnimatorHandle(3, 7),
            Speed = 1.5f,
            Paused = true,
            Enabled = false,
            ApplyRootMotion = true,
            ActiveLayer = 2,
            MorphCurveOffset = 4,
            MorphCurveCount = 3,
        };

        SceneAnimator restored = RoundTrip(new SceneAnimatorCodec(), in value);

        restored.Should().Be(value);
    }

    [Fact]
    public void AnimatorRejectsUnknownVersion()
    {
        SceneAnimatorCodec codec = new();
        using JsonDocument document = JsonDocument.Parse("""{"version":2,"slot":-1,"generation":0}""");

        Action read = () => codec.Read(document.RootElement);

        read.Should().Throw<SceneValidationException>();
    }

    [Fact]
    public void AnimatorRejectsInconsistentHandle()
    {
        SceneAnimatorCodec codec = new();
        using JsonDocument document = JsonDocument.Parse("""{"version":1,"slot":-1,"generation":4}""");

        Action read = () => codec.Read(document.RootElement);

        read.Should().Throw<SceneValidationException>();
    }

    [Fact]
    public void AnimatorRejectsNegativeLayer()
    {
        SceneAnimatorCodec codec = new();
        using JsonDocument document = JsonDocument.Parse("""{"version":1,"slot":0,"generation":1,"activeLayer":-1}""");

        Action read = () => codec.Read(document.RootElement);

        read.Should().Throw<SceneValidationException>();
    }

    [Fact]
    public void AnimatorRejectsNegativeMorphRange()
    {
        SceneAnimatorCodec codec = new();
        using JsonDocument document = JsonDocument.Parse("""{"version":1,"slot":0,"generation":1,"morphCurveCount":-1}""");

        Action read = () => codec.Read(document.RootElement);

        read.Should().Throw<SceneValidationException>();
    }

    [Fact]
    public void AnimationBindingRoundTripsAssetIds()
    {
        var value = new SceneAnimationBinding
        {
            Skin = SceneAssetId<SkinAssetTag>.FromName("skin/hero"),
            DefaultClip = SceneAssetId<AnimationAssetTag>.FromName("clip/run"),
        };

        SceneAnimationBinding restored = RoundTrip(new SceneAnimationBindingCodec(), in value);

        restored.Should().Be(value);
        restored.HasSkin.Should().BeTrue();
        restored.HasDefaultClip.Should().BeTrue();
    }

    [Fact]
    public void AnimationBindingRejectsMissingSkin()
    {
        SceneAnimationBindingCodec codec = new();
        using JsonDocument document = JsonDocument.Parse("""{"version":1,"skin":""}""");

        Action read = () => codec.Read(document.RootElement);

        read.Should().Throw<SceneValidationException>();
    }

    [Fact]
    public void PathAgentRoundTripsEveryField()
    {
        ScenePathAgent value = new()
        {
            Path = new ScenePathHandle(5, 9),
            Speed = 4.5f,
            ArrivalThreshold = 0.35f,
            TurnRateRadians = 2.0f,
            AvoidanceRadius = 1.25f,
            Loop = false,
            Enabled = true,
            StartWaypoint = 3,
        };

        ScenePathAgent restored = RoundTrip(new ScenePathAgentCodec(), in value);

        restored.Should().Be(value);
    }

    [Fact]
    public void PathAgentRejectsUnknownVersion()
    {
        ScenePathAgentCodec codec = new();
        using JsonDocument document = JsonDocument.Parse("""{"version":9,"slot":-1,"generation":0}""");

        Action read = () => codec.Read(document.RootElement);

        read.Should().Throw<SceneValidationException>();
    }

    [Fact]
    public void PathAgentRejectsNegativeSteeringValues()
    {
        ScenePathAgentCodec codec = new();
        using JsonDocument negativeSpeed = JsonDocument.Parse("""{"version":1,"slot":-1,"generation":0,"speed":-1}""");
        using JsonDocument negativeWaypoint = JsonDocument.Parse("""{"version":1,"slot":-1,"generation":0,"startWaypoint":-2}""");

        Action speedRead = () => codec.Read(negativeSpeed.RootElement);
        Action waypointRead = () => codec.Read(negativeWaypoint.RootElement);

        speedRead.Should().Throw<SceneValidationException>();
        waypointRead.Should().Throw<SceneValidationException>();
    }

    [Fact]
    public void ProfileExtensionsRegisterBothComponents()
    {
        SceneProfile profile = new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/ui-codecs")))
            .AddTransform3D()
            .AddAnimators3D()
            .AddPathAgents3D()
            .Build();

        profile.Registry.TryGetDataByType(typeof(SceneAnimator), out _).Should().BeTrue();
        profile.Registry.TryGetDataByType(typeof(SceneAnimationBinding), out _).Should().BeTrue();
        profile.Registry.TryGetDataByType(typeof(ScenePathAgent), out _).Should().BeTrue();

        SceneCodecRegistry codecs = new(profile.Registry);
        SceneRuntimeCodecs.Register(codecs, profile.Registry);

        codecs.TryGet("SceneAnimator", out _).Should().BeTrue();
        codecs.TryGet("SceneAnimationBinding", out _).Should().BeTrue();
        codecs.TryGet("ScenePathAgent", out _).Should().BeTrue();
        codecs.Count.Should().Be(3);
    }

    [Fact]
    public void CodecsAreNotRegisteredWithoutComponents()
    {
        SceneProfile profile = new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/no-animation")))
            .AddTransform3D()
            .Build();
        SceneCodecRegistry codecs = new(profile.Registry);

        SceneRuntimeCodecs.Register(codecs, profile.Registry);

        codecs.Count.Should().Be(0);
        codecs.TryGet("SceneAnimator", out _).Should().BeFalse();
        codecs.TryGet("ScenePathAgent", out _).Should().BeFalse();
    }

    [Fact]
    public void SnapshotRoundTripsAnimatorAndPathAgent()
    {
        SceneAnimator animator = new()
        {
            Handle = SceneAnimatorHandle.Invalid,
            Speed = 0.75f,
            Paused = true,
            Enabled = true,
            ApplyRootMotion = false,
            ActiveLayer = 1,
        };
        ScenePathAgent pathAgent = new()
        {
            Path = ScenePathHandle.Invalid,
            Speed = 2.5f,
            ArrivalThreshold = 0.2f,
            TurnRateRadians = 3.0f,
            AvoidanceRadius = 0.8f,
            Loop = true,
            Enabled = true,
            StartWaypoint = 0,
        };
        var binding = new SceneAnimationBinding
        {
            Skin = SceneAssetId<SkinAssetTag>.FromName("skin/hero"),
            DefaultClip = SceneAssetId<AnimationAssetTag>.FromName("clip/run"),
        };

        using SceneRuntime source = new(new SceneRuntimeOptions { Profile = CreateAnimationProfile() });
        SceneActor actor = source.World.CreateActor("Animated");
        source.World.GetTransform3D(actor).SetPosition(new Vec3(1.0f, 2.0f, 3.0f));
        source.World.AddData(actor, animator);
        source.World.AddData(actor, pathAgent);
        source.World.AddData(actor, binding);
        source.World.UpdateTransforms();

        SceneSnapshot snapshot = source.CaptureSnapshot("prefab/animated");

        using SceneRuntime target = new(new SceneRuntimeOptions { Profile = CreateAnimationProfile() });
        ScenePrefabInstantiationResult result = target.LoadSnapshot(snapshot);

        result.Actors.Should().ContainSingle();
        SceneActor loaded = result.Actors[0];
        target.World.GetData<SceneAnimator>(loaded).Should().Be(animator);
        target.World.GetData<ScenePathAgent>(loaded).Should().Be(pathAgent);
        target.World.GetData<SceneAnimationBinding>(loaded).Should().Be(binding);
    }

    private static SceneProfile CreateAnimationProfile() =>
        new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/animation-snapshot")))
            .AddTransform3D()
            .AddPhysics3D()
            .AddAnimators3D()
            .AddPathAgents3D()
            .Build();

    private static T RoundTrip<T>(SceneDataCodec<T> codec, in T value)
        where T : unmanaged, ISceneDataComponent
    {
        ArrayBufferWriter<byte> buffer = new();
        using (Utf8JsonWriter writer = new(buffer))
        {
            writer.WriteStartObject();
            codec.Write(writer, in value);
            writer.WriteEndObject();
        }

        using JsonDocument document = JsonDocument.Parse(buffer.WrittenSpan.ToArray());
        return codec.Read(document.RootElement);
    }
}
