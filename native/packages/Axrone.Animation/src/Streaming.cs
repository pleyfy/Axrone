namespace Axrone.Animation;

using System.Collections.ObjectModel;
using System.Text.Json;
using System.Text.Json.Serialization;

/// <summary>Merge policy for an ingested chunk.</summary>
public enum MergeMode
{
    /// <summary>Replace every channel.</summary>
    ReplaceAll = 0,

    /// <summary>Replace channels overlapping the time range.</summary>
    ReplaceRange = 1,
}

// CA1002/CA2227: DTO collection shape is dictated by the source-generated JSON
// serializer (mutable lists required both directions); not a domain API choice.
#pragma warning disable CA1002, CA2227

/// <summary>Serializable track payload.</summary>
public sealed class ChunkTrackDto
{
    /// <summary>Target bone.</summary>
    public int BoneIndex { get; set; }

    /// <summary>Channel target as byte.</summary>
    public byte Target { get; set; }

    /// <summary>Interpolation as byte.</summary>
    public byte Interpolation { get; set; }

    /// <summary>Key times.</summary>
    public List<float> KeyTimes { get; set; } = new();

    /// <summary>Key values.</summary>
    public List<float> KeyValues { get; set; } = new();
}

/// <summary>Serializable chunk payload.</summary>
public sealed class ChunkPayloadDto
{
    /// <summary>Schema version.</summary>
    public int Version { get; set; } = 1;

    /// <summary>Owning clip.</summary>
    public string ClipId { get; set; } = string.Empty;

    /// <summary>Merge policy as byte.</summary>
    public byte MergeMode { get; set; }

    /// <summary>Chunk start.</summary>
    public float StartTime { get; set; }

    /// <summary>Chunk end.</summary>
    public float EndTime { get; set; }

    /// <summary>Resulting clip duration.</summary>
    public float Duration { get; set; }

    /// <summary>Tracks.</summary>
    public List<ChunkTrackDto> Tracks { get; set; } = new();
}

#pragma warning restore CA1002, CA2227

/// <summary>Source-generated JSON context (AOT-safe, no reflection).</summary>
[JsonSourceGenerationOptions(
    WriteIndented = false,
    DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    GenerationMode = JsonSourceGenerationMode.Default,
    PropertyNamingPolicy = JsonKnownNamingPolicy.Unspecified)]
[JsonSerializable(typeof(ChunkPayloadDto))]
[JsonSerializable(typeof(ChunkTrackDto))]
[JsonSerializable(typeof(List<ChunkTrackDto>))]
[JsonSerializable(typeof(List<float>))]
public sealed partial class ChunkJsonSerializerContext : JsonSerializerContext
{
}

/// <summary>
/// One chunk fetch request, self-ordering: active before preload, then weight
/// descending, then start time. The scheduler relies on this for sorted output.
/// </summary>
public readonly record struct ChunkRequest(string ChunkId, ClipId ClipId, float StartTime, float Weight, bool IsPreload, ChunkKey Key)
    : IComparable<ChunkRequest>
{
    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public int CompareTo(ChunkRequest other)
    {
        if (IsPreload != other.IsPreload)
        {
            return IsPreload ? 1 : -1;
        }

        int byWeight = other.Weight.CompareTo(Weight);
        if (byWeight != 0)
        {
            return byWeight;
        }

        return StartTime.CompareTo(other.StartTime);
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator <(ChunkRequest left, ChunkRequest right) => left.CompareTo(right) < 0;

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator <=(ChunkRequest left, ChunkRequest right) => left.CompareTo(right) <= 0;

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator >(ChunkRequest left, ChunkRequest right) => left.CompareTo(right) > 0;

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator >=(ChunkRequest left, ChunkRequest right) => left.CompareTo(right) >= 0;
}

/// <summary>
/// Allocation-free chunk identity: (clip, version). The scheduler tracks these
/// by value and only materializes the string id for genuinely new requests —
/// steady-state scheduling allocates nothing. Formats as <c>clip:v:index</c>
/// into char or UTF-8 spans without transcoding.
/// </summary>
public readonly record struct ChunkKey(ClipId Clip, int Version) : ISpanFormattable, IUtf8SpanFormattable
{
    /// <summary>Separator between clip and version.</summary>
    private static ReadOnlySpan<char> Separator => ":v:";

    /// <inheritdoc/>
    public bool TryFormat(Span<char> destination, out int charsWritten, ReadOnlySpan<char> format = default, IFormatProvider? provider = null)
    {
        charsWritten = 0;
        ReadOnlySpan<char> separator = Separator;
        if (!Clip.TryFormat(destination, out int clipWritten, format, provider))
        {
            return false;
        }

        if (destination.Length < clipWritten + separator.Length)
        {
            return false;
        }

        separator.CopyTo(destination[clipWritten..]);
        int offset = clipWritten + separator.Length;
        if (!Version.TryFormat(destination[offset..], out int versionWritten, format, provider))
        {
            return false;
        }

        charsWritten = offset + versionWritten;
        return true;
    }

    /// <inheritdoc/>
    public string ToString(string? format, IFormatProvider? formatProvider)
    {
        Span<char> buffer = stackalloc char[64];
        return TryFormat(buffer, out int written, format, formatProvider)
            ? new string(buffer[..written])
            : $"{Clip.Value}:v:{Version}";
    }

    /// <inheritdoc/>
    public override string ToString() => ToString(null, null);

    /// <inheritdoc/>
    public bool TryFormat(Span<byte> utf8Destination, out int bytesWritten, ReadOnlySpan<char> format = default, IFormatProvider? provider = null)
    {
        bytesWritten = 0;
        if (!Clip.TryFormat(utf8Destination, out int clipWritten, format, provider))
        {
            return false;
        }

        ReadOnlySpan<byte> separator = ":v:"u8;
        if (utf8Destination.Length < clipWritten + separator.Length)
        {
            return false;
        }

        separator.CopyTo(utf8Destination[clipWritten..]);
        int offset = clipWritten + separator.Length;
        if (!System.Buffers.Text.Utf8Formatter.TryFormat(Version, utf8Destination[offset..], out int versionWritten))
        {
            return false;
        }

        bytesWritten = offset + versionWritten;
        return true;
    }
}

/// <summary>Fetch lifecycle of one chunk.</summary>
public enum ChunkStatus
{
    /// <summary>Never requested (or reset).</summary>
    Unrequested = 0,

    /// <summary>Requested, awaiting load.</summary>
    Requested = 1,

    /// <summary>Loaded; never rescheduled.</summary>
    Loaded = 2,

    /// <summary>Failed; rescheduled only after reset.</summary>
    Failed = 3,
}

/// <summary>Chunk fetch scheduler: active chunks first, preload window behind.</summary>
public sealed class StreamingScheduler
{
    private readonly Dictionary<ChunkKey, ChunkStatus> _states = new();
    private readonly Lock _gate = new();

    /// <summary>Marks a chunk loaded.</summary>
    public void MarkLoaded(ChunkKey key)
    {
        lock (_gate)
        {
            _states[key] = ChunkStatus.Loaded;
        }
    }

    /// <summary>Marks a chunk failed (eligible for retry after reset).</summary>
    public void MarkFailed(ChunkKey key)
    {
        lock (_gate)
        {
            _states[key] = ChunkStatus.Failed;
        }
    }

    /// <summary>Forgets all chunk states.</summary>
    public void Reset(ChunkKey key)
    {
        lock (_gate)
        {
            _states.Remove(key);
        }
    }

    /// <summary>Whether a key is eligible for (re)scheduling.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private bool IsSchedulable(ChunkKey key) =>
        !_states.TryGetValue(key, out ChunkStatus status) || status == ChunkStatus.Unrequested;

    /// <summary>Binary-search insertion point (shifts still cost O(n); search is O(log n)).</summary>
    private static void InsertSorted(Collection<ChunkRequest> requests, in ChunkRequest request)
    {
        int low = 0;
        int high = requests.Count - 1;
        while (low <= high)
        {
            int mid = low + ((high - low) >> 1);
            if (requests[mid].CompareTo(request) <= 0)
            {
                low = mid + 1;
            }
            else
            {
                high = mid - 1;
            }
        }

        requests.Insert(low, request);
    }

    /// <summary>
    /// Appends active and preload chunk requests to a caller-owned collection,
    /// kept sorted (active first, then weight, then start). Steady-state calls
    /// allocate nothing: membership probes use the by-value key, and the string
    /// id materializes only for genuinely new requests.
    /// </summary>
    public void Schedule(
        ReadOnlySpan<(ClipId Clip, float Time, float Weight)> activities,
        float chunkDuration,
        float preloadWindow,
        Collection<ChunkRequest> outRequests)
    {
        ArgumentNullException.ThrowIfNull(outRequests);
        if (chunkDuration <= 0.0f)
        {
            AnimationThrowHelper.ThrowValidation(AnimationErrorCode.ValidationInvalidArgument, "Chunk duration must be positive.");
        }

        lock (_gate)
        {
            for (int i = 0; i < activities.Length; i++)
            {
                (ClipId clip, float time, float weight) = activities[i];
                int currentIndex = (int)(time / chunkDuration);
                var activeKey = new ChunkKey(clip, currentIndex);

                if (IsSchedulable(activeKey))
                {
                    InsertSorted(outRequests, new ChunkRequest($"{clip.Value}:v:{currentIndex}", clip, currentIndex * chunkDuration, weight, false, activeKey));
                    _states[activeKey] = ChunkStatus.Requested;
                }

                int preloadIndex = (int)((time + preloadWindow) / chunkDuration);
                if (preloadIndex != currentIndex)
                {
                    var preloadKey = new ChunkKey(clip, preloadIndex);
                    if (IsSchedulable(preloadKey))
                    {
                        InsertSorted(outRequests, new ChunkRequest($"{clip.Value}:v:{preloadIndex}", clip, preloadIndex * chunkDuration, weight * AnimationConstants.PreloadWeightFactor, true, preloadKey));
                        _states[preloadKey] = ChunkStatus.Requested;
                    }
                }
            }
        }
    }

    /// <summary>
    /// Zero-allocation batch scheduling into a caller-owned span. Appends unsorted,
    /// sorts the written prefix once, and returns the count — no heap, no wrappers.
    /// Truncates (never overflows) when the destination is too small.
    /// </summary>
    public int Schedule(
        ReadOnlySpan<(ClipId Clip, float Time, float Weight)> activities,
        float chunkDuration,
        float preloadWindow,
        Span<ChunkRequest> destination)
    {
        if (chunkDuration <= 0.0f)
        {
            AnimationThrowHelper.ThrowValidation(AnimationErrorCode.ValidationInvalidArgument, "Chunk duration must be positive.");
        }

        int written = 0;
        lock (_gate)
        {
            for (int i = 0; i < activities.Length; i++)
            {
                (ClipId clip, float time, float weight) = activities[i];
                int currentIndex = (int)(time / chunkDuration);
                var activeKey = new ChunkKey(clip, currentIndex);

                if (IsSchedulable(activeKey))
                {
                    if (written < destination.Length)
                    {
                        destination[written++] = new ChunkRequest($"{clip.Value}:v:{currentIndex}", clip, currentIndex * chunkDuration, weight, false, activeKey);
                    }

                    _states[activeKey] = ChunkStatus.Requested;
                }

                int preloadIndex = (int)((time + preloadWindow) / chunkDuration);
                if (preloadIndex != currentIndex)
                {
                    var preloadKey = new ChunkKey(clip, preloadIndex);
                    if (IsSchedulable(preloadKey))
                    {
                        if (written < destination.Length)
                        {
                            destination[written++] = new ChunkRequest($"{clip.Value}:v:{preloadIndex}", clip, preloadIndex * chunkDuration, weight * AnimationConstants.PreloadWeightFactor, true, preloadKey);
                        }

                        _states[preloadKey] = ChunkStatus.Requested;
                    }
                }
            }
        }

        if (written > 1)
        {
            destination[..written].Sort();
        }

        return written;
    }
}

/// <summary>Chunk codec: bytes to payload with version and shape validation.</summary>
public static class ChunkCodec
{
    /// <summary>Decodes and validates a payload.</summary>
    public static ChunkPayloadDto Decode(ReadOnlySpan<byte> json)
    {
        ChunkPayloadDto? payload;
        try
        {
            payload = JsonSerializer.Deserialize(json, ChunkJsonSerializerContext.Default.ChunkPayloadDto);
        }
        catch (JsonException ex)
        {
            AnimationThrowHelper.ThrowStreaming(AnimationErrorCode.StreamingChunkCorrupt, $"Chunk JSON corrupt: {ex.Message}");
            throw new UnreachableException();
        }

        if (payload == null)
        {
            AnimationThrowHelper.ThrowStreaming(AnimationErrorCode.StreamingChunkCorrupt, "Chunk JSON decoded to null.");
        }

        if (payload.Version != 1)
        {
            AnimationThrowHelper.ThrowStreaming(AnimationErrorCode.StreamingChunkIncompatible, $"Unsupported chunk version {payload.Version}.");
        }

        if (string.IsNullOrWhiteSpace(payload.ClipId))
        {
            AnimationThrowHelper.ThrowStreaming(AnimationErrorCode.StreamingChunkCorrupt, "Chunk clip id missing.");
        }

        if (payload.Tracks is null)
        {
            AnimationThrowHelper.ThrowStreaming(AnimationErrorCode.StreamingChunkCorrupt, "Chunk track list missing.");
        }

        var seenTracks = new HashSet<(int Bone, byte Target)>();
        foreach (ChunkTrackDto track in payload.Tracks)
        {
            int components = track.Target switch
            {
                (byte)ChannelTarget.Translation => 3,
                (byte)ChannelTarget.Rotation => 4,
                (byte)ChannelTarget.Scale => 3,
                (byte)ChannelTarget.Curve => 1,
                _ => -1,
            };

            if (components < 0)
            {
                AnimationThrowHelper.ThrowStreaming(AnimationErrorCode.StreamingChunkIncompatible, $"Unknown channel target {track.Target}.");
            }

            if (track.BoneIndex < 0 && (byte)ChannelTarget.Curve != track.Target)
            {
                AnimationThrowHelper.ThrowStreaming(AnimationErrorCode.StreamingChunkCorrupt, "Only curve tracks may use a negative bone index.");
            }

            if (!seenTracks.Add((track.BoneIndex, track.Target)))
            {
                AnimationThrowHelper.ThrowStreaming(AnimationErrorCode.StreamingChunkCorrupt, "Chunk declares the same bone target twice.");
            }

            if (track.Interpolation > (byte)InterpolationMode.CubicSpline)
            {
                AnimationThrowHelper.ThrowStreaming(AnimationErrorCode.StreamingChunkIncompatible, $"Unknown interpolation mode {track.Interpolation}.");
            }

            float previous = float.NegativeInfinity;
            for (int k = 0; k < track.KeyTimes.Count; k++)
            {
                float time = track.KeyTimes[k];
                if (!float.IsFinite(time) || time < previous)
                {
                    AnimationThrowHelper.ThrowStreaming(AnimationErrorCode.StreamingChunkCorrupt, "Chunk key times must be finite and ascending.");
                }

                previous = time;
            }

            for (int v = 0; v < track.KeyValues.Count; v++)
            {
                if (!float.IsFinite(track.KeyValues[v]))
                {
                    AnimationThrowHelper.ThrowStreaming(AnimationErrorCode.StreamingChunkCorrupt, "Chunk key values must be finite.");
                }
            }

            int stride = track.Interpolation == (byte)InterpolationMode.CubicSpline ? components * 3 : components;
            if (track.KeyTimes.Count * stride != track.KeyValues.Count)
            {
                AnimationThrowHelper.ThrowStreaming(AnimationErrorCode.StreamingChunkIncompatible, "Chunk track stride mismatch.");
            }
        }

        return payload;
    }

    /// <summary>
    /// Merges a payload into a clip after verifying that the chunk names that
    /// clip. A chunk for another avatar or clip is refused instead of being
    /// silently folded into the wrong animation.
    /// </summary>
    public static AnimationChannel[] Merge(AnimationClip clip, ChunkPayloadDto payload, MergeMode mode)
    {
        ArgumentNullException.ThrowIfNull(clip);
        ArgumentNullException.ThrowIfNull(payload);
        if (!string.Equals(payload.ClipId, clip.Id.Value, StringComparison.Ordinal))
        {
            AnimationThrowHelper.ThrowStreaming(
                AnimationErrorCode.StreamingChunkIncompatible,
                $"Chunk targets clip '{payload.ClipId}' but was applied to '{clip.Id}'.");
        }

        return Merge([.. clip.Channels], payload, mode);
    }

    /// <summary>
    /// Merges a payload into live channels. Exact-size outputs (two passes, no
    /// list over-allocation); key arrays are copied so DTO buffers stay caller-owned.
    /// <see cref="MergeMode.ReplaceRange"/> keeps base keys outside the chunk's
    /// start/end window and merges the overlapping window key-by-key.
    /// </summary>
    public static AnimationChannel[] Merge(AnimationChannel[] baseChannels, ChunkPayloadDto payload, MergeMode mode)
    {
        ArgumentNullException.ThrowIfNull(baseChannels);
        ArgumentNullException.ThrowIfNull(payload);

        List<ChunkTrackDto> tracks = payload.Tracks;
        if (mode == MergeMode.ReplaceAll)
        {
            var replaced = GC.AllocateUninitializedArray<AnimationChannel>(tracks.Count);
            for (int i = 0; i < tracks.Count; i++)
            {
                replaced[i] = ToChannel(tracks[i]);
            }

            return replaced;
        }

        var merged = new List<AnimationChannel>(baseChannels.Length + tracks.Count);
        bool[] consumed = new bool[baseChannels.Length];

        for (int i = 0; i < tracks.Count; i++)
        {
            AnimationChannel chunkChannel = ToChannel(tracks[i]);
            int match = FindMatchingChannel(baseChannels, chunkChannel);
            if (match < 0)
            {
                merged.Add(chunkChannel);
                continue;
            }

            consumed[match] = true;
            merged.Add(MergeChannel(baseChannels[match], chunkChannel, payload.StartTime, payload.EndTime));
        }

        for (int i = 0; i < baseChannels.Length; i++)
        {
            if (!consumed[i])
            {
                merged.Add(baseChannels[i]);
            }
        }

        return [.. merged];
    }

    private static int FindMatchingChannel(ReadOnlySpan<AnimationChannel> channels, in AnimationChannel candidate)
    {
        for (int i = 0; i < channels.Length; i++)
        {
            if (channels[i].BoneIndex == candidate.BoneIndex && channels[i].Target == candidate.Target)
            {
                return i;
            }
        }

        return -1;
    }

    private static AnimationChannel MergeChannel(AnimationChannel baseChannel, AnimationChannel chunkChannel, float start, float end)
    {
        // Mixed interpolation would make one key's tangents mean something
        // different from its neighbour's, so the chunk wins wholesale.
        if (baseChannel.Interpolation != chunkChannel.Interpolation ||
            baseChannel.Target == ChannelTarget.Curve)
        {
            return chunkChannel;
        }

        ReadOnlySpan<float> chunkTimes = chunkChannel.KeyTimes;
        if (start >= end)
        {
            start = chunkTimes[0];
            end = chunkTimes[^1];
        }

        int stride = baseChannel.Stride;
        ReadOnlySpan<float> baseTimes = baseChannel.KeyTimes;
        ReadOnlySpan<float> baseValues = baseChannel.KeyValues;

        var entries = new List<(float Time, float[] Values)>(baseTimes.Length + chunkTimes.Length);
        for (int i = 0; i < baseTimes.Length; i++)
        {
            float time = baseTimes[i];
            if (time < start || time > end)
            {
                entries.Add((time, baseValues.Slice(i * stride, stride).ToArray()));
            }
        }

        ReadOnlySpan<float> chunkValues = chunkChannel.KeyValues;
        for (int i = 0; i < chunkTimes.Length; i++)
        {
            entries.Add((chunkTimes[i], chunkValues.Slice(i * stride, stride).ToArray()));
        }

        entries.Sort(static (a, b) => a.Time.CompareTo(b.Time));

        var times = new float[entries.Count];
        var values = new float[entries.Count * stride];
        for (int i = 0; i < entries.Count; i++)
        {
            times[i] = entries[i].Time;
            entries[i].Values.AsSpan().CopyTo(values.AsSpan(i * stride, stride));
        }

        return new AnimationChannel(
            baseChannel.BoneIndex,
            baseChannel.Target,
            baseChannel.Interpolation,
            times,
            values,
            baseChannel.TargetCurveId);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static AnimationChannel ToChannel(ChunkTrackDto track) =>
        new(
            track.BoneIndex,
            (ChannelTarget)track.Target,
            (InterpolationMode)track.Interpolation,
            [.. track.KeyTimes],
            [.. track.KeyValues]);
}

/// <summary>Linear keyframe reduction: drops interior keys a straight line predicts.</summary>
public static class KeyframeOptimizer
{
    /// <summary>Optimizes a clip with per-lane tolerances.</summary>
    public static AnimationClip Optimize(
        AnimationClip source,
        float positionTolerance = AnimationConstants.KeyframePosTol,
        float rotationTolerance = AnimationConstants.KeyframeRotTol,
        float scaleTolerance = AnimationConstants.KeyframeScaleTol)
    {
        ArgumentNullException.ThrowIfNull(source);

        var translations = new List<AnimationChannel>();
        var rotations = new List<AnimationChannel>();
        var scales = new List<AnimationChannel>();
        var curves = new List<AnimationChannel>();

        foreach (AnimationChannel channel in source.Channels)
        {
            // Channels are target-validated at construction; the default arms are
            // provably unreachable and fail loud instead of silently miscoding.
            float tolerance = channel.Target switch
            {
                ChannelTarget.Translation => positionTolerance,
                ChannelTarget.Rotation => rotationTolerance,
                ChannelTarget.Scale => scaleTolerance,
                ChannelTarget.Curve => AnimationConstants.KeyframeCurveTol,
                _ => throw new UnreachableException(),
            };

            AnimationChannel reduced = Reduce(channel, tolerance);
            switch (channel.Target)
            {
                case ChannelTarget.Translation: translations.Add(reduced); break;
                case ChannelTarget.Rotation: rotations.Add(reduced); break;
                case ChannelTarget.Scale: scales.Add(reduced); break;
                case ChannelTarget.Curve: curves.Add(reduced); break;
                default: AnimationThrowHelper.ThrowUnreachable(); break;
            }
        }

        var merged = new List<AnimationChannel>(translations.Count + rotations.Count + scales.Count + curves.Count);
        merged.AddRange(translations);
        merged.AddRange(rotations);
        merged.AddRange(scales);
        merged.AddRange(curves);

        return new AnimationClip(
            source.Id,
            source.Duration,
            merged.ToArray(),
            [.. source.Events],
            [.. source.FootContacts],
            source.Tags);
    }

    private static AnimationChannel Reduce(AnimationChannel channel, float tolerance)
    {
        if (channel.Interpolation != InterpolationMode.Linear)
        {
            return channel;
        }

        ReadOnlySpan<float> times = channel.KeyTimes;
        ReadOnlySpan<float> values = channel.KeyValues;
        if (times.Length <= 2)
        {
            return channel;
        }

        int stride = channel.Stride;
        float[] rentedTimes = ArrayPool<float>.Shared.Rent(times.Length);
        float[] rentedValues = ArrayPool<float>.Shared.Rent(values.Length);

        try
        {
            rentedTimes[0] = times[0];
            values.Slice(0, stride).CopyTo(rentedValues);
            int outKeyCount = 1;
            int anchor = 0;

            // Raw refs skip per-access bounds checks; all indices derive from the
            // validated stride packing (ctor-verified), so they cannot overrun.
            ref float timesRef = ref MemoryMarshal.GetReference(times);
            ref float valuesRef = ref MemoryMarshal.GetReference(values);

            for (int i = 1; i < times.Length - 1; i++)
            {
                float t0 = Unsafe.Add(ref timesRef, anchor);
                float t1 = Unsafe.Add(ref timesRef, i);
                float t2 = Unsafe.Add(ref timesRef, i + 1);

                if (MathF.Abs(t2 - t0) <= AnimationConstants.SoaEpsilon)
                {
                    PushKey(times, values, stride, i, rentedTimes, rentedValues, outKeyCount++);
                    anchor = i;
                    continue;
                }

                float factor = (t1 - t0) / (t2 - t0);
                bool deviate = false;
                if (Vector128.IsHardwareAccelerated && stride == 4)
                {
                    Vector128<float> v0 = Vector128.LoadUnsafe(ref valuesRef, (nuint)(anchor * stride));
                    Vector128<float> actual = Vector128.LoadUnsafe(ref valuesRef, (nuint)(i * stride));
                    Vector128<float> v2 = Vector128.LoadUnsafe(ref valuesRef, (nuint)((i + 1) * stride));
                    Vector128<float> predicted = v0 + (Vector128.Create(factor) * (v2 - v0));
                    deviate = Vector128.GreaterThanAny(Vector128.Abs(actual - predicted), Vector128.Create(tolerance));
                }
                else
                {
                    int anchorOffset = anchor * stride;
                    int iOffset = i * stride;
                    int nextOffset = (i + 1) * stride;
                    for (int s = 0; s < stride; s++)
                    {
                        float v0 = Unsafe.Add(ref valuesRef, anchorOffset + s);
                        float actual = Unsafe.Add(ref valuesRef, iOffset + s);
                        float v2 = Unsafe.Add(ref valuesRef, nextOffset + s);
                        float predicted = v0 + (factor * (v2 - v0));
                        if (MathF.Abs(actual - predicted) > tolerance)
                        {
                            deviate = true;
                            break;
                        }
                    }
                }

                if (deviate)
                {
                    PushKey(times, values, stride, i, rentedTimes, rentedValues, outKeyCount++);
                    anchor = i;
                }
            }

            PushKey(times, values, stride, times.Length - 1, rentedTimes, rentedValues, outKeyCount++);

            if (outKeyCount == times.Length)
            {
                return channel;
            }

            var finalTimes = GC.AllocateUninitializedArray<float>(outKeyCount);
            var finalValues = GC.AllocateUninitializedArray<float>(outKeyCount * stride);
            rentedTimes.AsSpan(0, outKeyCount).CopyTo(finalTimes);
            rentedValues.AsSpan(0, outKeyCount * stride).CopyTo(finalValues);

            return new AnimationChannel(channel.BoneIndex, channel.Target, channel.Interpolation, finalTimes, finalValues, channel.TargetCurveId);
        }
        finally
        {
            ArrayPool<float>.Shared.Return(rentedTimes);
            ArrayPool<float>.Shared.Return(rentedValues);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static void PushKey(ReadOnlySpan<float> times, ReadOnlySpan<float> values, int stride, int keyIndex, Span<float> outTimes, Span<float> outValues, int writePos)
    {
        outTimes[writePos] = times[keyIndex];
        values.Slice(keyIndex * stride, stride).CopyTo(outValues.Slice(writePos * stride, stride));
    }
}
