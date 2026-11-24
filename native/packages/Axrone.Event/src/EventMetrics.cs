namespace Axrone.Event;

using Axrone.Utility.Alignment;

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
/// Lock-free per-router accumulator. Counters are cache-line padded and updated with
/// interlocked operations so the publish and dispatch paths never allocate.
/// </summary>
/// <remarks>
/// Padding and atomics come from <see cref="AlignedAtomicCounter64"/> in Axrone.Utility rather
/// than a package-local copy, so every engine counter shares one implementation.
/// </remarks>
internal sealed class EventMetricsRecorder
{
    private readonly EmitSlot _emit = new();
    private readonly ExecutionSlot _execution = new();
    private AlignedAtomicCounter64 _executionErrors;

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
            _executionErrors.Increment();
        }
    }

    /// <summary>Copies a coherent-enough snapshot; concurrent updates may interleave.</summary>
    public EventMetricsSnapshot Snapshot() => new(
        _emit.Snapshot(),
        _execution.Snapshot(),
        _executionErrors.Value);

    /// <summary>Resets every accumulator. Concurrent in-flight samples may be lost.</summary>
    public void Reset()
    {
        _emit.Reset();
        _execution.Reset();
        _executionErrors.Reset();
    }

    private static double TicksToMilliseconds(long ticks) => ticks * 1000d / Stopwatch.Frequency;

    private abstract class TimingSlot
    {
        private AlignedAtomicCounter64 _count;
        private AlignedAtomicCounter64 _totalTicks;
        private AlignedAtomicCounter64 _minTicks;
        private AlignedAtomicCounter64 _maxTicks;

        protected TimingSlot() => _minTicks.Add(long.MaxValue);

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public void Record(long elapsedTicks)
        {
            _totalTicks.Add(elapsedTicks);
            UpdateMin(ref _minTicks, elapsedTicks);
            UpdateMax(ref _maxTicks, elapsedTicks);
            _count.Increment();
        }

        public EventTimingMetrics Snapshot()
        {
            long count = _count.Value;
            long total = _totalTicks.Value;
            long min = _minTicks.Value;
            long max = _maxTicks.Value;
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
            _count.Reset();
            _totalTicks.Reset();
            _minTicks.Reset();
            _minTicks.Add(long.MaxValue);
            _maxTicks.Reset();
        }

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        private static void UpdateMin(ref AlignedAtomicCounter64 counter, long value)
        {
            long current = counter.Value;
            while (value < current)
            {
                if (counter.CompareExchange(value, current))
                {
                    return;
                }

                current = counter.Value;
            }
        }

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        private static void UpdateMax(ref AlignedAtomicCounter64 counter, long value)
        {
            long current = counter.Value;
            while (value > current)
            {
                if (counter.CompareExchange(value, current))
                {
                    return;
                }

                current = counter.Value;
            }
        }
    }

    private sealed class EmitSlot : TimingSlot
    {
    }

    private sealed class ExecutionSlot : TimingSlot
    {
    }
}
