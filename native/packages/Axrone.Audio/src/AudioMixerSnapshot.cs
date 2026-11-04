namespace Axrone.Audio;

/// <summary>
/// Gain interpolation curve for a scheduled mixer restore.
/// </summary>
public enum MixerRampCurve : byte
{
    /// <summary>Straight-line interpolation between captured and target values.</summary>
    Linear = 0,

    /// <summary>Geometric interpolation; falls back to linear when either end is non-positive.</summary>
    Exponential = 1,
}

/// <summary>
/// One captured bus: committed tuning plus the topology and effective gain
/// resolved at capture time.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct AudioMixerSnapshotEntry(
    AudioBusId Id,
    AudioBusId ParentId,
    float Volume,
    bool Mute,
    float Pan,
    float EffectiveGain);

/// <summary>
/// Immutable mixer state. Captures every active bus's tuning plus the parent
/// link and effective gain, so a restore can rebuild both topology and level.
/// </summary>
public sealed class AudioMixerSnapshot
{
    private readonly AudioMixerSnapshotEntry[] _entries;

    /// <summary>Snapshot identity.</summary>
    public AudioSnapshotId Id { get; }

    /// <summary>Mixer clock value when the snapshot was taken.</summary>
    public double CapturedAtSeconds { get; }

    /// <summary>Captured bus count.</summary>
    public int BusCount => _entries.Length;

    /// <summary>Captured entries in ascending bus id order.</summary>
    public ReadOnlySpan<AudioMixerSnapshotEntry> Entries => _entries;

    /// <summary>Creates a snapshot.</summary>
    internal AudioMixerSnapshot(AudioSnapshotId id, double capturedAtSeconds, AudioMixerSnapshotEntry[] entries)
    {
        Id = id;
        CapturedAtSeconds = capturedAtSeconds;
        _entries = entries;
    }

    /// <summary>Looks up one captured bus.</summary>
    public bool TryGetEntry(AudioBusId id, out AudioMixerSnapshotEntry entry)
    {
        for (int i = 0; i < _entries.Length; i++)
        {
            if (_entries[i].Id == id)
            {
                entry = _entries[i];
                return true;
            }
        }

        entry = default;
        return false;
    }

    /// <summary>Effective gain captured for one bus, when present.</summary>
    public bool TryGetCapturedGain(AudioBusId id, out float effectiveGain)
    {
        if (TryGetEntry(id, out AudioMixerSnapshotEntry entry))
        {
            effectiveGain = entry.EffectiveGain;
            return true;
        }

        effectiveGain = 0.0f;
        return false;
    }
}

/// <summary>
/// Outcome of a scheduled restore. Unknown buses are counted, never silently
/// created, so a caller can detect a stale snapshot.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct AudioSnapshotApplyResult(
    int AppliedCount,
    int SkippedCount,
    int TopologyRestoredCount,
    double CompletionClockSeconds)
{
    /// <summary>Whether every captured bus was found in the registry.</summary>
    public bool IsComplete => SkippedCount == 0;
}

/// <summary>
/// Ramp curve evaluation. Pure and deterministic: the same clock always
/// produces the same gain.
/// </summary>
public static class MixerRamp
{
    /// <summary>Interpolates one value at normalized progress in [0, 1].</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static float Interpolate(MixerRampCurve curve, float from, float to, float t)
    {
        if (curve == MixerRampCurve.Exponential && from > 0.0f && to > 0.0f)
        {
            return from * MathF.Pow(to / from, t);
        }

        return from + ((to - from) * t);
    }

    /// <summary>Normalizes a clock value against a ramp window.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static float Progress(double clockSeconds, double startSeconds, double endSeconds)
    {
        double span = endSeconds - startSeconds;
        if (span <= 0.0)
        {
            return clockSeconds >= endSeconds ? 1.0f : 0.0f;
        }

        double elapsed = clockSeconds - startSeconds;
        if (elapsed <= 0.0)
        {
            return 0.0f;
        }

        return elapsed >= span ? 1.0f : (float)(elapsed / span);
    }
}
