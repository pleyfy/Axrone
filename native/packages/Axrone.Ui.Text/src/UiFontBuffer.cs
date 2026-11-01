namespace Axrone.Ui.Text;

public sealed class UiFontBuffer : IDisposable
{
    private byte[]? _pinned;
    private IntPtr _native;
    private int _length;
    private bool _disposed;

    private UiFontBuffer(byte[]? pinned, IntPtr native, int length)
    {
        _pinned = pinned;
        _native = native;
        _length = length;
    }

    public int Length
    {
        get
        {
            ThrowIfDisposed();
            return _length;
        }
    }

    public bool IsNative
    {
        get
        {
            ThrowIfDisposed();
            return _native != IntPtr.Zero;
        }
    }

    public unsafe ReadOnlySpan<byte> Span
    {
        get
        {
            ThrowIfDisposed();
            return _pinned is not null
                ? _pinned
                : new ReadOnlySpan<byte>((void*)_native, _length);
        }
    }

    public static UiFontBuffer FromSpan(ReadOnlySpan<byte> data)
    {
        if (data.IsEmpty)
        {
            throw new ArgumentException("Font data must not be empty.", nameof(data));
        }

        byte[] pinned = GC.AllocateArray<byte>(data.Length, pinned: true);
        data.CopyTo(pinned);
        return new UiFontBuffer(pinned, IntPtr.Zero, data.Length);
    }

    public static unsafe UiFontBuffer FromNative(ReadOnlySpan<byte> data)
    {
        if (data.IsEmpty)
        {
            throw new ArgumentException("Font data must not be empty.", nameof(data));
        }

        byte* memory = (byte*)NativeMemory.AlignedAlloc((nuint)data.Length, 16);
        if (memory is null)
        {
            throw new InvalidOperationException("Font buffer allocation failed.");
        }

        data.CopyTo(new Span<byte>(memory, data.Length));
        return new UiFontBuffer(null, (IntPtr)memory, data.Length);
    }

    public static UiFontBuffer FromOwned(byte[] data)
    {
        ArgumentNullException.ThrowIfNull(data);
        return FromSpan(data);
    }

    public unsafe void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        if (_native != IntPtr.Zero)
        {
            NativeMemory.AlignedFree((void*)_native);
            _native = IntPtr.Zero;
        }

        _pinned = null;
        _length = 0;
        GC.SuppressFinalize(this);
    }

    private void ThrowIfDisposed()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
    }
}
