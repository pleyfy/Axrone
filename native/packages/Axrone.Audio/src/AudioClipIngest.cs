namespace Axrone.Audio;

/// <summary>
/// Container-aware clip ingest. Uncompressed RIFF/WAVE is decoded in-engine;
/// every compressed family is routed to a registered
/// <see cref="IAudioSampleDecoder"/> and fails closed with a typed error when
/// nothing can decode it. A failed ingest never registers a clip and never
/// produces an empty record.
/// </summary>
public sealed class AudioClipIngest
{
    private readonly AudioDecoderRegistry _decoders;

    /// <summary>Decoder registry consulted for compressed payloads.</summary>
    public AudioDecoderRegistry Decoders => _decoders;

    /// <summary>Creates an ingest service; null decoders means no compressed support.</summary>
    public AudioClipIngest(AudioDecoderRegistry? decoders = null) => _decoders = decoders ?? new AudioDecoderRegistry();

    /// <summary>
    /// Decodes a container into a record. A false return always carries a
    /// typed <see cref="AudioException"/> describing why.
    /// </summary>
    public bool TryCreateRecord(
        AudioClipId id,
        ReadOnlyMemory<byte> payload,
        out AudioClipRecord? record,
        out AudioContainerInfo container,
        [NotNullWhen(false)] out AudioException? error)
    {
        record = null;
        error = null;
        container = default;

        if (!id.IsValid)
        {
            error = new AudioAssetException("Clip id must be valid before ingest.");
            return false;
        }

        NativeAudioMemory? samples = null;
        try
        {
            if (!AudioContainerInspector.TryInspect(payload.Span, out container, out AudioContainerFailure failure))
            {
                error = new AudioContainerException(container.Kind, failure);
                return false;
            }

            if (container.Encoding != AudioSampleEncoding.Compressed)
            {
                if (!AudioWavReader.TryDecode(payload.Span, out samples, out container, out failure))
                {
                    error = new AudioContainerException(container.Kind, failure);
                    return false;
                }
            }
            else
            {
                if (!_decoders.TryResolve(in container, out IAudioSampleDecoder? decoder))
                {
                    error = new AudioDecoderException(AudioDecoderFailure.DecoderMissing, container.Kind);
                    return false;
                }

                if (!TryInvokeDecoder(decoder, in container, payload, out samples, out AudioDecoderFailure decoderFailure, out string? decoderReason, out Exception? decoderInner))
                {
                    error = new AudioDecoderException(decoderFailure, container.Kind, decoder.Id, decoderReason, decoderInner);
                    return false;
                }
            }

            record = new AudioClipRecord(id, samples!);
            samples = null;
            return true;
        }
        finally
        {
            samples?.Dispose();
        }
    }

    /// <summary>Decodes a container or throws the typed ingest error.</summary>
    public AudioClipRecord CreateRecord(AudioClipId id, ReadOnlyMemory<byte> payload)
    {
        if (!TryCreateRecord(id, payload, out AudioClipRecord? record, out _, out AudioException? error))
        {
            throw error!;
        }

        return record!;
    }

    /// <summary>
    /// Decodes a container and registers it in the store. Registration happens
    /// only after a successful decode, so failures leave the cache untouched.
    /// </summary>
    public AudioClipId Register(AudioClipStore store, AudioClipId id, ReadOnlyMemory<byte> payload)
    {
        ArgumentNullException.ThrowIfNull(store);
        AudioClipRecord record = CreateRecord(id, payload);
        try
        {
            return store.Register(record);
        }
        catch
        {
            record.Dispose();
            throw;
        }
    }

    /// <summary>Decodes and registers, reporting the typed failure instead of throwing.</summary>
    public bool TryRegister(
        AudioClipStore store,
        AudioClipId id,
        ReadOnlyMemory<byte> payload,
        out AudioClipRecord? record,
        out AudioContainerInfo container,
        [NotNullWhen(false)] out AudioException? error)
    {
        ArgumentNullException.ThrowIfNull(store);
        if (!TryCreateRecord(id, payload, out record, out container, out error))
        {
            return false;
        }

        try
        {
            _ = store.Register(record!);
            return true;
        }
        catch (AudioException ex)
        {
            record!.Dispose();
            record = null;
            error = ex;
            return false;
        }
    }

    /// <summary>Sniffs a payload without decoding it.</summary>
    public static AudioContainerKind SniffContainerKind(ReadOnlySpan<byte> payload) => AudioContainerInspector.SniffKind(payload);

    private static bool TryInvokeDecoder(
        IAudioSampleDecoder decoder,
        in AudioContainerInfo container,
        ReadOnlyMemory<byte> payload,
        out NativeAudioMemory? samples,
        out AudioDecoderFailure failure,
        out string? reason,
        out Exception? innerException)
    {
        // Third-party decoders are untrusted; any throw is reported as
        // DecoderFaulted rather than escaping ingest.
#pragma warning disable CA1031
        try
        {
            if (!decoder.TryDecode(in container, payload, out samples, out reason))
            {
                failure = AudioDecoderFailure.DecoderRejected;
                innerException = null;
                return false;
            }

            if (samples is null || samples.SampleCount <= 0)
            {
                samples?.Dispose();
                samples = null;
                failure = AudioDecoderFailure.DecoderProducedEmpty;
                reason = "Decoder returned no samples.";
                innerException = null;
                return false;
            }

            failure = AudioDecoderFailure.None;
            reason = null;
            innerException = null;
            return true;
        }
        catch (Exception ex)
        {
            samples = null;
            failure = AudioDecoderFailure.DecoderFaulted;
            reason = ex.Message;
            innerException = ex;
            return false;
        }
#pragma warning restore CA1031
    }
}
