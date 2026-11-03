using Axrone.Utility.Descriptors;

namespace Axrone.Animation;

/// <summary>
/// Flat, allocation-free projection of an <see cref="AnimationChannel"/>'s
/// authoring-time shape: what it drives, how it interpolates, how many keys it
/// holds, and the time window it covers. Descriptor reads (clip reports,
/// validation, tooling, streaming manifests) need the shape of a track, not its
/// key values, so they project once instead of walking spans per frame.
///
/// Identity is uniform across both kinds of track: a bone track carries
/// <see cref="BoneIndex"/>, a curve track carries <see cref="CurveId"/>.
/// <see cref="BoneIndex"/> is <c>-1</c> for curve tracks and <see cref="CurveId"/>
/// is null for bone tracks, matching the authoring rules enforced by
/// <see cref="AnimationChannel"/>.
///
/// Time bounds come straight off the key times and are defined for the empty
/// track: a track with no keys reports <see cref="StartTime"/> and
/// <see cref="EndTime"/> as <c>0</c>, never by indexing into a zero-length span.
/// </summary>
public readonly record struct TrackDescriptor : IDescriptor<TrackDescriptor>
{
    /// <summary>What the track drives.</summary>
    public ChannelTarget Target { get; init; }

    /// <summary>Keyframe interpolation mode.</summary>
    public InterpolationMode Interpolation { get; init; }

    /// <summary>Driven bone index; <c>-1</c> for curve tracks.</summary>
    public int BoneIndex { get; init; }

    /// <summary>Driven curve; null for bone tracks.</summary>
    public CurveId? CurveId { get; init; }

    /// <summary>Key count; zero for an empty track.</summary>
    public int KeyCount { get; init; }

    /// <summary>First key time; <c>0</c> for an empty track.</summary>
    public float StartTime { get; init; }

    /// <summary>Last key time; <c>0</c> for an empty track.</summary>
    public float EndTime { get; init; }

    /// <summary>
    /// Span between the first and last key; <c>0</c> for an empty or single-key
    /// track, whose start and end are the same moment.
    /// </summary>
    public float Duration => EndTime - StartTime;

    /// <summary>Whether the track holds no keys at all.</summary>
    public bool IsEmpty => KeyCount == 0;

    /// <summary>Whether the track drives a bone rather than a named curve.</summary>
    public bool IsBoneTrack => Target != ChannelTarget.Curve;

    /// <summary>Whether the track drives a named curve rather than a bone.</summary>
    public bool IsCurveTrack => Target == ChannelTarget.Curve;

    /// <summary>
    /// Projects a channel's shape. The key count is read from
    /// <see cref="AnimationChannel.KeyTimes"/>, which is the authoritative
    /// sequence: <see cref="EndTime"/> is the last element of that sequence and
    /// <see cref="StartTime"/> the first, and an empty sequence short-circuits to
    /// <c>0</c> rather than touching either edge.
    /// </summary>
    /// <param name="channel">Channel to project.</param>
    /// <returns>The channel's shape.</returns>
    public static TrackDescriptor FromChannel(AnimationChannel channel)
    {
        ReadOnlySpan<float> keyTimes = channel.KeyTimes;
        int keyCount = keyTimes.Length;

        float startTime = 0.0f;
        float endTime = 0.0f;
        if (keyCount > 0)
        {
            startTime = keyTimes[0];
            endTime = keyTimes[keyCount - 1];
        }

        return new TrackDescriptor
        {
            Target = channel.Target,
            Interpolation = channel.Interpolation,
            BoneIndex = channel.BoneIndex,
            CurveId = channel.TargetCurveId,
            KeyCount = keyCount,
            StartTime = startTime,
            EndTime = endTime,
        };
    }

    public static void Validate(in TrackDescriptor descriptor)
    {
        if (descriptor.KeyCount < 0)
        {
            AnimationThrowHelper.ThrowValidation(AnimationErrorCode.ValidationClipDegenerateData, $"Track key count {descriptor.KeyCount} is negative.");
        }

        if (descriptor.KeyCount == 0)
        {
            if (descriptor.StartTime != 0.0f || descriptor.EndTime != 0.0f)
            {
                AnimationThrowHelper.ThrowValidation(AnimationErrorCode.ValidationClipDegenerateData, "Empty track must report zero start and end time.");
            }

            return;
        }

        if (descriptor.StartTime > descriptor.EndTime)
        {
            AnimationThrowHelper.ThrowValidation(AnimationErrorCode.ValidationClipDegenerateData, $"Track start time {descriptor.StartTime} exceeds end time {descriptor.EndTime}.");
        }
    }

    public static string Describe(in TrackDescriptor descriptor) => descriptor.ToString();
}

/// <summary>
/// Allocation-free forward-only cursor over a clip's channels, projecting each
/// step into a <see cref="TrackDescriptor"/>. Stack-only (it pins a span), so it
/// never escapes the iteration that created it and never allocates — the whole
/// point is to keep descriptor walks off the GC on paths that run per clip.
///
/// Iteration is a single flat loop over the channels: every channel is
/// projected the same way regardless of target, so adding a
/// <see cref="ChannelTarget"/> never adds a branch here.
/// </summary>
public ref struct TrackDescriptorEnumerator
{
    private readonly ReadOnlySpan<AnimationChannel> _channels;
    private int _index;

    /// <summary>
    /// Creates a cursor over a channel span. A default-constructed cursor and an
    /// empty span both yield zero descriptors.
    /// </summary>
    /// <param name="channels">Channels to project.</param>
    public TrackDescriptorEnumerator(ReadOnlySpan<AnimationChannel> channels)
    {
        _channels = channels;
        _index = -1;
    }

    /// <summary>
    /// Returns this cursor, so the enumerator itself can be walked with
    /// <c>foreach</c> like any other span-shaped sequence.
    /// </summary>
    /// <returns>This cursor.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public TrackDescriptorEnumerator GetEnumerator() => this;

    /// <summary>Advances to the next channel.</summary>
    /// <returns>True when <see cref="Current"/> now names a channel.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool MoveNext()
    {
        int next = _index + 1;
        if ((uint)next >= (uint)_channels.Length)
        {
            _index = _channels.Length;
            return false;
        }

        _index = next;
        return true;
    }

    /// <summary>
    /// Projects the channel the cursor currently names. Only valid after a
    /// <see cref="MoveNext"/> that returned true.
    /// </summary>
    public TrackDescriptor Current => TrackDescriptor.FromChannel(_channels[_index]);

    /// <summary>Starts a descriptor walk over a channel span.</summary>
    /// <param name="channels">Channels to project.</param>
    /// <returns>A fresh cursor.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static TrackDescriptorEnumerator Enumerate(ReadOnlySpan<AnimationChannel> channels) =>
        new(channels);
}
