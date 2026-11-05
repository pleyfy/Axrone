namespace Axrone.Ui.Tests;

using System.Runtime.ExceptionServices;

/// <summary>
/// One named sub-phase of a gated workload, measured only after a window already failed,
/// so the verdict names the allocation site instead of only reporting a byte count.
/// </summary>
/// <param name="Name">Phase label used in the failure message.</param>
/// <param name="Run">Runs the phase in isolation, in the same call shape as inside the window.</param>
internal readonly record struct UiGatePhase(string Name, Action Run);

/// <summary>Shared zero-allocation gate: every measured window must claim exactly zero bytes.</summary>
internal static class UiAllocationHarness
{
    internal const int Windows = 8;

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
        UiGatePhase[] diagnostics)
    {
        Exception? failure = null;
        Thread worker = new(
            () =>
            {
                try
                {
                    for (int pass = 0; pass < primePasses; pass++)
                    {
                        workload();
                        betweenWindows?.Invoke();
                    }

                    for (int window = 0; window < windows; window++)
                    {
                        long before = GC.GetAllocatedBytesForCurrentThread();
                        workload();
                        long delta = GC.GetAllocatedBytesForCurrentThread() - before;

                        // The window body builds nothing, not even a formatted reason: an eager
                        // reason string would be allocated between windows and pollute the very
                        // counter being watched. No tolerance, no retry, no cleanest-window: a
                        // single claimed byte fails, because a one-off allocation is a defect too.
                        if (delta != 0L)
                        {
                            Assert.Fail(
                                $"window {window}: the {label} hot path must allocate zero bytes on the measured " +
                                $"thread, but claimed {delta} B{Diagnose(diagnostics)}");
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

    private static string Diagnose(UiGatePhase[] diagnostics)
    {
        if (diagnostics.Length == 0)
        {
            return string.Empty;
        }

        System.Text.StringBuilder report = new();
        _ = report.Append(" (gen0 collections ");
        _ = report.Append(GC.CollectionCount(0));
        _ = report.Append(';');
        foreach (UiGatePhase phase in diagnostics)
        {
            long before = GC.GetAllocatedBytesForCurrentThread();
            string outcome = RunPhase(phase.Run);
            _ = report.Append(' ');
            _ = report.Append(phase.Name);
            _ = report.Append('=');
            _ = report.Append(GC.GetAllocatedBytesForCurrentThread() - before);
            _ = report.Append(" B");
            _ = report.Append(outcome);
            _ = report.Append(';');
        }

        return report.ToString();
    }

    // A diagnostic phase reports its own byte claim; failures inside it are recorded, not
    // swallowed — the verdict is already failure and the report must show what happened.
    private static string RunPhase(Action run)
    {
        try
        {
            run();
            return string.Empty;
        }
        catch (Exception error)
        {
            return $" (threw {error.GetType().Name})";
        }
    }
}
