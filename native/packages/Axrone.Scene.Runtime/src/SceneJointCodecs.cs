namespace Axrone.Scene.Runtime;

using System.Text.Json;

/// <summary>Shared JSON primitives for joint payloads and reference fields.</summary>
internal static class SceneJointJson
{
    public static void WriteRef(Utf8JsonWriter writer, string name, in SceneJointActorRef value)
    {
        writer.WriteStartObject(name);
        writer.WriteNumber("slot", value.Slot);
        writer.WriteNumber("generation", value.Generation);
        writer.WriteEndObject();
    }

    public static void WriteJointRef(Utf8JsonWriter writer, string name, in SceneJointRef2D value)
    {
        writer.WriteStartObject(name);
        writer.WriteNumber("slot", value.Slot);
        writer.WriteNumber("generation", value.Generation);
        writer.WriteNumber("kind", (int)value.Kind);
        writer.WriteEndObject();
    }

    public static SceneJointActorRef ReadRef(JsonElement data, string name)
    {
        if (!data.TryGetProperty(name, out JsonElement element) || element.ValueKind == JsonValueKind.Null)
        {
            return SceneJointActorRef.Invalid;
        }

        if (element.ValueKind != JsonValueKind.Object)
        {
            throw SceneRuntimeJson.Invalid($"'{name}' must be an object with 'slot' and 'generation'.");
        }

        int slot = element.TryGetProperty("slot", out JsonElement slotElement) ? slotElement.GetInt32() : -1;
        uint generation = element.TryGetProperty("generation", out JsonElement generationElement)
            ? generationElement.GetUInt32()
            : 0u;

        if (slot < -1 || (slot == -1 && generation != 0u) || (slot >= 0 && generation == 0u))
        {
            throw SceneRuntimeJson.Invalid($"'{name}' slot {slot} / generation {generation} is inconsistent.");
        }

        return new SceneJointActorRef(slot, generation);
    }

    public static SceneJointRef2D ReadJointRef(JsonElement data, string name)
    {
        if (!data.TryGetProperty(name, out JsonElement element) || element.ValueKind == JsonValueKind.Null)
        {
            return SceneJointRef2D.Invalid;
        }

        if (element.ValueKind != JsonValueKind.Object)
        {
            throw SceneRuntimeJson.Invalid($"'{name}' must be an object with 'slot', 'generation' and 'kind'.");
        }

        int slot = element.TryGetProperty("slot", out JsonElement slotElement) ? slotElement.GetInt32() : -1;
        uint generation = element.TryGetProperty("generation", out JsonElement generationElement)
            ? generationElement.GetUInt32()
            : 0u;
        int kindRaw = element.TryGetProperty("kind", out JsonElement kindElement) ? kindElement.GetInt32() : 0;

        if (slot < -1 || (slot == -1 && generation != 0u) || (slot >= 0 && generation == 0u))
        {
            throw SceneRuntimeJson.Invalid($"'{name}' slot {slot} / generation {generation} is inconsistent.");
        }

        if (slot == -1)
        {
            return SceneJointRef2D.Invalid;
        }

        if (!Enum.IsDefined(typeof(SceneJointKind2D), kindRaw))
        {
            throw SceneRuntimeJson.Invalid($"'{name}' kind '{kindRaw}' is not a known 2D joint kind.");
        }

        return new SceneJointRef2D(slot, generation, (SceneJointKind2D)kindRaw);
    }

    public static void WriteScalar(Utf8JsonWriter writer, string name, float value)
    {
        if (float.IsPositiveInfinity(value))
        {
            writer.WriteNull(name);
            return;
        }

        if (!float.IsFinite(value))
        {
            throw SceneRuntimeJson.Invalid($"Joint scalar '{name}' must be finite or positive infinity.");
        }

        writer.WriteNumber(name, value);
    }

    public static float ReadScalar(JsonElement data, string name, float current)
    {
        if (!data.TryGetProperty(name, out JsonElement element))
        {
            return current;
        }

        if (element.ValueKind == JsonValueKind.Null)
        {
            return float.PositiveInfinity;
        }

        return element.GetSingle();
    }

    public static bool ReadBool(JsonElement data, string name, bool current)
    {
        if (!data.TryGetProperty(name, out JsonElement element) || element.ValueKind == JsonValueKind.Null)
        {
            return current;
        }

        return element.GetBoolean();
    }

    public static int ReadInt32(JsonElement data, string name, int current)
    {
        if (!data.TryGetProperty(name, out JsonElement element) || element.ValueKind == JsonValueKind.Null)
        {
            return current;
        }

        return element.GetInt32();
    }

    public static void WriteVec2(Utf8JsonWriter writer, string name, in Vec2 value)
    {
        if (!float.IsFinite(value.X) || !float.IsFinite(value.Y))
        {
            throw SceneRuntimeJson.Invalid($"Joint vector '{name}' must have finite components.");
        }

        writer.WriteStartArray(name);
        writer.WriteNumberValue(value.X);
        writer.WriteNumberValue(value.Y);
        writer.WriteEndArray();
    }

    public static void WriteVec3(Utf8JsonWriter writer, string name, in Vec3 value)
    {
        if (!float.IsFinite(value.X) || !float.IsFinite(value.Y) || !float.IsFinite(value.Z))
        {
            throw SceneRuntimeJson.Invalid($"Joint vector '{name}' must have finite components.");
        }

        writer.WriteStartArray(name);
        writer.WriteNumberValue(value.X);
        writer.WriteNumberValue(value.Y);
        writer.WriteNumberValue(value.Z);
        writer.WriteEndArray();
    }

    public static void WriteQuat(Utf8JsonWriter writer, string name, in Quat value)
    {
        if (!float.IsFinite(value.X) || !float.IsFinite(value.Y) ||
            !float.IsFinite(value.Z) || !float.IsFinite(value.W))
        {
            throw SceneRuntimeJson.Invalid($"Joint quaternion '{name}' must have finite components.");
        }

        writer.WriteStartArray(name);
        writer.WriteNumberValue(value.X);
        writer.WriteNumberValue(value.Y);
        writer.WriteNumberValue(value.Z);
        writer.WriteNumberValue(value.W);
        writer.WriteEndArray();
    }

    public static Vec2 ReadVec2(JsonElement data, string name, in Vec2 current, float fallbackX, float fallbackY)
    {
        if (!data.TryGetProperty(name, out JsonElement element) || element.ValueKind == JsonValueKind.Null)
        {
            return current;
        }

        if (element.ValueKind != JsonValueKind.Array || element.GetArrayLength() < 2)
        {
            throw SceneRuntimeJson.Invalid($"Joint vector '{name}' must be a two-component array.");
        }

        return new Vec2(
            ComponentOrFallback(element[0], fallbackX),
            ComponentOrFallback(element[1], fallbackY));
    }

    public static Vec3 ReadVec3(
        JsonElement data, string name, in Vec3 current, float fallbackX, float fallbackY, float fallbackZ)
    {
        if (!data.TryGetProperty(name, out JsonElement element) || element.ValueKind == JsonValueKind.Null)
        {
            return current;
        }

        if (element.ValueKind != JsonValueKind.Array || element.GetArrayLength() < 3)
        {
            throw SceneRuntimeJson.Invalid($"Joint vector '{name}' must be a three-component array.");
        }

        return new Vec3(
            ComponentOrFallback(element[0], fallbackX),
            ComponentOrFallback(element[1], fallbackY),
            ComponentOrFallback(element[2], fallbackZ));
    }

    public static Quat ReadQuat(
        JsonElement data, string name, in Quat current, float fallbackX, float fallbackY, float fallbackZ, float fallbackW)
    {
        if (!data.TryGetProperty(name, out JsonElement element) || element.ValueKind == JsonValueKind.Null)
        {
            return current;
        }

        if (element.ValueKind != JsonValueKind.Array || element.GetArrayLength() < 4)
        {
            throw SceneRuntimeJson.Invalid($"Joint quaternion '{name}' must be a four-component array.");
        }

        return new Quat(
            ComponentOrFallback(element[0], fallbackX),
            ComponentOrFallback(element[1], fallbackY),
            ComponentOrFallback(element[2], fallbackZ),
            ComponentOrFallback(element[3], fallbackW));
    }

    public static void WriteLimits(Utf8JsonWriter writer, string name, in SceneJointLimits3D value)
    {
        writer.WriteStartObject(name);
        WriteScalar(writer, "min", value.Min);
        WriteScalar(writer, "max", value.Max);
        WriteScalar(writer, "bounciness", value.Bounciness);
        WriteScalar(writer, "contactDistance", value.ContactDistance);
        writer.WriteEndObject();
    }

    public static SceneJointLimits3D ReadLimits(JsonElement data, string name)
    {
        if (!data.TryGetProperty(name, out JsonElement element) || element.ValueKind != JsonValueKind.Object)
        {
            return default;
        }

        return new SceneJointLimits3D(
            ReadScalar(element, "min", 0.0f),
            ReadScalar(element, "max", 0.0f),
            ReadScalar(element, "bounciness", 0.0f),
            ReadScalar(element, "contactDistance", 0.0f));
    }

    public static void WriteMotor(Utf8JsonWriter writer, string name, in SceneJointMotor3D value)
    {
        writer.WriteStartObject(name);
        WriteScalar(writer, "targetVelocity", value.TargetVelocity);
        WriteScalar(writer, "force", value.Force);
        writer.WriteBoolean("freeSpin", value.FreeSpin);
        writer.WriteEndObject();
    }

    public static SceneJointMotor3D ReadMotor(JsonElement data, string name)
    {
        if (!data.TryGetProperty(name, out JsonElement element) || element.ValueKind != JsonValueKind.Object)
        {
            return default;
        }

        return new SceneJointMotor3D(
            ReadScalar(element, "targetVelocity", 0.0f),
            ReadScalar(element, "force", 0.0f),
            ReadBool(element, "freeSpin", false));
    }

    public static void WriteLimitSpring(Utf8JsonWriter writer, string name, in SceneSoftJointLimitSpring3D value)
    {
        writer.WriteStartObject(name);
        WriteScalar(writer, "spring", value.Spring);
        WriteScalar(writer, "damper", value.Damper);
        writer.WriteEndObject();
    }

    public static SceneSoftJointLimitSpring3D ReadLimitSpring(JsonElement data, string name)
    {
        if (!data.TryGetProperty(name, out JsonElement element) || element.ValueKind != JsonValueKind.Object)
        {
            return default;
        }

        return new SceneSoftJointLimitSpring3D(
            ReadScalar(element, "spring", 0.0f),
            ReadScalar(element, "damper", 0.0f));
    }

    public static void WriteSoftLimit(Utf8JsonWriter writer, string name, in SceneSoftJointLimit3D value)
    {
        writer.WriteStartObject(name);
        WriteScalar(writer, "limit", value.Limit);
        WriteScalar(writer, "bounciness", value.Bounciness);
        WriteScalar(writer, "contactDistance", value.ContactDistance);
        writer.WriteEndObject();
    }

    public static SceneSoftJointLimit3D ReadSoftLimit(JsonElement data, string name)
    {
        if (!data.TryGetProperty(name, out JsonElement element) || element.ValueKind != JsonValueKind.Object)
        {
            return default;
        }

        return new SceneSoftJointLimit3D(
            ReadScalar(element, "limit", 0.0f),
            ReadScalar(element, "bounciness", 0.0f),
            ReadScalar(element, "contactDistance", 0.0f));
    }

    public static void WriteDrive(Utf8JsonWriter writer, string name, in SceneJointDrive3D value)
    {
        writer.WriteStartObject(name);
        WriteScalar(writer, "positionSpring", value.PositionSpring);
        WriteScalar(writer, "positionDamper", value.PositionDamper);
        WriteScalar(writer, "maximumForce", value.MaximumForce);
        writer.WriteBoolean("useAcceleration", value.UseAcceleration);
        writer.WriteEndObject();
    }

    public static SceneJointDrive3D ReadDrive(JsonElement data, string name, in SceneJointDrive3D current)
    {
        if (!data.TryGetProperty(name, out JsonElement element) || element.ValueKind != JsonValueKind.Object)
        {
            return current;
        }

        return new SceneJointDrive3D(
            ReadScalar(element, "positionSpring", 0.0f),
            ReadScalar(element, "positionDamper", 0.0f),
            ReadScalar(element, "maximumForce", 0.0f),
            ReadBool(element, "useAcceleration", false));
    }

    public static void WriteBase2D(
        Utf8JsonWriter writer, bool enableCollision, float breakForce, float breakTorque, bool enabled)
    {
        writer.WriteBoolean("enableCollision", enableCollision);
        WriteScalar(writer, "breakForce", breakForce);
        WriteScalar(writer, "breakTorque", breakTorque);
        writer.WriteBoolean("enabled", enabled);
    }

    public static void ReadBase2D(
        JsonElement data,
        ref bool enableCollision,
        ref float breakForce,
        ref float breakTorque,
        ref bool enabled)
    {
        enableCollision = ReadBool(data, "enableCollision", enableCollision);
        breakForce = ReadScalar(data, "breakForce", breakForce);
        breakTorque = ReadScalar(data, "breakTorque", breakTorque);
        enabled = ReadBool(data, "enabled", enabled);
    }

    public static void ReadLimits2D(JsonElement data, ref float min, ref float max)
    {
        if (data.TryGetProperty("limits", out JsonElement limits) && limits.ValueKind == JsonValueKind.Object)
        {
            min = ReadScalar(limits, "min", min);
            max = ReadScalar(limits, "max", max);
        }

        // Flat editor keys win over the nested object, matching the TypeScript
        // deserialization order.
        if (data.TryGetProperty("limitsMin", out JsonElement flatMin) && flatMin.ValueKind == JsonValueKind.Number)
        {
            min = flatMin.GetSingle();
        }

        if (data.TryGetProperty("limitsMax", out JsonElement flatMax) && flatMax.ValueKind == JsonValueKind.Number)
        {
            max = flatMax.GetSingle();
        }
    }

    private static float ComponentOrFallback(JsonElement element, float fallback)
    {
        if (element.ValueKind != JsonValueKind.Number)
        {
            return fallback;
        }

        double raw = element.GetDouble();
        if (!double.IsFinite(raw))
        {
            return fallback;
        }

        float value = (float)raw;
        return float.IsFinite(value) ? value : fallback;
    }
}

/// <summary>JSON codec for <see cref="SceneDistanceJoint2D"/>.</summary>
public sealed class SceneDistanceJoint2DCodec : SceneDataCodec<SceneDistanceJoint2D>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneDistanceJoint2D value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        SceneJointJson.WriteRef(writer, "connectedBody", in value.ConnectedBody);
        SceneJointJson.WriteScalar(writer, "distance", value.Distance);
        SceneJointJson.WriteScalar(writer, "minDistance", value.MinDistance);
        SceneJointJson.WriteScalar(writer, "maxDistance", value.MaxDistance);
        SceneJointJson.WriteScalar(writer, "stiffness", value.Stiffness);
        SceneJointJson.WriteScalar(writer, "damping", value.Damping);
        SceneJointJson.WriteVec2(writer, "anchorA", in value.AnchorA);
        SceneJointJson.WriteVec2(writer, "anchorB", in value.AnchorB);
        writer.WriteBoolean("autoConfigureDistance", value.AutoConfigureDistance);
        SceneJointJson.WriteBase2D(writer, value.EnableCollision, value.BreakForce, value.BreakTorque, value.Enabled);
    }

    /// <inheritdoc/>
    public override SceneDistanceJoint2D Read(JsonElement data)
    {
        SceneDistanceJoint2D value = SceneDistanceJoint2D.Default;
        value.ConnectedBody = SceneJointJson.ReadRef(data, "connectedBody");
        value.Distance = SceneJointJson.ReadScalar(data, "distance", value.Distance);
        value.MinDistance = SceneJointJson.ReadScalar(data, "minDistance", value.MinDistance);
        value.MaxDistance = SceneJointJson.ReadScalar(data, "maxDistance", value.MaxDistance);
        value.Stiffness = SceneJointJson.ReadScalar(data, "stiffness", value.Stiffness);
        value.Damping = SceneJointJson.ReadScalar(data, "damping", value.Damping);
        value.AnchorA = SceneJointJson.ReadVec2(data, "anchorA", in value.AnchorA, 0.0f, 0.0f);
        value.AnchorB = SceneJointJson.ReadVec2(data, "anchorB", in value.AnchorB, 0.0f, 0.0f);
        value.AutoConfigureDistance = SceneJointJson.ReadBool(data, "autoConfigureDistance", value.AutoConfigureDistance);
        SceneJointJson.ReadBase2D(data, ref value.EnableCollision, ref value.BreakForce, ref value.BreakTorque, ref value.Enabled);
        return value;
    }
}

/// <summary>JSON codec for <see cref="SceneHingeJoint2D"/>.</summary>
public sealed class SceneHingeJoint2DCodec : SceneDataCodec<SceneHingeJoint2D>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneHingeJoint2D value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        SceneJointJson.WriteRef(writer, "connectedBody", in value.ConnectedBody);
        SceneJointJson.WriteVec2(writer, "anchor", in value.Anchor);
        writer.WriteBoolean("useMotor", value.UseMotor);
        SceneJointJson.WriteScalar(writer, "motorSpeed", value.MotorSpeed);
        SceneJointJson.WriteScalar(writer, "maxMotorTorque", value.MaxMotorTorque);
        writer.WriteBoolean("useLimits", value.UseLimits);
        writer.WriteStartObject("limits");
        SceneJointJson.WriteScalar(writer, "min", value.LimitsMin);
        SceneJointJson.WriteScalar(writer, "max", value.LimitsMax);
        writer.WriteEndObject();
        SceneJointJson.WriteBase2D(writer, value.EnableCollision, value.BreakForce, value.BreakTorque, value.Enabled);
    }

    /// <inheritdoc/>
    public override SceneHingeJoint2D Read(JsonElement data)
    {
        SceneHingeJoint2D value = SceneHingeJoint2D.Default;
        value.ConnectedBody = SceneJointJson.ReadRef(data, "connectedBody");
        value.Anchor = SceneJointJson.ReadVec2(data, "anchor", in value.Anchor, 0.0f, 0.0f);
        value.UseMotor = SceneJointJson.ReadBool(data, "useMotor", value.UseMotor);
        value.MotorSpeed = SceneJointJson.ReadScalar(data, "motorSpeed", value.MotorSpeed);
        value.MaxMotorTorque = SceneJointJson.ReadScalar(data, "maxMotorTorque", value.MaxMotorTorque);
        value.UseLimits = SceneJointJson.ReadBool(data, "useLimits", value.UseLimits);
        SceneJointJson.ReadLimits2D(data, ref value.LimitsMin, ref value.LimitsMax);
        SceneJointJson.ReadBase2D(data, ref value.EnableCollision, ref value.BreakForce, ref value.BreakTorque, ref value.Enabled);
        return value;
    }
}

/// <summary>JSON codec for <see cref="SceneFixedJoint2D"/>.</summary>
public sealed class SceneFixedJoint2DCodec : SceneDataCodec<SceneFixedJoint2D>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneFixedJoint2D value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        SceneJointJson.WriteRef(writer, "connectedBody", in value.ConnectedBody);
        SceneJointJson.WriteVec2(writer, "anchor", in value.Anchor);
        SceneJointJson.WriteScalar(writer, "dampingRatio", value.DampingRatio);
        SceneJointJson.WriteScalar(writer, "frequency", value.Frequency);
        SceneJointJson.WriteBase2D(writer, value.EnableCollision, value.BreakForce, value.BreakTorque, value.Enabled);
    }

    /// <inheritdoc/>
    public override SceneFixedJoint2D Read(JsonElement data)
    {
        SceneFixedJoint2D value = SceneFixedJoint2D.Default;
        value.ConnectedBody = SceneJointJson.ReadRef(data, "connectedBody");
        value.Anchor = SceneJointJson.ReadVec2(data, "anchor", in value.Anchor, 0.0f, 0.0f);
        value.DampingRatio = SceneJointJson.ReadScalar(data, "dampingRatio", value.DampingRatio);
        value.Frequency = SceneJointJson.ReadScalar(data, "frequency", value.Frequency);
        SceneJointJson.ReadBase2D(data, ref value.EnableCollision, ref value.BreakForce, ref value.BreakTorque, ref value.Enabled);
        return value;
    }
}

/// <summary>JSON codec for <see cref="SceneSliderJoint2D"/>.</summary>
public sealed class SceneSliderJoint2DCodec : SceneDataCodec<SceneSliderJoint2D>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneSliderJoint2D value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        SceneJointJson.WriteRef(writer, "connectedBody", in value.ConnectedBody);
        SceneJointJson.WriteVec2(writer, "anchor", in value.Anchor);
        SceneJointJson.WriteVec2(writer, "axis", in value.Axis);
        writer.WriteBoolean("useMotor", value.UseMotor);
        SceneJointJson.WriteScalar(writer, "motorSpeed", value.MotorSpeed);
        SceneJointJson.WriteScalar(writer, "maxMotorForce", value.MaxMotorForce);
        writer.WriteBoolean("useLimits", value.UseLimits);
        writer.WriteStartObject("limits");
        SceneJointJson.WriteScalar(writer, "min", value.LimitsMin);
        SceneJointJson.WriteScalar(writer, "max", value.LimitsMax);
        writer.WriteEndObject();
        SceneJointJson.WriteBase2D(writer, value.EnableCollision, value.BreakForce, value.BreakTorque, value.Enabled);
    }

    /// <inheritdoc/>
    public override SceneSliderJoint2D Read(JsonElement data)
    {
        SceneSliderJoint2D value = SceneSliderJoint2D.Default;
        value.ConnectedBody = SceneJointJson.ReadRef(data, "connectedBody");
        value.Anchor = SceneJointJson.ReadVec2(data, "anchor", in value.Anchor, 0.0f, 0.0f);
        value.Axis = SceneJointJson.ReadVec2(data, "axis", in value.Axis, 1.0f, 0.0f);
        value.UseMotor = SceneJointJson.ReadBool(data, "useMotor", value.UseMotor);
        value.MotorSpeed = SceneJointJson.ReadScalar(data, "motorSpeed", value.MotorSpeed);
        value.MaxMotorForce = SceneJointJson.ReadScalar(data, "maxMotorForce", value.MaxMotorForce);
        value.UseLimits = SceneJointJson.ReadBool(data, "useLimits", value.UseLimits);
        SceneJointJson.ReadLimits2D(data, ref value.LimitsMin, ref value.LimitsMax);
        SceneJointJson.ReadBase2D(data, ref value.EnableCollision, ref value.BreakForce, ref value.BreakTorque, ref value.Enabled);
        return value;
    }
}

/// <summary>JSON codec for <see cref="SceneSpringJoint2D"/>.</summary>
public sealed class SceneSpringJoint2DCodec : SceneDataCodec<SceneSpringJoint2D>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneSpringJoint2D value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        SceneJointJson.WriteRef(writer, "connectedBody", in value.ConnectedBody);
        SceneJointJson.WriteScalar(writer, "distance", value.Distance);
        SceneJointJson.WriteScalar(writer, "stiffness", value.Stiffness);
        SceneJointJson.WriteScalar(writer, "damping", value.Damping);
        SceneJointJson.WriteVec2(writer, "anchorA", in value.AnchorA);
        SceneJointJson.WriteVec2(writer, "anchorB", in value.AnchorB);
        writer.WriteBoolean("autoConfigureDistance", value.AutoConfigureDistance);
        SceneJointJson.WriteBase2D(writer, value.EnableCollision, value.BreakForce, value.BreakTorque, value.Enabled);
    }

    /// <inheritdoc/>
    public override SceneSpringJoint2D Read(JsonElement data)
    {
        SceneSpringJoint2D value = SceneSpringJoint2D.Default;
        value.ConnectedBody = SceneJointJson.ReadRef(data, "connectedBody");
        value.Distance = SceneJointJson.ReadScalar(data, "distance", value.Distance);
        value.Stiffness = SceneJointJson.ReadScalar(data, "stiffness", value.Stiffness);
        value.Damping = SceneJointJson.ReadScalar(data, "damping", value.Damping);
        value.AnchorA = SceneJointJson.ReadVec2(data, "anchorA", in value.AnchorA, 0.0f, 0.0f);
        value.AnchorB = SceneJointJson.ReadVec2(data, "anchorB", in value.AnchorB, 0.0f, 0.0f);
        value.AutoConfigureDistance = SceneJointJson.ReadBool(data, "autoConfigureDistance", value.AutoConfigureDistance);
        SceneJointJson.ReadBase2D(data, ref value.EnableCollision, ref value.BreakForce, ref value.BreakTorque, ref value.Enabled);
        return value;
    }
}

/// <summary>JSON codec for <see cref="SceneMotorJoint2D"/>.</summary>
public sealed class SceneMotorJoint2DCodec : SceneDataCodec<SceneMotorJoint2D>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneMotorJoint2D value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        SceneJointJson.WriteRef(writer, "connectedBody", in value.ConnectedBody);
        SceneJointJson.WriteVec2(writer, "linearOffset", in value.LinearOffset);
        SceneJointJson.WriteScalar(writer, "angularOffset", value.AngularOffset);
        SceneJointJson.WriteScalar(writer, "maxForce", value.MaxForce);
        SceneJointJson.WriteScalar(writer, "maxTorque", value.MaxTorque);
        SceneJointJson.WriteScalar(writer, "correctionFactor", value.CorrectionFactor);
        SceneJointJson.WriteBase2D(writer, value.EnableCollision, value.BreakForce, value.BreakTorque, value.Enabled);
    }

    /// <inheritdoc/>
    public override SceneMotorJoint2D Read(JsonElement data)
    {
        SceneMotorJoint2D value = SceneMotorJoint2D.Default;
        value.ConnectedBody = SceneJointJson.ReadRef(data, "connectedBody");
        value.LinearOffset = SceneJointJson.ReadVec2(data, "linearOffset", in value.LinearOffset, 0.0f, 0.0f);
        value.AngularOffset = SceneJointJson.ReadScalar(data, "angularOffset", value.AngularOffset);
        value.MaxForce = SceneJointJson.ReadScalar(data, "maxForce", value.MaxForce);
        value.MaxTorque = SceneJointJson.ReadScalar(data, "maxTorque", value.MaxTorque);
        value.CorrectionFactor = SceneJointJson.ReadScalar(data, "correctionFactor", value.CorrectionFactor);
        SceneJointJson.ReadBase2D(data, ref value.EnableCollision, ref value.BreakForce, ref value.BreakTorque, ref value.Enabled);
        return value;
    }
}

/// <summary>JSON codec for <see cref="SceneWheelJoint2D"/>.</summary>
public sealed class SceneWheelJoint2DCodec : SceneDataCodec<SceneWheelJoint2D>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneWheelJoint2D value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        SceneJointJson.WriteRef(writer, "connectedBody", in value.ConnectedBody);
        SceneJointJson.WriteVec2(writer, "anchorA", in value.AnchorA);
        SceneJointJson.WriteVec2(writer, "anchorB", in value.AnchorB);
        SceneJointJson.WriteVec2(writer, "axis", in value.Axis);
        writer.WriteBoolean("enableLimit", value.EnableLimit);
        SceneJointJson.WriteScalar(writer, "lowerTranslation", value.LowerTranslation);
        SceneJointJson.WriteScalar(writer, "upperTranslation", value.UpperTranslation);
        writer.WriteBoolean("enableMotor", value.EnableMotor);
        SceneJointJson.WriteScalar(writer, "motorSpeed", value.MotorSpeed);
        SceneJointJson.WriteScalar(writer, "maxMotorTorque", value.MaxMotorTorque);
        SceneJointJson.WriteScalar(writer, "stiffness", value.Stiffness);
        SceneJointJson.WriteScalar(writer, "damping", value.Damping);
        SceneJointJson.WriteBase2D(writer, value.EnableCollision, value.BreakForce, value.BreakTorque, value.Enabled);
    }

    /// <inheritdoc/>
    public override SceneWheelJoint2D Read(JsonElement data)
    {
        SceneWheelJoint2D value = SceneWheelJoint2D.Default;
        value.ConnectedBody = SceneJointJson.ReadRef(data, "connectedBody");
        value.AnchorA = SceneJointJson.ReadVec2(data, "anchorA", in value.AnchorA, 0.0f, 0.0f);
        value.AnchorB = SceneJointJson.ReadVec2(data, "anchorB", in value.AnchorB, 0.0f, 0.0f);
        value.Axis = SceneJointJson.ReadVec2(data, "axis", in value.Axis, 0.0f, 1.0f);
        value.EnableLimit = SceneJointJson.ReadBool(data, "enableLimit", value.EnableLimit);
        value.LowerTranslation = SceneJointJson.ReadScalar(data, "lowerTranslation", value.LowerTranslation);
        value.UpperTranslation = SceneJointJson.ReadScalar(data, "upperTranslation", value.UpperTranslation);
        value.EnableMotor = SceneJointJson.ReadBool(data, "enableMotor", value.EnableMotor);
        value.MotorSpeed = SceneJointJson.ReadScalar(data, "motorSpeed", value.MotorSpeed);
        value.MaxMotorTorque = SceneJointJson.ReadScalar(data, "maxMotorTorque", value.MaxMotorTorque);
        value.Stiffness = SceneJointJson.ReadScalar(data, "stiffness", value.Stiffness);
        value.Damping = SceneJointJson.ReadScalar(data, "damping", value.Damping);
        SceneJointJson.ReadBase2D(data, ref value.EnableCollision, ref value.BreakForce, ref value.BreakTorque, ref value.Enabled);
        return value;
    }
}

/// <summary>JSON codec for <see cref="SceneRopeJoint2D"/>.</summary>
public sealed class SceneRopeJoint2DCodec : SceneDataCodec<SceneRopeJoint2D>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneRopeJoint2D value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        SceneJointJson.WriteRef(writer, "connectedBody", in value.ConnectedBody);
        SceneJointJson.WriteVec2(writer, "anchorA", in value.AnchorA);
        SceneJointJson.WriteVec2(writer, "anchorB", in value.AnchorB);
        SceneJointJson.WriteScalar(writer, "maxLength", value.MaxLength);
        SceneJointJson.WriteBase2D(writer, value.EnableCollision, value.BreakForce, value.BreakTorque, value.Enabled);
    }

    /// <inheritdoc/>
    public override SceneRopeJoint2D Read(JsonElement data)
    {
        SceneRopeJoint2D value = SceneRopeJoint2D.Default;
        value.ConnectedBody = SceneJointJson.ReadRef(data, "connectedBody");
        value.AnchorA = SceneJointJson.ReadVec2(data, "anchorA", in value.AnchorA, 0.0f, 0.0f);
        value.AnchorB = SceneJointJson.ReadVec2(data, "anchorB", in value.AnchorB, 0.0f, 0.0f);
        value.MaxLength = SceneJointJson.ReadScalar(data, "maxLength", value.MaxLength);
        SceneJointJson.ReadBase2D(data, ref value.EnableCollision, ref value.BreakForce, ref value.BreakTorque, ref value.Enabled);
        return value;
    }
}

/// <summary>JSON codec for <see cref="SceneMouseJoint2D"/>.</summary>
public sealed class SceneMouseJoint2DCodec : SceneDataCodec<SceneMouseJoint2D>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneMouseJoint2D value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        SceneJointJson.WriteRef(writer, "connectedBody", in value.ConnectedBody);
        SceneJointJson.WriteVec2(writer, "target", in value.Target);
        SceneJointJson.WriteScalar(writer, "maxForce", value.MaxForce);
        SceneJointJson.WriteScalar(writer, "stiffness", value.Stiffness);
        SceneJointJson.WriteScalar(writer, "damping", value.Damping);
        SceneJointJson.WriteBase2D(writer, value.EnableCollision, value.BreakForce, value.BreakTorque, value.Enabled);
    }

    /// <inheritdoc/>
    public override SceneMouseJoint2D Read(JsonElement data)
    {
        SceneMouseJoint2D value = SceneMouseJoint2D.Default;
        value.ConnectedBody = SceneJointJson.ReadRef(data, "connectedBody");
        value.Target = SceneJointJson.ReadVec2(data, "target", in value.Target, 0.0f, 0.0f);
        value.MaxForce = SceneJointJson.ReadScalar(data, "maxForce", value.MaxForce);
        value.Stiffness = SceneJointJson.ReadScalar(data, "stiffness", value.Stiffness);
        value.Damping = SceneJointJson.ReadScalar(data, "damping", value.Damping);
        SceneJointJson.ReadBase2D(data, ref value.EnableCollision, ref value.BreakForce, ref value.BreakTorque, ref value.Enabled);
        return value;
    }
}

/// <summary>JSON codec for <see cref="SceneGearJoint2D"/>.</summary>
public sealed class SceneGearJoint2DCodec : SceneDataCodec<SceneGearJoint2D>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneGearJoint2D value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        SceneJointJson.WriteRef(writer, "connectedBody", in value.ConnectedBody);
        SceneJointJson.WriteJointRef(writer, "jointA", in value.JointA);
        SceneJointJson.WriteJointRef(writer, "jointB", in value.JointB);
        SceneJointJson.WriteScalar(writer, "ratio", value.Ratio);
        SceneJointJson.WriteBase2D(writer, value.EnableCollision, value.BreakForce, value.BreakTorque, value.Enabled);
    }

    /// <inheritdoc/>
    public override SceneGearJoint2D Read(JsonElement data)
    {
        SceneGearJoint2D value = SceneGearJoint2D.Default;
        value.ConnectedBody = SceneJointJson.ReadRef(data, "connectedBody");
        value.JointA = SceneJointJson.ReadJointRef(data, "jointA");
        value.JointB = SceneJointJson.ReadJointRef(data, "jointB");
        value.Ratio = SceneJointJson.ReadScalar(data, "ratio", value.Ratio);
        SceneJointJson.ReadBase2D(data, ref value.EnableCollision, ref value.BreakForce, ref value.BreakTorque, ref value.Enabled);
        return value;
    }
}

/// <summary>JSON codec for <see cref="SceneFixedJoint3D"/>.</summary>
public sealed class SceneFixedJoint3DCodec : SceneDataCodec<SceneFixedJoint3D>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneFixedJoint3D value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        SceneJoint3DJson.WriteBase(writer, in value);
    }

    /// <inheritdoc/>
    public override SceneFixedJoint3D Read(JsonElement data)
    {
        SceneFixedJoint3D value = SceneFixedJoint3D.Default;
        SceneJoint3DJson.ReadBase(data, ref value);
        return value;
    }
}

/// <summary>JSON codec for <see cref="SceneHingeJoint3D"/>.</summary>
public sealed class SceneHingeJoint3DCodec : SceneDataCodec<SceneHingeJoint3D>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneHingeJoint3D value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        SceneJoint3DJson.WriteBase(writer, in value);
        writer.WriteBoolean("useLimits", value.UseLimits);
        SceneJointJson.WriteLimits(writer, "limits", in value.Limits);
        writer.WriteBoolean("useMotor", value.UseMotor);
        SceneJointJson.WriteMotor(writer, "motor", in value.Motor);
        writer.WriteBoolean("useSpring", value.UseSpring);
        SceneJointJson.WriteLimitSpring(writer, "spring", in value.Spring);
    }

    /// <inheritdoc/>
    public override SceneHingeJoint3D Read(JsonElement data)
    {
        SceneHingeJoint3D value = SceneHingeJoint3D.Default;
        SceneJoint3DJson.ReadBase(data, ref value);
        value.UseLimits = SceneJointJson.ReadBool(data, "useLimits", value.UseLimits);
        value.Limits = SceneJointJson.ReadLimits(data, "limits");
        value.UseMotor = SceneJointJson.ReadBool(data, "useMotor", value.UseMotor);
        value.Motor = SceneJointJson.ReadMotor(data, "motor");
        value.UseSpring = SceneJointJson.ReadBool(data, "useSpring", value.UseSpring);
        value.Spring = SceneJointJson.ReadLimitSpring(data, "spring");
        return value;
    }
}

/// <summary>JSON codec for <see cref="SceneSliderJoint3D"/>.</summary>
public sealed class SceneSliderJoint3DCodec : SceneDataCodec<SceneSliderJoint3D>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneSliderJoint3D value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        SceneJoint3DJson.WriteBase(writer, in value);
        writer.WriteBoolean("useLimits", value.UseLimits);
        SceneJointJson.WriteLimits(writer, "limits", in value.Limits);
        writer.WriteBoolean("useMotor", value.UseMotor);
        SceneJointJson.WriteMotor(writer, "motor", in value.Motor);
        writer.WriteBoolean("useSpring", value.UseSpring);
        SceneJointJson.WriteLimitSpring(writer, "spring", in value.Spring);
    }

    /// <inheritdoc/>
    public override SceneSliderJoint3D Read(JsonElement data)
    {
        SceneSliderJoint3D value = SceneSliderJoint3D.Default;
        SceneJoint3DJson.ReadBase(data, ref value);
        value.UseLimits = SceneJointJson.ReadBool(data, "useLimits", value.UseLimits);
        value.Limits = SceneJointJson.ReadLimits(data, "limits");
        value.UseMotor = SceneJointJson.ReadBool(data, "useMotor", value.UseMotor);
        value.Motor = SceneJointJson.ReadMotor(data, "motor");
        value.UseSpring = SceneJointJson.ReadBool(data, "useSpring", value.UseSpring);
        value.Spring = SceneJointJson.ReadLimitSpring(data, "spring");
        return value;
    }
}

/// <summary>JSON codec for <see cref="SceneSpringJoint3D"/>.</summary>
public sealed class SceneSpringJoint3DCodec : SceneDataCodec<SceneSpringJoint3D>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneSpringJoint3D value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        SceneJoint3DJson.WriteBase(writer, in value);
        SceneJointJson.WriteScalar(writer, "minDistance", value.MinDistance);
        SceneJointJson.WriteScalar(writer, "maxDistance", value.MaxDistance);
        SceneJointJson.WriteScalar(writer, "spring", value.Spring);
        SceneJointJson.WriteScalar(writer, "damper", value.Damper);
        SceneJointJson.WriteScalar(writer, "tolerance", value.Tolerance);
        writer.WriteBoolean("autoConfigureDistance", value.AutoConfigureDistance);
    }

    /// <inheritdoc/>
    public override SceneSpringJoint3D Read(JsonElement data)
    {
        SceneSpringJoint3D value = SceneSpringJoint3D.Default;
        SceneJoint3DJson.ReadBase(data, ref value);
        value.MinDistance = SceneJointJson.ReadScalar(data, "minDistance", value.MinDistance);
        value.MaxDistance = SceneJointJson.ReadScalar(data, "maxDistance", value.MaxDistance);
        value.Spring = SceneJointJson.ReadScalar(data, "spring", value.Spring);
        value.Damper = SceneJointJson.ReadScalar(data, "damper", value.Damper);
        value.Tolerance = SceneJointJson.ReadScalar(data, "tolerance", value.Tolerance);
        value.AutoConfigureDistance = SceneJointJson.ReadBool(data, "autoConfigureDistance", value.AutoConfigureDistance);
        return value;
    }
}

/// <summary>JSON codec for <see cref="SceneCharacterJoint3D"/>.</summary>
public sealed class SceneCharacterJoint3DCodec : SceneDataCodec<SceneCharacterJoint3D>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneCharacterJoint3D value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        SceneJoint3DJson.WriteBase(writer, in value);
        SceneJointJson.WriteVec3(writer, "swingAxis", in value.SwingAxis);
        SceneJointJson.WriteSoftLimit(writer, "lowTwistLimit", in value.LowTwistLimit);
        SceneJointJson.WriteSoftLimit(writer, "highTwistLimit", in value.HighTwistLimit);
        SceneJointJson.WriteSoftLimit(writer, "swing1Limit", in value.Swing1Limit);
        SceneJointJson.WriteSoftLimit(writer, "swing2Limit", in value.Swing2Limit);
        SceneJointJson.WriteLimitSpring(writer, "twistLimitSpring", in value.TwistLimitSpring);
        SceneJointJson.WriteLimitSpring(writer, "swingLimitSpring", in value.SwingLimitSpring);
        writer.WriteBoolean("enableProjection", value.EnableProjection);
        SceneJointJson.WriteScalar(writer, "projectionDistance", value.ProjectionDistance);
        SceneJointJson.WriteScalar(writer, "projectionAngle", value.ProjectionAngle);
        SceneJointJson.WriteScalar(writer, "motorSpeed", value.MotorSpeed);
        SceneJointJson.WriteScalar(writer, "maxMotorTorque", value.MaxMotorTorque);
    }

    /// <inheritdoc/>
    public override SceneCharacterJoint3D Read(JsonElement data)
    {
        SceneCharacterJoint3D value = SceneCharacterJoint3D.Default;
        SceneJoint3DJson.ReadBase(data, ref value);
        value.SwingAxis = SceneJointJson.ReadVec3(data, "swingAxis", in value.SwingAxis, 1.0f, 0.0f, 0.0f);
        value.LowTwistLimit = SceneJointJson.ReadSoftLimit(data, "lowTwistLimit");
        value.HighTwistLimit = SceneJointJson.ReadSoftLimit(data, "highTwistLimit");
        value.Swing1Limit = SceneJointJson.ReadSoftLimit(data, "swing1Limit");
        value.Swing2Limit = SceneJointJson.ReadSoftLimit(data, "swing2Limit");
        value.TwistLimitSpring = SceneJointJson.ReadLimitSpring(data, "twistLimitSpring");
        value.SwingLimitSpring = SceneJointJson.ReadLimitSpring(data, "swingLimitSpring");
        value.EnableProjection = SceneJointJson.ReadBool(data, "enableProjection", value.EnableProjection);
        value.ProjectionDistance = SceneJointJson.ReadScalar(data, "projectionDistance", value.ProjectionDistance);
        value.ProjectionAngle = SceneJointJson.ReadScalar(data, "projectionAngle", value.ProjectionAngle);
        value.MotorSpeed = SceneJointJson.ReadScalar(data, "motorSpeed", value.MotorSpeed);
        value.MaxMotorTorque = SceneJointJson.ReadScalar(data, "maxMotorTorque", value.MaxMotorTorque);
        return value;
    }
}

/// <summary>
/// JSON codec for <see cref="SceneConfigurableJoint3D"/>. The angular per-axis
/// limit structs are consumed at solver creation but not serialized, matching
/// the TypeScript configurable joint.
/// </summary>
public sealed class SceneConfigurableJoint3DCodec : SceneDataCodec<SceneConfigurableJoint3D>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneConfigurableJoint3D value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        SceneJoint3DJson.WriteBase(writer, in value);
        SceneJointJson.WriteScalar(writer, "xMotion", value.XMotion);
        SceneJointJson.WriteScalar(writer, "yMotion", value.YMotion);
        SceneJointJson.WriteScalar(writer, "zMotion", value.ZMotion);
        SceneJointJson.WriteScalar(writer, "angularXMotion", value.AngularXMotion);
        SceneJointJson.WriteScalar(writer, "angularYMotion", value.AngularYMotion);
        SceneJointJson.WriteScalar(writer, "angularZMotion", value.AngularZMotion);
        SceneJointJson.WriteSoftLimit(writer, "linearLimit", in value.LinearLimit);
        SceneJointJson.WriteVec3(writer, "targetPosition", in value.TargetPosition);
        SceneJointJson.WriteVec3(writer, "targetVelocity", in value.TargetVelocity);
        SceneJointJson.WriteQuat(writer, "targetRotation", in value.TargetRotation);
        SceneJointJson.WriteVec3(writer, "targetAngularVelocity", in value.TargetAngularVelocity);
        writer.WriteNumber("rotationDriveMode", value.RotationDriveMode);
        writer.WriteBoolean("configuredInWorldSpace", value.ConfiguredInWorldSpace);
        writer.WriteBoolean("swapBodies", value.SwapBodies);
        SceneJointJson.WriteDrive(writer, "xDrive", in value.XDrive);
        SceneJointJson.WriteDrive(writer, "yDrive", in value.YDrive);
        SceneJointJson.WriteDrive(writer, "zDrive", in value.ZDrive);
        SceneJointJson.WriteDrive(writer, "angularXDrive", in value.AngularXDrive);
        SceneJointJson.WriteDrive(writer, "angularYZDrive", in value.AngularYZDrive);
    }

    /// <inheritdoc/>
    public override SceneConfigurableJoint3D Read(JsonElement data)
    {
        SceneConfigurableJoint3D value = SceneConfigurableJoint3D.Default;
        SceneJoint3DJson.ReadBase(data, ref value);
        value.XMotion = SceneJointJson.ReadScalar(data, "xMotion", value.XMotion);
        value.YMotion = SceneJointJson.ReadScalar(data, "yMotion", value.YMotion);
        value.ZMotion = SceneJointJson.ReadScalar(data, "zMotion", value.ZMotion);
        value.AngularXMotion = SceneJointJson.ReadScalar(data, "angularXMotion", value.AngularXMotion);
        value.AngularYMotion = SceneJointJson.ReadScalar(data, "angularYMotion", value.AngularYMotion);
        value.AngularZMotion = SceneJointJson.ReadScalar(data, "angularZMotion", value.AngularZMotion);
        value.LinearLimit = SceneJointJson.ReadSoftLimit(data, "linearLimit");
        value.TargetPosition = SceneJointJson.ReadVec3(data, "targetPosition", in value.TargetPosition, 0.0f, 0.0f, 0.0f);
        value.TargetVelocity = SceneJointJson.ReadVec3(data, "targetVelocity", in value.TargetVelocity, 0.0f, 0.0f, 0.0f);
        value.TargetRotation = SceneJointJson.ReadQuat(data, "targetRotation", in value.TargetRotation, 0.0f, 0.0f, 0.0f, 1.0f);
        value.TargetAngularVelocity = SceneJointJson.ReadVec3(data, "targetAngularVelocity", in value.TargetAngularVelocity, 0.0f, 0.0f, 0.0f);
        value.RotationDriveMode = SceneJointJson.ReadInt32(data, "rotationDriveMode", value.RotationDriveMode);
        value.ConfiguredInWorldSpace = SceneJointJson.ReadBool(data, "configuredInWorldSpace", value.ConfiguredInWorldSpace);
        value.SwapBodies = SceneJointJson.ReadBool(data, "swapBodies", value.SwapBodies);
        value.XDrive = SceneJointJson.ReadDrive(data, "xDrive", value.XDrive);
        value.YDrive = SceneJointJson.ReadDrive(data, "yDrive", value.YDrive);
        value.ZDrive = SceneJointJson.ReadDrive(data, "zDrive", value.ZDrive);
        value.AngularXDrive = SceneJointJson.ReadDrive(data, "angularXDrive", value.AngularXDrive);
        value.AngularYZDrive = SceneJointJson.ReadDrive(data, "angularYZDrive", value.AngularYZDrive);
        return value;
    }
}

/// <summary>
/// Base 3D joint field IO shared by every 3D codec. The fixed-joint codec
/// carries its own inline copy for the structurally identical base payload.
/// </summary>
internal static class SceneJoint3DJson
{
    public static void WriteBase(Utf8JsonWriter writer, in SceneFixedJoint3D value) =>
        WriteFields(
            writer, in value.ConnectedBody, in value.Anchor, in value.ConnectedAnchor,
            value.AutoConfigureConnectedAnchor, in value.Axis, in value.SecondaryAxis,
            value.BreakForce, value.BreakTorque, value.EnableCollision, value.EnablePreprocessing,
            value.MassScale, value.ConnectedMassScale, value.Enabled);

    public static void WriteBase(Utf8JsonWriter writer, in SceneHingeJoint3D value) =>
        WriteFields(
            writer, in value.ConnectedBody, in value.Anchor, in value.ConnectedAnchor,
            value.AutoConfigureConnectedAnchor, in value.Axis, in value.SecondaryAxis,
            value.BreakForce, value.BreakTorque, value.EnableCollision, value.EnablePreprocessing,
            value.MassScale, value.ConnectedMassScale, value.Enabled);

    public static void WriteBase(Utf8JsonWriter writer, in SceneSliderJoint3D value) =>
        WriteFields(
            writer, in value.ConnectedBody, in value.Anchor, in value.ConnectedAnchor,
            value.AutoConfigureConnectedAnchor, in value.Axis, in value.SecondaryAxis,
            value.BreakForce, value.BreakTorque, value.EnableCollision, value.EnablePreprocessing,
            value.MassScale, value.ConnectedMassScale, value.Enabled);

    public static void WriteBase(Utf8JsonWriter writer, in SceneSpringJoint3D value) =>
        WriteFields(
            writer, in value.ConnectedBody, in value.Anchor, in value.ConnectedAnchor,
            value.AutoConfigureConnectedAnchor, in value.Axis, in value.SecondaryAxis,
            value.BreakForce, value.BreakTorque, value.EnableCollision, value.EnablePreprocessing,
            value.MassScale, value.ConnectedMassScale, value.Enabled);

    public static void WriteBase(Utf8JsonWriter writer, in SceneCharacterJoint3D value) =>
        WriteFields(
            writer, in value.ConnectedBody, in value.Anchor, in value.ConnectedAnchor,
            value.AutoConfigureConnectedAnchor, in value.Axis, in value.SecondaryAxis,
            value.BreakForce, value.BreakTorque, value.EnableCollision, value.EnablePreprocessing,
            value.MassScale, value.ConnectedMassScale, value.Enabled);

    public static void WriteBase(Utf8JsonWriter writer, in SceneConfigurableJoint3D value) =>
        WriteFields(
            writer, in value.ConnectedBody, in value.Anchor, in value.ConnectedAnchor,
            value.AutoConfigureConnectedAnchor, in value.Axis, in value.SecondaryAxis,
            value.BreakForce, value.BreakTorque, value.EnableCollision, value.EnablePreprocessing,
            value.MassScale, value.ConnectedMassScale, value.Enabled);

    public static void ReadBase(JsonElement data, ref SceneFixedJoint3D value) =>
        ReadFields(
            data, out value.ConnectedBody, ref value.Anchor, ref value.ConnectedAnchor,
            ref value.AutoConfigureConnectedAnchor, ref value.Axis, ref value.SecondaryAxis,
            ref value.BreakForce, ref value.BreakTorque, ref value.EnableCollision,
            ref value.EnablePreprocessing, ref value.MassScale, ref value.ConnectedMassScale,
            ref value.Enabled);

    public static void ReadBase(JsonElement data, ref SceneHingeJoint3D value) =>
        ReadFields(
            data, out value.ConnectedBody, ref value.Anchor, ref value.ConnectedAnchor,
            ref value.AutoConfigureConnectedAnchor, ref value.Axis, ref value.SecondaryAxis,
            ref value.BreakForce, ref value.BreakTorque, ref value.EnableCollision,
            ref value.EnablePreprocessing, ref value.MassScale, ref value.ConnectedMassScale,
            ref value.Enabled);

    public static void ReadBase(JsonElement data, ref SceneSliderJoint3D value) =>
        ReadFields(
            data, out value.ConnectedBody, ref value.Anchor, ref value.ConnectedAnchor,
            ref value.AutoConfigureConnectedAnchor, ref value.Axis, ref value.SecondaryAxis,
            ref value.BreakForce, ref value.BreakTorque, ref value.EnableCollision,
            ref value.EnablePreprocessing, ref value.MassScale, ref value.ConnectedMassScale,
            ref value.Enabled);

    public static void ReadBase(JsonElement data, ref SceneSpringJoint3D value) =>
        ReadFields(
            data, out value.ConnectedBody, ref value.Anchor, ref value.ConnectedAnchor,
            ref value.AutoConfigureConnectedAnchor, ref value.Axis, ref value.SecondaryAxis,
            ref value.BreakForce, ref value.BreakTorque, ref value.EnableCollision,
            ref value.EnablePreprocessing, ref value.MassScale, ref value.ConnectedMassScale,
            ref value.Enabled);

    public static void ReadBase(JsonElement data, ref SceneCharacterJoint3D value) =>
        ReadFields(
            data, out value.ConnectedBody, ref value.Anchor, ref value.ConnectedAnchor,
            ref value.AutoConfigureConnectedAnchor, ref value.Axis, ref value.SecondaryAxis,
            ref value.BreakForce, ref value.BreakTorque, ref value.EnableCollision,
            ref value.EnablePreprocessing, ref value.MassScale, ref value.ConnectedMassScale,
            ref value.Enabled);

    public static void ReadBase(JsonElement data, ref SceneConfigurableJoint3D value) =>
        ReadFields(
            data, out value.ConnectedBody, ref value.Anchor, ref value.ConnectedAnchor,
            ref value.AutoConfigureConnectedAnchor, ref value.Axis, ref value.SecondaryAxis,
            ref value.BreakForce, ref value.BreakTorque, ref value.EnableCollision,
            ref value.EnablePreprocessing, ref value.MassScale, ref value.ConnectedMassScale,
            ref value.Enabled);

    private static void WriteFields(
        Utf8JsonWriter writer,
        in SceneJointActorRef connectedBody,
        in Vec3 anchor,
        in Vec3 connectedAnchor,
        bool autoConfigureConnectedAnchor,
        in Vec3 axis,
        in Vec3 secondaryAxis,
        float breakForce,
        float breakTorque,
        bool enableCollision,
        bool enablePreprocessing,
        float massScale,
        float connectedMassScale,
        bool enabled)
    {
        SceneJointJson.WriteRef(writer, "connectedBody", in connectedBody);
        SceneJointJson.WriteVec3(writer, "anchor", in anchor);
        SceneJointJson.WriteVec3(writer, "connectedAnchor", in connectedAnchor);
        writer.WriteBoolean("autoConfigureConnectedAnchor", autoConfigureConnectedAnchor);
        SceneJointJson.WriteVec3(writer, "axis", in axis);
        SceneJointJson.WriteVec3(writer, "secondaryAxis", in secondaryAxis);
        SceneJointJson.WriteScalar(writer, "breakForce", breakForce);
        SceneJointJson.WriteScalar(writer, "breakTorque", breakTorque);
        writer.WriteBoolean("enableCollision", enableCollision);
        writer.WriteBoolean("enablePreprocessing", enablePreprocessing);
        SceneJointJson.WriteScalar(writer, "massScale", massScale);
        SceneJointJson.WriteScalar(writer, "connectedMassScale", connectedMassScale);
        writer.WriteBoolean("enabled", enabled);
    }

    private static void ReadFields(
        JsonElement data,
        out SceneJointActorRef connectedBody,
        ref Vec3 anchor,
        ref Vec3 connectedAnchor,
        ref bool autoConfigureConnectedAnchor,
        ref Vec3 axis,
        ref Vec3 secondaryAxis,
        ref float breakForce,
        ref float breakTorque,
        ref bool enableCollision,
        ref bool enablePreprocessing,
        ref float massScale,
        ref float connectedMassScale,
        ref bool enabled)
    {
        connectedBody = SceneJointJson.ReadRef(data, "connectedBody");
        anchor = SceneJointJson.ReadVec3(data, "anchor", in anchor, 0.0f, 0.0f, 0.0f);
        connectedAnchor = SceneJointJson.ReadVec3(data, "connectedAnchor", in connectedAnchor, 0.0f, 0.0f, 0.0f);
        autoConfigureConnectedAnchor = SceneJointJson.ReadBool(data, "autoConfigureConnectedAnchor", autoConfigureConnectedAnchor);
        axis = SceneJointJson.ReadVec3(data, "axis", in axis, 1.0f, 0.0f, 0.0f);
        secondaryAxis = SceneJointJson.ReadVec3(data, "secondaryAxis", in secondaryAxis, 0.0f, 1.0f, 0.0f);
        breakForce = SceneJointJson.ReadScalar(data, "breakForce", breakForce);
        breakTorque = SceneJointJson.ReadScalar(data, "breakTorque", breakTorque);
        enableCollision = SceneJointJson.ReadBool(data, "enableCollision", enableCollision);
        enablePreprocessing = SceneJointJson.ReadBool(data, "enablePreprocessing", enablePreprocessing);
        massScale = SceneJointJson.ReadScalar(data, "massScale", massScale);
        connectedMassScale = SceneJointJson.ReadScalar(data, "connectedMassScale", connectedMassScale);
        enabled = SceneJointJson.ReadBool(data, "enabled", enabled);
    }
}
