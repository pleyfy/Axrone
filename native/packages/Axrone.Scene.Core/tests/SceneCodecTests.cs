namespace Axrone.Scene.Core.Tests;

using System.Buffers;
using System.Text.Json;
using Axrone.Scene;
using FluentAssertions;
using Xunit;

public sealed class SceneCodecTests
{
    [Fact]
    public void CodecRegistry_RoundTripsDataComponent()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out SceneComponentRegistry registry);
        var codecs = new SceneCodecRegistry(registry);
        codecs.Register(new HealthCodec());

        SceneEntity source = world.CreateEntity("Source");
        world.AddData(source, new Health { Value = 42 });

        SceneCodecRegistration registration = codecs.Registrations[0];
        registration.Descriptor.Name.Should().Be(registry.Names.Intern("Health"));
        codecs.TryGet(registry.GetDataByType(typeof(Health)).TypeId, out ISceneDataCodec? byId)
            .Should().BeTrue();
        byId.Should().BeSameAs(registration.Codec);
        codecs.TryGet("Health", out ISceneDataCodec? byName).Should().BeTrue();
        byName.Should().BeSameAs(registration.Codec);

        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WritePropertyName("data");
            writer.WriteStartObject();
            registration.Codec.Write(world, source, writer);
            writer.WriteEndObject();
            writer.WriteEndObject();
        }

        using JsonDocument document = JsonDocument.Parse(buffer.WrittenMemory);
        SceneEntity target = world.CreateEntity("Target");
        registration.Codec.ReadInto(world, target, document.RootElement.GetProperty("data"));

        world.GetData<Health>(target).Value.Should().Be(42);
    }

    [Fact]
    public void CodecRegistry_RejectsDuplicateRegistration()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out SceneComponentRegistry registry);
        var codecs = new SceneCodecRegistry(registry);
        codecs.Register(new HealthCodec());

        Action duplicate = () => codecs.Register(new HealthCodec());

        duplicate.Should().Throw<SceneValidationException>();
    }

    private sealed class HealthCodec : SceneDataCodec<Health>
    {
        public override void Write(Utf8JsonWriter writer, in Health value) =>
            writer.WriteNumber("value", value.Value);

        public override Health Read(JsonElement data) =>
            new() { Value = data.GetProperty("value").GetInt32() };
    }
}
