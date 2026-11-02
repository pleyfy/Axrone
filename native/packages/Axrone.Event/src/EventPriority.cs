namespace Axrone.Event;

/// <summary>
/// Dispatch priority. Lower values run first; subscribers sharing a priority run in
/// registration order.
/// </summary>
public enum EventPriority : byte
{
    /// <summary>Runs before normal and low subscribers.</summary>
    High = 0,

    /// <summary>Default priority.</summary>
    Normal = 1,

    /// <summary>Runs after high and normal subscribers.</summary>
    Low = 2
}

/// <summary>Validates priority values crossing the public API.</summary>
internal static class EventPriorityGuard
{
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void Validate(EventPriority priority)
    {
        if ((uint)priority > (uint)EventPriority.Low)
        {
            ThrowHelper.ThrowArgumentOutOfRange(
                nameof(priority),
                "Priority must be High, Normal or Low.");
        }
    }
}
