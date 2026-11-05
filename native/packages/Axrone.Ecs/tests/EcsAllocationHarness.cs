namespace Axrone.Ecs.Tests;

using System.Runtime.ExceptionServices;

/// <summary>Shared zero-allocation gate: every measured window must claim exactly zero bytes.</summary>
internal static class EcsAllocationHarness
{
    internal const int Windows = 8;
    internal const int PrimePasses = 14;

    internal static void AssertEveryWindowClean(
        Action workload,
        Action? betweenWindows,
        int windows,
        int primePasses,
        string label)
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
                        // counter being watched. The predicate itself is unchanged.
                        if (delta != 0L)
                        {
                            Assert.Fail(
                                $"window {window}: the {label} hot path must allocate zero bytes on the " +
                                $"measured thread, but claimed {delta} B");
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
    }
}
