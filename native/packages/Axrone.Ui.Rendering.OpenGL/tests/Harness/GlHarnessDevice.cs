namespace Axrone.Ui.Testing.OpenGL;

using System.Diagnostics.CodeAnalysis;
using System.Runtime.InteropServices;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Implementations;
using Silk.NET.OpenGL;

internal sealed partial class GlHarnessDevice : IDisposable
{
    internal const string ForcedSkipVariable = "AXRONE_FORCE_NO_GL";

    private static IntPtr s_opengl32;

    private IntPtr _window;
    private IntPtr _dc;
    private IntPtr _context;
    private GL? _gl;
    private GLContext? _glContext;
    private int _disposed;

    private GlHarnessDevice()
    {
        try
        {
            _window = Win32.CreateWindowExW(
                0,
                "STATIC",
                "AxroneUiGlHarness",
                Win32.WsOverlappedWindow,
                0,
                0,
                4,
                4,
                IntPtr.Zero,
                IntPtr.Zero,
                IntPtr.Zero,
                IntPtr.Zero);
            if (_window == IntPtr.Zero)
            {
                throw new InvalidOperationException($"CreateWindowExW failed (Win32 {Marshal.GetLastWin32Error()}).");
            }

            _dc = Win32.GetDC(_window);
            if (_dc == IntPtr.Zero)
            {
                throw new InvalidOperationException($"GetDC failed (Win32 {Marshal.GetLastWin32Error()}).");
            }

            var descriptor = new PixelFormatDescriptor
            {
                Size = (ushort)Marshal.SizeOf<PixelFormatDescriptor>(),
                Version = 1,
                Flags = Win32.PfdDrawToWindow | Win32.PfdSupportOpenGl | Win32.PfdDoubleBuffer,
                PixelType = 0,
                ColorBits = 32,
                AlphaBits = 8,
                DepthBits = 24,
            };

            int format = Win32.ChoosePixelFormat(_dc, ref descriptor);
            if (format == 0)
            {
                throw new InvalidOperationException($"ChoosePixelFormat failed (Win32 {Marshal.GetLastWin32Error()}).");
            }

            if (!Win32.SetPixelFormat(_dc, format, ref descriptor))
            {
                throw new InvalidOperationException($"SetPixelFormat failed (Win32 {Marshal.GetLastWin32Error()}).");
            }

            _context = Win32.wglCreateContext(_dc);
            if (_context == IntPtr.Zero)
            {
                throw new InvalidOperationException($"wglCreateContext failed (Win32 {Marshal.GetLastWin32Error()}).");
            }

            if (!Win32.wglMakeCurrent(_dc, _context))
            {
                throw new InvalidOperationException($"wglMakeCurrent failed (Win32 {Marshal.GetLastWin32Error()}).");
            }

            _gl = GL.GetApi(LoadGlFunction);
            _glContext = new GLContext(new SilkGLApi(_gl));

            Renderer = _glContext.Capabilities.Renderer;
            Version = _glContext.Capabilities.Version;
            ShadingLanguageVersion = _glContext.Capabilities.ShadingLanguageVersion;
            if (!SupportsRequiredVersion(Version))
            {
                throw new NotSupportedException(
                    $"OpenGL 3.3 is required by the UI shaders; the device reports '{Version}' ({Renderer}).");
            }
        }
        catch
        {
            Dispose();
            throw;
        }
    }

    public GLContext Context => _glContext ?? throw new ObjectDisposedException(nameof(GlHarnessDevice));

    public string Renderer { get; } = "unknown";

    public string Version { get; } = "unknown";

    public string ShadingLanguageVersion { get; } = "unknown";

    public string Description => $"OpenGL {Version} on {Renderer} (GLSL {ShadingLanguageVersion})";

    /// <summary>
    /// Creates the device for a test that was not skipped at discovery. A discovery-time probe
    /// failure skips the test; a probe success followed by an execution failure is a real
    /// failure, never a silent pass.
    /// </summary>
    public static GlHarnessDevice Require()
    {
        if (!TryCreate(out GlHarnessDevice? device, out string reason))
        {
            throw new InvalidOperationException(
                $"The real GL device was available at discovery but could not be created at execution: {reason}");
        }

        return device!;
    }

    public static bool TryCreate(out GlHarnessDevice? device, out string reason)
    {
        device = null;
        if (!OperatingSystem.IsWindows())
        {
            reason = $"Real GL validation requires a Windows WGL context; platform is {RuntimeInformation.OSDescription}.";
            return false;
        }

        try
        {
            device = new GlHarnessDevice();
            reason = device.Description;
            return true;
        }
        catch (Exception ex)
        {
            reason = $"Real GL device unavailable: {ex.GetType().Name}: {ex.Message}";
            return false;
        }
    }

    [SuppressMessage(
        "Usage",
        "CA1806:Do not ignore method results",
        Justification = "ReleaseDC/DestroyWindow failures cannot be acted on during teardown; the window dies with the process.")]
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        try
        {
            _glContext?.Dispose();
        }
        finally
        {
            _gl?.Dispose();
            _gl = null;
            _glContext = null;

            if (_context != IntPtr.Zero)
            {
                Win32.wglMakeCurrent(IntPtr.Zero, IntPtr.Zero);
                Win32.wglDeleteContext(_context);
                _context = IntPtr.Zero;
            }

            if (_dc != IntPtr.Zero && _window != IntPtr.Zero)
            {
                Win32.ReleaseDC(_window, _dc);
                _dc = IntPtr.Zero;
            }

            if (_window != IntPtr.Zero)
            {
                Win32.DestroyWindow(_window);
                _window = IntPtr.Zero;
            }
        }
    }

    private static IntPtr LoadGlFunction(string name)
    {
        IntPtr address = Win32.wglGetProcAddress(name);
        if (address == IntPtr.Zero || address == new IntPtr(1) || address == new IntPtr(2) ||
            address == new IntPtr(3) || address == new IntPtr(-1))
        {
            IntPtr opengl32 = Volatile.Read(ref s_opengl32);
            if (opengl32 == IntPtr.Zero)
            {
                opengl32 = NativeLibrary.Load("opengl32.dll");
                Volatile.Write(ref s_opengl32, opengl32);
            }

            address = NativeLibrary.TryGetExport(opengl32, name, out IntPtr export) ? export : IntPtr.Zero;
        }

        return address;
    }

    private static bool SupportsRequiredVersion(string version)
    {
        int space = version.IndexOf(' ', StringComparison.Ordinal);
        string numeric = space < 0 ? version : version[..space];
        string[] parts = numeric.Split('.');
        if (parts.Length < 2 || !int.TryParse(parts[0], out int major) || !int.TryParse(parts[1], out int minor))
        {
            return false;
        }

        return major > 3 || (major == 3 && minor >= 3);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PixelFormatDescriptor
    {
        public ushort Size;
        public ushort Version;
        public uint Flags;
        public byte PixelType;
        public byte ColorBits;
        public byte RedBits;
        public byte RedShift;
        public byte GreenBits;
        public byte GreenShift;
        public byte BlueBits;
        public byte BlueShift;
        public byte AlphaBits;
        public byte AlphaShift;
        public byte AccumBits;
        public byte AccumRedBits;
        public byte AccumGreenBits;
        public byte AccumBlueBits;
        public byte AccumAlphaBits;
        public byte DepthBits;
        public byte StencilBits;
        public byte AuxBuffers;
        public byte LayerType;
        public byte Reserved;
        public uint LayerMask;
        public uint VisibleMask;
        public uint DamageMask;
    }

    private static partial class Win32
    {
        public const uint WsOverlappedWindow = 0x00CF0000;
        public const uint PfdDrawToWindow = 0x00000004;
        public const uint PfdSupportOpenGl = 0x00000020;
        public const uint PfdDoubleBuffer = 0x00000001;

        [LibraryImport("user32.dll", EntryPoint = "CreateWindowExW", SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        public static partial IntPtr CreateWindowExW(
            uint exStyle,
            string className,
            string windowName,
            uint style,
            int x,
            int y,
            int width,
            int height,
            IntPtr parent,
            IntPtr menu,
            IntPtr instance,
            IntPtr parameter);

        [LibraryImport("user32.dll", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        public static partial IntPtr GetDC(IntPtr window);

        [LibraryImport("user32.dll")]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        public static partial int ReleaseDC(IntPtr window, IntPtr dc);

        [LibraryImport("user32.dll", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static partial bool DestroyWindow(IntPtr window);

        [LibraryImport("gdi32.dll", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        public static partial int ChoosePixelFormat(IntPtr dc, ref PixelFormatDescriptor descriptor);

        [LibraryImport("gdi32.dll", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static partial bool SetPixelFormat(IntPtr dc, int format, ref PixelFormatDescriptor descriptor);

        [LibraryImport("opengl32.dll", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        public static partial IntPtr wglCreateContext(IntPtr dc);

        [LibraryImport("opengl32.dll", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static partial bool wglMakeCurrent(IntPtr dc, IntPtr context);

        [LibraryImport("opengl32.dll", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static partial bool wglDeleteContext(IntPtr context);

        [LibraryImport("opengl32.dll", StringMarshalling = StringMarshalling.Utf8)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        public static partial IntPtr wglGetProcAddress(string name);
    }
}
