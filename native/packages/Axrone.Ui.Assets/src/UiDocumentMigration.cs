namespace Axrone.Ui.Assets;

/// <summary>
/// One step in a document schema migration. Migrations rewrite the raw payload
/// into the next version so the codec can apply the current parser unchanged.
/// </summary>
public interface IUiDocumentMigration
{
    /// <summary>Gets the version this migration accepts.</summary>
    int FromVersion { get; }

    /// <summary>Gets the version this migration produces.</summary>
    int ToVersion { get; }

    /// <summary>Rewrites a payload into the next version.</summary>
    bool TryMigrate(ReadOnlySpan<byte> source, IBufferWriter<byte> destination, out UiDocumentError failure);
}

/// <summary>
/// Ordered chain of document migrations. Construction validates that no two
/// migrations start from the same version; a missing link fails closed with
/// <see cref="UiDocumentErrorCode.UnsupportedVersion"/>.
/// </summary>
public sealed class UiDocumentMigrationPipeline
{
    private const int MaxSteps = 32;

    private readonly IUiDocumentMigration[] _migrations;
    private readonly ArrayBufferWriter<byte> _scratchA = new(1024);
    private readonly ArrayBufferWriter<byte> _scratchB = new(1024);

    /// <summary>Creates a pipeline over a migration set.</summary>
    public UiDocumentMigrationPipeline(ReadOnlySpan<IUiDocumentMigration> migrations)
    {
        _migrations = migrations.ToArray();
        for (int i = 0; i < _migrations.Length; i++)
        {
            IUiDocumentMigration migration = _migrations[i]
                ?? throw new ArgumentException("Migration entries must not be null.", nameof(migrations));
            if (migration.FromVersion < 0 || migration.ToVersion <= migration.FromVersion)
            {
                throw new ArgumentException("Migration versions must form a forward chain.", nameof(migrations));
            }

            for (int j = 0; j < i; j++)
            {
                if (_migrations[j].FromVersion == migration.FromVersion)
                {
                    throw new ArgumentException("Duplicate migration source version.", nameof(migrations));
                }
            }
        }

        Array.Sort(_migrations, static (left, right) => left.FromVersion.CompareTo(right.FromVersion));
    }

    /// <summary>Gets the shared empty pipeline.</summary>
    public static UiDocumentMigrationPipeline Empty { get; } =
        new(ReadOnlySpan<IUiDocumentMigration>.Empty);

    /// <summary>Gets the number of registered migrations.</summary>
    public int Count => _migrations.Length;

    /// <summary>Runs the chain from one version to another.</summary>
    public bool TryMigrate(
        ReadOnlySpan<byte> source,
        int fromVersion,
        int toVersion,
        IBufferWriter<byte> destination,
        out UiDocumentError failure)
    {
        ArgumentNullException.ThrowIfNull(destination);
        if (toVersion <= fromVersion)
        {
            failure = new UiDocumentError(
                UiDocumentErrorCode.UnsupportedVersion,
                0,
                "Target version must be newer than the source version.");
            return false;
        }

        int current = fromVersion;
        ReadOnlySpan<byte> buffer = source;
        int steps = 0;
        while (current < toVersion)
        {
            if (++steps > MaxSteps)
            {
                failure = new UiDocumentError(
                    UiDocumentErrorCode.UnsupportedVersion,
                    0,
                    "Migration chain exceeds the step limit.");
                return false;
            }

            IUiDocumentMigration? migration = Find(current);
            if (migration is null)
            {
                failure = new UiDocumentError(
                    UiDocumentErrorCode.UnsupportedVersion,
                    0,
                    "No migration is registered for the document version.");
                return false;
            }

            ArrayBufferWriter<byte> scratch = (steps & 1) == 1 ? _scratchA : _scratchB;
            scratch.Clear();
            if (!migration.TryMigrate(buffer, scratch, out failure))
            {
                return false;
            }

            buffer = scratch.WrittenSpan;
            current = migration.ToVersion;
        }

        if (current != toVersion)
        {
            failure = new UiDocumentError(
                UiDocumentErrorCode.UnsupportedVersion,
                0,
                "Migration chain overshot the target version.");
            return false;
        }

        destination.Write(buffer);
        failure = UiDocumentError.None;
        return true;
    }

    private IUiDocumentMigration? Find(int version)
    {
        int low = 0;
        int high = _migrations.Length - 1;
        while (low <= high)
        {
            int middle = low + ((high - low) >> 1);
            int current = _migrations[middle].FromVersion;
            if (current == version)
            {
                return _migrations[middle];
            }

            if (current < version)
            {
                low = middle + 1;
            }
            else
            {
                high = middle - 1;
            }
        }

        return null;
    }
}
