namespace Axrone.Ecs.Tests;

using System.Diagnostics;
using System.Runtime.ExceptionServices;
using System.Text;

/// <summary>
/// One named sub-phase of a gated workload, measured only after a window already failed,
/// so the verdict names the allocation site instead of only reporting a byte count.
/// </summary>
/// <param name="Name">Phase label used in the failure message.</param>
/// <param name="Run">Runs the phase in isolation, in the same call shape as inside the window.</param>
internal readonly record struct EcsGatePhase(string Name, Action Run);

/// <summary>
/// Shared zero-allocation gate: every measured window must claim exactly zero bytes.
/// The verdict stays strict, but a red is only worth what its evidence is worth, so the failure
/// dump separates the two shapes that look identical in a byte count: an allocation the measured
/// path really made, which repeats in the repeat control and is carried by a named phase, and a
/// charge attributed to the measuring thread while other threads in the process allocate, which
/// shows no collection in the window and zero bytes in every re-measurement.
/// </summary>
internal static class EcsAllocationHarness
{
    internal const int Windows = 8;
    internal const int PrimePasses = 14;

    // No-op control windows measure the counter with an indirect call of the same shape as the
    // workload, so a claim that is not caused by the product becomes visible as a claim on nothing.
    private const int NoopControls = 4;

    /// <summary>
    /// Pass accounting the caller needs to keep its own counters exact without hard-coding the
    /// priming length.
    /// </summary>
    /// <param name="PrimePasses">Workload invocations consumed by warm-up.</param>
    /// <param name="MeasuredWindows">Gated windows that each had to claim zero bytes.</param>
    internal readonly record struct Outcome(int PrimePasses, int MeasuredWindows)
    {
        /// <summary>Total workload invocations, warm-up plus gated windows.</summary>
        internal int TotalInvocations => PrimePasses + MeasuredWindows;
    }

    internal static Outcome AssertEveryWindowClean(
        Action workload,
        Action? betweenWindows,
        int windows,
        int primePasses,
        string label,
        EcsGatePhase[] diagnostics)
    {
        Exception? failure = null;
        Thread worker = new(
            () =>
            {
                try
                {
                    // Allocated before any window opens, so the history buffer itself can never be
                    // charged to the counter the gate is watching.
                    long[] claimed = new long[windows];
                    long[] micros = new long[windows];
                    Action noop = Noop;

                    // The control is warmed exactly like the workload, so a byte claim it makes
                    // later can only be attribution to this thread, never its own first touch.
                    for (int warm = 0; warm < NoopControls; warm++)
                    {
                        noop();
                    }

                    long openedGate = Stopwatch.GetTimestamp();
                    for (int pass = 0; pass < primePasses; pass++)
                    {
                        workload();
                        betweenWindows?.Invoke();
                    }

                    for (int window = 0; window < windows; window++)
                    {
                        int gen0 = GC.CollectionCount(0);
                        int gen1 = GC.CollectionCount(1);
                        int gen2 = GC.CollectionCount(2);
                        long opened = Stopwatch.GetTimestamp();
                        long before = GC.GetAllocatedBytesForCurrentThread();
                        long allBefore = GC.GetTotalAllocatedBytes(precise: false);

                        // The window body builds nothing, not even a formatted reason: an eager
                        // reason string would be allocated between windows and pollute the very
                        // counter being watched. No tolerance, no retry, no cleanest-window: a
                        // single claimed byte fails, because a one-off allocation is a defect too.
                        workload();
                        long delta = GC.GetAllocatedBytesForCurrentThread() - before;
                        claimed[window] = delta;
                        long windowMicros = (Stopwatch.GetTimestamp() - opened) * 1_000_000L / Stopwatch.Frequency;
                        micros[window] = windowMicros;
                        if (delta != 0L)
                        {
                            Assert.Fail(
                                $"window {window}: the {label} hot path must allocate zero bytes on the measured " +
                                $"thread, but claimed {delta} B" +
                                FullState(workload, noop, diagnostics, label, claimed, micros, window, windows,
                                          primePasses, gen0, gen1, gen2, allBefore, windowMicros,
                                          (Stopwatch.GetTimestamp() - openedGate) * 1000L / Stopwatch.Frequency,
                                          betweenWindows is not null));
                        }

                        betweenWindows?.Invoke();
                    }
                }
                catch (Exception error)
                {
                    failure = error;
                }
            });

        worker.IsBackground = true;
        worker.Start();

        // Bounded join: a blocked workload must fail this test rather than hang the whole run.
        if (!worker.Join(TimeSpan.FromMinutes(2)))
        {
            Assert.Fail($"no clean verdict for the {label} gate within 2 minutes; the workload blocked");
        }

        if (failure is not null)
        {
            ExceptionDispatchInfo.Capture(failure).Throw();
        }

        return new Outcome(primePasses, windows);
    }

    /// <summary>
    /// State dump taken only on a window that already claimed bytes. The verdict is fixed by the
    /// caller's Assert.Fail, so nothing measured here can turn the failure green: these runs are
    /// measurements, not retries. They exist so the next red carries its own source: which window,
    /// whether the channel repeats, whether a no-op claims bytes too, and whether a phase claims
    /// bytes once and never again (first touch) or every time (standing product allocation).
    /// </summary>
    private static string FullState(
        Action workload,
        Action noop,
        EcsGatePhase[] diagnostics,
        string label,
        long[] claimed,
        long[] micros,
        int window,
        int windows,
        int primePasses,
        int gen0,
        int gen1,
        int gen2,
        long allBefore,
        long windowMicros,
        long gateMicros,
        bool hasBetweenWindows)
    {
        long slowestClean = 0;
        for (int index = 0; index < window; index++)
        {
            if (claimed[index] == 0L && micros[index] > slowestClean)
            {
                slowestClean = micros[index];
            }
        }

        StringBuilder report = new();
        _ = report.Append(" [state: label=");
        _ = report.Append(label);
        _ = report.Append(", window ");
        _ = report.Append(window + 1);
        _ = report.Append('/');
        _ = report.Append(windows);
        _ = report.Append(", primed ");
        _ = report.Append(primePasses);
        _ = report.Append(" passes, betweenWindows=");
        _ = report.Append(hasBetweenWindows ? "yes" : "no");
        _ = report.Append(", this thread claimed per window: ");
        for (int index = 0; index <= window; index++)
        {
            _ = report.Append(index == 0 ? string.Empty : "/");
            _ = report.Append(claimed[index]);
        }

        _ = report.Append(" B, this window took ");
        _ = report.Append(windowMicros);
        _ = report.Append(" us (slowest zero-claim window so far ");
        _ = report.Append(slowestClean);
        _ = report.Append(" us), ");
        _ = report.Append(gateMicros / 1000L);
        _ = report.Append(" ms into the gate, gen0 +");
        _ = report.Append(GC.CollectionCount(0) - gen0);
        _ = report.Append(" (total ");
        _ = report.Append(GC.CollectionCount(0));
        _ = report.Append("), gen1 +");
        _ = report.Append(GC.CollectionCount(1) - gen1);
        _ = report.Append(", gen2 +");
        _ = report.Append(GC.CollectionCount(2) - gen2);
        _ = report.Append(", all threads in window ");
        _ = report.Append(GC.GetTotalAllocatedBytes(precise: false) - allBefore);
        _ = report.Append(" B, cpu count ");
        _ = report.Append(Environment.ProcessorCount);
        _ = report.Append(", repeat control (same workload, measured again after the verdict)=");
        _ = report.Append(Measure(workload));

        _ = report.Append(", noop control (an empty call of the same shape)=");
        for (int index = 0; index < NoopControls; index++)
        {
            _ = report.Append(index == 0 ? string.Empty : "/");
            _ = report.Append(Measure(noop));
        }

        if (diagnostics.Length != 0)
        {
            _ = report.Append(", phases:");
            foreach (EcsGatePhase phase in diagnostics)
            {
                _ = report.Append(' ');
                _ = report.Append(phase.Name);
                _ = report.Append(" first=");
                _ = report.Append(Measure(phase.Run));
                _ = report.Append(" second=");
                _ = report.Append(Measure(phase.Run));
                _ = report.Append(';');
            }
        }

        _ = report.Append(']');
        return report.ToString();
    }

    // A diagnostic run may legitimately throw (a full parked ring, for instance); the verdict is
    // already failure, so the report records the byte claim plus the thrown type instead of
    // masking or replacing the real reason.
    private static string Measure(Action run)
    {
        long before = GC.GetAllocatedBytesForCurrentThread();
        try
        {
            run();
            return $"{GC.GetAllocatedBytesForCurrentThread() - before} B";
        }
        catch (Exception error)
        {
            return $"{GC.GetAllocatedBytesForCurrentThread() - before} B (threw {error.GetType().Name})";
        }
    }

    private static void Noop()
    {
    }
}
