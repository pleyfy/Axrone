namespace Axrone.Ui;

/// <summary>Immutable, sorted theme token table with binary-search lookups.</summary>
public sealed class UiTheme : IUiTheme
{
    private readonly UiThemeTokenId[] _colorTokens;
    private readonly UiColor[] _colors;
    private readonly UiThemeTokenId[] _numberTokens;
    private readonly float[] _numbers;

    internal UiTheme(
        UiThemeTokenId[] colorTokens,
        UiColor[] colors,
        UiThemeTokenId[] numberTokens,
        float[] numbers)
    {
        _colorTokens = colorTokens;
        _colors = colors;
        _numberTokens = numberTokens;
        _numbers = numbers;
    }

    /// <summary>Gets the number of color tokens.</summary>
    public int ColorCount => _colorTokens.Length;

    /// <summary>Gets the number of numeric tokens.</summary>
    public int NumberCount => _numberTokens.Length;

    /// <inheritdoc/>
    public bool TryGetColor(UiThemeTokenId token, out UiColor color)
    {
        int index = IndexOf(_colorTokens, token);
        if (index >= 0)
        {
            color = _colors[index];
            return true;
        }

        color = default;
        return false;
    }

    /// <inheritdoc/>
    public bool TryGetNumber(UiThemeTokenId token, out float value)
    {
        int index = IndexOf(_numberTokens, token);
        if (index >= 0)
        {
            value = _numbers[index];
            return true;
        }

        value = 0.0f;
        return false;
    }

    private static int IndexOf(UiThemeTokenId[] tokens, UiThemeTokenId token)
    {
        int low = 0;
        int high = tokens.Length - 1;
        while (low <= high)
        {
            int mid = low + ((high - low) >> 1);
            uint candidate = tokens[mid].Value;
            if (candidate == token.Value)
            {
                return mid;
            }

            if (candidate < token.Value)
            {
                low = mid + 1;
            }
            else
            {
                high = mid - 1;
            }
        }

        return -1;
    }
}

/// <summary>Mutable theme builder; later adds of a token replace earlier ones.</summary>
public sealed class UiThemeBuilder
{
    private readonly Dictionary<UiThemeTokenId, UiColor> _colors = new();
    private readonly Dictionary<UiThemeTokenId, float> _numbers = new();

    /// <summary>Adds or replaces a color token.</summary>
    public UiThemeBuilder AddColor(UiThemeTokenId token, in UiColor color)
    {
        _colors[token] = color;
        return this;
    }

    /// <summary>Adds or replaces a numeric token.</summary>
    public UiThemeBuilder AddNumber(UiThemeTokenId token, float value)
    {
        _numbers[token] = value;
        return this;
    }

    /// <summary>Builds an immutable sorted theme.</summary>
    public UiTheme Build()
    {
        (UiThemeTokenId Token, UiColor Value)[] colors = new (UiThemeTokenId, UiColor)[_colors.Count];
        int colorCursor = 0;
        foreach (KeyValuePair<UiThemeTokenId, UiColor> entry in _colors)
        {
            colors[colorCursor++] = (entry.Key, entry.Value);
        }

        Array.Sort(colors, static (a, b) => a.Token.Value.CompareTo(b.Token.Value));

        (UiThemeTokenId Token, float Value)[] numbers = new (UiThemeTokenId, float)[_numbers.Count];
        int numberCursor = 0;
        foreach (KeyValuePair<UiThemeTokenId, float> entry in _numbers)
        {
            numbers[numberCursor++] = (entry.Key, entry.Value);
        }

        Array.Sort(numbers, static (a, b) => a.Token.Value.CompareTo(b.Token.Value));

        UiThemeTokenId[] colorTokens = GC.AllocateArray<UiThemeTokenId>(colors.Length, pinned: true);
        UiColor[] colorValues = GC.AllocateArray<UiColor>(colors.Length, pinned: true);
        for (int i = 0; i < colors.Length; i++)
        {
            colorTokens[i] = colors[i].Token;
            colorValues[i] = colors[i].Value;
        }

        UiThemeTokenId[] numberTokens = GC.AllocateArray<UiThemeTokenId>(numbers.Length, pinned: true);
        float[] numberValues = GC.AllocateArray<float>(numbers.Length, pinned: true);
        for (int i = 0; i < numbers.Length; i++)
        {
            numberTokens[i] = numbers[i].Token;
            numberValues[i] = numbers[i].Value;
        }

        return new UiTheme(colorTokens, colorValues, numberTokens, numberValues);
    }
}
