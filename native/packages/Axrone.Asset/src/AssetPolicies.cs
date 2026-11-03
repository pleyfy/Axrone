namespace Axrone.Asset;

/// <summary>Lifecycle hooks invoked around persistence.</summary>
/// <typeparam name="TData">Payload type.</typeparam>
public interface IAssetLifecyclePolicy<TData>
{
    /// <summary>Runs after creation.</summary>
    static abstract void OnCreated(in TData data);

    /// <summary>Runs after an update.</summary>
    static abstract void OnUpdated(in TData data, in AssetRevision newRevision);

    /// <summary>Runs before disposal.</summary>
    static abstract void OnDeleted(in TData data);
}

/// <summary>No-op lifecycle policy that disposes disposable payloads.</summary>
/// <typeparam name="TData">Payload type.</typeparam>
public readonly struct DefaultLifecyclePolicy<TData> : IAssetLifecyclePolicy<TData>
{
    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void OnCreated(in TData data)
    {
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void OnUpdated(in TData data, in AssetRevision newRevision)
    {
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void OnDeleted(in TData data)
    {
        if (data is IDisposable disposable)
        {
            disposable.Dispose();
        }
    }
}

/// <summary>
/// Coded reason one <see cref="DefaultDataCodecPolicy{TData}"/> payload was refused. A decline
/// (<see cref="AssetCodecFailureExtensions.IsForeignPayload"/>) means the bytes belong to another
/// codec; every other value means this codec owned the payload and the payload is broken.
/// </summary>
public enum AssetCodecFailure : byte
{
    /// <summary>No failure.</summary>
    None = 0,

    /// <summary>The payload is empty; there is nothing to decode.</summary>
    EmptyPayload = 1,

    /// <summary>The leading tag byte is not part of this codec's tag space.</summary>
    UnknownTag = 2,

    /// <summary>The tagged JSON body is not valid JSON.</summary>
    InvalidJson = 3,

    /// <summary>The destination is smaller than the encoded payload.</summary>
    DestinationTooSmall = 4,
}

/// <summary>Stable machine codes and decline semantics for <see cref="AssetCodecFailure"/>.</summary>
public static class AssetCodecFailureExtensions
{
    /// <summary>Stable error code, or null when the failure is <see cref="AssetCodecFailure.None"/>.</summary>
    public static string? CodeOf(this AssetCodecFailure failure) => failure switch
    {
        AssetCodecFailure.None => null,
        AssetCodecFailure.EmptyPayload => "asset.codec.payload.empty",
        AssetCodecFailure.UnknownTag => "asset.codec.tag.unknown",
        AssetCodecFailure.InvalidJson => "asset.codec.json.invalid",
        AssetCodecFailure.DestinationTooSmall => "asset.codec.destination.too-small",
        _ => "asset.codec.unknown",
    };

    /// <summary>Whether the failure means "this payload is not mine" rather than "mine is broken".</summary>
    public static bool IsForeignPayload(this AssetCodecFailure failure) =>
        failure is AssetCodecFailure.EmptyPayload or AssetCodecFailure.UnknownTag;

    /// <summary>Builds the matching <see cref="AssetError"/> for a failure and payload description.</summary>
    public static AssetError ToError(this AssetCodecFailure failure, string payloadDescription) =>
        new(
            $"Default data codec refused the payload ({payloadDescription}): {failure} ({failure.CodeOf()}).",
            failure.CodeOf() ?? "asset.codec.unknown");
}

/// <summary>Default data codec: byte arrays verbatim, strings as UTF-8, everything else as JSON.</summary>
/// <typeparam name="TData">Payload type.</typeparam>
public readonly struct DefaultDataCodecPolicy<TData> : IAssetCodecPolicy<TData>
{
    /// <inheritdoc/>
    public static string Format => "default";

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static int MaxSerializedBytes(in TData data)
    {
        if (typeof(TData) == typeof(object))
        {
            return MaxObjectBytes(data);
        }

        if (data is byte[] bytes)
        {
            return bytes.Length;
        }

        if (data is string text)
        {
            return Encoding.UTF8.GetMaxByteCount(text.Length);
        }

        return 512;
    }

    private static int MaxObjectBytes(object? data) => data switch
    {
        null => 1,
        byte[] bytes => bytes.Length + 1,
        string text => Encoding.UTF8.GetMaxByteCount(text.Length) + 1,
        _ => 4096,
    };

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool TrySerialize(in TData data, Span<byte> destination, out int bytesWritten) =>
        TrySerialize(data, destination, out bytesWritten, out _);

    /// <summary>Serializes and reports the coded reason when the destination cannot hold the payload.</summary>
    /// <param name="data">Payload to encode.</param>
    /// <param name="destination">Destination buffer.</param>
    /// <param name="bytesWritten">Bytes written on success.</param>
    /// <param name="failure">Coded failure on refusal; <see cref="AssetCodecFailure.None"/> on success.</param>
    /// <returns>Whether the payload was written.</returns>
    public static bool TrySerialize(
        in TData data,
        Span<byte> destination,
        out int bytesWritten,
        out AssetCodecFailure failure)
    {
        failure = AssetCodecFailure.None;
        if (typeof(TData) == typeof(object))
        {
            return TrySerializeObject(data, destination, out bytesWritten, out failure);
        }

        if (data is byte[] bytes)
        {
            if (destination.Length < bytes.Length)
            {
                bytesWritten = 0;
                failure = AssetCodecFailure.DestinationTooSmall;
                return false;
            }

            bytes.CopyTo(destination);
            bytesWritten = bytes.Length;
            return true;
        }

        if (data is string text)
        {
            if (Encoding.UTF8.TryGetBytes(text, destination, out bytesWritten))
            {
                return true;
            }

            failure = AssetCodecFailure.DestinationTooSmall;
            return false;
        }

#pragma warning disable IL2026 // Generic-TData JSON fallback is inherently dynamic; AOT users bind concrete codecs.
#pragma warning disable IL3050 // Generic-TData JSON fallback is inherently dynamic; AOT users bind concrete codecs.
        byte[] json = JsonSerializer.SerializeToUtf8Bytes(data);
#pragma warning restore IL3050
#pragma warning restore IL2026
        if (destination.Length < json.Length)
        {
            bytesWritten = 0;
            failure = AssetCodecFailure.DestinationTooSmall;
            return false;
        }

        json.CopyTo(destination);
        bytesWritten = json.Length;
        return true;
    }

    /// <summary>Tagged object serialization: 0=null, 1=bytes, 2=utf8, 3=json.</summary>
    private static bool TrySerializeObject(
        object? data,
        Span<byte> destination,
        out int bytesWritten,
        out AssetCodecFailure failure)
    {
        bytesWritten = 0;
        failure = AssetCodecFailure.None;
        switch (data)
        {
            case null:
                if (destination.IsEmpty)
                {
                    failure = AssetCodecFailure.DestinationTooSmall;
                    return false;
                }

                destination[0] = 0;
                bytesWritten = 1;
                return true;
            case byte[] bytes:
                if (destination.Length < bytes.Length + 1)
                {
                    failure = AssetCodecFailure.DestinationTooSmall;
                    return false;
                }

                destination[0] = 1;
                bytes.CopyTo(destination[1..]);
                bytesWritten = bytes.Length + 1;
                return true;
            case string text:
                if (destination.IsEmpty || !Encoding.UTF8.TryGetBytes(text, destination[1..], out int written))
                {
                    bytesWritten = 0;
                    failure = AssetCodecFailure.DestinationTooSmall;
                    return false;
                }

                destination[0] = 2;
                bytesWritten = written + 1;
                return true;
            default:
            {
#pragma warning disable IL2026 // Generic-TData JSON fallback is inherently dynamic; AOT users bind concrete codecs.
#pragma warning disable IL3050 // Generic-TData JSON fallback is inherently dynamic; AOT users bind concrete codecs.
                byte[] json = JsonSerializer.SerializeToUtf8Bytes(data);
#pragma warning restore IL3050
#pragma warning restore IL2026
                if (destination.Length < json.Length + 1)
                {
                    failure = AssetCodecFailure.DestinationTooSmall;
                    return false;
                }

                destination[0] = 3;
                json.CopyTo(destination[1..]);
                bytesWritten = json.Length + 1;
                return true;
            }
        }
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool TryDeserialize(ReadOnlySpan<byte> source, out TData data) =>
        TryDeserialize(source, out data, out _);

    /// <summary>Deserializes and reports the coded reason for a refusal.</summary>
    /// <param name="source">Encoded payload.</param>
    /// <param name="data">Decoded payload on success.</param>
    /// <param name="failure">Coded failure on refusal; <see cref="AssetCodecFailure.None"/> on success.</param>
    /// <returns>Whether the payload was decoded.</returns>
    public static bool TryDeserialize(
        ReadOnlySpan<byte> source,
        out TData data,
        out AssetCodecFailure failure)
    {
        failure = AssetCodecFailure.None;
        if (typeof(TData) == typeof(object))
        {
            if (TryDeserializeObject(source, out object? boxed, out failure))
            {
                data = (TData)boxed!;
                return true;
            }

            data = default!;
            return false;
        }

        if (typeof(TData) == typeof(byte[]))
        {
            data = (TData)(object)source.ToArray();
            return true;
        }

        if (typeof(TData) == typeof(string))
        {
            data = (TData)(object)Encoding.UTF8.GetString(source);
            return true;
        }

#pragma warning disable IL2026 // Generic-TData JSON fallback is inherently dynamic; AOT users bind concrete codecs.
#pragma warning disable IL3050 // Generic-TData JSON fallback is inherently dynamic; AOT users bind concrete codecs.
        data = JsonSerializer.Deserialize<TData>(source)!;
#pragma warning restore IL3050
#pragma warning restore IL2026
        if (data is not null)
        {
            return true;
        }

        failure = AssetCodecFailure.InvalidJson;
        return false;
    }

    /// <summary>Reads a tagged object payload.</summary>
    private static bool TryDeserializeObject(
        ReadOnlySpan<byte> source,
        out object? value,
        out AssetCodecFailure failure)
    {
        value = null;
        failure = AssetCodecFailure.None;
        if (source.IsEmpty)
        {
            failure = AssetCodecFailure.EmptyPayload;
            return false;
        }

        switch (source[0])
        {
            case 0:
                return true;
            case 1:
                value = source[1..].ToArray();
                return true;
            case 2:
                value = Encoding.UTF8.GetString(source[1..]);
                return true;
            case 3:
                try
                {
#pragma warning disable IL2026 // Generic-TData JSON fallback is inherently dynamic; AOT users bind concrete codecs.
#pragma warning disable IL3050 // Generic-TData JSON fallback is inherently dynamic; AOT users bind concrete codecs.
                    value = JsonSerializer.Deserialize<object>(source[1..]);
#pragma warning restore IL3050
#pragma warning restore IL2026
                    return true;
                }
                catch (JsonException)
                {
                    failure = AssetCodecFailure.InvalidJson;
                    return false;
                }

            default:
                failure = AssetCodecFailure.UnknownTag;
                return false;
        }
    }
}

/// <summary>Record helpers.</summary>
public static class AssetRecordExtensions
{
    /// <summary>Erases a typed record to <see cref="object"/>.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static AssetRecord<object> ToUntypedRecord<TData>(in this AssetRecord<TData> record) => new(
        record.Kind,
        record.Id,
        record.Key,
        record.Aliases,
        record.Name,
        record.Data!,
        record.Revision,
        record.Fingerprint,
        record.CreatedAtEpochMs,
        record.UpdatedAtEpochMs,
        record.Metadata,
        record.DependencyIds);
}
