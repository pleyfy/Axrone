namespace Axrone.Audio.OpenAL.Tests;

using Xunit;

/// <summary>
/// Runs the test only when the default OpenAL device can be opened. The probe
/// runs once at discovery; an unavailable device produces a genuine skipped
/// test carrying the reason, never a green pass. Set
/// <c>AXRONE_FORCE_NO_AUDIO=reason</c> to exercise the skip path.
/// </summary>
public sealed class RealAudioDeviceFactAttribute : FactAttribute
{
    private static int s_reported;

    public RealAudioDeviceFactAttribute()
    {
        (bool available, string reason) = AudioDeviceProbe.Result;
        if (!available)
        {
            Skip = reason;
            if (Interlocked.Exchange(ref s_reported, 1) == 0)
            {
                Console.WriteLine($"[RealAudioDeviceFact] real audio validation skipped: {reason}");
            }
        }
    }
}

internal static class AudioDeviceProbe
{
    internal const string ForcedSkipVariable = "AXRONE_FORCE_NO_AUDIO";

    private static readonly Lazy<(bool Available, string Reason)> s_result = new(Probe);

    public static (bool Available, string Reason) Result => s_result.Value;

    private static (bool Available, string Reason) Probe()
    {
        string? forced = Environment.GetEnvironmentVariable(ForcedSkipVariable);
        if (!string.IsNullOrEmpty(forced))
        {
            return (false, $"Real audio validation disabled by {ForcedSkipVariable}='{forced}'.");
        }

        using var driver = new SilkAudioDriver();
        try
        {
            driver.Open(null, 48000);
            if (!driver.IsOpen)
            {
                return (false, "OpenAL returned no default device.");
            }
        }
        catch (Exception ex) when (ex is AudioDriverException or DllNotFoundException or EntryPointNotFoundException)
        {
            return (false, $"OpenAL device probe failed: {ex.Message}");
        }
        finally
        {
            driver.Close();
        }

        return (true, "Default OpenAL device available.");
    }
}
