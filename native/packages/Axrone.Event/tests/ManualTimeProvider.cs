namespace Axrone.Event.Tests;

internal sealed class ManualTimeProvider : TimeProvider
{
    private long _utcTicks;

    public ManualTimeProvider(DateTimeOffset start) => _utcTicks = start.UtcTicks;

    public override DateTimeOffset GetUtcNow() =>
        new(Volatile.Read(ref _utcTicks), TimeSpan.Zero);

    public void Advance(TimeSpan delta) => AdvanceTicks(delta.Ticks);

    public void AdvanceTicks(long ticks) => Interlocked.Add(ref _utcTicks, ticks);
}
