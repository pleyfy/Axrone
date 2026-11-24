namespace Axrone.Scene.Runtime;

using System.Globalization;
using System.Text.Json;

/// <summary>Codec registration for runtime-owned data components.</summary>
public static class SceneRuntimeCodecs
{
    /// <summary>Registers codecs for every runtime component present in a registry.</summary>
    /// <param name="codecs">Codec catalog to register into.</param>
    /// <param name="components">Component registry that gates which codecs apply.</param>
    public static void Register(SceneCodecRegistry codecs, SceneComponentRegistry components)
    {
        ArgumentNullException.ThrowIfNull(codecs);
        ArgumentNullException.ThrowIfNull(components);

        if (components.TryGetDataByType(typeof(SceneRigidbody3D), out _))
        {
            codecs.Register(new SceneRigidbody3DCodec());
        }

        if (components.TryGetDataByType(typeof(SceneCollider3D), out _))
        {
            codecs.Register(new SceneCollider3DCodec());
        }

        if (components.TryGetDataByType(typeof(SceneRigidbody2D), out _))
        {
            codecs.Register(new SceneRigidbody2DCodec());
        }

        if (components.TryGetDataByType(typeof(SceneCollider2D), out _))
        {
            codecs.Register(new SceneCollider2DCodec());
        }

        if (components.TryGetDataByType(typeof(SceneParticleSystem), out _))
        {
            codecs.Register(new SceneParticleSystemCodec());
        }

        if (components.TryGetDataByType(typeof(SceneTerrainChunk3D), out _))
        {
            codecs.Register(new SceneTerrainChunk3DCodec());
        }

        if (components.TryGetDataByType(typeof(SceneAnimator), out _))
        {
            codecs.Register(new SceneAnimatorCodec());
        }

        if (components.TryGetDataByType(typeof(SceneAnimationBinding), out _))
        {
            codecs.Register(new SceneAnimationBindingCodec());
        }

        if (components.TryGetDataByType(typeof(ScenePathAgent), out _))
        {
            codecs.Register(new ScenePathAgentCodec());
        }

        RegisterJointCodecs(codecs, components);
    }

    private static void RegisterJointCodecs(SceneCodecRegistry codecs, SceneComponentRegistry components)
    {
        if (components.TryGetDataByType(typeof(SceneDistanceJoint2D), out _))
        {
            codecs.Register(new SceneDistanceJoint2DCodec());
        }

        if (components.TryGetDataByType(typeof(SceneHingeJoint2D), out _))
        {
            codecs.Register(new SceneHingeJoint2DCodec());
        }

        if (components.TryGetDataByType(typeof(SceneFixedJoint2D), out _))
        {
            codecs.Register(new SceneFixedJoint2DCodec());
        }

        if (components.TryGetDataByType(typeof(SceneSliderJoint2D), out _))
        {
            codecs.Register(new SceneSliderJoint2DCodec());
        }

        if (components.TryGetDataByType(typeof(SceneSpringJoint2D), out _))
        {
            codecs.Register(new SceneSpringJoint2DCodec());
        }

        if (components.TryGetDataByType(typeof(SceneMotorJoint2D), out _))
        {
            codecs.Register(new SceneMotorJoint2DCodec());
        }

        if (components.TryGetDataByType(typeof(SceneWheelJoint2D), out _))
        {
            codecs.Register(new SceneWheelJoint2DCodec());
        }

        if (components.TryGetDataByType(typeof(SceneRopeJoint2D), out _))
        {
            codecs.Register(new SceneRopeJoint2DCodec());
        }

        if (components.TryGetDataByType(typeof(SceneMouseJoint2D), out _))
        {
            codecs.Register(new SceneMouseJoint2DCodec());
        }

        if (components.TryGetDataByType(typeof(SceneGearJoint2D), out _))
        {
            codecs.Register(new SceneGearJoint2DCodec());
        }

        if (components.TryGetDataByType(typeof(SceneFixedJoint3D), out _))
        {
            codecs.Register(new SceneFixedJoint3DCodec());
        }

        if (components.TryGetDataByType(typeof(SceneHingeJoint3D), out _))
        {
            codecs.Register(new SceneHingeJoint3DCodec());
        }

        if (components.TryGetDataByType(typeof(SceneSliderJoint3D), out _))
        {
            codecs.Register(new SceneSliderJoint3DCodec());
        }

        if (components.TryGetDataByType(typeof(SceneSpringJoint3D), out _))
        {
            codecs.Register(new SceneSpringJoint3DCodec());
        }

        if (components.TryGetDataByType(typeof(SceneCharacterJoint3D), out _))
        {
            codecs.Register(new SceneCharacterJoint3DCodec());
        }

        if (components.TryGetDataByType(typeof(SceneConfigurableJoint3D), out _))
        {
            codecs.Register(new SceneConfigurableJoint3DCodec());
        }
    }
}

/// <summary>
/// Versioned JSON codec for <see cref="SceneAnimator"/>. Unknown versions,
/// non-finite speeds and inconsistent handles are rejected instead of being
/// silently coerced.
/// </summary>
public sealed class SceneAnimatorCodec : SceneDataCodec<SceneAnimator>
{
    /// <summary>Payload version written by this codec.</summary>
    public const int CurrentVersion = 1;

    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneAnimator value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        writer.WriteNumber("version", CurrentVersion);
        writer.WriteNumber("slot", value.Handle.Slot);
        writer.WriteNumber("generation", value.Handle.Generation);
        writer.WriteNumber("speed", value.Speed);
        writer.WriteBoolean("paused", value.Paused);
        writer.WriteBoolean("enabled", value.Enabled);
        writer.WriteBoolean("applyRootMotion", value.ApplyRootMotion);
        writer.WriteNumber("activeLayer", value.ActiveLayer);
        writer.WriteNumber("morphCurveOffset", value.MorphCurveOffset);
        writer.WriteNumber("morphCurveCount", value.MorphCurveCount);
    }

    /// <inheritdoc/>
    public override SceneAnimator Read(JsonElement data)
    {
        ReadVersion(data, CurrentVersion, "SceneAnimator");
        int slot = data.TryGetProperty("slot", out JsonElement slotElement) ? slotElement.GetInt32() : -1;
        uint generation = data.TryGetProperty("generation", out JsonElement generationElement) ? generationElement.GetUInt32() : 0;

        if (slot < -1 || (slot == -1 && generation != 0) || (slot >= 0 && generation == 0))
        {
            throw Invalid($"SceneAnimator handle slot {slot} / generation {generation} is inconsistent.");
        }

        SceneAnimator value = SceneAnimator.Default;
        value.Handle = new SceneAnimatorHandle(slot, generation);

        if (data.TryGetProperty("speed", out JsonElement speed))
        {
            value.Speed = speed.GetSingle();
        }

        if (data.TryGetProperty("paused", out JsonElement paused))
        {
            value.Paused = paused.GetBoolean();
        }

        if (data.TryGetProperty("enabled", out JsonElement enabled))
        {
            value.Enabled = enabled.GetBoolean();
        }

        if (data.TryGetProperty("applyRootMotion", out JsonElement applyRootMotion))
        {
            value.ApplyRootMotion = applyRootMotion.GetBoolean();
        }

        if (data.TryGetProperty("activeLayer", out JsonElement activeLayer))
        {
            value.ActiveLayer = activeLayer.GetInt32();
        }

        if (data.TryGetProperty("morphCurveOffset", out JsonElement morphOffset))
        {
            value.MorphCurveOffset = morphOffset.GetInt32();
        }

        if (data.TryGetProperty("morphCurveCount", out JsonElement morphCount))
        {
            value.MorphCurveCount = morphCount.GetInt32();
        }

        if (!float.IsFinite(value.Speed))
        {
            throw Invalid($"SceneAnimator speed {value.Speed} must be finite.");
        }

        if (value.ActiveLayer < 0)
        {
            throw Invalid($"SceneAnimator activeLayer {value.ActiveLayer} must not be negative.");
        }

        if (value.MorphCurveOffset < 0 || value.MorphCurveCount < 0)
        {
            throw Invalid($"SceneAnimator morph range {value.MorphCurveOffset}/{value.MorphCurveCount} must not be negative.");
        }

        return value;
    }

    private static int ReadVersion(JsonElement data, int currentVersion, string component)
    {
        if (!data.TryGetProperty("version", out JsonElement versionElement))
        {
            return currentVersion;
        }

        if (!versionElement.TryGetInt32(out int version) || version != currentVersion)
        {
            throw Invalid($"{component} payload version '{versionElement}' is not supported.");
        }

        return version;
    }

    private static SceneValidationException Invalid(string message) =>
        new(SceneErrorCodes.ValidationInvalid, message);
}

/// <summary>
/// Versioned JSON codec for <see cref="SceneAnimationBinding"/>. The skin is
/// required; the default clip is optional so a host can choose one in code.
/// </summary>
public sealed class SceneAnimationBindingCodec : SceneDataCodec<SceneAnimationBinding>
{
    /// <summary>Payload version written by this codec.</summary>
    public const int CurrentVersion = 1;

    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneAnimationBinding value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        writer.WriteNumber("version", CurrentVersion);
        writer.WriteString("skin", value.Skin.Value.Value.ToString("X16", CultureInfo.InvariantCulture));
        if (value.DefaultClip.IsValid)
        {
            writer.WriteString("defaultClip", value.DefaultClip.Value.Value.ToString("X16", CultureInfo.InvariantCulture));
        }
    }

    /// <inheritdoc/>
    public override SceneAnimationBinding Read(JsonElement data)
    {
        ReadVersion(data, CurrentVersion, "SceneAnimationBinding");

        if (!TryReadSymbol(data, "skin", out ulong skinValue) || skinValue == 0UL)
        {
            throw Invalid("SceneAnimationBinding skin id is missing or empty.");
        }

        ulong clipValue = 0UL;
        if (data.TryGetProperty("defaultClip", out _))
        {
            _ = TryReadSymbol(data, "defaultClip", out clipValue);
        }

        return new SceneAnimationBinding
        {
            Skin = SceneAssetId<SkinAssetTag>.FromSymbol(new SceneStringId(skinValue)),
            DefaultClip = SceneAssetId<AnimationAssetTag>.FromSymbol(new SceneStringId(clipValue)),
        };
    }

    private static bool TryReadSymbol(JsonElement data, string property, out ulong value)
    {
        value = 0UL;
        return data.TryGetProperty(property, out JsonElement element) &&
            element.ValueKind == JsonValueKind.String &&
            ulong.TryParse(element.GetString(), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out value);
    }

    private static int ReadVersion(JsonElement data, int currentVersion, string component)
    {
        if (!data.TryGetProperty("version", out JsonElement versionElement))
        {
            return currentVersion;
        }

        if (!versionElement.TryGetInt32(out int version) || version != currentVersion)
        {
            throw Invalid($"{component} version {versionElement.GetRawText()} is unsupported.");
        }

        return version;
    }

    private static SceneValidationException Invalid(string message) =>
        new(SceneErrorCodes.ValidationInvalid, message);
}

/// <summary>
/// Versioned JSON codec for <see cref="ScenePathAgent"/>. Waypoint storage is
/// bridge-owned runtime state; the payload preserves the path reference and the
/// steering configuration so a rebound agent resumes deterministically.
/// </summary>
public sealed class ScenePathAgentCodec : SceneDataCodec<ScenePathAgent>
{
    /// <summary>Payload version written by this codec.</summary>
    public const int CurrentVersion = 1;

    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in ScenePathAgent value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        writer.WriteNumber("version", CurrentVersion);
        writer.WriteNumber("slot", value.Path.Slot);
        writer.WriteNumber("generation", value.Path.Generation);
        writer.WriteNumber("speed", value.Speed);
        writer.WriteNumber("arrivalThreshold", value.ArrivalThreshold);
        writer.WriteNumber("turnRateRadians", value.TurnRateRadians);
        writer.WriteNumber("avoidanceRadius", value.AvoidanceRadius);
        writer.WriteBoolean("loop", value.Loop);
        writer.WriteBoolean("enabled", value.Enabled);
        writer.WriteNumber("startWaypoint", value.StartWaypoint);
    }

    /// <inheritdoc/>
    public override ScenePathAgent Read(JsonElement data)
    {
        if (data.TryGetProperty("version", out JsonElement versionElement) &&
            (!versionElement.TryGetInt32(out int version) || version != CurrentVersion))
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                $"ScenePathAgent payload version '{versionElement}' is not supported.");
        }

        int slot = data.TryGetProperty("slot", out JsonElement slotElement) ? slotElement.GetInt32() : -1;
        uint generation = data.TryGetProperty("generation", out JsonElement generationElement) ? generationElement.GetUInt32() : 0;
        if (slot < -1 || (slot == -1 && generation != 0) || (slot >= 0 && generation == 0))
        {
            throw Invalid($"ScenePathAgent path slot {slot} / generation {generation} is inconsistent.");
        }

        ScenePathAgent value = ScenePathAgent.Default;
        value.Path = new ScenePathHandle(slot, generation);

        if (data.TryGetProperty("speed", out JsonElement speed))
        {
            value.Speed = speed.GetSingle();
        }

        if (data.TryGetProperty("arrivalThreshold", out JsonElement arrivalThreshold))
        {
            value.ArrivalThreshold = arrivalThreshold.GetSingle();
        }

        if (data.TryGetProperty("turnRateRadians", out JsonElement turnRate))
        {
            value.TurnRateRadians = turnRate.GetSingle();
        }

        if (data.TryGetProperty("avoidanceRadius", out JsonElement avoidanceRadius))
        {
            value.AvoidanceRadius = avoidanceRadius.GetSingle();
        }

        if (data.TryGetProperty("loop", out JsonElement loop))
        {
            value.Loop = loop.GetBoolean();
        }

        if (data.TryGetProperty("enabled", out JsonElement enabled))
        {
            value.Enabled = enabled.GetBoolean();
        }

        if (data.TryGetProperty("startWaypoint", out JsonElement startWaypoint))
        {
            value.StartWaypoint = startWaypoint.GetInt32();
        }

        if (!float.IsFinite(value.Speed) || value.Speed < 0.0f)
        {
            throw Invalid($"ScenePathAgent speed {value.Speed} must be finite and non-negative.");
        }

        if (!float.IsFinite(value.ArrivalThreshold) || value.ArrivalThreshold < 0.0f)
        {
            throw Invalid($"ScenePathAgent arrivalThreshold {value.ArrivalThreshold} must be finite and non-negative.");
        }

        if (!float.IsFinite(value.TurnRateRadians) || value.TurnRateRadians < 0.0f)
        {
            throw Invalid($"ScenePathAgent turnRateRadians {value.TurnRateRadians} must be finite and non-negative.");
        }

        if (!float.IsFinite(value.AvoidanceRadius) || value.AvoidanceRadius < 0.0f)
        {
            throw Invalid($"ScenePathAgent avoidanceRadius {value.AvoidanceRadius} must be finite and non-negative.");
        }

        if (value.StartWaypoint < 0)
        {
            throw Invalid($"ScenePathAgent startWaypoint {value.StartWaypoint} must not be negative.");
        }

        return value;
    }

    private static SceneValidationException Invalid(string message) =>
        new(SceneErrorCodes.ValidationInvalid, message);
}

/// <summary>JSON codec for <see cref="SceneTerrainChunk3D"/>.</summary>
public sealed class SceneTerrainChunk3DCodec : SceneDataCodec<SceneTerrainChunk3D>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneTerrainChunk3D value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        writer.WriteNumber("terrainId", value.TerrainId);
        writer.WriteNumber("chunkX", value.ChunkX);
        writer.WriteNumber("chunkZ", value.ChunkZ);
        writer.WriteNumber("lodLevel", value.LodLevel);
        writer.WriteBoolean("enabled", value.Enabled);
    }

    /// <inheritdoc/>
    public override SceneTerrainChunk3D Read(JsonElement data)
    {
        SceneTerrainChunk3D value = SceneTerrainChunk3D.Default;

        if (data.TryGetProperty("terrainId", out JsonElement terrainId))
        {
            value.TerrainId = terrainId.GetUInt32();
        }

        if (data.TryGetProperty("chunkX", out JsonElement chunkX))
        {
            value.ChunkX = chunkX.GetInt32();
        }

        if (data.TryGetProperty("chunkZ", out JsonElement chunkZ))
        {
            value.ChunkZ = chunkZ.GetInt32();
        }

        if (data.TryGetProperty("lodLevel", out JsonElement lodLevel))
        {
            value.LodLevel = lodLevel.GetInt32();
        }

        if (data.TryGetProperty("enabled", out JsonElement enabled))
        {
            value.Enabled = enabled.GetBoolean();
        }

        return value;
    }
}

/// <summary>JSON codec for <see cref="SceneRigidbody3D"/>.</summary>
public sealed class SceneRigidbody3DCodec : SceneDataCodec<SceneRigidbody3D>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneRigidbody3D value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        writer.WriteString("bodyType", SceneRuntimeJson.WriteBodyType(value.BodyType));
        SceneRuntimeJson.WriteVec3(writer, "linearVelocity", value.LinearVelocity);
        SceneRuntimeJson.WriteVec3(writer, "angularVelocity", value.AngularVelocity);
        writer.WriteNumber("linearDamping", value.LinearDamping);
        writer.WriteNumber("angularDamping", value.AngularDamping);
        writer.WriteNumber("gravityScale", value.GravityScale);
        writer.WriteNumber("mass", value.Mass);
        writer.WriteBoolean("enabled", value.Enabled);
    }

    /// <inheritdoc/>
    public override SceneRigidbody3D Read(JsonElement data)
    {
        SceneRigidbody3D value = SceneRigidbody3D.Default;

        if (data.TryGetProperty("bodyType", out JsonElement bodyType))
        {
            value.BodyType = SceneRuntimeJson.ReadBodyType(bodyType);
        }

        if (data.TryGetProperty("linearVelocity", out JsonElement linearVelocity))
        {
            value.LinearVelocity = SceneRuntimeJson.ReadVec3(linearVelocity, "linearVelocity");
        }

        if (data.TryGetProperty("angularVelocity", out JsonElement angularVelocity))
        {
            value.AngularVelocity = SceneRuntimeJson.ReadVec3(angularVelocity, "angularVelocity");
        }

        if (data.TryGetProperty("linearDamping", out JsonElement linearDamping))
        {
            value.LinearDamping = linearDamping.GetSingle();
        }

        if (data.TryGetProperty("angularDamping", out JsonElement angularDamping))
        {
            value.AngularDamping = angularDamping.GetSingle();
        }

        if (data.TryGetProperty("gravityScale", out JsonElement gravityScale))
        {
            value.GravityScale = gravityScale.GetSingle();
        }

        if (data.TryGetProperty("mass", out JsonElement mass))
        {
            value.Mass = mass.GetSingle();
        }

        if (data.TryGetProperty("enabled", out JsonElement enabled))
        {
            value.Enabled = enabled.GetBoolean();
        }

        return value;
    }
}

/// <summary>JSON codec for <see cref="SceneCollider3D"/>.</summary>
public sealed class SceneCollider3DCodec : SceneDataCodec<SceneCollider3D>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneCollider3D value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        writer.WriteString("shape", SceneRuntimeJson.WriteShape(value.Shape));
        SceneRuntimeJson.WriteVec3(writer, "boxHalfExtents", value.BoxHalfExtents);
        writer.WriteNumber("radius", value.Radius);
        writer.WriteNumber("capsuleHalfHeight", value.CapsuleHalfHeight);
        SceneRuntimeJson.WriteVec3(writer, "offset", value.Offset);
        writer.WriteNumber("density", value.Density);
        writer.WriteNumber("friction", value.Friction);
        writer.WriteNumber("restitution", value.Restitution);
        writer.WriteBoolean("trigger", value.IsTrigger);
        writer.WriteBoolean("enabled", value.Enabled);
    }

    /// <inheritdoc/>
    public override SceneCollider3D Read(JsonElement data)
    {
        SceneCollider3D value = SceneCollider3D.Default;

        if (data.TryGetProperty("shape", out JsonElement shape))
        {
            value.Shape = SceneRuntimeJson.ReadShape(shape);
        }

        if (data.TryGetProperty("boxHalfExtents", out JsonElement boxHalfExtents))
        {
            value.BoxHalfExtents = SceneRuntimeJson.ReadVec3(boxHalfExtents, "boxHalfExtents");
        }

        if (data.TryGetProperty("radius", out JsonElement radius))
        {
            value.Radius = radius.GetSingle();
        }

        if (data.TryGetProperty("capsuleHalfHeight", out JsonElement capsuleHalfHeight))
        {
            value.CapsuleHalfHeight = capsuleHalfHeight.GetSingle();
        }

        if (data.TryGetProperty("offset", out JsonElement offset))
        {
            value.Offset = SceneRuntimeJson.ReadVec3(offset, "offset");
        }

        if (data.TryGetProperty("density", out JsonElement density))
        {
            value.Density = density.GetSingle();
        }

        if (data.TryGetProperty("friction", out JsonElement friction))
        {
            value.Friction = friction.GetSingle();
        }

        if (data.TryGetProperty("restitution", out JsonElement restitution))
        {
            value.Restitution = restitution.GetSingle();
        }

        if (data.TryGetProperty("trigger", out JsonElement trigger))
        {
            value.IsTrigger = trigger.GetBoolean();
        }

        if (data.TryGetProperty("enabled", out JsonElement enabled))
        {
            value.Enabled = enabled.GetBoolean();
        }

        return value;
    }
}

/// <summary>JSON codec for <see cref="SceneRigidbody2D"/>.</summary>
public sealed class SceneRigidbody2DCodec : SceneDataCodec<SceneRigidbody2D>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneRigidbody2D value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        writer.WriteString("bodyType", SceneRuntimeJson.WriteBodyType(value.BodyType));
        SceneRuntimeJson.WriteVec2(writer, "linearVelocity", value.LinearVelocity);
        writer.WriteNumber("angularVelocity", value.AngularVelocity);
        writer.WriteNumber("linearDamping", value.LinearDamping);
        writer.WriteNumber("angularDamping", value.AngularDamping);
        writer.WriteNumber("gravityScale", value.GravityScale);
        writer.WriteNumber("mass", value.Mass);
        writer.WriteBoolean("enabled", value.Enabled);
    }

    /// <inheritdoc/>
    public override SceneRigidbody2D Read(JsonElement data)
    {
        SceneRigidbody2D value = SceneRigidbody2D.Default;

        if (data.TryGetProperty("bodyType", out JsonElement bodyType))
        {
            value.BodyType = SceneRuntimeJson.ReadBodyType(bodyType);
        }

        if (data.TryGetProperty("linearVelocity", out JsonElement linearVelocity))
        {
            value.LinearVelocity = SceneRuntimeJson.ReadVec2(linearVelocity, "linearVelocity");
        }

        if (data.TryGetProperty("angularVelocity", out JsonElement angularVelocity))
        {
            value.AngularVelocity = angularVelocity.GetSingle();
        }

        if (data.TryGetProperty("linearDamping", out JsonElement linearDamping))
        {
            value.LinearDamping = linearDamping.GetSingle();
        }

        if (data.TryGetProperty("angularDamping", out JsonElement angularDamping))
        {
            value.AngularDamping = angularDamping.GetSingle();
        }

        if (data.TryGetProperty("gravityScale", out JsonElement gravityScale))
        {
            value.GravityScale = gravityScale.GetSingle();
        }

        if (data.TryGetProperty("mass", out JsonElement mass))
        {
            value.Mass = mass.GetSingle();
        }

        if (data.TryGetProperty("enabled", out JsonElement enabled))
        {
            value.Enabled = enabled.GetBoolean();
        }

        return value;
    }
}

/// <summary>JSON codec for <see cref="SceneCollider2D"/>.</summary>
public sealed class SceneCollider2DCodec : SceneDataCodec<SceneCollider2D>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneCollider2D value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        writer.WriteString("shape", SceneRuntimeJson.WriteShape(value.Shape));
        SceneRuntimeJson.WriteVec2(writer, "boxHalfExtents", value.BoxHalfExtents);
        writer.WriteNumber("radius", value.Radius);
        writer.WriteNumber("capsuleHalfHeight", value.CapsuleHalfHeight);
        SceneRuntimeJson.WriteVec2(writer, "offset", value.Offset);
        writer.WriteNumber("density", value.Density);
        writer.WriteNumber("friction", value.Friction);
        writer.WriteNumber("restitution", value.Restitution);
        writer.WriteBoolean("trigger", value.IsTrigger);
        writer.WriteBoolean("enabled", value.Enabled);
    }

    /// <inheritdoc/>
    public override SceneCollider2D Read(JsonElement data)
    {
        SceneCollider2D value = SceneCollider2D.Default;

        if (data.TryGetProperty("shape", out JsonElement shape))
        {
            value.Shape = SceneRuntimeJson.ReadShape2D(shape);
        }

        if (data.TryGetProperty("boxHalfExtents", out JsonElement boxHalfExtents))
        {
            value.BoxHalfExtents = SceneRuntimeJson.ReadVec2(boxHalfExtents, "boxHalfExtents");
        }

        if (data.TryGetProperty("radius", out JsonElement radius))
        {
            value.Radius = radius.GetSingle();
        }

        if (data.TryGetProperty("capsuleHalfHeight", out JsonElement capsuleHalfHeight))
        {
            value.CapsuleHalfHeight = capsuleHalfHeight.GetSingle();
        }

        if (data.TryGetProperty("offset", out JsonElement offset))
        {
            value.Offset = SceneRuntimeJson.ReadVec2(offset, "offset");
        }

        if (data.TryGetProperty("density", out JsonElement density))
        {
            value.Density = density.GetSingle();
        }

        if (data.TryGetProperty("friction", out JsonElement friction))
        {
            value.Friction = friction.GetSingle();
        }

        if (data.TryGetProperty("restitution", out JsonElement restitution))
        {
            value.Restitution = restitution.GetSingle();
        }

        if (data.TryGetProperty("trigger", out JsonElement trigger))
        {
            value.IsTrigger = trigger.GetBoolean();
        }

        if (data.TryGetProperty("enabled", out JsonElement enabled))
        {
            value.Enabled = enabled.GetBoolean();
        }

        return value;
    }
}

/// <summary>JSON codec for <see cref="SceneParticleSystem"/>.</summary>
public sealed class SceneParticleSystemCodec : SceneDataCodec<SceneParticleSystem>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneParticleSystem value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        writer.WriteBoolean("enabled", value.Enabled);
        writer.WriteBoolean("playing", value.Playing);
        writer.WriteNumber("emissionRate", value.EmissionRate);
        writer.WriteNumber("startLifetime", value.StartLifetime);
        writer.WriteNumber("startSpeed", value.StartSpeed);
        writer.WriteNumber("startSize", value.StartSize);
        SceneRuntimeJson.WriteVec4(writer, "startColor", value.StartColor);
        writer.WriteNumber("spread", value.Spread);
        writer.WriteNumber("maxParticles", value.MaxParticles);
    }

    /// <inheritdoc/>
    public override SceneParticleSystem Read(JsonElement data)
    {
        SceneParticleSystem value = SceneParticleSystem.Default;

        if (data.TryGetProperty("enabled", out JsonElement enabled))
        {
            value.Enabled = enabled.GetBoolean();
        }

        if (data.TryGetProperty("playing", out JsonElement playing))
        {
            value.Playing = playing.GetBoolean();
        }

        if (data.TryGetProperty("emissionRate", out JsonElement emissionRate))
        {
            value.EmissionRate = emissionRate.GetSingle();
        }

        if (data.TryGetProperty("startLifetime", out JsonElement startLifetime))
        {
            value.StartLifetime = startLifetime.GetSingle();
        }

        if (data.TryGetProperty("startSpeed", out JsonElement startSpeed))
        {
            value.StartSpeed = startSpeed.GetSingle();
        }

        if (data.TryGetProperty("startSize", out JsonElement startSize))
        {
            value.StartSize = startSize.GetSingle();
        }

        if (data.TryGetProperty("startColor", out JsonElement startColor))
        {
            value.StartColor = SceneRuntimeJson.ReadVec4(startColor, "startColor");
        }

        if (data.TryGetProperty("spread", out JsonElement spread))
        {
            value.Spread = spread.GetSingle();
        }

        if (data.TryGetProperty("maxParticles", out JsonElement maxParticles))
        {
            value.MaxParticles = maxParticles.GetInt32();
        }

        return value;
    }
}

/// <summary>Shared JSON primitives for the runtime codecs.</summary>
internal static class SceneRuntimeJson
{
    public static void WriteVec2(Utf8JsonWriter writer, string name, in Vec2 value)
    {
        writer.WriteStartArray(name);
        writer.WriteNumberValue(value.X);
        writer.WriteNumberValue(value.Y);
        writer.WriteEndArray();
    }

    public static void WriteVec3(Utf8JsonWriter writer, string name, in Vec3 value)
    {
        writer.WriteStartArray(name);
        writer.WriteNumberValue(value.X);
        writer.WriteNumberValue(value.Y);
        writer.WriteNumberValue(value.Z);
        writer.WriteEndArray();
    }

    public static void WriteVec4(Utf8JsonWriter writer, string name, in Vec4 value)
    {
        writer.WriteStartArray(name);
        writer.WriteNumberValue(value.X);
        writer.WriteNumberValue(value.Y);
        writer.WriteNumberValue(value.Z);
        writer.WriteNumberValue(value.W);
        writer.WriteEndArray();
    }

    public static Vec2 ReadVec2(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Array || element.GetArrayLength() < 2)
        {
            throw Invalid($"'{name}' must be a two-component array.");
        }

        return new Vec2(
            element[0].GetSingle(),
            element[1].GetSingle());
    }

    public static Vec3 ReadVec3(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Array || element.GetArrayLength() < 3)
        {
            throw Invalid($"'{name}' must be a three-component array.");
        }

        return new Vec3(
            element[0].GetSingle(),
            element[1].GetSingle(),
            element[2].GetSingle());
    }

    public static Vec4 ReadVec4(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Array || element.GetArrayLength() < 4)
        {
            throw Invalid($"'{name}' must be a four-component array.");
        }

        return new Vec4(
            element[0].GetSingle(),
            element[1].GetSingle(),
            element[2].GetSingle(),
            element[3].GetSingle());
    }

    public static string WriteBodyType(SceneBodyType type) => type switch
    {
        SceneBodyType.Static => "static",
        SceneBodyType.Kinematic => "kinematic",
        _ => "dynamic"
    };

    public static SceneBodyType ReadBodyType(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.String)
        {
            throw Invalid("Rigidbody 'bodyType' must be a string.");
        }

        return element.GetString() switch
        {
            "dynamic" => SceneBodyType.Dynamic,
            "static" => SceneBodyType.Static,
            "kinematic" => SceneBodyType.Kinematic,
            _ => throw Invalid(
                $"Rigidbody 'bodyType' must be 'dynamic', 'static' or 'kinematic'; received '{element.GetString()}'.")
        };
    }

    public static string WriteShape(SceneColliderShape3D shape) => shape switch
    {
        SceneColliderShape3D.Box => "box",
        SceneColliderShape3D.Capsule => "capsule",
        _ => "sphere"
    };

    public static SceneColliderShape3D ReadShape(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.String)
        {
            throw Invalid("Collider 'shape' must be a string.");
        }

        return element.GetString() switch
        {
            "sphere" => SceneColliderShape3D.Sphere,
            "box" => SceneColliderShape3D.Box,
            "capsule" => SceneColliderShape3D.Capsule,
            _ => throw Invalid(
                $"Collider 'shape' must be 'sphere', 'box' or 'capsule'; received '{element.GetString()}'.")
        };
    }

    public static string WriteShape(SceneColliderShape2D shape) => shape switch
    {
        SceneColliderShape2D.Box => "box",
        SceneColliderShape2D.Capsule => "capsule",
        _ => "circle"
    };

    public static SceneColliderShape2D ReadShape2D(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.String)
        {
            throw Invalid("Collider 'shape' must be a string.");
        }

        return element.GetString() switch
        {
            "circle" => SceneColliderShape2D.Circle,
            "box" => SceneColliderShape2D.Box,
            "capsule" => SceneColliderShape2D.Capsule,
            _ => throw Invalid(
                $"Collider 'shape' must be 'circle', 'box' or 'capsule'; received '{element.GetString()}'.")
        };
    }

    [DoesNotReturn]
    public static SceneValidationException Invalid(string message) =>
        throw new SceneValidationException(SceneErrorCodes.ValidationInvalid, message);
}
