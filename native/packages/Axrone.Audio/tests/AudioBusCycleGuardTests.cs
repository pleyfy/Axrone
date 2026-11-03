namespace Axrone.Audio.Tests;

public sealed class AudioBusCycleGuardTests
{
    [Fact]
    public void Upsert_ClosingAnABPair_IsRejectedWithTypedCycleError()
    {
        using AudioSystem system = new(maxBuses: 32);
        AudioBusId a = new(20U);
        AudioBusId b = new(21U);
        system.Buses.Upsert(new AudioBusDefinition(a, AudioBusId.Master, 1.0f));
        system.Buses.Upsert(new AudioBusDefinition(b, AudioBusId.Master, 1.0f));

        Action upsert = () => system.Buses.Upsert(new AudioBusDefinition(b, a, 1.0f));
        upsert.Should().NotThrow();
        system.Buses.GetEffectiveGain(b).Should().Be(1.0f);

        Action closing = () => system.Buses.Upsert(new AudioBusDefinition(a, b, 1.0f));
        closing.Should().Throw<AudioBusCycleException>()
            .Which.Code.Should().Be("audio.bus-cycle");

        system.Buses.TryGetBus(a, out AudioBusState state).Should().BeTrue();
        state.ParentId.Should().Be(AudioBusId.Master);
    }

    [Fact]
    public void Upsert_ThreeNodeCycle_IsRejectedWithTypedCycleError()
    {
        using AudioSystem system = new(maxBuses: 32);
        AudioBusId a = new(20U);
        AudioBusId b = new(21U);
        AudioBusId c = new(22U);
        system.Buses.Upsert(new AudioBusDefinition(a, AudioBusId.Master, 1.0f));
        system.Buses.Upsert(new AudioBusDefinition(b, a, 0.5f));
        system.Buses.Upsert(new AudioBusDefinition(c, b, 0.25f));
        system.Buses.GetEffectiveGain(c).Should().Be(0.125f);

        Action rootDown = () => system.Buses.Upsert(new AudioBusDefinition(a, c, 1.0f));
        rootDown.Should().Throw<AudioBusCycleException>();

        Action middleDown = () => system.Buses.Upsert(new AudioBusDefinition(b, c, 0.5f));
        middleDown.Should().Throw<AudioBusCycleException>();

        system.Buses.GetEffectiveGain(c).Should().Be(0.125f);
    }

    [Fact]
    public void UpdateBus_ClosingAnABPair_IsRejectedAndKeepsPreviousParent()
    {
        using AudioSystem system = new(maxBuses: 32);
        AudioBusId a = new(20U);
        AudioBusId b = new(21U);
        system.Buses.Upsert(new AudioBusDefinition(a, AudioBusId.Master, 1.0f));
        system.Buses.Upsert(new AudioBusDefinition(b, AudioBusId.Master, 0.5f));

        Action update = () => system.Buses.UpdateBus(a, new AudioBusPatch(ParentId: b));
        update.Should().NotThrow();

        Action closing = () => system.Buses.UpdateBus(b, new AudioBusPatch(ParentId: a));
        closing.Should().Throw<AudioBusCycleException>();

        system.Buses.TryGetBus(b, out AudioBusState state).Should().BeTrue();
        state.ParentId.Should().Be(AudioBusId.Master);
    }

    [Fact]
    public void SelfParent_IsRejectedWithTypedCycleError()
    {
        using AudioSystem system = new(maxBuses: 32);
        AudioBusId a = new(20U);
        system.Buses.Upsert(new AudioBusDefinition(a, AudioBusId.Master, 0.5f));

        Action upsert = () => system.Buses.Upsert(new AudioBusDefinition(a, a, 0.5f));
        upsert.Should().Throw<AudioBusCycleException>();

        Action update = () => system.Buses.UpdateBus(a, new AudioBusPatch(ParentId: a));
        update.Should().Throw<AudioBusCycleException>();

        system.Buses.GetEffectiveGain(a).Should().Be(0.5f);
    }

    [Fact]
    public void DanglingParentPair_NeverOverflowsStack()
    {
        // Both orders of an A↔B pair through not-yet-registered parents leave
        // dangling parent ids the upsert guard cannot see. The entry-visited
        // mark in gain resolution must terminate instead of crashing the
        // process; this is the CRITICAL-1 stack-overflow regression.
        using AudioSystem system = new(maxBuses: 32);
        AudioBusId a = new(20U);
        AudioBusId b = new(21U);
        system.Buses.Upsert(new AudioBusDefinition(a, b, 1.0f));
        system.Buses.Upsert(new AudioBusDefinition(b, a, 0.5f));

        system.Buses.AdvanceClock(0.001);
        float gainA = system.Buses.GetEffectiveGain(a);
        float gainB = system.Buses.GetEffectiveGain(b);

        float[] block = new float[64];
        system.ProcessAudioRenderBlock(block);

        float.IsFinite(gainA).Should().BeTrue();
        float.IsFinite(gainB).Should().BeTrue();
    }

    [Fact]
    public void Upsert_LegitimateReparentToNonDescendant_IsAllowed()
    {
        using AudioSystem system = new(maxBuses: 32);
        AudioBusId a = new(20U);
        AudioBusId b = new(21U);
        AudioBusId child = new(22U);
        system.Buses.Upsert(new AudioBusDefinition(a, AudioBusId.Master, 0.5f));
        system.Buses.Upsert(new AudioBusDefinition(b, AudioBusId.Master, 1.0f));
        system.Buses.Upsert(new AudioBusDefinition(child, a, 1.0f));

        system.Buses.UpdateBus(child, new AudioBusPatch(ParentId: b));

        system.Buses.GetEffectiveGain(child).Should().Be(1.0f);
    }

    [Fact]
    public void DefaultHierarchyBus_CannotParentToItsOwnDescendant()
    {
        using AudioSystem system = new();

        Action upsert = () => system.Buses.Upsert(new AudioBusDefinition(AudioBusId.Master, AudioBusId.Ambient, 1.0f));
        upsert.Should().Throw<AudioBusCycleException>();

        system.Buses.GetEffectiveGain(AudioBusId.Master).Should().Be(1.0f);
        system.Buses.GetEffectiveGain(AudioBusId.Ambient).Should().Be(1.0f);
    }

    [Fact]
    public void Registry_DirectRemoveBus_RebindsSourcesAndVoicesThroughTheHook()
    {
        using AudioSystem system = new(maxBuses: 32, outputSampleRate: 48000);
        NativeAudioMemory memory = new(48000, 1, 480);
        memory.AsSpan().Fill(0.25f);
        AudioClipRecord record = new(new AudioClipId(30U), memory);
        system.Clips.Register(record);
        AudioBusId ui = AudioBusId.Ui;
        AudioSourceId source = new(40U);
        system.Sources.Upsert(source, new AudioSourceDefinition(BusId: ui, ClipId: new AudioClipId(30U), Loop: true));
        system.Sources.Play(source, new AudioSourcePlayRequest());

        // No facade involved: the registry hook must still rebind sources and
        // live voices so no dangling bus id survives the removal.
        system.Buses.RemoveBus(ui);

        system.Buses.GetEffectiveGain(ui).Should().Be(0.0f);
        system.Sources.TryGetDefinition(source, out AudioSourceDefinition definition).Should().BeTrue();
        definition.BusId.Should().Be(AudioBusId.Sfx);
        float[] block = new float[64];
        system.ProcessAudioRenderBlock(block);
        block.Sum(value => MathF.Abs(value)).Should().BeGreaterThan(0.0f);
        record.Dispose();
    }
}
