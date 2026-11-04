namespace Axrone.Lighting;

/// <summary>Serialized environment block.</summary>
public sealed class SerializedEnvironmentDto
{
    /// <summary>Ambient tuple.</summary>
    public float[] Ambient { get; set; } = [0.2f, 0.2f, 0.25f];

    /// <summary>Sky tuple.</summary>
    public float[] Sky { get; set; } = [0.4f, 0.45f, 0.55f];

    /// <summary>Ground tuple.</summary>
    public float[] Ground { get; set; } = [0.15f, 0.13f, 0.1f];

    /// <summary>Exposure.</summary>
    public float Exposure { get; set; } = 1.0f;

    /// <summary>Gamma.</summary>
    public float Gamma { get; set; } = 2.2f;
}

/// <summary>Serialized light block.</summary>
public sealed class SerializedLightDto
{
    /// <summary>Light id.</summary>
    public ulong Id { get; set; }

    /// <summary>Light kind string.</summary>
    public string Kind { get; set; } = string.Empty;

    /// <summary>Enabled flag.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Color tuple.</summary>
    public float[] Color { get; set; } = [1.0f, 1.0f, 1.0f];

    /// <summary>Intensity.</summary>
    public float Intensity { get; set; } = 1.0f;

    /// <summary>Priority.</summary>
    public float Priority { get; set; }

    /// <summary>Direction tuple.</summary>
    public float[]? Direction { get; set; }

    /// <summary>Ambient tuple.</summary>
    public float[]? Ambient { get; set; }

    /// <summary>Position tuple.</summary>
    public float[]? Position { get; set; }

    /// <summary>Range.</summary>
    public float? Range { get; set; }

    /// <summary>Attenuation.</summary>
    public float? Attenuation { get; set; }

    /// <summary>Inner cone cosine.</summary>
    public float? InnerConeCosine { get; set; }

    /// <summary>Outer cone cosine.</summary>
    public float? OuterConeCosine { get; set; }
}

/// <summary>Serialized lighting document.</summary>
public sealed class LightingDocumentDto
{
    /// <summary>Schema version.</summary>
    public int Version { get; set; } = 1;

    /// <summary>Rig id.</summary>
    public ulong RigId { get; set; }

    /// <summary>Environment.</summary>
    public SerializedEnvironmentDto Environment { get; set; } = new();

    /// <summary>Lights in insertion order.</summary>
    public List<SerializedLightDto> Lights { get; set; } = [];
}

/// <summary>Parse issue.</summary>
public readonly record struct SerializationIssue(string Code, string Message, string? Path = null);

/// <summary>Deserialization result.</summary>
public sealed class DeserializationResult
{
    /// <summary>Whether parsing succeeded.</summary>
    public bool Success { get; init; }

    /// <summary>Parsed rig.</summary>
    public LightingRig? Rig { get; init; }

    /// <summary>Parse issues.</summary>
    public IReadOnlyList<SerializationIssue> Issues { get; init; } = [];
}

/// <summary>AOT JSON source-generation context.</summary>
[JsonSourceGenerationOptions(
    WriteIndented = false,
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    GenerationMode = JsonSourceGenerationMode.Default)]
[JsonSerializable(typeof(LightingDocumentDto))]
[JsonSerializable(typeof(SerializedEnvironmentDto))]
[JsonSerializable(typeof(SerializedLightDto))]
[JsonSerializable(typeof(List<SerializedLightDto>))]
[JsonSerializable(typeof(float[]))]
internal sealed partial class LightingAotJsonContext : JsonSerializerContext
{
}

/// <summary>Lighting document serializer.</summary>
public static class LightingSerializer
{
    /// <summary>Exports a rig to a document.</summary>
    public static LightingDocumentDto Export(LightingRig rig)
    {
        ArgumentNullException.ThrowIfNull(rig);

        var doc = new LightingDocumentDto
        {
            Version = 1,
            RigId = rig.Id.Value,
            Environment = new SerializedEnvironmentDto
            {
                Ambient = [rig.Environment.Ambient.X, rig.Environment.Ambient.Y, rig.Environment.Ambient.Z],
                Sky = [rig.Environment.Sky.X, rig.Environment.Sky.Y, rig.Environment.Sky.Z],
                Ground = [rig.Environment.Ground.X, rig.Environment.Ground.Y, rig.Environment.Ground.Z],
                Exposure = rig.Environment.Exposure,
                Gamma = rig.Environment.Gamma,
            },
        };

        foreach (ref readonly LightData light in rig)
        {
            var dto = new SerializedLightDto
            {
                Id = light.Id.Value,
                Enabled = light.IsEnabled,
                Color = [light.Color.X, light.Color.Y, light.Color.Z],
                Intensity = light.Intensity.Value,
                Priority = light.Priority.Value,
            };

            switch (light.Type)
            {
                case LightType.Directional:
                    dto.Kind = "directional";
                    dto.Direction = [light.Direction.X, light.Direction.Y, light.Direction.Z];
                    dto.Ambient = [light.Ambient.X, light.Ambient.Y, light.Ambient.Z];
                    break;
                case LightType.Point:
                    dto.Kind = "point";
                    dto.Position = [light.Position.X, light.Position.Y, light.Position.Z];
                    dto.Range = light.Range.Value;
                    dto.Attenuation = light.Attenuation.Value;
                    break;
                case LightType.Spot:
                    dto.Kind = "spot";
                    dto.Position = [light.Position.X, light.Position.Y, light.Position.Z];
                    dto.Direction = [light.Direction.X, light.Direction.Y, light.Direction.Z];
                    dto.Range = light.Range.Value;
                    dto.Attenuation = light.Attenuation.Value;
                    dto.InnerConeCosine = light.InnerConeCosine.Value;
                    dto.OuterConeCosine = light.OuterConeCosine.Value;
                    break;
                default:
                    break;
            }

            doc.Lights.Add(dto);
        }

        return doc;
    }

    /// <summary>Serializes a rig to JSON.</summary>
    public static string ToJson(LightingRig rig)
    {
        ArgumentNullException.ThrowIfNull(rig);

        LightingDocumentDto doc = Export(rig);
        return JsonSerializer.Serialize(doc, LightingAotJsonContext.Default.LightingDocumentDto);
    }

    /// <summary>Parses a JSON document, keeping valid lights on partial failure.</summary>
    public static DeserializationResult ParseSafe(string json)
    {
        ArgumentNullException.ThrowIfNull(json);

        var issues = new List<SerializationIssue>();
        LightingDocumentDto? doc;

        try
        {
            doc = JsonSerializer.Deserialize(json, LightingAotJsonContext.Default.LightingDocumentDto);
        }
        catch (Exception ex)
        {
            issues.Add(new SerializationIssue("lighting.parse.document", $"JSON document deserialization failed: {ex.Message}"));
            return new DeserializationResult { Success = false, Issues = issues };
        }

        if (doc == null)
        {
            issues.Add(new SerializationIssue("lighting.parse.document", "Parsed document root was null."));
            return new DeserializationResult { Success = false, Issues = issues };
        }

        if (doc.Version != 1)
        {
            issues.Add(new SerializationIssue("lighting.parse.version", $"Unsupported schema version '{doc.Version}'. Expected: 1"));
            return new DeserializationResult { Success = false, Issues = issues };
        }

        LightingEnvironment env;
        try
        {
            Vec3 amb = ParseVector3(doc.Environment?.Ambient, "environment.ambient");
            Vec3 sky = ParseVector3(doc.Environment?.Sky, "environment.sky");
            Vec3 grd = ParseVector3(doc.Environment?.Ground, "environment.ground");
            float exp = doc.Environment?.Exposure ?? 1.0f;
            float gam = doc.Environment?.Gamma ?? 2.2f;
            env = new LightingEnvironment(amb, sky, grd, exp, gam);
        }
        catch (Exception ex)
        {
            issues.Add(new SerializationIssue("lighting.parse.environment", ex.Message, "environment"));
            return new DeserializationResult { Success = false, Issues = issues };
        }

        var rig = new LightingRig(new RigId(doc.RigId), env);

        if (doc.Lights != null)
        {
            for (int i = 0; i < doc.Lights.Count; i++)
            {
                SerializedLightDto lightDto = doc.Lights[i];
                string path = $"lights[{i}]";

                if (lightDto == null)
                {
                    issues.Add(new SerializationIssue("lighting.parse.null-entry", "Light definition is null.", path));
                    continue;
                }

                try
                {
                    Vec3 color = ParseVector3(lightDto.Color, $"{path}.color");
                    LightId id = lightDto.Id != 0 ? new LightId(lightDto.Id) : rig.NextLightId();
                    var intensity = new LightIntensity(lightDto.Intensity);
                    var priority = new LightPriority(lightDto.Priority);

                    switch (lightDto.Kind?.ToLowerInvariant())
                    {
                        case "directional":
                            {
                                Vec3 dir = ParseVector3(lightDto.Direction, $"{path}.direction");
                                Vec3 amb = lightDto.Ambient != null ? ParseVector3(lightDto.Ambient, $"{path}.ambient") : Vec3.Zero;

                                rig.Add(LightData.CreateDirectional(id, id.Value, dir, color, amb, intensity, priority, lightDto.Enabled));
                                break;
                            }

                        case "point":
                            {
                                Vec3 pos = ParseVector3(lightDto.Position, $"{path}.position");
                                var range = new LightRange(lightDto.Range ?? 8.0f);
                                var att = new AttenuationFactor(lightDto.Attenuation ?? 2.0f);

                                rig.Add(LightData.CreatePoint(id, id.Value, pos, color, intensity, priority, range, att, lightDto.Enabled));
                                break;
                            }

                        case "spot":
                            {
                                Vec3 pos = ParseVector3(lightDto.Position, $"{path}.position");
                                Vec3 dir = ParseVector3(lightDto.Direction, $"{path}.direction");
                                var range = new LightRange(lightDto.Range ?? 8.0f);
                                var att = new AttenuationFactor(lightDto.Attenuation ?? 2.0f);
                                var inCos = new ConeCosine(lightDto.InnerConeCosine ?? ConeCosine.DefaultInner.Value);
                                var outCos = new ConeCosine(lightDto.OuterConeCosine ?? ConeCosine.DefaultOuter.Value);

                                rig.Add(LightData.CreateSpot(id, id.Value, pos, dir, color, intensity, priority, range, att, inCos, outCos, lightDto.Enabled));
                                break;
                            }

                        default:
                            issues.Add(new SerializationIssue("lighting.parse.unknown-kind", $"Invalid light kind: '{lightDto.Kind}'.", $"{path}.kind"));
                            break;
                    }
                }
                catch (Exception ex)
                {
                    issues.Add(new SerializationIssue("lighting.parse.light-error", ex.Message, path));
                }
            }
        }

        return new DeserializationResult { Success = true, Rig = rig, Issues = issues };
    }

    /// <summary>Deserializes JSON, throwing on any failure.</summary>
    public static LightingRig FromJson(string json)
    {
        DeserializationResult result = ParseSafe(json);
        if (!result.Success || result.Rig == null)
        {
            ThrowHelper.ThrowSerializationError(
                "lighting.deserialization.failed",
                result.Issues.Count > 0 ? result.Issues[0].Message : "JSON deserialization produced an invalid rig.");
        }

        if (result.Issues.Count > 0)
        {
            ThrowHelper.ThrowSerializationError(
                "lighting.deserialization.partial",
                $"Encountered {result.Issues.Count} issue(s) during document deserialization.");
        }

        return result.Rig!;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static Vec3 ParseVector3(float[]? tuple, string path)
    {
        if (tuple == null || tuple.Length != 3)
        {
            throw new LightingValidationException("lighting.parse.vector-invalid", $"Expected 3-component float array at '{path}'.");
        }

        if (!LightingGuards.IsFinite(tuple[0]) || !LightingGuards.IsFinite(tuple[1]) || !LightingGuards.IsFinite(tuple[2]))
        {
            throw new LightingValidationException("lighting.parse.vector-non-finite", $"Vector contains non-finite floating values at '{path}'.");
        }

        return new Vec3(tuple[0], tuple[1], tuple[2]);
    }
}
