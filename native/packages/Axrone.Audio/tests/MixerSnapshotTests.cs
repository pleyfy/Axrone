namespace Axrone.Audio.Tests;

public sealed class MixerSnapshotTests
{
    private static readonly Lock SequenceGate = new();

    [Fact]
    public void Capture_DefaultHierarchy_RecordsEveryActiveBusWithTopology()
    {
        using AudioSystem system = new();

        AudioMixerSnapshot snapshot = system.CaptureMixerSnapshot();

        snapshot.BusCount.Should().Be(8);
        snapshot.Id.IsValid.Should().BeTrue();
        snapshot.CapturedAtSeconds.Should().Be(0.0);
        snapshot.TryGetEntry(AudioBusId.Ambient, out AudioMixerSnapshotEntry ambient).Should().BeTrue();
        ambient.ParentId.Should().Be(AudioBusId.Music);
        ambient.Volume.Should().Be(1.0f);
        ambient.EffectiveGain.Should().Be(1.0f);
        snapshot.TryGetEntry(AudioBusId.Master, out AudioMixerSnapshotEntry master).Should().BeTrue();
        master.ParentId.Should().Be(AudioBusId.Invalid);
    }

    [Fact]
    public void Capture_RecordsCommittedGainsAndMutes()
    {
        using AudioSystem system = new();
        system.Buses.Upsert(new AudioBusDefinition(AudioBusId.Music, AudioBusId.Master, 0.5f));
        system.Buses.Upsert(new AudioBusDefinition(AudioBusId.Sfx, AudioBusId.Master, 1.0f, true));

        AudioMixerSnapshot snapshot = system.CaptureMixerSnapshot();

        snapshot.TryGetEntry(AudioBusId.Ambient, out AudioMixerSnapshotEntry ambient).Should().BeTrue();
        ambient.EffectiveGain.Should().Be(0.5f);
        snapshot.TryGetEntry(AudioBusId.Sfx, out AudioMixerSnapshotEntry sfx).Should().BeTrue();
        sfx.Mute.Should().BeTrue();
        sfx.EffectiveGain.Should().Be(0.0f);
    }

    [Fact]
    public void Apply_ZeroDuration_CommitsImmediately()
    {
        using AudioSystem system = new();
        AudioMixerSnapshot snapshot = system.CaptureMixerSnapshot();
        system.Buses.Upsert(new AudioBusDefinition(AudioBusId.Master, AudioBusId.Invalid, 0.25f));

        AudioSnapshotApplyResult result = system.ApplyMixerSnapshot(snapshot, durationSeconds: 0.0);

        result.IsComplete.Should().BeTrue();
        result.AppliedCount.Should().Be(8);
        result.SkippedCount.Should().Be(0);
        system.Buses.GetEffectiveGain(AudioBusId.Master).Should().Be(1.0f);
        system.Buses.PendingRampCount.Should().Be(0);
    }

    [Fact]
    public void Apply_LinearRamp_InterpolatesExactlyOnTheClock()
    {
        using AudioSystem system = new();
        AudioMixerSnapshot snapshot = system.CaptureMixerSnapshot();
        system.Buses.Upsert(new AudioBusDefinition(AudioBusId.Master, AudioBusId.Invalid, 0.0f));

        system.ApplyMixerSnapshot(snapshot, atTime: 0.0, durationSeconds: 1.0);
        system.Buses.PendingRampCount.Should().Be(8);

        system.AdvanceMixerClock(0.25);
        system.Buses.GetEffectiveGain(AudioBusId.Master).Should().Be(0.25f);

        system.AdvanceMixerClock(0.25);
        system.Buses.GetEffectiveGain(AudioBusId.Master).Should().Be(0.5f);

        system.AdvanceMixerClock(0.25);
        system.Buses.GetEffectiveGain(AudioBusId.Master).Should().Be(0.75f);

        system.AdvanceMixerClock(0.25);
        system.Buses.GetEffectiveGain(AudioBusId.Master).Should().Be(1.0f);
        system.Buses.PendingRampCount.Should().Be(0);
    }

    [Fact]
    public void Apply_HoldsCurrentValueBeforeAtTime()
    {
        using AudioSystem system = new();
        AudioMixerSnapshot snapshot = system.CaptureMixerSnapshot();
        system.Buses.Upsert(new AudioBusDefinition(AudioBusId.Master, AudioBusId.Invalid, 0.0f));

        system.ApplyMixerSnapshot(snapshot, atTime: 0.5, durationSeconds: 1.0);
        system.AdvanceMixerClock(0.25);

        system.Buses.GetEffectiveGain(AudioBusId.Master).Should().Be(0.0f);
        system.Buses.PendingRampCount.Should().Be(8);

        system.AdvanceMixerClock(0.25);
        system.Buses.GetEffectiveGain(AudioBusId.Master).Should().Be(0.0f);

        system.AdvanceMixerClock(0.5);
        system.Buses.GetEffectiveGain(AudioBusId.Master).Should().Be(0.5f);
    }

    [Fact]
    public void Apply_ExponentialCurve_MatchesGeometricProgress()
    {
        using AudioSystem system = new();
        system.Buses.Upsert(new AudioBusDefinition(AudioBusId.Master, AudioBusId.Invalid, 1.0f));
        AudioMixerSnapshot snapshot = system.CaptureMixerSnapshot();
        system.Buses.Upsert(new AudioBusDefinition(AudioBusId.Master, AudioBusId.Invalid, 0.1f));

        system.ApplyMixerSnapshot(snapshot, atTime: 0.0, durationSeconds: 1.0, curve: MixerRampCurve.Exponential);
        system.AdvanceMixerClock(0.5);

        system.Buses.GetEffectiveGain(AudioBusId.Master).Should().BeApproximately(0.1f * MathF.Pow(10.0f, 0.5f), 1e-6f);
    }

    [Fact]
    public void Apply_CompletionWritesTheExactCapturedTarget()
    {
        using AudioSystem system = new();
        AudioMixerSnapshot snapshot = system.CaptureMixerSnapshot();
        system.Buses.Upsert(new AudioBusDefinition(AudioBusId.Soundtrack, AudioBusId.Music, 0.3333333f, false, 0.1111111f));

        system.ApplyMixerSnapshot(snapshot, atTime: 0.0, durationSeconds: 0.9);
        system.AdvanceMixerClock(0.4);
        system.AdvanceMixerClock(0.5);

        system.Buses.TryGetBus(AudioBusId.Soundtrack, out AudioBusState state).Should().BeTrue();
        state.Volume.Should().Be(1.0f);
        state.Pan.Should().Be(0.0f);
    }

    [Fact]
    public void Apply_UnknownBus_IsSkippedAndReported_NotCreated()
    {
        using AudioSystem system = new();
        AudioMixerSnapshot snapshot = system.CaptureMixerSnapshot();
        system.RemoveBus(AudioBusId.Ui);

        AudioSnapshotApplyResult result = system.ApplyMixerSnapshot(snapshot, durationSeconds: 0.0);

        result.IsComplete.Should().BeFalse();
        result.SkippedCount.Should().Be(1);
        result.AppliedCount.Should().Be(7);
        system.Buses.TryGetBus(AudioBusId.Ui, out _).Should().BeFalse();
    }

    [Fact]
    public void Apply_RestoresTopologyWhenTheParentStillExists()
    {
        using AudioSystem system = new();
        AudioMixerSnapshot snapshot = system.CaptureMixerSnapshot();
        system.Buses.Upsert(new AudioBusDefinition(AudioBusId.Ambient, AudioBusId.Sfx, 1.0f));

        AudioSnapshotApplyResult result = system.ApplyMixerSnapshot(snapshot, durationSeconds: 0.0);

        result.TopologyRestoredCount.Should().Be(1);
        system.Buses.TryGetBus(AudioBusId.Ambient, out AudioBusState state).Should().BeTrue();
        state.ParentId.Should().Be(AudioBusId.Music);
    }

    [Fact]
    public void Apply_KeepsCurrentParentWhenCapturedParentIsGone()
    {
        using AudioSystem system = new();
        AudioMixerSnapshot snapshot = system.CaptureMixerSnapshot();
        system.RemoveBus(AudioBusId.Music);

        system.Buses.TryGetBus(AudioBusId.Ambient, out AudioBusState before).Should().BeTrue();
        before.ParentId.Should().Be(AudioBusId.Master);

        AudioSnapshotApplyResult result = system.ApplyMixerSnapshot(snapshot, durationSeconds: 0.0);

        result.TopologyRestoredCount.Should().Be(0);
        system.Buses.TryGetBus(AudioBusId.Ambient, out AudioBusState after).Should().BeTrue();
        after.ParentId.Should().Be(AudioBusId.Master);
    }

    [Fact]
    public void Apply_MuteTarget_IsAppliedWhenTheRampStarts()
    {
        using AudioSystem system = new();
        AudioMixerSnapshot unmuted = system.CaptureMixerSnapshot();
        system.Buses.Upsert(new AudioBusDefinition(AudioBusId.Master, AudioBusId.Invalid, 1.0f, true));
        system.Buses.GetEffectiveGain(AudioBusId.Master).Should().Be(0.0f);

        system.ApplyMixerSnapshot(unmuted, atTime: 0.5, durationSeconds: 1.0);
        system.AdvanceMixerClock(0.25);
        system.Buses.GetEffectiveGain(AudioBusId.Master).Should().Be(0.0f);

        system.AdvanceMixerClock(0.25);
        system.Buses.GetEffectiveGain(AudioBusId.Master).Should().Be(1.0f);
    }

    [Fact]
    public void Upsert_CancelsThePendingRampForThatBus()
    {
        using AudioSystem system = new();
        AudioMixerSnapshot snapshot = system.CaptureMixerSnapshot();
        system.Buses.Upsert(new AudioBusDefinition(AudioBusId.Master, AudioBusId.Invalid, 0.0f));
        system.ApplyMixerSnapshot(snapshot, atTime: 0.0, durationSeconds: 1.0);

        system.AdvanceMixerClock(0.25);
        system.Buses.Upsert(new AudioBusDefinition(AudioBusId.Sfx, AudioBusId.Master, 0.4f));
        system.AdvanceMixerClock(0.25);

        system.Buses.TryGetBus(AudioBusId.Sfx, out AudioBusState sfx).Should().BeTrue();
        sfx.Volume.Should().Be(0.4f);
        sfx.EffectiveGain.Should().Be(0.2f);
        system.Buses.GetEffectiveGain(AudioBusId.Master).Should().Be(0.5f);
    }

    [Fact]
    public void AdvanceClock_WithInvalidTime_IsTypedError()
    {
        using AudioSystem system = new();

        Action negative = () => system.AdvanceMixerClock(-0.1);
        Action nonFinite = () => system.AdvanceMixerClock(double.PositiveInfinity);

        negative.Should().Throw<AudioConfigurationException>().Which.Code.Should().Be("audio.invalid-time");
        nonFinite.Should().Throw<AudioConfigurationException>();
    }

    [Fact]
    public void Apply_WithInvalidSchedule_IsTypedError()
    {
        using AudioSystem system = new();
        AudioMixerSnapshot snapshot = system.CaptureMixerSnapshot();

        Action negativeAt = () => system.ApplyMixerSnapshot(snapshot, atTime: -1.0, durationSeconds: 1.0);
        Action negativeDuration = () => system.ApplyMixerSnapshot(snapshot, atTime: 0.0, durationSeconds: -1.0);

        negativeAt.Should().Throw<AudioConfigurationException>().Which.Code.Should().Be("audio.invalid-time");
        negativeDuration.Should().Throw<AudioConfigurationException>().Which.Code.Should().Be("audio.invalid-time");
    }

    [Fact]
    public void RenderedFrames_DriveTheMixerClock()
    {
        using AudioSystem system = new(outputSampleRate: 48000);
        float[] block = new float[960];

        system.ProcessAudioRenderBlock(block);
        system.ProcessAudioRenderBlock(block);

        system.MixerClockSeconds.Should().BeApproximately(0.02, 1e-12);
    }

    [Fact]
    public void SuspendedSystem_DoesNotAdvanceTheClock()
    {
        using AudioSystem system = new(outputSampleRate: 48000);
        system.Suspend();

        system.ProcessAudioRenderBlock(new float[960]);

        system.MixerClockSeconds.Should().Be(0.0);
    }

    [Fact]
    public void Restore_IsDeterministic_ForTheSameClockSequence()
    {
        float[] first = RunSequence();
        float[] second = RunSequence();

        first.Should().Equal(second);
    }

    [Fact]
    public void Apply_CountsSnapshotOperations_AndNotifiesObservers()
    {
        using AudioSystem system = new();
        RecordingObserver observer = new();
        system.Observability.Subscribe(observer);

        AudioMixerSnapshot snapshot = system.CaptureMixerSnapshot();
        system.ApplyMixerSnapshot(snapshot, atTime: 0.0, durationSeconds: 0.5);

        system.Counters.SnapshotOperationCount.Should().BeGreaterThanOrEqualTo(2);
        observer.Types.Should().Contain(AudioEventType.SnapshotCaptured);
        observer.Types.Should().Contain(AudioEventType.SnapshotRestored);
        system.Observability.Unsubscribe(observer);
    }

    [Fact]
    public void Capture_WithExplicitInvalidId_IsTypedError()
    {
        using AudioSystem system = new();

        Action capture = () => system.Buses.CaptureMixerSnapshot(AudioSnapshotId.Invalid);

        capture.Should().Throw<AudioConfigurationException>().Which.Code.Should().Be("audio.invalid-snapshot");
    }

    [Fact]
    public void Capture_WithExplicitId_UsesIt()
    {
        using AudioSystem system = new();

        AudioMixerSnapshot snapshot = system.Buses.CaptureMixerSnapshot(new AudioSnapshotId(42U));

        snapshot.Id.Should().Be(new AudioSnapshotId(42U));
    }

    [Fact]
    public void Apply_OverFullRampCycle_TerminatesAndKeepsGainsFinite()
    {
        // Cyclic topologies can no longer be built through the guarded upsert
        // path (see AudioBusCycleGuardTests); this pins the ramp semantics
        // over a full clock cycle instead.
        using AudioSystem system = new(maxBuses: 32);
        AudioBusId a = new(20U);
        system.Buses.Upsert(new AudioBusDefinition(a, AudioBusId.Master, 1.0f));

        AudioMixerSnapshot snapshot = system.CaptureMixerSnapshot();
        system.Buses.Upsert(new AudioBusDefinition(a, AudioBusId.Master, 0.2f));
        system.ApplyMixerSnapshot(snapshot, atTime: 0.0, durationSeconds: 1.0);
        system.AdvanceMixerClock(0.5);

        system.Buses.GetEffectiveGain(a).Should().Be(0.6f);
        system.AdvanceMixerClock(0.5);
        system.Buses.GetEffectiveGain(a).Should().Be(1.0f);
        system.Buses.PendingRampCount.Should().Be(0);
    }

    private static float[] RunSequence()
    {
        lock (SequenceGate)
        {
            using AudioSystem system = new(outputSampleRate: 48000);
            AudioMixerSnapshot snapshot = system.CaptureMixerSnapshot();
            foreach (AudioMixerSnapshotEntry entry in snapshot.Entries)
            {
                system.Buses.Upsert(new AudioBusDefinition(entry.Id, entry.ParentId, 0.0f, false, 0.0f));
            }

            system.ApplyMixerSnapshot(snapshot, atTime: 0.0, durationSeconds: 0.5);

            float[] observed = new float[5];
            for (int i = 0; i < 5; i++)
            {
                system.AdvanceMixerClock(0.1);
                observed[i] = system.Buses.GetEffectiveGain(AudioBusId.Ambient);
            }

            return observed;
        }
    }

    private sealed class RecordingObserver : IAudioEventListener
    {
        public List<AudioEventType> Types { get; } = [];

        public void OnAudioEvent(in AudioRuntimeEvent ev) => Types.Add(ev.Type);
    }
}
