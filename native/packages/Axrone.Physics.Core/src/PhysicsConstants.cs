namespace Axrone.Physics.Core;

using Axrone.Numeric;

/// <summary>
/// Canonical physics tuning: gravity defaults, velocity caps, slops,
/// Baumgarte factors, solver budgets, correction caps and sleep thresholds.
/// Mirrors the web physics-core constant table; solvers and worlds take
/// their defaults from here so both dimensions push with the same hand.
/// </summary>
public static class PhysicsConstants
{
    /// <summary>Earth-like planar gravity.</summary>
    public static Vec2 DefaultGravity2D => new(0.0f, -9.81f);

    /// <summary>Earth-like spatial gravity.</summary>
    public static Vec3 DefaultGravity3D => new(0.0f, -9.81f, 0.0f);

    /// <summary>Linear speed cap.</summary>
    public const float MaxVelocity = 200.0f;

    /// <summary>Angular speed cap in radians per second.</summary>
    public const float MaxAngularVelocity = 250.0f;

    /// <summary>Penetration allowance that never corrects; rests stay quiet.</summary>
    public const float LinearSlop = 0.005f;

    /// <summary>Two degrees in radians; angular allowance that stays quiet.</summary>
    public const float AngularSlop = 2.0f / 180.0f * MathF.PI;

    /// <summary>Fraction of the error corrected per position sweep.</summary>
    public const float BaumgarteFactor = 0.2f;

    /// <summary>Time-of-impact Baumgarte factor for CCD.</summary>
    public const float ToiBaumgarte = 0.75f;

    /// <summary>General numerical epsilon.</summary>
    public const float Epsilon = 1e-6f;

    /// <summary>Solver substep budget.</summary>
    public const int MaxSubSteps = 8;

    /// <summary>Time-of-impact contact budget.</summary>
    public const int MaxToiContacts = 32;

    /// <summary>Approach speed above which restitution kicks in.</summary>
    public const float VelocityThreshold = 1.0f;

    /// <summary>Largest linear correction applied in one sweep.</summary>
    public const float MaxLinearCorrection = 0.2f;

    /// <summary>Eight degrees in radians; largest angular correction per sweep.</summary>
    public const float MaxAngularCorrection = 8.0f / 180.0f * MathF.PI;

    /// <summary>
    /// Metres of integration travel one step may buy a body, whatever its
    /// velocity. Anti-teleport budget: a body over the cap advances along its
    /// velocity direction and stops there instead of vanishing across scenery.
    /// </summary>
    public const float MaxTranslation = 2.0f;

    /// <summary>Quarter turn in radians; largest integrated rotation one step may buy a body.</summary>
    public const float MaxRotation = 0.5f * MathF.PI;

    /// <summary>
    /// Gap in metres a tracked solid pair may open and still be carried to the
    /// next step. Below it the pair keeps its identity, warm start and Stay
    /// events; above it the pair breaks and reports Ended.
    /// </summary>
    public const float ContactBreakThreshold = 0.02f;

    /// <summary>
    /// Squared metres a contact point's witness may travel in one step and keep
    /// its accumulated impulses. A point that jumped further is a different
    /// piece of geometry, so its carry is dropped instead of misapplied.
    /// </summary>
    public const float ContactPersistentThresholdSq = 0.01f;

    /// <summary>Quiet seconds before an island sleeps.</summary>
    public const float SleepTime = 0.5f;

    /// <summary>Linear speed below which a body counts as quiet.</summary>
    public const float LinearSleepTolerance = 0.01f;

    /// <summary>Two degrees per second in radians; angular quiet threshold.</summary>
    public const float AngularSleepTolerance = 2.0f / 180.0f * MathF.PI;
}
