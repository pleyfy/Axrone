namespace Axrone.Ui.Text;

/// <summary>Registration metadata for one font face.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiFontFaceDescriptor(string FamilyName, UiFontWeight Weight, UiFontStyle Style)
{
    /// <summary>Creates a normal/upright descriptor.</summary>
    public static UiFontFaceDescriptor Regular(string familyName) =>
        new(familyName, UiFontWeight.Normal, UiFontStyle.Normal);
}

/// <summary>
/// Explicit, AOT-safe font registry and <see cref="IUiFontProvider"/>. Reads use
/// a copy-on-write snapshot so shaping and measurement never lock; registration
/// and fallback updates take a <see cref="Lock"/>.
/// </summary>
public sealed class UiFontProvider : IUiFontProvider, IDisposable
{
    /// <summary>Maximum registered faces.</summary>
    public const int MaxFaces = 64;

    /// <summary>Maximum configured fallback families.</summary>
    public const int MaxFallbackFamilies = 16;

    /// <summary>Maximum authored family-name length in UTF-16 units.</summary>
    public const int MaxFamilyNameLength = 64;

    private const uint FnvOffsetBasis = 2166136261u;
    private const uint FnvPrime = 16777619u;

    private readonly Lock _gate = new();
    private FaceTable _table = FaceTable.Empty;
    private bool _disposed;

    /// <summary>Gets the registered face count.</summary>
    public int FaceCount => Volatile.Read(ref _table).Faces.Length;

    /// <summary>Gets the registered family count.</summary>
    public int FamilyCount => Volatile.Read(ref _table).Families.Count;

    /// <summary>Gets the default family; invalid when no face is registered.</summary>
    public UiFontFamilyId DefaultFamily => Volatile.Read(ref _table).DefaultFamily;

    /// <summary>Derives the stable family identity from a display name.</summary>
    public static UiFontFamilyId FromFamilyName(ReadOnlySpan<char> name)
    {
        ReadOnlySpan<char> trimmed = name.Trim();
        if (trimmed.IsEmpty || trimmed.Length > MaxFamilyNameLength)
        {
            return UiFontFamilyId.Invalid;
        }

        Span<byte> utf8 = stackalloc byte[MaxFamilyNameLength * 4];
        int written = 0;
        int index = 0;
        while (index < trimmed.Length)
        {
            OperationStatus status = Rune.DecodeFromUtf16(trimmed[index..], out Rune rune, out int consumed);
            if (status != OperationStatus.Done)
            {
                return UiFontFamilyId.Invalid;
            }

            Rune lower = Rune.ToLowerInvariant(rune);
            written += lower.EncodeToUtf8(utf8[written..]);
            index += consumed;
        }

        uint hash = FnvOffsetBasis;
        for (int i = 0; i < written; i++)
        {
            hash = (hash ^ utf8[i]) * FnvPrime;
        }

        return new UiFontFamilyId(hash == 0 ? 1U : hash);
    }

    /// <summary>Derives the stable family identity from a display name.</summary>
    public static UiFontFamilyId FromFamilyName(string name)
    {
        ArgumentNullException.ThrowIfNull(name);
        return FromFamilyName(name.AsSpan());
    }

    /// <summary>Registers a face; the provider takes ownership of the buffer on success.</summary>
    public UiFontFaceId RegisterFace(UiFontBuffer buffer, in UiFontFaceDescriptor descriptor, out UiFontError error)
    {
        ArgumentNullException.ThrowIfNull(buffer);
        error = UiFontError.None;

        string familyName = descriptor.FamilyName?.Trim() ?? string.Empty;
        if (familyName.Length == 0 || familyName.Length > MaxFamilyNameLength)
        {
            error = UiFontError.At(UiFontErrorCode.InvalidDescriptor, 0, "Family name must be non-empty and within the length limit.");
            return UiFontFaceId.Invalid;
        }

        UiFontWeight weight = descriptor.Weight == UiFontWeight.Default ? UiFontWeight.Normal : descriptor.Weight;
        if ((int)weight < 100 || (int)weight > 900)
        {
            error = UiFontError.At(UiFontErrorCode.InvalidDescriptor, 0, "Font weight must be between 100 and 900.");
            return UiFontFaceId.Invalid;
        }

        UiFontFamilyId family = FromFamilyName(familyName.AsSpan());
        if (!family.IsValid)
        {
            error = UiFontError.At(UiFontErrorCode.InvalidDescriptor, 0, "Family name is not valid UTF-16.");
            return UiFontFaceId.Invalid;
        }

        if (!UiFontParser.TryParse(buffer, family, familyName, weight, descriptor.Style, out UiFontFace? face, out error))
        {
            return UiFontFaceId.Invalid;
        }

        using (_gate.EnterScope())
        {
            if (_disposed)
            {
                error = UiFontError.At(UiFontErrorCode.InvalidDescriptor, 0, "The font provider has been disposed.");
                return UiFontFaceId.Invalid;
            }

            FaceTable current = _table;
            if (current.Faces.Length >= MaxFaces)
            {
                error = UiFontError.At(UiFontErrorCode.ResourceLimit, 0, "The face limit has been reached.");
                return UiFontFaceId.Invalid;
            }

            if (current.Families.TryGetValue(family, out int[]? familyFaces))
            {
                for (int i = 0; i < familyFaces.Length; i++)
                {
                    UiFontFace existing = current.Faces[familyFaces[i]];
                    if (existing.Weight == weight && existing.Style == descriptor.Style)
                    {
                        error = UiFontError.At(UiFontErrorCode.DuplicateFace, 0, "A face with the same family, weight and style is already registered.");
                        return UiFontFaceId.Invalid;
                    }
                }
            }

            var faces = new UiFontFace[current.Faces.Length + 1];
            Array.Copy(current.Faces, faces, current.Faces.Length);
            face!.Id = new UiFontFaceId((uint)faces.Length);
            faces[^1] = face;
            int newIndex = faces.Length - 1;

            var updatedFamily = new int[(familyFaces?.Length ?? 0) + 1];
            if (familyFaces is not null)
            {
                Array.Copy(familyFaces, updatedFamily, familyFaces.Length);
            }

            updatedFamily[^1] = newIndex;

            var families = new Dictionary<UiFontFamilyId, int[]>(current.Families)
            {
                [family] = updatedFamily,
            };
            UiFontFamilyId defaultFamily = current.DefaultFamily.IsValid ? current.DefaultFamily : family;
            Volatile.Write(ref _table, new FaceTable(faces, families, current.Fallbacks, defaultFamily));
            return face.Id;
        }
    }

    /// <summary>Copies bytes into a pinned buffer and registers the face.</summary>
    [SuppressMessage("Reliability", "CA2000:Dispose objects before losing scope", Justification = "Ownership transfers to the provider on success.")]
    public UiFontFaceId RegisterFace(ReadOnlySpan<byte> data, in UiFontFaceDescriptor descriptor, out UiFontError error)
    {
        UiFontBuffer buffer = UiFontBuffer.FromSpan(data);
        bool transferred = false;
        try
        {
            UiFontFaceId id = RegisterFace(buffer, in descriptor, out error);
            transferred = id.IsValid;
            return id;
        }
        finally
        {
            if (!transferred)
            {
                buffer.Dispose();
            }
        }
    }

    /// <summary>Registers a face through the native-memory buffer path.</summary>
    [SuppressMessage("Reliability", "CA2000:Dispose objects before losing scope", Justification = "Ownership transfers to the provider on success.")]
    public UiFontFaceId RegisterNativeFace(ReadOnlySpan<byte> data, in UiFontFaceDescriptor descriptor, out UiFontError error)
    {
        UiFontBuffer buffer = UiFontBuffer.FromNative(data);
        bool transferred = false;
        try
        {
            UiFontFaceId id = RegisterFace(buffer, in descriptor, out error);
            transferred = id.IsValid;
            return id;
        }
        finally
        {
            if (!transferred)
            {
                buffer.Dispose();
            }
        }
    }

    /// <summary>Sets the ordered fallback families used when a glyph is missing.</summary>
    public void SetFallbackFamilies(ReadOnlySpan<UiFontFamilyId> families)
    {
        if (families.Length > MaxFallbackFamilies)
        {
            throw new ArgumentOutOfRangeException(nameof(families), "The fallback family limit was exceeded.");
        }

        var copy = new UiFontFamilyId[families.Length];
        for (int i = 0; i < families.Length; i++)
        {
            if (!families[i].IsValid)
            {
                throw new ArgumentException("Fallback family ids must be valid.", nameof(families));
            }

            copy[i] = families[i];
        }

        using (_gate.EnterScope())
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            FaceTable current = _table;
            Volatile.Write(ref _table, new FaceTable(current.Faces, current.Families, copy, current.DefaultFamily));
        }
    }

    /// <inheritdoc/>
    public bool TryGetFace(in UiFontQuery query, out UiFontFaceId face)
    {
        FaceTable table = Volatile.Read(ref _table);
        if (table.Faces.Length == 0)
        {
            face = UiFontFaceId.Invalid;
            return false;
        }

        UiFontWeight weight = query.Weight == UiFontWeight.Default ? UiFontWeight.Normal : query.Weight;
        UiFontFamilyId family = query.Family.IsValid ? query.Family : table.DefaultFamily;
        if (TryPick(table, family, weight, query.Style, out face))
        {
            return true;
        }

        for (int i = 0; i < table.Fallbacks.Length; i++)
        {
            if (TryPick(table, table.Fallbacks[i], weight, query.Style, out face))
            {
                return true;
            }
        }

        if (table.DefaultFamily.IsValid && TryPick(table, table.DefaultFamily, weight, query.Style, out face))
        {
            return true;
        }

        face = table.Faces[0].Id;
        return true;
    }

    /// <inheritdoc/>
    public bool TryMeasureGlyph(UiFontFaceId face, int codePoint, out UiGlyphMetrics metrics)
    {
        if (TryGetFace(face, out UiFontFace? resolved))
        {
            return resolved.TryGetGlyphMetrics(codePoint, out metrics);
        }

        metrics = default;
        return false;
    }

    /// <inheritdoc/>
    public float GetKerning(UiFontFaceId face, int left, int right)
    {
        return TryGetFace(face, out UiFontFace? resolved) ? resolved.GetKerning(left, right) : 0.0f;
    }

    /// <summary>Resolves a glyph through the primary face and configured fallbacks.</summary>
    public bool TryResolveGlyph(
        UiFontFaceId primary,
        int codePoint,
        out UiFontFaceId resolvedFace,
        out UiGlyphMetrics metrics)
    {
        if (TryMeasureGlyph(primary, codePoint, out metrics))
        {
            resolvedFace = primary;
            return true;
        }

        FaceTable table = Volatile.Read(ref _table);
        for (int f = 0; f < table.Fallbacks.Length; f++)
        {
            if (!table.Families.TryGetValue(table.Fallbacks[f], out int[]? indices))
            {
                continue;
            }

            for (int i = 0; i < indices.Length; i++)
            {
                UiFontFace candidate = table.Faces[indices[i]];
                if (candidate.TryGetGlyphMetrics(codePoint, out metrics))
                {
                    resolvedFace = candidate.Id;
                    return true;
                }
            }
        }

        for (int i = 0; i < table.Faces.Length; i++)
        {
            UiFontFace candidate = table.Faces[i];
            if (candidate.TryGetGlyphMetrics(codePoint, out metrics))
            {
                resolvedFace = candidate.Id;
                return true;
            }
        }

        resolvedFace = UiFontFaceId.Invalid;
        metrics = default;
        return false;
    }

    /// <summary>Gets a registered face for outline access.</summary>
    public bool TryGetFace(UiFontFaceId id, [NotNullWhen(true)] out UiFontFace? face)
    {
        FaceTable table = Volatile.Read(ref _table);
        int index = (int)id.Value - 1;
        if ((uint)index < (uint)table.Faces.Length)
        {
            face = table.Faces[index];
            return true;
        }

        face = null;
        return false;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        using (_gate.EnterScope())
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            FaceTable current = _table;
            for (int i = 0; i < current.Faces.Length; i++)
            {
                current.Faces[i].Buffer.Dispose();
            }

            Volatile.Write(ref _table, FaceTable.Empty);
        }

        GC.SuppressFinalize(this);
    }

    private static bool TryPick(
        FaceTable table,
        UiFontFamilyId family,
        UiFontWeight weight,
        UiFontStyle style,
        out UiFontFaceId face)
    {
        face = UiFontFaceId.Invalid;
        if (!table.Families.TryGetValue(family, out int[]? indices))
        {
            return false;
        }

        int bestScore = int.MaxValue;
        UiFontFace? best = null;
        for (int i = 0; i < indices.Length; i++)
        {
            UiFontFace candidate = table.Faces[indices[i]];
            int stylePenalty = StylePenalty(style, candidate.Style);
            int weightPenalty = Math.Abs((int)candidate.Weight - (int)weight);
            int score = (stylePenalty * 10_000) + weightPenalty;
            if (best is null ||
                score < bestScore ||
                (score == bestScore && candidate.Weight > best.Weight) ||
                (score == bestScore && candidate.Weight == best.Weight && candidate.Id.Value < best.Id.Value))
            {
                best = candidate;
                bestScore = score;
            }
        }

        if (best is null)
        {
            return false;
        }

        face = best.Id;
        return true;
    }

    private static int StylePenalty(UiFontStyle requested, UiFontStyle candidate)
    {
        if (requested == candidate)
        {
            return 0;
        }

        if (requested == UiFontStyle.Normal)
        {
            return 1;
        }

        return candidate == UiFontStyle.Normal ? 2 : 1;
    }

    private sealed class FaceTable
    {
        public static readonly FaceTable Empty = new(
            [],
            new Dictionary<UiFontFamilyId, int[]>(),
            [],
            UiFontFamilyId.Invalid);

        public FaceTable(
            UiFontFace[] faces,
            Dictionary<UiFontFamilyId, int[]> families,
            UiFontFamilyId[] fallbacks,
            UiFontFamilyId defaultFamily)
        {
            Faces = faces;
            Families = families;
            Fallbacks = fallbacks;
            DefaultFamily = defaultFamily;
        }

        public UiFontFace[] Faces { get; }

        public Dictionary<UiFontFamilyId, int[]> Families { get; }

        public UiFontFamilyId[] Fallbacks { get; }

        public UiFontFamilyId DefaultFamily { get; }
    }
}
