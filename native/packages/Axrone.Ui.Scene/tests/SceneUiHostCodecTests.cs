namespace Axrone.Ui.Scene.Tests;

using System.Buffers;
using System.Text.Json;
using Axrone.Scene;
using Axrone.Ui.Scene;
using FluentAssertions;
using Xunit;

public sealed class SceneUiHostCodecTests
{
    [Fact]
    public void CodecRoundTripsEveryField()
    {
        SceneUiHost value = new()
        {
            AssetId = SceneStringId.FromName(UiHostTestAssets.AssetId),
            RenderMode = SceneUiHostRenderMode.WorldSpace,
            Billboard = SceneUiHostBillboard.CameraFacing,
            WorldWidth = 2.0f,
            WorldHeight = 1.25f,
            TextureScale = 256.0f,
            ReceiveInput = false,
            Enabled = true,
            Visible = false,
            SortingOrder = 3,
        };

        SceneUiHost restored = RoundTrip(new SceneUiHostCodec(), in value);

        restored.Should().Be(value);
    }

    [Fact]
    public void CodecClampsNonFiniteSizesToDefaults()
    {
        SceneUiHostCodec codec = new();
        using JsonDocument document = JsonDocument.Parse("""{"version":1,"assetId":7,"worldWidth":-4,"worldHeight":100000,"textureScale":4}""");

        SceneUiHost restored = codec.Read(document.RootElement);

        restored.WorldWidth.Should().Be(SceneUiHostLimits.MinWorldSize);
        restored.WorldHeight.Should().Be(SceneUiHostLimits.MaxWorldSize);
        restored.TextureScale.Should().Be(SceneUiHostLimits.MinTextureScale);
    }

    [Fact]
    public void CodecRejectsUnknownVersion()
    {
        SceneUiHostCodec codec = new();
        using JsonDocument document = JsonDocument.Parse("""{"version":2}""");

        Action read = () => codec.Read(document.RootElement);

        read.Should().Throw<SceneValidationException>();
    }

    [Fact]
    public void CodecRejectsUnknownModes()
    {
        SceneUiHostCodec codec = new();
        using JsonDocument renderMode = JsonDocument.Parse("""{"version":1,"renderMode":"holographic"}""");
        using JsonDocument billboard = JsonDocument.Parse("""{"version":1,"billboard":"spin"}""");

        Action renderRead = () => codec.Read(renderMode.RootElement);
        Action billboardRead = () => codec.Read(billboard.RootElement);

        renderRead.Should().Throw<SceneValidationException>();
        billboardRead.Should().Throw<SceneValidationException>();
    }

    [Fact]
    public void ProfileAndCodecRegistrationAreExplicit()
    {
        SceneProfile profile = new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/ui-host-profile")))
            .AddTransform3D()
            .AddUiHosts()
            .Build();

        SceneUiHostRegistration.IsRegistered(profile.Registry).Should().BeTrue();

        SceneCodecRegistry codecs = new(profile.Registry);
        SceneUiHostRegistration.RegisterCodecs(codecs, profile.Registry);

        codecs.TryGet("SceneUiHost", out _).Should().BeTrue();
        codecs.Count.Should().Be(1);
    }

    [Fact]
    public void CodecIsNotRegisteredWithoutComponent()
    {
        SceneProfile profile = new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/no-ui-host")))
            .AddTransform3D()
            .Build();
        SceneCodecRegistry codecs = new(profile.Registry);

        SceneUiHostRegistration.RegisterCodecs(codecs, profile.Registry);

        codecs.Count.Should().Be(0);
    }

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
