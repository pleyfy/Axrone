namespace Axrone.Asset.Tests;

/// <summary>
/// The default data codec must distinguish "this payload is not mine" from "this payload is mine
/// but broken", and every refusal must carry a stable code instead of a bare false.
/// </summary>
public sealed class AssetCodecFailureTests
{
    [Fact]
    public void UnknownTag_IsAReasonedDecline()
    {
        byte[] payload = [9, 1, 2, 3];

        DefaultDataCodecPolicy<object>.TryDeserialize(payload, out object? data, out AssetCodecFailure failure)
            .Should().BeFalse();

        data.Should().BeNull();
        failure.Should().Be(AssetCodecFailure.UnknownTag);
        failure.IsForeignPayload().Should().BeTrue();
        failure.CodeOf().Should().Be("asset.codec.tag.unknown");
    }

    [Fact]
    public void EmptyPayload_IsAReasonedDecline()
    {
        DefaultDataCodecPolicy<object>.TryDeserialize(
            ReadOnlySpan<byte>.Empty,
            out object? data,
            out AssetCodecFailure failure)
            .Should().BeFalse();

        data.Should().BeNull();
        failure.Should().Be(AssetCodecFailure.EmptyPayload);
        failure.IsForeignPayload().Should().BeTrue();
        failure.CodeOf().Should().Be("asset.codec.payload.empty");
    }

    [Fact]
    public void BrokenJsonBody_IsOursAndReportsTheJsonCode()
    {
        byte[] payload = [3, (byte)'{', (byte)'"', (byte)'k', (byte)':'];

        DefaultDataCodecPolicy<object>.TryDeserialize(payload, out object? data, out AssetCodecFailure failure)
            .Should().BeFalse();

        data.Should().BeNull();
        failure.Should().Be(AssetCodecFailure.InvalidJson);
        failure.IsForeignPayload().Should().BeFalse();
        failure.CodeOf().Should().Be("asset.codec.json.invalid");
    }

    [Fact]
    public void TaggedJsonNullBody_DecodesToNullWithoutFailure()
    {
        byte[] payload = [3, .. "null"u8.ToArray()];

        DefaultDataCodecPolicy<object>.TryDeserialize(payload, out object? data, out AssetCodecFailure failure)
            .Should().BeTrue();

        data.Should().BeNull();
        failure.Should().Be(AssetCodecFailure.None);
        failure.CodeOf().Should().BeNull();
    }

    [Fact]
    public void TaggedNullPayload_DecodesWithoutFailure()
    {
        DefaultDataCodecPolicy<object>.TryDeserialize([0], out object? data, out AssetCodecFailure failure)
            .Should().BeTrue();

        data.Should().BeNull();
        failure.Should().Be(AssetCodecFailure.None);
    }

    [Fact]
    public void BytesStringAndJsonRoundTrips_ReportNoFailure()
    {
        byte[] bytesPayload = [1, 7, 8, 9];
        DefaultDataCodecPolicy<object>.TryDeserialize(bytesPayload, out object? bytes, out AssetCodecFailure bytesFailure)
            .Should().BeTrue();
        bytes.Should().BeEquivalentTo(new byte[] { 7, 8, 9 });
        bytesFailure.Should().Be(AssetCodecFailure.None);

        byte[] textPayload = [2, .. "atlas"u8.ToArray()];
        DefaultDataCodecPolicy<object>.TryDeserialize(textPayload, out object? text, out AssetCodecFailure textFailure)
            .Should().BeTrue();
        text.Should().Be("atlas");
        textFailure.Should().Be(AssetCodecFailure.None);

        byte[] jsonPayload = [3, .. "{\"a\":1}"u8.ToArray()];
        DefaultDataCodecPolicy<object>.TryDeserialize(jsonPayload, out object? json, out AssetCodecFailure jsonFailure)
            .Should().BeTrue();
        json.Should().NotBeNull();
        jsonFailure.Should().Be(AssetCodecFailure.None);
    }

    [Fact]
    public void SerializeIntoSmallDestination_IsCoded()
    {
        byte[] destination = new byte[2];

        DefaultDataCodecPolicy<object>.TrySerialize(
            new byte[] { 1, 2, 3, 4 },
            destination,
            out int bytesWritten,
            out AssetCodecFailure failure)
            .Should().BeFalse();

        bytesWritten.Should().Be(0);
        failure.Should().Be(AssetCodecFailure.DestinationTooSmall);
        failure.CodeOf().Should().Be("asset.codec.destination.too-small");
        failure.IsForeignPayload().Should().BeFalse();
    }

    [Fact]
    public void LegacyOverload_KeepsTheBooleanContract()
    {
        DefaultDataCodecPolicy<object>.TryDeserialize([9], out object? data).Should().BeFalse();
        data.Should().BeNull();
        DefaultDataCodecPolicy<object>.TryDeserialize([0], out object? taggedNull).Should().BeTrue();
        taggedNull.Should().BeNull();
    }

    [Fact]
    public void ToError_CarriesTheCodecCodeAndPayloadDescription()
    {
        AssetError error = AssetCodecFailure.InvalidJson.ToError("asset 'sprites/hero'");

        error.Code.Should().Be("asset.codec.json.invalid");
        error.Message.Should().Contain("sprites/hero").And.Contain("InvalidJson");
    }
}
