namespace Axrone.Execution;

using System.Runtime.InteropServices;
using System.Runtime.Versioning;

/// <summary>
/// Why a pinning request ended the way it did. The distinction matters: an OS that refused a
/// mask and a deployment whose affinity ABI is missing both leave the thread unpinned, but only
/// one of them is a broken install worth reporting.
/// </summary>
internal enum AffinityResult : byte
{
    /// <summary>No request was made (default value).</summary>
    NotAttempted,

    /// <summary>The OS accepted the mask.</summary>
    Pinned,

    /// <summary>The core id is outside the range the platform can encode.</summary>
    OutOfRange,

    /// <summary>This build has no affinity ABI for the running platform.</summary>
    UnsupportedPlatform,

    /// <summary>The OS rejected the mask for an in-range core.</summary>
    DeclinedByOs,

    /// <summary>kernel32/libc or its entry point is missing: the pin can never happen here.</summary>
    AbiUnavailable,

    /// <summary>The platform raised something unexpected while probing.</summary>
    PlatformFault,
}

/// <summary>
/// Best-effort current-thread processor pinning. The only hard guarantees here
/// are the ones the OS actually provides — Windows gives per-thread affinity
/// masks, Linux gives a per-thread CPU set — so every path degrades to "not
/// pinned" instead of throwing, and the worker treats pinning as advisory.
/// </summary>
/// <remarks>
/// <para>
/// Bindings are source-generated <see cref="LibraryImportAttribute"/> rather than
/// <c>DllImport</c>, which keeps the package trim- and AOT-clean: the marshalling
/// stub is generated at compile time, there is no runtime marshaller to preserve,
/// and the entry-point probe is compile-time known per platform.
/// </para>
/// <para>
/// Platform coverage: Windows and Linux only. Every other target (macOS, the
/// browser-hosted runtime, a platform this build does not know) is a documented
/// no-op reporting <see cref="AffinityResult.UnsupportedPlatform"/> — a caller
/// that treats the result as a requirement is asking for something the BCL
/// cannot promise cross-platform either.
/// </para>
/// <para>
/// Every non-pinned answer is coded: an out-of-range core, an unknown platform, an
/// OS refusal, a missing ABI, and an unexpected platform fault are separate outcomes,
/// so a caller can tell "the OS said no" from "this deployment cannot pin at all".
/// </para>
/// </remarks>
internal static partial class ThreadAffinityScope
{
    /// <summary>Windows encodes affinity as a 64-bit mask.</summary>
    private const int MaxWindowsCoreId = 63;

    /// <summary>Linux cpu_set_t is a fixed 1024-bit set.</summary>
    private const int MaxLinuxCoreId = 1023;

    /// <summary>Words in a Linux cpu_set_t (1024 bits / 64).</summary>
    private const int LinuxCpuSetWords = 16;

    /// <summary>Size of a Linux cpu_set_t in bytes.</summary>
    private const nuint LinuxCpuSetBytes = 128;

    /// <summary>
    /// Restricts the calling thread to one logical processor.
    /// </summary>
    /// <param name="coreId">Zero-based logical processor id.</param>
    /// <returns>
    /// Why the thread ended up pinned or not: <see cref="AffinityResult.Pinned"/> only when the
    /// OS accepted the mask. A refused mask, an unsupported platform, an out-of-range core and a
    /// missing ABI are four different answers, and never throws — a failed pin must not take the
    /// worker down with it.
    /// </returns>
    [SuppressMessage(
        "Design",
        "CA1031:Do not catch general exception types",
        Justification = "Probing a platform ABI must never propagate, but it is never discarded either: each exception class becomes a coded AffinityResult the caller can act on.")]
    [MethodImpl(MethodImplOptions.NoInlining)]
    internal static AffinityResult PinCurrentThread(int coreId)
    {
        try
        {
            if (OperatingSystem.IsWindows())
                return TryPinWindows(coreId);

            if (OperatingSystem.IsLinux())
                return TryPinLinux(coreId);

            return AffinityResult.UnsupportedPlatform;
        }
        catch (Exception fault)
        {
            return OutcomeFrom(fault);
        }
    }

    /// <summary>
    /// Codes a caught probe exception. A missing module or entry point means the affinity ABI is
    /// absent from this deployment, so pinning can never happen however often it is retried;
    /// anything else is an unexpected platform fault. Neither is reported as an OS refusal.
    /// </summary>
    internal static AffinityResult OutcomeFrom(Exception fault) =>
        fault is DllNotFoundException or EntryPointNotFoundException
            ? AffinityResult.AbiUnavailable
            : AffinityResult.PlatformFault;

    [LibraryImport("kernel32.dll", EntryPoint = "GetCurrentThread")]
    [UnmanagedCallConv(CallConvs = [typeof(CallConvStdcall)])]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    private static partial nuint GetCurrentThread();

    [LibraryImport("kernel32.dll", EntryPoint = "SetThreadAffinityMask")]
    [UnmanagedCallConv(CallConvs = [typeof(CallConvStdcall)])]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    private static partial nuint SetThreadAffinityMask(nuint thread, nuint threadAffinityMask);

    [LibraryImport("libc", EntryPoint = "sched_setaffinity")]
    [UnmanagedCallConv(CallConvs = [typeof(CallConvCdecl)])]
    [DefaultDllImportSearchPaths(DllImportSearchPath.SafeDirectories)]
    private static unsafe partial int SchedSetAffinity(int pid, nuint cpuSetSize, ulong* mask);

    [SupportedOSPlatform("windows")]
    private static AffinityResult TryPinWindows(int coreId)
    {
        if ((uint)coreId > MaxWindowsCoreId)
            return AffinityResult.OutOfRange;

        nuint thread = GetCurrentThread();
        return SetThreadAffinityMask(thread, (nuint)(1UL << coreId)) != 0
            ? AffinityResult.Pinned
            : AffinityResult.DeclinedByOs;
    }

    [SupportedOSPlatform("linux")]
    private static unsafe AffinityResult TryPinLinux(int coreId)
    {
        if ((uint)coreId > MaxLinuxCoreId)
            return AffinityResult.OutOfRange;

        ulong* mask = stackalloc ulong[LinuxCpuSetWords];
        new Span<ulong>(mask, LinuxCpuSetWords).Clear();
        mask[coreId >> 6] = 1UL << (coreId & 63);

        // pid 0 addresses the calling thread, which is the thread being pinned.
        return SchedSetAffinity(0, LinuxCpuSetBytes, mask) == 0
            ? AffinityResult.Pinned
            : AffinityResult.DeclinedByOs;
    }
}
