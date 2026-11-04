namespace Axrone.Audio;

/// <summary>
/// Coded audio error.
/// </summary>
public class AudioException(string code, string message, Exception? innerException = null) : Exception(message, innerException)
{
    /// <summary>Machine-readable code.</summary>
    public string Code { get; } = code;
}

/// <summary>
/// Invalid audio configuration.
/// </summary>
public sealed class AudioConfigurationException(string code, string message, Exception? innerException = null) : AudioException(code, message, innerException);

/// <summary>
/// Illegal audio lifecycle transition.
/// </summary>
public sealed class AudioLifecycleException(string message) : AudioException("audio.state-fault", message);

/// <summary>
/// Use after audio disposal.
/// </summary>
public sealed class AudioDisposedException(string entity)
    : AudioException("audio.disposed", $"Target '{entity}' is already disposed.");

/// <summary>
/// Unknown or invalid bus.
/// </summary>
public sealed class AudioBusException(AudioBusId busId, string message)
    : AudioException("audio.invalid-bus", message)
{
    /// <summary>Offending bus.</summary>
    public AudioBusId BusId { get; } = busId;
}

/// <summary>
/// Hierarchy write that would create a parent cycle. Cycles make gain
/// resolution recurse without bound, so they are rejected before commit.
/// </summary>
public sealed class AudioBusCycleException(AudioBusId busId, AudioBusId parentId)
    : AudioException("audio.bus-cycle", $"Bus '{busId}' cannot take parent '{parentId}': the parent is reachable from the bus, which would form a cycle.")
{
    /// <summary>Offending bus.</summary>
    public AudioBusId BusId { get; } = busId;

    /// <summary>Rejected parent.</summary>
    public AudioBusId ParentId { get; } = parentId;
}

/// <summary>
/// Unknown or invalid source.
/// </summary>
public sealed class AudioSourceException(AudioSourceId sourceId, string message)
    : AudioException("audio.invalid-source", message)
{
    /// <summary>Offending source.</summary>
    public AudioSourceId SourceId { get; } = sourceId;
}

/// <summary>
/// Unknown or invalid listener.
/// </summary>
public sealed class AudioListenerException(AudioListenerId listenerId, string message)
    : AudioException("audio.invalid-listener", message)
{
    /// <summary>Offending listener.</summary>
    public AudioListenerId ListenerId { get; } = listenerId;
}

/// <summary>
/// Invalid clip or asset.
/// </summary>
public sealed class AudioAssetException(string message) : AudioException("audio.invalid-clip", message);

/// <summary>
/// Output driver failure.
/// </summary>
public sealed class AudioDriverException(string operation, string detail)
    : AudioException("audio.driver-failure", $"{operation} failed: {detail}")
{
    /// <summary>Failing operation.</summary>
    public string Operation { get; } = operation;
}

/// <summary>
/// Centralized audio throw helpers; throwing paths stay out of hot methods.
/// </summary>
internal static class AudioThrowHelper
{
    /// <summary>Throws when an audio object is used after disposal.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowDisposed(string entity) => throw new AudioDisposedException(entity);

    /// <summary>Throws an audio configuration error.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowConfig(string code, string message) => throw new AudioConfigurationException(code, message);

    /// <summary>Throws an audio lifecycle error.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowLifecycle(string message) => throw new AudioLifecycleException(message);

    /// <summary>Throws an audio bus error.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowBus(AudioBusId id, string message) => throw new AudioBusException(id, message);

    /// <summary>Throws an audio source error.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowSource(AudioSourceId id, string message) => throw new AudioSourceException(id, message);

    /// <summary>Throws an audio listener error.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowListener(AudioListenerId id, string message) => throw new AudioListenerException(id, message);

    /// <summary>Throws an audio asset error.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowAsset(string message) => throw new AudioAssetException(message);

    /// <summary>Throws an audio driver error.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowDriver(string operation, string detail) => throw new AudioDriverException(operation, detail);
}
