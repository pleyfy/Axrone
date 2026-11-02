namespace Axrone.Reactive;

public class ObserverException : Exception
{
    public string Code { get; }

    public long Timestamp { get; }

    protected ObserverException(string code, string message, Exception? inner = null)
        : base(message, inner)
    {
        Code = code;
        Timestamp = Stopwatch.GetTimestamp();
    }
}

public class ObserverError : ObserverException
{
    public ObserverError(string message = "Observer operation failed.", Exception? inner = null)
        : base("OBSERVER_ERROR", message, inner)
    {
    }
}

public class SubjectError : ObserverException
{
    public int SubjectId { get; }

    public SubjectError(int subjectId, string message = "Subject operation failed.", Exception? inner = null)
        : base("SUBJECT_ERROR", message, inner)
    {
        SubjectId = subjectId;
    }
}

public sealed class ObserverNotFoundError : ObserverError
{
    public int ObserverId { get; }

    public ObserverNotFoundError(int observerId)
        : base($"Observer {observerId} is not registered.")
    {
        ObserverId = observerId;
    }
}

public sealed class SubjectCompletedError : SubjectError
{
    public SubjectCompletedError(int subjectId)
        : base(subjectId, $"Subject {subjectId} is completed.")
    {
    }
}

public sealed class SubjectDisposedError : SubjectError
{
    public SubjectDisposedError(int subjectId)
        : base(subjectId, $"Subject {subjectId} is disposed.")
    {
    }
}

public sealed class MaxObserversExceededError : ObserverError
{
    public int MaxObservers { get; }

    public int CurrentCount { get; }

    public MaxObserversExceededError(int maxObservers, int currentCount)
        : base($"Maximum number of observers exceeded. Max: {maxObservers}, Current: {currentCount}")
    {
        MaxObservers = maxObservers;
        CurrentCount = currentCount;
    }
}

public sealed class ObserverExecutionError : ObserverError
{
    public int ObserverId { get; }

    public Exception OriginalError { get; }

    public object? NotificationData { get; }

    public ObserverExecutionError(int observerId, object? notificationData, Exception originalError)
        : base($"Observer {observerId} failed while handling a notification.", originalError)
    {
        ObserverId = observerId;
        OriginalError = originalError;
        NotificationData = notificationData;
    }
}

public sealed class ValidationError : ObserverError
{
    public object? InvalidData { get; }

    public ValidationError(object? invalidData)
        : base("Notification data failed validation.")
    {
        InvalidData = invalidData;
    }
}

public sealed class ConcurrencyLimitError : SubjectError
{
    public int Limit { get; }

    public int Current { get; }

    public ConcurrencyLimitError(int subjectId, int limit, int current)
        : base(subjectId, $"Subject {subjectId} exceeded the concurrency limit of {limit}.")
    {
        Limit = limit;
        Current = current;
    }
}

public sealed class FilterError : ObserverError
{
    public Exception OriginalError { get; }

    public FilterError(Exception originalError)
        : base("Observer filter failed.", originalError)
    {
        OriginalError = originalError;
    }
}

public sealed class TransformError : ObserverError
{
    public Exception OriginalError { get; }

    public object? InputData { get; }

    public TransformError(object? inputData, Exception originalError)
        : base("Observer transform failed.", originalError)
    {
        OriginalError = originalError;
        InputData = inputData;
    }
}
