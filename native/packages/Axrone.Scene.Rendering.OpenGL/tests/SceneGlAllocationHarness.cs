namespace Axrone.Scene.Rendering.OpenGL.Tests;

using System.Runtime.ExceptionServices;

internal readonly record struct SceneGlGatePhase(string Name, Action Run);

internal static class SceneGlAllocationHarness
{
    internal const int Windows = 8;
    internal const int PrimePasses = 14;

    internal readonly record struct Outcome(int PrimePasses, int MeasuredWindows)
    {
        internal int TotalInvocations => PrimePasses + MeasuredWindows;
    }

    internal static Outcome AssertEveryWindowClean(
        Action workload,
        Action? betweenWindows,
        int windows,
        int primePasses,
        string label,
        SceneGlGatePhase[] diagnostics)
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

    private static string Diagnose(SceneGlGatePhase[] diagnostics)
    {
        if (diagnostics.Length == 0)
        {
            return string.Empty;
        }

        System.Text.StringBuilder report = new();
        _ = report.Append(" (gen0 collections ");
        _ = report.Append(GC.CollectionCount(0));
        _ = report.Append(';');
        foreach (SceneGlGatePhase phase in diagnostics)
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
