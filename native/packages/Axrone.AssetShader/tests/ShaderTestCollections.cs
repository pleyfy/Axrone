namespace Axrone.AssetShader.Tests;

/// <summary>
/// Serializes tests that touch the process-wide <see cref="ShaderLibraryRegistry.Instance"/>.
/// The registry is shared by every bake, so a blanket <c>Clear</c> from one collection can erase
/// registrations another collection is still using. Tests in this collection own the static
/// registry for their duration and must restore every key they register.
/// </summary>
[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class ShaderLibraryRegistryGroup
{
    /// <summary>Collection name applied to registry-mutating test classes.</summary>
    public const string Name = "ShaderLibraryRegistry";
}
