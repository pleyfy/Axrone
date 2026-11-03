namespace Axrone.Audio;

/// <summary>
/// Compressed-container failure discriminant. Missing decoders are separated
/// from decoder faults so a caller can distinguish "no plugin installed" from
/// "the plugin rejected this stream".
/// </summary>
public enum AudioDecoderFailure : byte
{
    /// <summary>No failure.</summary>
    None = 0,

    /// <summary>No decoder is registered for the container.</summary>
    DecoderMissing = 1,

    /// <summary>The resolved decoder declined the stream.</summary>
    DecoderRejected = 2,

    /// <summary>The resolved decoder threw.</summary>
    DecoderFaulted = 3,

    /// <summary>The decoder produced no samples.</summary>
    DecoderProducedEmpty = 4,
}

/// <summary>
/// Compressed clip ingest failure. Never wraps an empty clip: a compressed
/// payload without a usable decoder is a hard error.
/// </summary>
public sealed class AudioDecoderException : AudioException
{
    /// <summary>Container that needed decoding.</summary>
    public AudioContainerKind Kind { get; }

    /// <summary>Failure discriminant.</summary>
    public AudioDecoderFailure Failure { get; }

    /// <summary>Decoder id when one was resolved.</summary>
    public string? DecoderId { get; }

    /// <summary>Creates a decoder failure.</summary>
    public AudioDecoderException(AudioDecoderFailure failure, AudioContainerKind kind, string? decoderId = null, string? detail = null)
        : base(CodeFor(failure), MessageFor(failure, kind, decoderId, detail))
    {
        Kind = kind;
        Failure = failure;
        DecoderId = decoderId;
    }

    /// <summary>Whether no decoder could be resolved at all.</summary>
    public bool IsUnavailable => Failure == AudioDecoderFailure.DecoderMissing;

    internal static string CodeFor(AudioDecoderFailure failure) => failure == AudioDecoderFailure.DecoderMissing
        ? "audio.decoder.missing"
        : "audio.decoder.failed";

    private static string MessageFor(AudioDecoderFailure failure, AudioContainerKind kind, string? decoderId, string? detail)
    {
        string target = decoderId is null ? kind.ToString() : $"{kind} via decoder '{decoderId}'";
        string message = failure switch
        {
            AudioDecoderFailure.DecoderMissing => $"Audio container '{kind}' needs a decoder and none is registered; implement IAudioSampleDecoder and register it before ingest.",
            AudioDecoderFailure.DecoderRejected => $"Decoder for {target} declined the stream.",
            AudioDecoderFailure.DecoderFaulted => $"Decoder for {target} threw.",
            AudioDecoderFailure.DecoderProducedEmpty => $"Decoder for {target} produced no samples.",
            _ => $"Decoder for {target} failed.",
        };

        return string.IsNullOrEmpty(detail) ? message : message + " " + detail;
    }
}

/// <summary>
/// Compressed sample decoder seam (Ogg, MP3, FLAC and ADPCM-in-WAV). The
/// engine ships no codec; ingest fails closed when nothing is registered,
/// mirroring the glTF KTX2 transcoder contract so a missing plugin can never
/// degrade into a silent empty clip.
/// </summary>
public interface IAudioSampleDecoder
{
    /// <summary>Stable decoder identity used for registration and errors.</summary>
    string Id { get; }

    /// <summary>Whether this decoder handles the container.</summary>
    bool CanDecode(in AudioContainerInfo container);

    /// <summary>
    /// Decodes the payload into the engine's interleaved normalized float
    /// layout. The decoder allocates the returned buffer and transfers
    /// ownership to the caller. Implementations must assign a non-null,
    /// non-empty buffer whenever they return true; ingest verifies this and
    /// reports a violation as <see cref="AudioDecoderFailure.DecoderProducedEmpty"/>.
    /// </summary>
    bool TryDecode(
        in AudioContainerInfo container,
        ReadOnlyMemory<byte> payload,
        out NativeAudioMemory? samples,
        out string? failureReason);
}

/// <summary>
/// Ordered decoder registry. Registration is id-keyed and copy-on-write so
/// resolution on the ingest path reads a stable snapshot without locking.
/// </summary>
public sealed class AudioDecoderRegistry
{
    private static readonly IAudioSampleDecoder[] EmptyArray = [];

    private readonly Lock _gate = new();
    private IAudioSampleDecoder[] _decoders = EmptyArray;

    /// <summary>Creates an empty registry.</summary>
    public AudioDecoderRegistry()
    {
    }

    /// <summary>Creates a registry pre-loaded with one decoder.</summary>
    public AudioDecoderRegistry(IAudioSampleDecoder decoder)
    {
        ArgumentNullException.ThrowIfNull(decoder);
        _decoders = [decoder];
    }

    /// <summary>Registered decoder count.</summary>
    public int Count => Volatile.Read(ref _decoders).Length;

    /// <summary>
    /// Registers a decoder under its own id. Returns false when the id is
    /// already taken; registration order is resolution order.
    /// </summary>
    public bool Register(IAudioSampleDecoder decoder)
    {
        ArgumentNullException.ThrowIfNull(decoder);
        ArgumentException.ThrowIfNullOrEmpty(decoder.Id);

        lock (_gate)
        {
            IAudioSampleDecoder[] current = _decoders;
            for (int i = 0; i < current.Length; i++)
            {
                if (string.Equals(current[i].Id, decoder.Id, StringComparison.Ordinal))
                {
                    return false;
                }
            }

            IAudioSampleDecoder[] next = new IAudioSampleDecoder[current.Length + 1];
            Array.Copy(current, next, current.Length);
            next[current.Length] = decoder;
            Volatile.Write(ref _decoders, next);
            return true;
        }
    }

    /// <summary>
    /// Registers a decoder, replacing any previous entry with the same id and
    /// keeping its position in resolution order.
    /// </summary>
    public void RegisterOrReplace(IAudioSampleDecoder decoder)
    {
        ArgumentNullException.ThrowIfNull(decoder);
        ArgumentException.ThrowIfNullOrEmpty(decoder.Id);

        lock (_gate)
        {
            IAudioSampleDecoder[] current = _decoders;
            IAudioSampleDecoder[] next = new IAudioSampleDecoder[current.Length + 1];
            Array.Copy(current, next, current.Length);

            int replaced = -1;
            for (int i = 0; i < current.Length; i++)
            {
                if (string.Equals(current[i].Id, decoder.Id, StringComparison.Ordinal))
                {
                    replaced = i;
                    break;
                }
            }

            if (replaced >= 0)
            {
                next = new IAudioSampleDecoder[current.Length];
                Array.Copy(current, next, current.Length);
                next[replaced] = decoder;
            }

            Volatile.Write(ref _decoders, next);
        }
    }

    /// <summary>Unregisters a decoder by id.</summary>
    public bool Unregister(string id)
    {
        ArgumentException.ThrowIfNullOrEmpty(id);

        lock (_gate)
        {
            IAudioSampleDecoder[] current = _decoders;
            int idx = IndexOf(current, id);
            if (idx < 0)
            {
                return false;
            }

            IAudioSampleDecoder[] next = new IAudioSampleDecoder[current.Length - 1];
            if (idx > 0)
            {
                Array.Copy(current, 0, next, 0, idx);
            }

            if (idx + 1 < current.Length)
            {
                Array.Copy(current, idx + 1, next, idx, current.Length - idx - 1);
            }

            Volatile.Write(ref _decoders, next);
            return true;
        }
    }

    /// <summary>Resolves the first registered decoder that accepts the container.</summary>
    public bool TryResolve(in AudioContainerInfo container, [NotNullWhen(true)] out IAudioSampleDecoder? decoder)
    {
        IAudioSampleDecoder[] current = Volatile.Read(ref _decoders);
        for (int i = 0; i < current.Length; i++)
        {
            if (current[i].CanDecode(in container))
            {
                decoder = current[i];
                return true;
            }
        }

        decoder = null;
        return false;
    }

    /// <summary>Whether any registered decoder accepts the container.</summary>
    public bool Supports(in AudioContainerInfo container) => TryResolve(in container, out _);

    /// <summary>Removes every decoder.</summary>
    public void Clear()
    {
        lock (_gate)
        {
            Volatile.Write(ref _decoders, EmptyArray);
        }
    }

    /// <summary>Enumerates registered decoders in resolution order.</summary>
    public DecoderEnumerator GetEnumerator() => new(Volatile.Read(ref _decoders));

    /// <summary>Duck-typed zero-allocation enumerator over registered decoders.</summary>
    public ref struct DecoderEnumerator
    {
        private readonly IAudioSampleDecoder[] _decoders;
        private int _index;

        /// <summary>Creates an enumerator.</summary>
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        internal DecoderEnumerator(IAudioSampleDecoder[] decoders)
        {
            _decoders = decoders;
            _index = -1;
        }

        /// <summary>Advances to the next decoder.</summary>
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public bool MoveNext() => ++_index < _decoders.Length;

        /// <summary>Current decoder.</summary>
        public readonly IAudioSampleDecoder Current => _decoders[_index];
    }

    private static int IndexOf(IAudioSampleDecoder[] decoders, string id)
    {
        for (int i = 0; i < decoders.Length; i++)
        {
            if (string.Equals(decoders[i].Id, id, StringComparison.Ordinal))
            {
                return i;
            }
        }

        return -1;
    }
}
