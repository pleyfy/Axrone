namespace Axrone.Animation;

// CA1028: both enums are byte-sized on purpose. They travel as byte fields in the
// streaming chunk DTO and are projected through (byte)/(ChannelTarget) casts, so a
// byte underlying type keeps the wire format and the runtime representation the
// same width instead of widening every packed track descriptor.
#pragma warning disable CA1028

/// <summary>Keyframe interpolation mode.</summary>
public enum InterpolationMode : byte
{
    /// <summary>Linear blend (slerp for rotations).</summary>
    Linear = 0,

    /// <summary>Hold previous key.</summary>
    Step = 1,

    /// <summary>Hermite spline (in-tangent/value/out-tangent triples).</summary>
    CubicSpline = 2,
}

/// <summary>What a channel drives.</summary>
public enum ChannelTarget : byte
{
    /// <summary>Bone translation (3 lanes).</summary>
    Translation = 0,

    /// <summary>Bone rotation (4 lanes).</summary>
    Rotation = 1,

    /// <summary>Bone scale (3 lanes).</summary>
    Scale = 2,

    /// <summary>Named curve (1 lane).</summary>
    Curve = 3,
}

#pragma warning restore CA1028

// CA1815: a channel is a value handle over authoring data, not a comparable value.
// Two channels are "the same" only as a statement about the arrays they share, and
// the struct never needs equality to work: binding rebinds by index, sampling
// reads fields, and no call site has ever compared channels. Adding Equals and ==
// here would invent a comparison contract the type does not have.
#pragma warning disable CA1815

/// <summary>
/// One animated track: key times plus packed key values.
///
/// A readonly struct over the two key arrays rather than a reference type: a
/// channel is an immutable, copy-cheap value, and holding a clip worth of tracks
/// in one array keeps the per-channel sample loop cache-resident instead of
/// chasing a pointer per track. Nothing is shared by mutation — the arrays are
/// owned by the ctor and never reallocated — so the only state that has to change
/// after construction is the bind-time curve slot, and that travels through
/// <see cref="WithBoundSlot"/> as a copy.
///
/// The key arrays are deliberately not defensive copies: a channel borrows the
/// caller's arrays, and sampling treats them as immutable authoring data. Do not
/// write to them after handing them over.
/// </summary>
public readonly struct AnimationChannel
{
    private readonly float[] _keyTimes;
    private readonly float[] _keyValues;

    /// <summary>Target bone index.</summary>
    public int BoneIndex { get; }

    /// <summary>What the channel drives.</summary>
    public ChannelTarget Target { get; }

    /// <summary>Interpolation mode.</summary>
    public InterpolationMode Interpolation { get; }

    /// <summary>Key times, ascending.</summary>
    public ReadOnlySpan<float> KeyTimes => _keyTimes;

    /// <summary>Packed key values.</summary>
    public ReadOnlySpan<float> KeyValues => _keyValues;

    /// <summary>Floats per key (×3 for splines holding tangents).</summary>
    public int Stride { get; }

    /// <summary>Whether the channel carries no keys and therefore drives nothing.</summary>
    public bool IsEmpty
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _keyTimes.Length == 0;
    }

    /// <summary>Target curve for curve channels.</summary>
    public CurveId? TargetCurveId { get; }

    /// <summary>
    /// Bind-time resolved curve slot; <c>-1</c> until <see cref="AnimationClip.Bind"/>
    /// resolves it. Sampling falls back to dictionary lookup while unbound.
    /// </summary>
    public int CurveSlot { get; }

    /// <summary>
    /// Creates a channel; validates target, bone range, ascending finite times,
    /// and the time/value packing. Anything malformed fails here — sampling trusts.
    /// </summary>
    public AnimationChannel(int boneIndex, ChannelTarget target, InterpolationMode interpolation, float[] times, float[] values, CurveId? curveId = null)
    {
        ArgumentNullException.ThrowIfNull(times);
        ArgumentNullException.ThrowIfNull(values);

        if (boneIndex < 0 && target != ChannelTarget.Curve)
        {
            AnimationThrowHelper.ThrowValidation(AnimationErrorCode.ValidationClipMismatch, $"Channel bone index {boneIndex} is negative.");
        }

        if ((uint)target > (uint)ChannelTarget.Curve)
        {
            AnimationThrowHelper.ThrowValidation(AnimationErrorCode.ValidationClipMismatch, $"Unknown channel target '{target}'.");
        }

        int componentCount = target switch
        {
            ChannelTarget.Translation => 3,
            ChannelTarget.Rotation => 4,
            ChannelTarget.Scale => 3,
            ChannelTarget.Curve => 1,
            _ => throw new UnreachableException(),
        };

        float previous = float.NegativeInfinity;
        for (int i = 0; i < times.Length; i++)
        {
            float t = times[i];
            if (!float.IsFinite(t) || t < previous)
            {
                AnimationThrowHelper.ThrowValidation(AnimationErrorCode.ValidationClipDegenerateData, $"Channel times must be finite and ascending (index {i}).");
            }

            previous = t;
        }

        BoneIndex = boneIndex;
        Target = target;
        Interpolation = interpolation;
        _keyTimes = times;
        _keyValues = values;
        TargetCurveId = curveId;
        CurveSlot = -1;

        Stride = interpolation == InterpolationMode.CubicSpline ? componentCount * 3 : componentCount;

        if (times.Length * Stride != values.Length)
        {
            AnimationThrowHelper.ThrowValidation(AnimationErrorCode.ValidationClipMismatch, $"Channel stride mismatch: times({times.Length}) * stride({Stride}) != values({values.Length}).");
        }
    }

    /// <summary>
    /// Private rebind copy. The public ctor re-validates authoring data on every
    /// call, which a bind must not pay for: rebinding replaces one already-proven
    /// integer and nothing else.
    /// </summary>
    private AnimationChannel(AnimationChannel source, int curveSlot)
    {
        _keyTimes = source._keyTimes;
        _keyValues = source._keyValues;
        BoneIndex = source.BoneIndex;
        Target = source.Target;
        Interpolation = source.Interpolation;
        Stride = source.Stride;
        TargetCurveId = source.TargetCurveId;
        CurveSlot = curveSlot;
    }

    /// <summary>
    /// Returns this channel bound to a curve slot, sharing the same key arrays.
    /// The channel is otherwise immutable, so binding is a copy rather than a
    /// mutation: the previous value stays valid and usable, which is what keeps
    /// <see cref="AnimationClip.Bind"/> idempotent and re-entrant.
    /// </summary>
    /// <param name="slot">Resolved curve slot, or <c>-1</c> to stay unbound.</param>
    /// <returns>A channel identical to this one except for its curve slot.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public readonly AnimationChannel WithBoundSlot(int slot) => new(this, slot);

    /// <summary>
    /// Edge rule for the first key, resolved per mode like the segment blend.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private readonly void SampleFirstByMode(ReadOnlySpan<float> values, Span<float> output)
    {
        switch (Interpolation)
        {
            case InterpolationMode.Step:
                StepSamplePolicy.SampleFirst(values, Stride, output);
                return;

            case InterpolationMode.Linear:
                LinearSamplePolicy.SampleFirst(values, Stride, output);
                return;

            default:
                CubicSamplePolicy.SampleFirst(values, Stride, output);
                return;
        }
    }

    /// <summary>
    /// Edge rule for the last key, resolved per mode like the segment blend.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private readonly void SampleLastByMode(ReadOnlySpan<float> values, Span<float> output)
    {
        switch (Interpolation)
        {
            case InterpolationMode.Step:
                StepSamplePolicy.SampleLast(values, Stride, output);
                return;

            case InterpolationMode.Linear:
                LinearSamplePolicy.SampleLast(values, Stride, output);
                return;

            default:
                CubicSamplePolicy.SampleLast(values, Stride, output);
                return;
        }
    }

    /// <summary>
    /// Samples the channel at a time inside its range, starting the segment
    /// search from the beginning.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public readonly void Sample(float time, Span<float> output)
    {
        int segmentHint = 0;
        Sample(time, output, ref segmentHint);
    }

    /// <summary>
    /// Samples the channel at a time inside its range.
    ///
    /// Times outside the key range clamp to the first or last key, and a channel
    /// with fewer than two keys samples as a constant track. Inside the range the
    /// mode picks one of the <see cref="ISamplePolicy"/> implementations; the
    /// rotation-specific paths (spherical blend, post-blend renormalization) stay
    /// conditions of the policy rather than of the channel, so the mode list and
    /// the mode behaviour cannot drift apart.
    /// </summary>
    /// <param name="time">Time to sample at; clamped to the key range.</param>
    /// <param name="output">Destination span of at least the component count floats (equal to <see cref="Stride"/> except for splines, whose edge rules write the key value, a third of the stride).</param>
    /// <param name="segmentHint">
    /// Previous segment index for this channel and the slot the new one is written
    /// back to. Purely a speed hint: the result never depends on it. Callers
    /// sampling a channel repeatedly should pass a persistent slot.
    /// </param>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public readonly void Sample(float time, Span<float> output, ref int segmentHint)
    {
        ReadOnlySpan<float> times = _keyTimes;
        ReadOnlySpan<float> values = _keyValues;
        int count = times.Length;
        if (count == 0)
        {
            return;
        }

        // Every policy agrees on the boundary rule — the edge key's *value* is
        // taken verbatim — so these clamps resolve per mode, exactly like the
        // segment blend below. Step and Linear copy the full stride (which is
        // the value for flat layouts); Cubic copies the value third, so tangents
        // never reach a component-width output.
        if (count == 1 || time <= times[0])
        {
            SampleFirstByMode(values, output);
            return;
        }

        if (time >= times[count - 1])
        {
            SampleLastByMode(values, output);
            return;
        }

        int segment = FastMath.FindSegment(times, time, ref segmentHint);
        float t0 = times[segment];
        float t1 = times[segment + 1];
        float dt = t1 - t0;
        float factor = (time - t0) / MathF.Max(dt, AnimationConstants.SoaEpsilon);

        // Step and Linear are the enumerated modes; anything else samples as a
        // spline, which is what an out-of-range authoring value has always meant.
        switch (Interpolation)
        {
            case InterpolationMode.Step:
                StepSamplePolicy.SampleSegment(values, Stride, Target, segment, factor, dt, output);
                return;

            case InterpolationMode.Linear:
                LinearSamplePolicy.SampleSegment(values, Stride, Target, segment, factor, dt, output);
                return;

            default:
                CubicSamplePolicy.SampleSegment(values, Stride, Target, segment, factor, dt, output);
                return;
        }
    }
}

#pragma warning restore CA1815

/// <summary>Timed named marker fired during playback.</summary>
public readonly record struct ClipEvent(float Time, string Name, string Payload);

/// <summary>Foot-ground contact window with a ramped weight.</summary>
public readonly record struct FootContact(float StartTime, float EndTime, int BoneIndex)
{
    /// <summary>Contact weight at a time: ramps at edges, floored inside.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public float EvaluateWeight(float time)
    {
        if (time < StartTime || time > EndTime)
        {
            return 0.0f;
        }

        float duration = EndTime - StartTime;
        if (duration <= AnimationConstants.SoaEpsilon)
        {
            return 1.0f;
        }

        float n = (time - StartTime) / duration;
        float ramp = MathF.Min(n, 1.0f - n);
        return MathF.Min(1.0f, MathF.Max(AnimationConstants.FootWeightFloor, ramp * AnimationConstants.FootEdgeRampGain));
    }
}

/// <summary>Named set of channels with events, foot contacts, and tags.</summary>
public sealed class AnimationClip
{
    private AnimationChannel[] _channels;
    private int[] _segmentHints;
    private ClipEvent[] _events;
    private FootContact[] _footContacts;

    /// <summary>Clip identity.</summary>
    public ClipId Id { get; }

    /// <summary>Playback length; at least the last key time.</summary>
    public float Duration { get; }

    /// <summary>Channels.</summary>
    public ReadOnlySpan<AnimationChannel> Channels => _channels;

    /// <summary>Sorted events.</summary>
    public ReadOnlySpan<ClipEvent> Events => _events;

    /// <summary>Foot contacts.</summary>
    public ReadOnlySpan<FootContact> FootContacts => _footContacts;

    /// <summary>Tags for motion matching.</summary>
    public HashSet<string> Tags { get; }

    /// <summary>Creates a clip, sanitizing events, contacts, and tags.</summary>
    public AnimationClip(ClipId id, float duration, AnimationChannel[] channels, ClipEvent[]? events = null, FootContact[]? contacts = null, IEnumerable<string>? tags = null)
    {
        ArgumentNullException.ThrowIfNull(channels);

        // NaN would survive Max (it is not ordered) and then poison every derived
        // time — wrap, event collection, normalization — so it is refused here
        // where the cause is still visible.
        if (!float.IsFinite(duration))
        {
            AnimationThrowHelper.ThrowValidation(AnimationErrorCode.ValidationClipDegenerateData, $"Clip '{id}' duration must be finite.");
        }

        Id = id;
        _channels = channels;
        _segmentHints = new int[channels.Length];

        float maxKeyTime = 0.0f;
        for (int i = 0; i < channels.Length; i++)
        {
            ReadOnlySpan<float> times = channels[i].KeyTimes;
            if (times.Length > 0)
            {
                maxKeyTime = MathF.Max(maxKeyTime, times[times.Length - 1]);
            }
        }

        Duration = MathF.Max(MathF.Max(duration, maxKeyTime), 0.0f);

        var cleanEvents = new List<ClipEvent>();
        if (events != null)
        {
            foreach (ClipEvent evt in events)
            {
                if (!float.IsNaN(evt.Time) && !string.IsNullOrWhiteSpace(evt.Name))
                {
                    cleanEvents.Add(evt);
                }
            }

            cleanEvents.Sort(static (a, b) => a.Time.CompareTo(b.Time));
        }

        _events = cleanEvents.ToArray();

        var cleanContacts = new List<FootContact>();
        if (contacts != null)
        {
            foreach (FootContact contact in contacts)
            {
                float start = MathF.Min(contact.StartTime, contact.EndTime);
                float end = MathF.Max(contact.StartTime, contact.EndTime);
                cleanContacts.Add(new FootContact(start, end, contact.BoneIndex));
            }
        }

        _footContacts = cleanContacts.ToArray();

        Tags = new HashSet<string>(StringComparer.Ordinal);
        if (tags != null)
        {
            foreach (string tag in tags)
            {
                if (!string.IsNullOrWhiteSpace(tag))
                {
                    Tags.Add(tag);
                }
            }
        }
    }

    /// <summary>
    /// Replaces channels (streaming merge).
    ///
    /// Curve slots survive the swap. A streamed track is new data, not a new
    /// identity, so a curve channel carrying a <see cref="AnimationChannel.TargetCurveId"/>
    /// that the previous set already resolved inherits that slot. Dropping the
    /// binding here would silently demote every streamed curve back to the
    /// dictionary lookup path, which is a per-frame regression with no visible
    /// symptom — the values stay correct, only the speed collapses.
    ///
    /// Slot hints do not survive: the new track set is a fresh search space, so
    /// every channel restarts its search. A stale hint could not change a result
    /// (see <see cref="FastMath.FindSegment(ReadOnlySpan{float}, float, ref int)"/>),
    /// but a fresh buffer is also the honest state and keeps the two arrays the
    /// same length by construction.
    ///
    /// The clip keeps ownership of <paramref name="newChannels"/> — it stores the
    /// array itself and the carry-over writes rebound tracks back into it — so the
    /// caller must not touch the array after this call, exactly as before.
    /// </summary>
    public void RebuildChannels(AnimationChannel[] newChannels)
    {
        ArgumentNullException.ThrowIfNull(newChannels);
        CarryOverCurveSlots(newChannels);
        _channels = newChannels;
        _segmentHints = new int[newChannels.Length];
    }

    /// <summary>
    /// Copies the resolved curve slot of each outgoing curve channel onto the
    /// incoming channel naming the same curve. Identity is the
    /// <see cref="CurveId"/>, not the position: streaming reorders and extends
    /// tracks, so an index would bind the wrong curve.
    /// </summary>
    private void CarryOverCurveSlots(AnimationChannel[] newChannels)
    {
        AnimationChannel[] outgoing = _channels;
        Dictionary<CurveId, int>? boundSlots = null;

        for (int i = 0; i < outgoing.Length; i++)
        {
            AnimationChannel channel = outgoing[i];
            if (channel.CurveSlot < 0 || !channel.TargetCurveId.HasValue)
            {
                continue;
            }

            boundSlots ??= new Dictionary<CurveId, int>();
            boundSlots[channel.TargetCurveId.Value] = channel.CurveSlot;
        }

        if (boundSlots is null)
        {
            return;
        }

        for (int i = 0; i < newChannels.Length; i++)
        {
            AnimationChannel incoming = newChannels[i];
            if (incoming.Target != ChannelTarget.Curve || !incoming.TargetCurveId.HasValue)
            {
                continue;
            }

            if (boundSlots.TryGetValue(incoming.TargetCurveId.Value, out int slot) && slot >= 0)
            {
                newChannels[i] = incoming.WithBoundSlot(slot);
            }
        }
    }

    /// <summary>
    /// Binds curve slots against a layout and validates bone indices against a
    /// rig. Missing curve ids stay unbound (sampling fails loudly with a code);
    /// out-of-range bones fail here, never mid-frame. Idempotent.
    /// </summary>
    public void Bind(in MotionBindingContext context)
    {
        AnimationChannel[] channels = _channels;
        for (int i = 0; i < channels.Length; i++)
        {
            AnimationChannel channel = channels[i];
            if (context.Rig is not null && channel.Target != ChannelTarget.Curve)
            {
                if ((uint)channel.BoneIndex >= (uint)context.Rig.BoneCount)
                {
                    AnimationThrowHelper.ThrowValidation(AnimationErrorCode.ValidationClipMismatch, $"Channel {i} bone index {channel.BoneIndex} out of range for '{Id}'.");
                }
            }

            if (channel.Target == ChannelTarget.Curve && !channel.TargetCurveId.HasValue)
            {
                AnimationThrowHelper.ThrowValidation(AnimationErrorCode.ValidationClipDegenerateData, $"Curve channel {i} in '{Id}' names no curve.");
            }

            if (context.CurveLayout is not null
                && channel.Target == ChannelTarget.Curve
                && channel.TargetCurveId.HasValue
                && context.CurveLayout.TryGetValue(channel.TargetCurveId.Value, out int slot))
            {
                channels[i] = channel.WithBoundSlot(slot);
            }
        }
    }

    /// <summary>Wraps or clamps time to the clip range.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public float WrapClipTime(float time, bool isLooping)
    {
        if (Duration <= AnimationConstants.SoaEpsilon)
        {
            return 0.0f;
        }

        if (!isLooping)
        {
            return Math.Clamp(time, 0.0f, Duration);
        }

        return FastMath.WrapTime(time, Duration);
    }

    /// <summary>
    /// Samples all channels into a frame.
    ///
    /// Each channel keeps a persistent segment hint in a buffer sized alongside
    /// the channel array, so a clip evaluated frame after frame resolves every
    /// track's key segment in constant time instead of re-searching the key times
    /// from scratch. The buffer is swapped and resized with the channels by
    /// <see cref="RebuildChannels"/>, so index <c>i</c> always names channel
    /// <c>i</c>'s hint.
    ///
    /// Hints are a private cache, not shared state: a hint is verified against
    /// the key times before use, so sampling the same clip from two threads
    /// produces identical output — the worst a racing hint can cost is a slower
    /// search.
    /// </summary>
    [SkipLocalsInit]
    public void Sample(float time, AnimationFrame outFrame, bool isLooping = true)
    {
        ArgumentNullException.ThrowIfNull(outFrame);
        AnimationTelemetry.RecordClipSampled();
        float t = WrapClipTime(time, isLooping);
        // Component width, not stride: every sampling path (edges included)
        // writes at most one rotation Quat (4 floats); spline tangents
        // never reach the output.
        Span<float> component = stackalloc float[4];

        Span<Vec3> translations = outFrame.GetTranslations();
        Span<Quat> rotations = outFrame.GetRotations();
        Span<Vec3> scales = outFrame.GetScales();

        AnimationChannel[] channels = _channels;
        int[] hints = _segmentHints;

        for (int i = 0; i < channels.Length; i++)
        {
            AnimationChannel channel = channels[i];
            if (channel.IsEmpty)
            {
                continue;
            }

            channel.Sample(t, component, ref hints[i]);

            switch (channel.Target)
            {
                case ChannelTarget.Translation:
                    translations[channel.BoneIndex] = new Vec3(component[0], component[1], component[2]);
                    break;
                case ChannelTarget.Rotation:
                    rotations[channel.BoneIndex] = new Quat(component[0], component[1], component[2], component[3]);
                    break;
                case ChannelTarget.Scale:
                    scales[channel.BoneIndex] = new Vec3(component[0], component[1], component[2]);
                    break;
                case ChannelTarget.Curve:
                    if (channel.TargetCurveId.HasValue)
                    {
                        if (channel.CurveSlot >= 0)
                        {
                            outFrame.Curves.Write(new CurveHandle(channel.CurveSlot), component[0]);
                        }
                        else
                        {
                            outFrame.Curves.Write(channel.TargetCurveId.Value, component[0]);
                        }
                    }

                    break;
                default:
                    AnimationThrowHelper.ThrowUnreachable();
                    break;
            }
        }
    }

    /// <summary>Collects events in (prev, cur] into a zero-allocation sink.</summary>
    public void CollectEvents<TSink>(float prevTime, float curTime, ref TSink sink)
        where TSink : struct, IClipEventSink
    {
        if (Duration <= 0.0f || _events.Length == 0)
        {
            return;
        }

        if (curTime >= prevTime)
        {
            CollectEventsRange(prevTime, curTime, includeStart: false, ref sink);
        }
        else
        {
            CollectEventsRange(prevTime, Duration, includeStart: false, ref sink);
            CollectEventsRange(0.0f, curTime, includeStart: true, ref sink);
        }
    }

    /// <summary>Collects events in (prev, cur] into a collection.</summary>
    public void CollectEvents(float prevTime, float curTime, ICollection<ClipEvent> outEvents)
    {
        ArgumentNullException.ThrowIfNull(outEvents);
        var adapter = new CollectionEventSinkAdapter(outEvents);
        CollectEvents(prevTime, curTime, ref adapter);
    }

    private void CollectEventsRange<TSink>(float start, float end, bool includeStart, ref TSink sink)
        where TSink : struct, IClipEventSink
    {
        for (int i = 0; i < _events.Length; i++)
        {
            ClipEvent evt = _events[i];
            bool afterStart = includeStart ? evt.Time >= start : evt.Time > start;
            if (afterStart && evt.Time <= end)
            {
                sink.Emit(in evt);
            }
        }
    }
}
