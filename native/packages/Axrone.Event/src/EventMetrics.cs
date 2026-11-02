namespace Axrone.Event;

using System.Runtime.InteropServices;

/// <summary>Timing aggregate for one measurement family.</summary>
/// <param name="Count">Recorded samples.</param>
/// <param name="TotalMilliseconds">Sum of sample durations.</param>
/// <param name="AverageMilliseconds">Mean sample duration; zero when no sample was recorded.</param>
/// <param name="MinMilliseconds">Smallest sample duration; zero when no sample was recorded.</param>
/// <param name="MaxMilliseconds">Largest sample duration; zero when no sample was recorded.</param>
public readonly record struct EventTimingMetrics(
    long Count,
    double TotalMilliseconds,
    double AverageMilliseconds,
    double MinMilliseconds,
    double MaxMilliseconds);

/// <summary>Per-router metrics snapshot; independent from the OpenTelemetry meter.</summary>
/// <param name="Emit">Publish-path timing (one sample per publish call).</param>
/// <param name="Execution">Handler-invocation timing (one sample per invoked handler).</param>
/// <param name="ExecutionErrors">Handler invocations that faulted.</param>
public readonly record struct EventMetricsSnapshot(
    EventTimingMetrics Emit,
    EventTimingMetrics Execution,
    long ExecutionErrors);

/// <summary>
/// Lock-free per-router accumulator. Counters are padded to a full cache line and updated with
/// interlocked operations so the publish and dispatch paths never allocate.
/// </summary>
internal sealed class EventMetricsRecorder
{
    private readonly EmitSlot _emit = new();
    private readonly ExecutionSlot _execution = new();
    private PaddedLong _executionErrors;

    /// <summary>Records one publish call duration.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void RecordEmit(long elapsedTicks) => _emit.Record(elapsedTicks);

    /// <summary>Records one handler invocation and whether it faulted.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void RecordExecution(long elapsedTicks, bool failed)
    {
        _execution.Record(elapsedTicks);
        if (failed)
        {
            Interlocked.Increment(ref _executionErrors.Value);
        }
    }

    /// <summary>Copies a coherent-enough snapshot; concurrent updates may interleave.</summary>
    public EventMetricsSnapshot Snapshot() => new(
        _emit.Snapshot(),
        _execution.Snapshot(),
        Interlocked.Read(ref _executionErrors.Value));

    /// <summary>Resets every accumulator. Concurrent in-flight samples may be lost.</summary>
    public void Reset()
    {
        _emit.Reset();
        _execution.Reset();
        Volatile.Write(ref _executionErrors.Value, 0);
    }

    private static double TicksToMilliseconds(long ticks) => ticks * 1000d / Stopwatch.Frequency;

    private abstract class TimingSlot
    {
        private PaddedLong _count;
        private PaddedLong _totalTicks;
        private PaddedLong _minTicks = new() { Value = long.MaxValue };
        private PaddedLong _maxTicks;

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public void Record(long elapsedTicks)
        {
            Interlocked.Add(ref _totalTicks.Value, elapsedTicks);
            UpdateMin(ref _minTicks.Value, elapsedTicks);
            UpdateMax(ref _maxTicks.Value, elapsedTicks);
            Interlocked.Increment(ref _count.Value);
        }

        public EventTimingMetrics Snapshot()
        {
            long count = Volatile.Read(ref _count.Value);
            long total = Volatile.Read(ref _totalTicks.Value);
            long min = Volatile.Read(ref _minTicks.Value);
            long max = Volatile.Read(ref _maxTicks.Value);
            if (count == 0)
            {
                return default;
            }

            double totalMilliseconds = TicksToMilliseconds(total);
            double minMilliseconds = min == long.MaxValue ? 0d : TicksToMilliseconds(min);
            return new EventTimingMetrics(
                count,
                totalMilliseconds,
                totalMilliseconds / count,
                minMilliseconds,
                TicksToMilliseconds(max));
        }

        public void Reset()
        {
            Interlocked.Exchange(ref _count.Value, 0);
            Interlocked.Exchange(ref _totalTicks.Value, 0);
            Interlocked.Exchange(ref _minTicks.Value, long.MaxValue);
            Interlocked.Exchange(ref _maxTicks.Value, 0);
        }

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        private static void UpdateMin(ref long location, long value)
        {
            long current = Volatile.Read(ref location);
            while (value < current)
            {
                long observed = Interlocked.CompareExchange(ref location, value, current);
                if (observed == current)
                {
                    return;
                }

                current = observed;
            }
        }

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        private static void UpdateMax(ref long location, long value)
        {
            long current = Volatile.Read(ref location);
            while (value > current)
            {
                long observed = Interlocked.CompareExchange(ref location, value, current);
                if (observed == current)
                {
                    return;
                }

                current = observed;
            }
        }
    }

    private sealed class EmitSlot : TimingSlot
    {
    }

    private sealed class ExecutionSlot : TimingSlot
    {
    }

    [StructLayout(LayoutKind.Explicit, Size = 64)]
    private struct PaddedLong
    {
        [FieldOffset(0)]
        public long Value;
    }
}
