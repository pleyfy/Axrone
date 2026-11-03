namespace Axrone.Lighting;

/// <summary>Base lighting failure with a stable error code.</summary>
public abstract class LightingEngineException : Exception
{
    /// <summary>Stable error code.</summary>
    public string Code { get; }

    /// <summary>Creates an error.</summary>
    protected LightingEngineException(string code, string message, Exception? inner = null)
        : base($"[{code}] {message}", inner)
    {
        Code = code;
    }
}

/// <summary>Lighting validation failure.</summary>
public sealed class LightingValidationException : LightingEngineException
{
    /// <summary>Creates an error.</summary>
    public LightingValidationException(string code, string message)
        : base(code, message)
    {
    }
}

/// <summary>Lighting state failure (disposed rig).</summary>
public sealed class LightingStateException : LightingEngineException
{
    /// <summary>Creates an error.</summary>
    public LightingStateException(string code, string message)
        : base(code, message)
    {
    }
}

/// <summary>Lighting serialization failure.</summary>
public sealed class LightingSerializationException : LightingEngineException
{
    /// <summary>Creates an error.</summary>
    public LightingSerializationException(string code, string message)
        : base(code, message)
    {
    }
}

/// <summary>Centralized throw paths (keeps hot paths inline).</summary>
internal static class ThrowHelper
{
    /// <summary>Throws a validation error.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowValidationError(string code, string message) =>
        throw new LightingValidationException(code, message);

    /// <summary>Throws a disposed-rig error.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowDisposed(RigId rigId) =>
        throw new LightingStateException("lighting.rig.disposed", $"LightingRig '{rigId.Value}' has been disposed or drained.");

    /// <summary>Throws a not-found error.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowNotFound(LightId id) =>
        throw new LightingValidationException("lighting.light.not-found", $"Light '{id.Value}' was not found in storage.");

    /// <summary>Throws a duplicate-id error.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowDuplicateId(LightId id) =>
        throw new LightingValidationException("lighting.light.duplicate-id", $"Light '{id.Value}' already exists in rig.");

    /// <summary>Throws a serialization error.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowSerializationError(string code, string message) =>
        throw new LightingSerializationException(code, message);

    /// <summary>Throws an invalid cascade-count mapping.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static T InvalidShadowCascadeCount<T>() =>
        throw new LightingValidationException(
            "lighting.shadow.invalid-cascade-count",
            "Shadow cascades must be exactly 1, 2, or 4.");

    /// <summary>Throws an invalid shadow configuration.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowShadowValidation(string message) =>
        throw new LightingValidationException("lighting.shadow.invalid", message);
}

/// <summary>Validation guards.</summary>
public static class LightingGuards
{
    /// <summary>Whether a float is finite.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool IsFinite(float value) => !float.IsNaN(value) && !float.IsInfinity(value);

    /// <summary>Whether all vector components are finite.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool IsFinite(in Vec3 v) => IsFinite(v.X) && IsFinite(v.Y) && IsFinite(v.Z);

    /// <summary>Validates vector finiteness.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void ValidateVectorFinite(in Vec3 v, string paramName)
    {
        if (!IsFinite(v))
        {
            ThrowHelper.ThrowValidationError("lighting.light.invalid-vector", $"Vector parameter '{paramName}' must contain finite numbers.");
        }
    }

    /// <summary>Validates and normalizes a direction.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Vec3 ValidateAndNormalize(in Vec3 direction)
    {
        ValidateVectorFinite(direction, nameof(direction));
        float lenSq = direction.LengthSquared();
        if (lenSq < 1e-12f)
        {
            ThrowHelper.ThrowValidationError("lighting.light.invalid-direction", "Direction vector length cannot be near-zero.");
        }

        return Vec3.Normalize(direction);
    }

    /// <summary>Validates an environment block.</summary>
    public static void ValidateEnvironment(in LightingEnvironment env)
    {
        if (!IsFinite(env.Ambient) || !IsFinite(env.Sky) || !IsFinite(env.Ground))
        {
            ThrowHelper.ThrowValidationError("lighting.environment.invalid-vector", "Environment radiance vectors must be finite.");
        }

        if (!IsFinite(env.Exposure) || env.Exposure < 0.0f)
        {
            ThrowHelper.ThrowValidationError("lighting.environment.out-of-range", "Exposure must be non-negative and finite.");
        }

        if (!IsFinite(env.Gamma) || env.Gamma <= 0.0f)
        {
            ThrowHelper.ThrowValidationError("lighting.environment.out-of-range", "Gamma must be strictly positive and finite.");
        }
    }

    /// <summary>Validates spot cone cosines.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void ValidateConeCosines(float innerCosine, float outerCosine)
    {
        if (!IsFinite(innerCosine) || !IsFinite(outerCosine))
        {
            ThrowHelper.ThrowValidationError("lighting.light.invalid-cone", "Cone cosines must be finite.");
        }

        if (innerCosine < 0.0f || innerCosine > 1.0f || outerCosine < 0.0f || outerCosine > 1.0f)
        {
            ThrowHelper.ThrowValidationError("lighting.light.invalid-cone", "Cone cosines must be within [0, 1].");
        }

        if (innerCosine < outerCosine)
        {
            ThrowHelper.ThrowValidationError("lighting.light.invalid-cone", "Inner cone cosine must be >= outer cone cosine.");
        }
    }
}
