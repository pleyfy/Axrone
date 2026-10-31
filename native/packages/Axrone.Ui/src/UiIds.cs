namespace Axrone.Ui;

/// <summary>Stable identity of a UI document.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiDocumentId(uint Value)
{
    /// <summary>Gets the invalid sentinel; never names a document.</summary>
    public bool IsValid => Value != 0;

    /// <summary>Gets the invalid sentinel.</summary>
    public static UiDocumentId Invalid => default;
}

/// <summary>Document-local node identity; zero is reserved.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiNodeId(uint Value)
{
    /// <summary>Gets the invalid sentinel; never names a node.</summary>
    public bool IsValid => Value != 0;

    /// <summary>Gets the invalid sentinel.</summary>
    public static UiNodeId Invalid => default;
}

/// <summary>Stable identity of a loaded font face.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiFontFaceId(uint Value)
{
    /// <summary>Gets the invalid sentinel.</summary>
    public bool IsValid => Value != 0;

    /// <summary>Gets the invalid sentinel.</summary>
    public static UiFontFaceId Invalid => default;
}

/// <summary>Stable identity of a font family.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiFontFamilyId(uint Value)
{
    /// <summary>Gets the invalid sentinel.</summary>
    public bool IsValid => Value != 0;

    /// <summary>Gets the invalid sentinel.</summary>
    public static UiFontFamilyId Invalid => default;
}

/// <summary>Identity of one glyph atlas page.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiGlyphAtlasPageId(uint Value)
{
    /// <summary>Gets the invalid sentinel.</summary>
    public bool IsValid => Value != 0;

    /// <summary>Gets the invalid sentinel.</summary>
    public static UiGlyphAtlasPageId Invalid => default;
}

/// <summary>Identity of a style/theme token.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiThemeTokenId(uint Value)
{
    /// <summary>Gets the invalid sentinel.</summary>
    public bool IsValid => Value != 0;

    /// <summary>Gets the invalid sentinel.</summary>
    public static UiThemeTokenId Invalid => default;
}

/// <summary>Identity of a render resource (texture, material or shader).</summary>
[StructLayout(LayoutKind.Sequential, Pack = 8)]
public readonly record struct UiResourceId(ulong Value)
{
    /// <summary>Gets the invalid sentinel.</summary>
    public bool IsValid => Value != 0;

    /// <summary>Gets the invalid sentinel.</summary>
    public static UiResourceId Invalid => default;
}

/// <summary>Identity of an immutable shaped text layout.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiTextLayoutId(uint Value)
{
    /// <summary>Gets the invalid sentinel.</summary>
    public bool IsValid => Value != 0;

    /// <summary>Gets the invalid sentinel.</summary>
    public static UiTextLayoutId Invalid => default;
}
