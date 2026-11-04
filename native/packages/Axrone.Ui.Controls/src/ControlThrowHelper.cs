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

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    internal static void ThrowDuplicateWidget(string name) =>
        throw new InvalidOperationException($"Widget controller \"{name}\" is already registered.");

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    internal static void ThrowInvalidWidgetHandle() =>
        throw new ArgumentException("The widget handle is stale or was never registered.", "handle");

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    internal static void ThrowNoWidgetRegistry() =>
        throw new InvalidOperationException("The runtime was created without a UiWidgetRegistry.");

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    internal static void ThrowForeignNode(UiNodeId node) =>
        throw new ArgumentException($"Node {node.Value} is not owned by this control.", nameof(node));
}
