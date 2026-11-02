namespace Axrone.Ui.Testing.OpenGL;

using Xunit;

/// <summary>
/// Runs the test only when a real OpenGL 3.3+ context can be created. The probe runs once at
/// test discovery; an unavailable device produces a genuine skipped test carrying the reason,
/// never a green pass. Set <c>AXRONE_FORCE_NO_GL=reason</c> to exercise the skip path.
/// </summary>
public sealed class RealGpuFactAttribute : FactAttribute
{
    private static int s_reported;

    public RealGpuFactAttribute()
    {
        (bool available, string reason) = GlDeviceProbe.Result;
        if (!available)
        {
            Skip = reason;
            if (Interlocked.Exchange(ref s_reported, 1) == 0)
            {
                Console.WriteLine($"[RealGpuFact] real GL validation skipped: {reason}");
            }
        }
    }
}

internal static class GlDeviceProbe
{
    private static readonly Lazy<(bool Available, string Reason)> s_result =
        new(Probe, LazyThreadSafetyMode.ExecutionAndPublication);

    public static (bool Available, string Reason) Result => s_result.Value;

    private static (bool Available, string Reason) Probe()
    {
        string? forced = Environment.GetEnvironmentVariable(GlHarnessDevice.ForcedSkipVariable);
        if (!string.IsNullOrEmpty(forced))
        {
            return (false, $"Real GL validation disabled by {GlHarnessDevice.ForcedSkipVariable}='{forced}'.");
        }

        if (!GlHarnessDevice.TryCreate(out GlHarnessDevice? device, out string reason))
        {
            return (false, reason);
        }

        string description = device!.Description;
        device.Dispose();
        return (true, description);
    }
}
