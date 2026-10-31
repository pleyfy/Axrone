namespace Axrone.Ui.Rendering;

using System.Diagnostics.CodeAnalysis;

/// <summary>
/// Cold-path validation failures. Every throw site is <see cref="DoesNotReturnAttribute"/>
/// and <see cref="MethodImplOptions.NoInlining"/> so hot paths stay branch-only.
/// </summary>
internal static class UiRenderThrowHelper
{
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowArgumentOutOfRange(string parameter, int value, string message) =>
        throw new ArgumentOutOfRangeException(parameter, value, message);

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowInvalidOperation(string message) =>
        throw new InvalidOperationException(message);

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowArgument(string parameter, string message) =>
        throw new ArgumentException(message, parameter);

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowObjectDisposed(string name) =>
        throw new ObjectDisposedException(name);
}
