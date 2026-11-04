namespace Axrone.Memory.Lifetime;

/// <summary>
/// Static monotonic accessor over a lease-tracked singleton engine. The wrapped engine
/// is created once per closed generic type and the instance it publishes never regresses:
/// once initialized, the Instance property keeps returning the same
/// reference for the lifetime of the process.
/// </summary>
/// <typeparam name="T">The singleton instance type.</typeparam>
/// <typeparam name="TFactory">The factory struct that produces instances.</typeparam>
public static class StaticSingleton<T, TFactory>
    where T : class
    where TFactory : struct, ISingletonFactory<T>
{
    private static readonly Singleton<T, TFactory, AdaptiveBackoff, NullDiagnostics> s_engine = new();

    /// <summary>Gets the underlying engine instance.</summary>
    public static Singleton<T, TFactory, AdaptiveBackoff, NullDiagnostics> Engine => s_engine;

    /// <summary>
    /// Gets the published instance, lazily initializing it on first access. The returned
    /// reference is stable: every call returns the same object until the engine is drained
    /// or disposed.
    /// </summary>
    /// <returns>The published instance.</returns>
    public static T Instance => s_engine.Instance;

    /// <summary>
    /// Acquires a lease against the instance.
    /// </summary>
    /// <returns>The acquired lease.</returns>
    public static SingletonLease<T, TFactory, AdaptiveBackoff, NullDiagnostics> AcquireLease() => s_engine.AcquireLease();

    /// <summary>
    /// Attempts to acquire a lease against the instance without throwing.
    /// </summary>
    /// <param name="result">The outcome of the acquisition attempt.</param>
    /// <returns><see langword="true"/> when a lease was acquired; otherwise <see langword="false"/>.</returns>
    public static bool TryAcquireLease(out LeaseAcquisitionResult<SingletonLease<T, TFactory, AdaptiveBackoff, NullDiagnostics>> result) =>
        s_engine.TryAcquireLease(out result);

    /// <summary>Gets the current metadata snapshot for the engine.</summary>
    /// <returns>The metadata snapshot.</returns>
    public static SingletonMetadata GetMetadata() => s_engine.GetMetadata();

    /// <summary>Transitions the engine to the closed phase in which no new leases are accepted.</summary>
    public static void Complete() => s_engine.Complete();

    /// <summary>
    /// Drains the engine asynchronously, waiting until all held leases release or the
    /// configured drain timeout elapses.
    /// </summary>
    /// <param name="cancellationToken">The token to cancel the wait.</param>
    /// <returns>The outcome of the drain attempt.</returns>
    public static ValueTask<DrainResult> DrainAsync(CancellationToken cancellationToken = default) =>
        s_engine.DrainAsync(cancellationToken);
}
