namespace Axrone.Audio.OpenAL.Tests;

using System.Diagnostics;

/// <summary>
/// Real-device smoke tests: the default OpenAL device is probed at discovery
/// and an absent device reports the tests as skipped with a reason, never as
/// green. With a device they run the full upload/play/stop/teardown sequence.
/// Filter by Category=Hardware in CI.
/// </summary>
[Trait("Category", "Hardware")]
public sealed class OpenALHardwareSmokeTests
{
    private static readonly TimeSpan StartBudget = TimeSpan.FromMilliseconds(3000);

    private const int SampleRate = 48000;

    // Seconds of queued silence are deliberately long: the play/stop pair must catch the source
    // while it is still running, and a queue that drains during a slow device open would turn the
    // stop assertion into a check that playback ended on its own.
    private const int QueueLength = 4;

    private readonly ITestOutputHelper _output;

    public OpenALHardwareSmokeTests(ITestOutputHelper output) => _output = output;

    [RealAudioDeviceFact]
    public void Device_Open_Probe()
    {
        using var driver = new SilkAudioDriver();
        OpenOrExplainFailure(driver);
        _output.WriteLine("Audio device opened.");
        try
        {
            driver.IsOpen.Should().BeTrue();
        }
        finally
        {
            driver.Close();
        }

        driver.IsOpen.Should().BeFalse();
    }

    [RealAudioDeviceFact]
    public void Device_Play_Silence_Teardown()
    {
        using var driver = new SilkAudioDriver();
        OpenOrExplainFailure(driver);
        _output.WriteLine("Audio device opened; running full sequence.");

        try
        {
            uint[] buffers = driver.GenBuffers(QueueLength);
            uint source = driver.GenSource();

            short[] silence = new short[SampleRate];
            for (int i = 0; i < buffers.Length; i++)
            {
                driver.BufferDataShort(buffers[i], silence, SampleRate);
            }

            driver.QueueBuffers(source, buffers);
            driver.Play(source);
            WaitUntilPlaying(driver, source);

            driver.StopPlayback(source);
            driver.GetSourceState(source).Should().Be(AudioDriverSourceState.Stopped);

            uint[] scratch = new uint[4];
            driver.UnqueueProcessed(source, scratch);
            driver.DeleteSource(source);
            driver.DeleteBuffers(buffers);
        }
        finally
        {
            driver.Close();
        }
    }

    private static void OpenOrExplainFailure(SilkAudioDriver driver)
    {
        try
        {
            driver.Open(null, 48000);
        }
        catch (Exception ex) when (ex is AudioDriverException or DllNotFoundException or EntryPointNotFoundException)
        {
            throw new InvalidOperationException(
                $"RealAudioDeviceFact saw an audio device at discovery, but opening it failed at run time: {ex.Message}",
                ex);
        }

        driver.IsOpen.Should().BeTrue(
            "the discovery probe reported a device; a runtime open failure is a regression, not a vacuous pass");
    }

    private static void WaitUntilPlaying(SilkAudioDriver driver, uint source)
    {
        SpinWait spin = default;
        Stopwatch watch = Stopwatch.StartNew();
        AudioDriverSourceState state = driver.GetSourceState(source);
        AudioDriverSourceState first = state;
        while (state != AudioDriverSourceState.Playing && watch.Elapsed < StartBudget)
        {
            spin.SpinOnce();
            state = driver.GetSourceState(source);
        }

        int processed = driver.PeekProcessedBufferCount(source);
        state.Should().Be(
            AudioDriverSourceState.Playing,
            "alSourcePlay is asynchronous and the audio thread must start the source: expected Playing, " +
            "first saw {0}, final saw {1} after {2:F0} ms of the {3} startup budget " +
            "(processed buffers {4}, source {5}, device open {6})",
            first, state, watch.Elapsed.TotalMilliseconds, StartBudget, processed, source, driver.IsOpen);
    }
}
