namespace Axrone.Event;

/// <summary>Forwarding policy: hop bound and source-subscription priority.</summary>
/// <param name="MaxHops">Maximum forwarding hops before an envelope is dead-lettered.</param>
/// <param name="Priority">Priority of the forwarder subscription on the source router.</param>
public readonly record struct EventForwardingOptions(int MaxHops, EventPriority Priority)
{
    /// <summary>Eight hops, normal subscription priority.</summary>
    public static EventForwardingOptions Default => new(8, EventPriority.Normal);
}
