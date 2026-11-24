namespace Axrone.Event;

/// <summary>How an <see cref="EventBus"/> moves envelopes from transport to subscribers.</summary>
public enum EventDispatchMode : byte
{
    /// <summary>
    /// A dedicated worker thread drains continuously. The default, and the only mode that keeps
    /// working for hosts that never call <see cref="EventBus.Pump(int)"/>.
    /// </summary>
    Background = 0,

    /// <summary>
    /// No worker thread is created. The owning loop calls <see cref="EventBus.Pump(int)"/> once per
    /// frame, so dispatch is deterministic and shares the frame's clock and thread.
    /// </summary>
    FrameDriven = 1,
}
