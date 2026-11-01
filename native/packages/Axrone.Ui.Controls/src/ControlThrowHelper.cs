namespace Axrone.Ui.Controls;

using System.Diagnostics.CodeAnalysis;
using Axrone.Ui;

/// <summary>Cold-path failures raised by control authoring APIs.</summary>
internal static class ControlThrowHelper
{
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    internal static void ThrowInvalidKind(ControlKind kind) =>
        throw new ArgumentOutOfRangeException(nameof(kind), kind, "The control kind is not registered.");

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    internal static void ThrowDisposed() =>
        throw new ObjectDisposedException(nameof(UiControlRuntime));

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    internal static void ThrowInvalidHandle() =>
        throw new ArgumentException("The control handle is stale or invalid.", "control");
}
