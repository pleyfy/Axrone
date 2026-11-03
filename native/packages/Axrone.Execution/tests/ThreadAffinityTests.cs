namespace Axrone.Execution.Tests;

using Axrone.Execution;
using FluentAssertions;
using Xunit;

/// <summary>
/// The affinity probe must answer "why is this thread still unpinned" with a code, not a
/// single shared <c>false</c>: a refused mask, an unknown platform, and an ABI that is missing
/// from the deployment are three different operational facts.
/// </summary>
public class ThreadAffinityTests
{
    [Theory]
    [InlineData(-1)]
    [InlineData(1024)]
    [InlineData(int.MaxValue)]
    public void PinCurrentThread_OutOfRangeCore_IsCodedOutOfRangeNotUnavailable(int coreId)
    {
        // 1024 is beyond the Windows mask range (63) and the Linux cpu_set_t range (1023), so the
        // refusal is range-based on every supported platform without touching the real ABI.
        ThreadAffinityScope.PinCurrentThread(coreId).Should().Be(AffinityResult.OutOfRange);
    }

    [Fact]
    public void MissingAbi_IsCodedUnavailable_NotAnOsRefusal()
    {
        Exception[] abiFaults = [new DllNotFoundException(), new EntryPointNotFoundException()];

        foreach (Exception fault in abiFaults)
        {
            AffinityResult result = ThreadAffinityScope.OutcomeFrom(fault);
            result.Should().Be(AffinityResult.AbiUnavailable);
            result.Should().NotBe(AffinityResult.DeclinedByOs, "a missing ABI is a broken deployment, not a refusal");
            result.Should().NotBe(AffinityResult.UnsupportedPlatform);
        }
    }

    [Fact]
    public void UnexpectedProbeFault_IsCodedPlatformFault()
    {
        ThreadAffinityScope.OutcomeFrom(new InvalidOperationException("platform raised this"))
            .Should().Be(AffinityResult.PlatformFault);

        ThreadAffinityScope.OutcomeFrom(new IOException())
            .Should().Be(AffinityResult.PlatformFault);
    }

    [Fact]
    public void DefaultAffinityResult_IsNotAttempted()
    {
        // A record nobody filled in must never read as a successful pin.
        default(AffinityResult).Should().Be(AffinityResult.NotAttempted);
        ((AffinityResult)0).Should().NotBe(AffinityResult.Pinned);
    }
}
