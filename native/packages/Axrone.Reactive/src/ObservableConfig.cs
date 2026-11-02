namespace Axrone.Reactive;

public sealed class ObservableConfig
{
    public ObservableConfig(
        in ObservationOptions observerOptions = default,
        in SubjectOptions subjectOptions = default,
        bool enableGlobalErrorHandling = true,
        Action<Exception>? globalErrorHandler = null)
    {
        ObserverOptions = observerOptions.Priority == ObservationPriority.Normal &&
            observerOptions.DebounceMs == 0 &&
            observerOptions.ThrottleMs == 0
                ? ObservationOptions.Default
                : observerOptions.Normalize();
        SubjectOptions = subjectOptions.Normalize();
        EnableGlobalErrorHandling = enableGlobalErrorHandling;
        GlobalErrorHandler = globalErrorHandler;
    }

    public static ObservableConfig Default { get; } = new(
        ObservationOptions.Default,
        SubjectOptions.Default,
        true,
        null);

    public ObservationOptions ObserverOptions { get; }

    public SubjectOptions SubjectOptions { get; }

    public bool EnableGlobalErrorHandling { get; }

    public Action<Exception>? GlobalErrorHandler { get; }

    public ObservableConfig WithObserverOptions(in ObservationOptions options) => new(
        options,
        SubjectOptions,
        EnableGlobalErrorHandling,
        GlobalErrorHandler);

    public ObservableConfig WithSubjectOptions(in SubjectOptions options) => new(
        ObserverOptions,
        options,
        EnableGlobalErrorHandling,
        GlobalErrorHandler);
}
