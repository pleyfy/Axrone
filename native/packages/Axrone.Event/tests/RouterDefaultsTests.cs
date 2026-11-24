namespace Axrone.Event.Tests;

/// <summary>Default configuration must match the TypeScript contract it was ported from.</summary>
public sealed class RouterDefaultsTests
{
    [Fact]
    public void MaxListeners_DefaultsToTen()
    {
        RouterOptions.Default.MaxListeners.Should().Be(10);
        RouterOptionsState.Default.MaxListeners.Should().Be(10);
    }
}
