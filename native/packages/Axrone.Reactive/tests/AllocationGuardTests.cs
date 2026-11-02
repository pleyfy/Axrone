namespace Axrone.Reactive.Tests;

using FluentAssertions;
using Xunit;

public sealed class AllocationGuardTests
{
    [Fact]
    public void DetectsAKnownAllocation()
    {
        long before = GC.GetAllocatedBytesForCurrentThread();
        var buffer = new List<int>(32);
        for (int i = 0; i < 32; i++)
        {
            buffer.Add(i);
        }

        GC.KeepAlive(buffer);
        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().BeGreaterThan(0);
    }
}
