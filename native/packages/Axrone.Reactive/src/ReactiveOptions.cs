namespace Axrone.Reactive;

using System.Runtime.InteropServices;

public enum ObservationErrorHandling
{
    Throw,
    Silent,
    Callback,
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct ObservationBufferOptions
{
    public readonly bool Enabled;
    public readonly int MaxSize;
    public readonly int FlushIntervalMs;

    public ObservationBufferOptions(bool enabled, int maxSize = 100, int flushIntervalMs = 1000)
    {
        Enabled = enabled;
        MaxSize = maxSize;
        FlushIntervalMs = flushIntervalMs;
    }

    public static ObservationBufferOptions Default => new(false, 100, 1000);

    public ObservationBufferOptions Normalize() => new(
        Enabled,
        MaxSize >= 1 ? MaxSize : 100,
        FlushIntervalMs >= 1 ? FlushIntervalMs : 1000);
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct ObservationReplayOptions
{
    public readonly bool Enabled;
    public readonly int BufferSize;

    public ObservationReplayOptions(bool enabled, int bufferSize = 10)
    {
        Enabled = enabled;
        BufferSize = bufferSize;
    }

    public static ObservationReplayOptions Default => new(false, 10);

    public ObservationReplayOptions Normalize() => new(Enabled, BufferSize >= 1 ? BufferSize : 10);
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct ObservationOptions
{
    public readonly ObservationPriority Priority;
    public readonly bool Once;
    public readonly int DebounceMs;
    public readonly int ThrottleMs;
    public readonly ObservationBufferOptions Buffering;
    public readonly ObservationReplayOptions Replay;
    public readonly bool WeakReference;
    public readonly ObservationErrorHandling ErrorHandling;
    public readonly Action<Exception>? OnError;

    public ObservationOptions(
        ObservationPriority priority = ObservationPriority.Normal,
        bool once = false,
        int debounceMs = 0,
        int throttleMs = 0,
        ObservationBufferOptions buffering = default,
        ObservationReplayOptions replay = default,
        bool weakReference = false,
        ObservationErrorHandling errorHandling = ObservationErrorHandling.Throw,
        Action<Exception>? onError = null)
    {
        Priority = priority;
        Once = once;
        DebounceMs = debounceMs;
        ThrottleMs = throttleMs;
        Buffering = buffering;
        Replay = replay;
        WeakReference = weakReference;
        ErrorHandling = errorHandling;
        OnError = onError;
    }

    public static ObservationOptions Default => new(
        ObservationPriority.Normal,
        false,
        0,
        0,
        ObservationBufferOptions.Default,
        ObservationReplayOptions.Default,
        false,
        ObservationErrorHandling.Throw);

    public ObservationOptions Normalize() => new(
        (uint)Priority <= (uint)ObservationPriority.Low ? Priority : ObservationPriority.Normal,
        Once,
        DebounceMs >= 0 ? DebounceMs : 0,
        ThrottleMs >= 0 ? ThrottleMs : 0,
        Buffering.Normalize(),
        Replay.Normalize(),
        WeakReference,
        (uint)ErrorHandling <= (uint)ObservationErrorHandling.Callback ? ErrorHandling : ObservationErrorHandling.Throw,
        OnError);

    public static ObservationOptions Merge(in ObservationOptions baseOptions, in ObservationOptions overrides) => new(
        overrides.Priority == ObservationPriority.Normal ? baseOptions.Priority : overrides.Priority,
        overrides.Once || baseOptions.Once,
        overrides.DebounceMs > 0 ? overrides.DebounceMs : baseOptions.DebounceMs,
        overrides.ThrottleMs > 0 ? overrides.ThrottleMs : baseOptions.ThrottleMs,
        MergeBuffer(baseOptions.Buffering, overrides.Buffering),
        MergeReplay(baseOptions.Replay, overrides.Replay),
        overrides.WeakReference || baseOptions.WeakReference,
        overrides.ErrorHandling != ObservationErrorHandling.Throw ? overrides.ErrorHandling : baseOptions.ErrorHandling,
        overrides.OnError ?? baseOptions.OnError);

    internal static ObservationBufferOptions MergeBuffer(in ObservationBufferOptions baseOptions, in ObservationBufferOptions overrides) => new(
        overrides.Enabled || baseOptions.Enabled,
        overrides.MaxSize > 0 ? overrides.MaxSize : baseOptions.MaxSize,
        overrides.FlushIntervalMs > 0 ? overrides.FlushIntervalMs : baseOptions.FlushIntervalMs);

    internal static ObservationReplayOptions MergeReplay(in ObservationReplayOptions baseOptions, in ObservationReplayOptions overrides) => new(
        overrides.Enabled || baseOptions.Enabled,
        overrides.BufferSize > 0 ? overrides.BufferSize : baseOptions.BufferSize);
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SubjectMemoryOptions
{
    public readonly bool Enabled;
    public readonly int GcIntervalMs;
    public readonly bool WeakReferences;

    public SubjectMemoryOptions(bool enabled = true, int gcIntervalMs = 60000, bool weakReferences = false)
    {
        Enabled = enabled;
        GcIntervalMs = gcIntervalMs;
        WeakReferences = weakReferences;
    }

    public static SubjectMemoryOptions Default => new(true, 60000, false);

    public SubjectMemoryOptions Normalize() => new(
        Enabled,
        GcIntervalMs >= 0 ? GcIntervalMs : 60000,
        WeakReferences);
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SubjectReplayOptions
{
    public readonly bool Enabled;
    public readonly int BufferSize;

    public SubjectReplayOptions(bool enabled = false, int bufferSize = 10)
    {
        Enabled = enabled;
        BufferSize = bufferSize;
    }

    public static SubjectReplayOptions Default => new(false, 10);

    public SubjectReplayOptions Normalize() => new(Enabled, BufferSize >= 1 ? BufferSize : 10);
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SubjectConcurrencyOptions
{
    public readonly bool Enabled;
    public readonly int MaxConcurrent;

    public SubjectConcurrencyOptions(bool enabled = true, int maxConcurrent = 10)
    {
        Enabled = enabled;
        MaxConcurrent = maxConcurrent;
    }

    public static SubjectConcurrencyOptions Default => new(true, 10);

    public SubjectConcurrencyOptions Normalize() => new(Enabled, MaxConcurrent >= 1 ? MaxConcurrent : 10);
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SubjectOptions
{
    public readonly int MaxObservers;
    public readonly bool AutoComplete;
    public readonly bool ErrorPropagation;
    public readonly SubjectMemoryOptions MemoryManagement;
    public readonly SubjectReplayOptions Replay;
    public readonly SubjectConcurrencyOptions Concurrency;

    public SubjectOptions(
        int maxObservers = 100,
        bool autoComplete = false,
        bool errorPropagation = true,
        SubjectMemoryOptions memoryManagement = default,
        SubjectReplayOptions replay = default,
        SubjectConcurrencyOptions concurrency = default)
    {
        MaxObservers = maxObservers;
        AutoComplete = autoComplete;
        ErrorPropagation = errorPropagation;
        MemoryManagement = memoryManagement;
        Replay = replay;
        Concurrency = concurrency;
    }

    public static SubjectOptions Default => new(
        100,
        false,
        true,
        SubjectMemoryOptions.Default,
        SubjectReplayOptions.Default,
        SubjectConcurrencyOptions.Default);

    public SubjectOptions Normalize() => new(
        MaxObservers >= 1 ? MaxObservers : 100,
        AutoComplete,
        ErrorPropagation,
        MemoryManagement.Normalize(),
        Replay.Normalize(),
        Concurrency.Normalize());

    public static SubjectOptions Merge(in SubjectOptions baseOptions, in SubjectOptions overrides) => new(
        overrides.MaxObservers > 0 ? overrides.MaxObservers : baseOptions.MaxObservers,
        overrides.AutoComplete || baseOptions.AutoComplete,
        overrides.ErrorPropagation,
        new SubjectMemoryOptions(
            overrides.MemoryManagement.Enabled || baseOptions.MemoryManagement.Enabled,
            overrides.MemoryManagement.GcIntervalMs > 0
                ? overrides.MemoryManagement.GcIntervalMs
                : baseOptions.MemoryManagement.GcIntervalMs,
            overrides.MemoryManagement.WeakReferences || baseOptions.MemoryManagement.WeakReferences),
        new SubjectReplayOptions(
            overrides.Replay.Enabled || baseOptions.Replay.Enabled,
            overrides.Replay.BufferSize > 0 ? overrides.Replay.BufferSize : baseOptions.Replay.BufferSize),
        new SubjectConcurrencyOptions(
            overrides.Concurrency.Enabled || baseOptions.Concurrency.Enabled,
            overrides.Concurrency.MaxConcurrent > 0
                ? overrides.Concurrency.MaxConcurrent
                : baseOptions.Concurrency.MaxConcurrent));
}
