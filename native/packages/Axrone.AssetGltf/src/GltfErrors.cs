namespace Axrone.AssetGltf;

/// <summary>Base glTF import failure with a stable error code.</summary>
public class GltfException : Exception
{
    /// <summary>Stable error code.</summary>
    public string Code { get; }

    /// <summary>Creates an error.</summary>
    public GltfException(string code, string message, Exception? inner = null)
        : base($"[{code}] {message}", inner)
    {
        Code = code;
    }
}

/// <summary>GLB container is malformed.</summary>
public sealed class GltfContainerError(string message, Exception? inner = null)
    : GltfException("gltf.container.invalid", message, inner);

/// <summary>glTF JSON schema is malformed.</summary>
public sealed class GltfSchemaError(string message, Exception? inner = null)
    : GltfException("gltf.schema.invalid", message, inner);

/// <summary>External buffer/image resource cannot be resolved.</summary>
public sealed class GltfResourceError(string uri, string kind, string message, Exception? inner = null)
    : GltfException("gltf.resource.unresolved", $"Resource '{uri}' (kind: {kind}) unresolved: {message}", inner)
{
    /// <summary>Requested URI.</summary>
    public string Uri { get; } = uri;

    /// <summary>Resource kind.</summary>
    public string Kind { get; } = kind;
}

/// <summary>Accessor payload is malformed.</summary>
public sealed class GltfAccessorError(int accessorIndex, string message, Exception? inner = null)
    : GltfException("gltf.accessor.invalid", $"Accessor [{accessorIndex}] invalid: {message}", inner)
{
    /// <summary>Accessor index.</summary>
    public int AccessorIndex { get; } = accessorIndex;
}

/// <summary>Primitive topology mode is unsupported.</summary>
public sealed class GltfTopologyError(int mode, string message)
    : GltfException("gltf.topology.unsupported", $"Topology mode {mode} unsupported: {message}")
{
    /// <summary>glTF primitive mode.</summary>
    public int Mode { get; } = mode;
}

/// <summary>Required glTF extension has no linked runtime implementation.</summary>
public sealed class GltfUnsupportedExtensionError(string extensionName, string message)
    : GltfException("gltf.extension.unsupported", $"Extension '{extensionName}' is unsupported: {message}")
{
    /// <summary>Extension name.</summary>
    public string ExtensionName { get; } = extensionName;
}

/// <summary>Configured import limit was exceeded.</summary>
public sealed class GltfLimitExceededError(string limit, long requested, long maximum)
    : GltfException("gltf.limit.exceeded", $"Limit '{limit}' exceeded: {requested} > {maximum}.")
{
    /// <summary>Limit name.</summary>
    public string Limit { get; } = limit;

    /// <summary>Requested value.</summary>
    public long Requested { get; } = requested;

    /// <summary>Configured maximum.</summary>
    public long Maximum { get; } = maximum;
}

/// <summary>Texture references an image index that the document does not declare.</summary>
public sealed class GltfTextureSourceError(int textureIndex, int imageSource, int imageCount)
    : GltfException(
        "gltf.texture.source.invalid",
        $"Texture [{textureIndex}] references image {imageSource} but the document declares {imageCount} images.")
{
    /// <summary>Texture index with the bad reference.</summary>
    public int TextureIndex { get; } = textureIndex;

    /// <summary>Referenced image index.</summary>
    public int ImageSource { get; } = imageSource;

    /// <summary>Declared image count.</summary>
    public int ImageCount { get; } = imageCount;
}

/// <summary>Centralized throw paths (keeps hot paths inline).</summary>
internal static class ThrowHelper
{
    /// <summary>Throws a container error.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowContainer(string message) => throw new GltfContainerError(message);

    /// <summary>Throws a schema error.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowSchema(string message) => throw new GltfSchemaError(message);

    /// <summary>Throws a resource error.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowResource(string uri, string kind, string message) =>
        throw new GltfResourceError(uri, kind, message);

    /// <summary>Throws an accessor error.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowAccessor(int index, string message) => throw new GltfAccessorError(index, message);

    /// <summary>Throws a topology error.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowTopology(int mode, string message) => throw new GltfTopologyError(mode, message);

    /// <summary>Throws an unsupported-extension error.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowUnsupportedExtension(string extensionName, string message) =>
        throw new GltfUnsupportedExtensionError(extensionName, message);

    /// <summary>Throws a limit-exceeded error.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowLimit(string limit, long requested, long maximum) =>
        throw new GltfLimitExceededError(limit, requested, maximum);

    /// <summary>Throws a texture source reference error.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowTextureSource(int textureIndex, int source, int imageCount) =>
        throw new GltfTextureSourceError(textureIndex, source, imageCount);
}
