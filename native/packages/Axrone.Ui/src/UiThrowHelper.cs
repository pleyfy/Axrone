namespace Axrone.Ui;

using System.Diagnostics.CodeAnalysis;

/// <summary>Cold-path throw helpers so hot paths stay throw-free and inlinable.</summary>
internal static class UiThrowHelper
{
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowArgumentOutOfRange(string parameter) =>
        throw new ArgumentOutOfRangeException(parameter);

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowInvalidOperation(string message) =>
        throw new InvalidOperationException(message);

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowLayoutTreeMissingNode(UiNodeId node) =>
        throw new InvalidOperationException($"Layout node {node.Value} is not present in the tree.");

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowLayoutCycle(UiNodeId node) =>
        throw new InvalidOperationException($"Layout node {node.Value} is part of a cycle or was reached twice.");
}
