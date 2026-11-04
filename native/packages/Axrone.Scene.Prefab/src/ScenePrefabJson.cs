namespace Axrone.Scene.Prefab;

using System.Buffers;

/// <summary>
/// Deterministic JSON codec for prefab definitions. The format is versioned and
/// uses only explicit property names, so Native AOT never needs reflection.
/// </summary>
public static class ScenePrefabJson
{
    /// <summary>Current wire version.</summary>
    public const int Version = 2;

    /// <summary>Writes a prefab definition.</summary>
    public static void Write(Utf8JsonWriter writer, ScenePrefabDefinition prefab)
    {
        ArgumentNullException.ThrowIfNull(writer);
        ArgumentNullException.ThrowIfNull(prefab);

        writer.WriteStartObject();
        writer.WriteNumber("version", Version);
        writer.WriteString("id", prefab.Id);
        writer.WriteString("kind", KindToString(prefab.Kind));

        writer.WriteStartArray("actors");
        for (int i = 0; i < prefab.Actors.Count; i++)
        {
            WriteActor(writer, prefab.Actors[i]);
        }

        writer.WriteEndArray();

        if (prefab.Metadata is { } metadata)
        {
            WriteMetadata(writer, metadata);
        }

        if (prefab.Base is { } baseReference)
        {
            writer.WritePropertyName("base");
            WriteReference(writer, baseReference);
        }

        if (prefab.Nested.Count > 0)
        {
            writer.WriteStartArray("nested");
            for (int i = 0; i < prefab.Nested.Count; i++)
            {
                WriteNestedInstance(writer, prefab.Nested[i]);
            }

            writer.WriteEndArray();
        }

        if (prefab.Overrides.Count > 0)
        {
            writer.WriteStartArray("overrides");
            for (int i = 0; i < prefab.Overrides.Count; i++)
            {
                WriteOperation(writer, prefab.Overrides[i]);
            }

            writer.WriteEndArray();
        }

        if (prefab.Lineage.Count > 0)
        {
            writer.WriteStartArray("lineage");
            for (int i = 0; i < prefab.Lineage.Count; i++)
            {
                writer.WriteStringValue(prefab.Lineage[i]);
            }

            writer.WriteEndArray();
        }

        writer.WriteEndObject();
    }

    /// <summary>Reads a prefab definition from a JSON object.</summary>
    public static ScenePrefabDefinition Read(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                "Prefab JSON root must be an object.");
        }

        int version = root.TryGetProperty("version", out JsonElement versionElement)
            ? versionElement.GetInt32()
            : Version;

        if (version is < 1 or > Version)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                $"Unsupported prefab version {version}.");
        }

        string id = GetRequiredString(root, "id");
        ScenePrefabKind kind = root.TryGetProperty("kind", out JsonElement kindElement)
            ? ParseKind(GetString(kindElement, "kind"))
            : ScenePrefabKind.Prefab;

        if (!root.TryGetProperty("actors", out JsonElement actorsElement) ||
            actorsElement.ValueKind != JsonValueKind.Array)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                $"Prefab '{id}' requires an actors array.");
        }

        var actors = new List<SceneActorSnapshot>(actorsElement.GetArrayLength());
        int actorIndex = 0;
        foreach (JsonElement actorElement in actorsElement.EnumerateArray())
        {
            actors.Add(ReadActor(actorElement, id, actorIndex++));
        }

        ScenePrefabMetadata? metadata = null;
        if (root.TryGetProperty("metadata", out JsonElement metadataElement) &&
            metadataElement.ValueKind == JsonValueKind.Object)
        {
            metadata = ReadMetadata(metadataElement);
        }

        ScenePrefabReference? basePrefab = null;
        if (root.TryGetProperty("base", out JsonElement baseElement) &&
            baseElement.ValueKind == JsonValueKind.Object)
        {
            basePrefab = ReadReference(baseElement);
        }

        ScenePrefabNestedInstance[]? nested = null;
        if (root.TryGetProperty("nested", out JsonElement nestedElement) &&
            nestedElement.ValueKind == JsonValueKind.Array)
        {
            nested = new ScenePrefabNestedInstance[nestedElement.GetArrayLength()];
            int index = 0;
            foreach (JsonElement instanceElement in nestedElement.EnumerateArray())
            {
                nested[index++] = ReadNestedInstance(instanceElement);
            }
        }

        ScenePrefabOverrideOperation[]? overrides = null;
        if (root.TryGetProperty("overrides", out JsonElement overridesElement) &&
            overridesElement.ValueKind == JsonValueKind.Array)
        {
            overrides = new ScenePrefabOverrideOperation[overridesElement.GetArrayLength()];
            int index = 0;
            foreach (JsonElement operationElement in overridesElement.EnumerateArray())
            {
                overrides[index] = ReadOperation(operationElement, id, index);
                index++;
            }
        }

        string[]? lineage = null;
        if (root.TryGetProperty("lineage", out JsonElement lineageElement) &&
            lineageElement.ValueKind == JsonValueKind.Array)
        {
            lineage = new string[lineageElement.GetArrayLength()];
            int index = 0;
            foreach (JsonElement idElement in lineageElement.EnumerateArray())
            {
                lineage[index++] = GetString(idElement, "lineage");
            }
        }

        return new ScenePrefabDefinition(
            id,
            actors,
            kind,
            metadata,
            basePrefab,
            nested,
            overrides,
            lineage);
    }

    /// <summary>Serializes a prefab to UTF-8 JSON.</summary>
    public static byte[] Serialize(ScenePrefabDefinition prefab)
    {
        ArgumentNullException.ThrowIfNull(prefab);

        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            Write(writer, prefab);
        }

        return buffer.WrittenSpan.ToArray();
    }

    /// <summary>Deserializes a prefab from UTF-8 JSON.</summary>
    public static ScenePrefabDefinition Deserialize(ReadOnlySpan<byte> utf8)
    {
        if (utf8.IsEmpty)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                "Prefab JSON payload must not be empty.");
        }

        using JsonDocument document = JsonDocument.Parse(utf8.ToArray());
        return Read(document.RootElement);
    }

    private static void WriteActor(Utf8JsonWriter writer, SceneActorSnapshot actor)
    {
        writer.WriteStartObject();
        writer.WriteString("nodeId", actor.NodeId);

        if (actor.ParentNodeId is { } parentNodeId)
        {
            writer.WriteString("parentNodeId", parentNodeId);
        }
        else
        {
            writer.WriteNull("parentNodeId");
        }

        writer.WriteString("name", actor.Name);
        writer.WriteNumber("layer", actor.Layer);
        writer.WriteString("tag", actor.Tag);
        writer.WriteBoolean("active", actor.Active);
        writer.WriteBoolean("persistent", actor.Persistent);
        writer.WriteBoolean("pooled", actor.Pooled);

        if (actor.Source is { } source)
        {
            writer.WritePropertyName("source");
            WriteSource(writer, source);
        }

        writer.WriteStartArray("components");
        for (int i = 0; i < actor.Components.Count; i++)
        {
            WriteComponent(writer, actor.Components[i]);
        }

        writer.WriteEndArray();
        writer.WriteEndObject();
    }

    private static void WriteComponent(Utf8JsonWriter writer, SceneComponentSnapshot component)
    {
        writer.WriteStartObject();
        writer.WriteString("type", component.Type);

        if (component.Id is { } id)
        {
            writer.WriteString("id", id);
        }

        writer.WritePropertyName("data");
        component.Data.WriteTo(writer);
        writer.WriteEndObject();
    }

    private static void WriteMetadata(Utf8JsonWriter writer, ScenePrefabMetadata metadata)
    {
        writer.WriteStartObject("metadata");

        if (metadata.Revision is { } revision)
        {
            writer.WriteString("revision", revision);
        }

        if (metadata.Locale is { } locale)
        {
            writer.WriteString("locale", locale);
        }

        if (metadata.UpdatedAt is { } updatedAt)
        {
            writer.WriteString("updatedAt", updatedAt);
        }

        if (metadata.TimeZone is { } timeZone)
        {
            writer.WriteString("timeZone", timeZone);
        }

        if (metadata.Tags.Count > 0)
        {
            writer.WriteStartArray("tags");
            for (int i = 0; i < metadata.Tags.Count; i++)
            {
                writer.WriteStringValue(metadata.Tags[i]);
            }

            writer.WriteEndArray();
        }

        writer.WriteEndObject();
    }

    private static SceneActorSnapshot ReadActor(JsonElement element, string prefabId, int index)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                "Actor snapshots must be JSON objects.");
        }

        string nodeId = ReadStableNodeId(element, prefabId, index);
        string? parentNodeId = GetOptionalString(element, "parentNodeId");
        string name = GetRequiredString(element, "name");
        ushort layer = GetOptionalUInt16(element, "layer");
        string tag = element.TryGetProperty("tag", out JsonElement tagElement)
            ? GetString(tagElement, "tag")
            : "Default";
        bool active = GetOptionalBoolean(element, "active", true);
        bool persistent = GetOptionalBoolean(element, "persistent", false);
        bool pooled = GetOptionalBoolean(element, "pooled", false);

        if (!element.TryGetProperty("components", out JsonElement componentsElement) ||
            componentsElement.ValueKind != JsonValueKind.Array)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                $"Actor '{nodeId}' requires a components array.",
                nodeId);
        }

        var components = new List<SceneComponentSnapshot>(componentsElement.GetArrayLength());
        foreach (JsonElement componentElement in componentsElement.EnumerateArray())
        {
            components.Add(ReadComponent(componentElement, nodeId));
        }

        ScenePrefabNodeSource? source = ReadSource(element);

        return new SceneActorSnapshot(
            nodeId,
            name,
            layer,
            tag,
            active,
            persistent,
            pooled,
            components,
            parentNodeId,
            source);
    }

    private static SceneComponentSnapshot ReadComponent(JsonElement element, string nodeId)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                "Component snapshots must be JSON objects.",
                nodeId);
        }

        string type = GetRequiredString(element, "type");
        if (!element.TryGetProperty("data", out JsonElement data) ||
            data.ValueKind != JsonValueKind.Object)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                $"Component '{type}' requires an object payload.",
                nodeId);
        }

        string? id = GetOptionalString(element, "id");
        return new SceneComponentSnapshot(type, data, id);
    }

    private static ScenePrefabMetadata ReadMetadata(JsonElement element) => new()
    {
        Revision = GetOptionalString(element, "revision"),
        Locale = GetOptionalString(element, "locale"),
        UpdatedAt = GetOptionalString(element, "updatedAt"),
        TimeZone = GetOptionalString(element, "timeZone"),
        Tags = ReadTags(element)
    };

    private static string[] ReadTags(JsonElement element)
    {
        if (!element.TryGetProperty("tags", out JsonElement tags))
        {
            return [];
        }

        if (tags.ValueKind != JsonValueKind.Array)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                "'tags' must be an array of strings.");
        }

        string[] result = new string[tags.GetArrayLength()];
        int index = 0;
        foreach (JsonElement tag in tags.EnumerateArray())
        {
            result[index++] = tag.ValueKind switch
            {
                JsonValueKind.String => tag.GetString()!,
                JsonValueKind.Null => ThrowNullElement("tags"),
                _ => ThrowInvalidStringTag()
            };
        }

        return result;
    }

    private static void WriteSource(Utf8JsonWriter writer, in ScenePrefabNodeSource source)
    {
        writer.WriteStartObject();
        writer.WriteString("prefabId", source.PrefabId);
        writer.WriteString("nodeId", source.NodeId);

        if (!source.InstancePath.IsEmpty)
        {
            source.InstancePath.WriteTo(writer, "instancePath");
        }

        if (!source.Lineage.IsEmpty)
        {
            source.Lineage.WriteTo(writer, "lineage");
        }

        writer.WriteEndObject();
    }

    private static ScenePrefabNodeSource? ReadSource(JsonElement element)
    {
        if (!element.TryGetProperty("source", out JsonElement sourceElement))
        {
            return null;
        }

        if (sourceElement.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        if (sourceElement.ValueKind != JsonValueKind.Object)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.InvalidProvenance,
                "'source' must be an object or null.");
        }

        return new ScenePrefabNodeSource(
            GetRequiredString(sourceElement, "prefabId"),
            GetRequiredString(sourceElement, "nodeId"),
            ReadIdPath(sourceElement, "instancePath"),
            ReadIdPath(sourceElement, "lineage"));
    }

    private static ScenePrefabIdPath ReadIdPath(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out JsonElement values))
        {
            return ScenePrefabIdPath.Empty;
        }

        if (values.ValueKind != JsonValueKind.Array)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.InvalidProvenance,
                $"'{name}' must be an array of strings.");
        }

        int count = values.GetArrayLength();
        if (count > ScenePrefabIdPath.Capacity)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.InvalidProvenance,
                $"'{name}' exceeds the fixed capacity of {ScenePrefabIdPath.Capacity}.");
        }

        if (count == 0)
        {
            return ScenePrefabIdPath.Empty;
        }

        string[] buffer = ArrayPool<string>.Shared.Rent(count);
        try
        {
            int index = 0;
            foreach (JsonElement value in values.EnumerateArray())
            {
                string item = value.ValueKind switch
                {
                    JsonValueKind.String => value.GetString()!,
                    JsonValueKind.Null => ThrowNullElement(name),
                    _ => ThrowInvalidStringElement(name)
                };
                if (string.IsNullOrEmpty(item))
                {
                    ThrowInvalidProvenance($"'{name}' elements must be non-empty.");
                }

                buffer[index++] = item;
            }

            return ScenePrefabIdPath.Create(buffer.AsSpan(0, count));
        }
        finally
        {
            ArrayPool<string>.Shared.Return(buffer, clearArray: true);
        }
    }

    private static string ReadStableNodeId(JsonElement element, string prefabId, int index)
    {
        if (!element.TryGetProperty("nodeId", out JsonElement nodeIdElement))
        {
            return ScenePrefabNodeIdentity.RequireStableNodeId(null, prefabId, index);
        }

        if (nodeIdElement.ValueKind == JsonValueKind.Null)
        {
            return ScenePrefabNodeIdentity.RequireStableNodeId(null, prefabId, index);
        }

        if (nodeIdElement.ValueKind != JsonValueKind.String)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                $"Property 'nodeId' must be a string.",
                nodeIdElement.ToString());
        }

        return ScenePrefabNodeIdentity.RequireStableNodeId(
            nodeIdElement.GetString(),
            prefabId,
            index);
    }

    [DoesNotReturn]
    private static string ThrowNullElement(string name) =>
        throw new ScenePrefabException(
            ScenePrefabErrorCodes.InvalidNullElement,
            $"'{name}' must not contain null elements.");

    [DoesNotReturn]
    private static string ThrowInvalidStringTag() =>
        throw new ScenePrefabException(
            ScenePrefabErrorCodes.Invalid,
            "'tags' must be an array of strings.");

    [DoesNotReturn]
    private static string ThrowInvalidStringElement(string name) =>
        throw new ScenePrefabException(
            ScenePrefabErrorCodes.InvalidProvenance,
            $"'{name}' must be an array of strings.");

    [DoesNotReturn]
    private static void ThrowInvalidProvenance(string message) =>
        throw new ScenePrefabException(ScenePrefabErrorCodes.InvalidProvenance, message);

    private static void WriteReference(Utf8JsonWriter writer, ScenePrefabReference reference)
    {
        writer.WriteStartObject();

        if (reference.Kind == ScenePrefabReferenceKind.Inline)
        {
            writer.WriteString("kind", "inline");
            writer.WritePropertyName("prefab");
            Write(writer, reference.Prefab!);
        }
        else
        {
            writer.WriteString("kind", "registry");
            writer.WriteString("id", reference.PrefabId);
            if (reference.Revision is { } revision)
            {
                writer.WriteString("revision", revision);
            }
        }

        writer.WriteEndObject();
    }

    private static ScenePrefabReference ReadReference(JsonElement element)
    {
        string kind = GetRequiredString(element, "kind");
        if (string.Equals(kind, "inline", StringComparison.Ordinal))
        {
            return ScenePrefabReference.FromInline(Read(RequireProperty(element, "prefab")));
        }

        if (!string.Equals(kind, "registry", StringComparison.Ordinal))
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                $"Unknown prefab reference kind '{kind}'.");
        }

        return ScenePrefabReference.FromRegistry(
            GetRequiredString(element, "id"),
            GetOptionalString(element, "revision"));
    }

    private static void WriteNestedInstance(Utf8JsonWriter writer, ScenePrefabNestedInstance instance)
    {
        writer.WriteStartObject();
        writer.WriteString("instanceId", instance.InstanceId);
        writer.WritePropertyName("reference");
        WriteReference(writer, instance.Reference);

        if (instance.ParentNodeId is { } parentNodeId)
        {
            writer.WriteString("parentNodeId", parentNodeId);
        }
        else
        {
            writer.WriteNull("parentNodeId");
        }

        if (instance.NamePrefix is { } namePrefix)
        {
            writer.WriteString("namePrefix", namePrefix);
        }

        if (instance.Overrides.Count > 0)
        {
            writer.WriteStartArray("overrides");
            for (int i = 0; i < instance.Overrides.Count; i++)
            {
                WriteOperation(writer, instance.Overrides[i]);
            }

            writer.WriteEndArray();
        }

        writer.WriteEndObject();
    }

    private static ScenePrefabNestedInstance ReadNestedInstance(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                "Nested prefab instances must be JSON objects.");
        }

        string instanceId = GetRequiredString(element, "instanceId");
        ScenePrefabReference reference = ReadReference(RequireProperty(element, "reference"));
        string? parentNodeId = GetOptionalString(element, "parentNodeId");
        string? namePrefix = GetOptionalString(element, "namePrefix");

        var overrides = new List<ScenePrefabOverrideOperation>();
        if (element.TryGetProperty("overrides", out JsonElement overridesElement) &&
            overridesElement.ValueKind == JsonValueKind.Array)
        {
            int operationIndex = 0;
            foreach (JsonElement operationElement in overridesElement.EnumerateArray())
            {
                overrides.Add(ReadOperation(operationElement, instanceId, operationIndex++));
            }
        }

        return new ScenePrefabNestedInstance(
            instanceId,
            reference,
            parentNodeId,
            namePrefix,
            overrides);
    }

    private static void WriteOperation(Utf8JsonWriter writer, ScenePrefabOverrideOperation operation)
    {
        writer.WriteStartObject();

        switch (operation)
        {
            case ScenePrefabAddActorOperation add:
                writer.WriteString("kind", "add-actor");
                if (add.AfterNodeId is { } afterNodeId)
                {
                    writer.WriteString("afterNodeId", afterNodeId);
                }

                writer.WritePropertyName("actor");
                WriteActor(writer, add.Actor);
                break;

            case ScenePrefabRemoveActorOperation remove:
                writer.WriteString("kind", "remove-actor");
                writer.WriteString("nodeId", remove.NodeId);
                break;

            case ScenePrefabReparentActorOperation reparent:
                writer.WriteString("kind", "reparent-actor");
                writer.WriteString("nodeId", reparent.NodeId);
                if (reparent.ParentNodeId is { } parentNodeId)
                {
                    writer.WriteString("parentNodeId", parentNodeId);
                }
                else
                {
                    writer.WriteNull("parentNodeId");
                }

                break;

            case ScenePrefabSetActorFieldOperation setField:
                writer.WriteString("kind", "set-actor-field");
                writer.WriteString("nodeId", setField.NodeId);
                writer.WriteString("field", FieldToString(setField.Field));
                writer.WritePropertyName("value");
                WriteFieldValue(writer, setField.Value);
                break;

            case ScenePrefabAddComponentOperation addComponent:
                writer.WriteString("kind", "add-component");
                writer.WriteString("nodeId", addComponent.NodeId);
                if (addComponent.Index is { } index)
                {
                    writer.WriteNumber("index", index);
                }

                writer.WritePropertyName("component");
                WriteComponent(writer, addComponent.Component);
                break;

            case ScenePrefabRemoveComponentOperation removeComponent:
                writer.WriteString("kind", "remove-component");
                writer.WriteString("nodeId", removeComponent.NodeId);
                writer.WritePropertyName("selector");
                WriteSelector(writer, removeComponent.Selector);
                break;

            case ScenePrefabReplaceComponentOperation replaceComponent:
                writer.WriteString("kind", "replace-component");
                writer.WriteString("nodeId", replaceComponent.NodeId);
                writer.WritePropertyName("selector");
                WriteSelector(writer, replaceComponent.Selector);
                writer.WritePropertyName("component");
                WriteComponent(writer, replaceComponent.Component);
                break;

            case ScenePrefabSetComponentPropertyOperation setProperty:
                writer.WriteString("kind", "set-component-property");
                writer.WriteString("nodeId", setProperty.NodeId);
                writer.WritePropertyName("selector");
                WriteSelector(writer, setProperty.Selector);
                writer.WritePropertyName("path");
                WritePath(writer, setProperty.Path);
                writer.WritePropertyName("value");
                setProperty.Value.WriteTo(writer);
                break;

            case ScenePrefabUnsetComponentPropertyOperation unsetProperty:
                writer.WriteString("kind", "unset-component-property");
                writer.WriteString("nodeId", unsetProperty.NodeId);
                writer.WritePropertyName("selector");
                WriteSelector(writer, unsetProperty.Selector);
                writer.WritePropertyName("path");
                WritePath(writer, unsetProperty.Path);
                break;

            default:
                throw new ScenePrefabException(
                    ScenePrefabErrorCodes.InvalidOverride,
                    $"Unknown override operation '{operation.GetType().Name}'.");
        }

        writer.WriteEndObject();
    }

    private static ScenePrefabOverrideOperation ReadOperation(
        JsonElement element,
        string prefabId,
        int operationIndex)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                "Override operations must be JSON objects.");
        }

        string kind = GetRequiredString(element, "kind");

        return kind switch
        {
            "add-actor" => new ScenePrefabAddActorOperation(
                ReadActor(RequireProperty(element, "actor"), prefabId, operationIndex),
                GetOptionalString(element, "afterNodeId")),
            "remove-actor" => new ScenePrefabRemoveActorOperation(
                GetRequiredString(element, "nodeId")),
            "reparent-actor" => new ScenePrefabReparentActorOperation(
                GetRequiredString(element, "nodeId"),
                GetOptionalString(element, "parentNodeId")),
            "set-actor-field" => new ScenePrefabSetActorFieldOperation(
                GetRequiredString(element, "nodeId"),
                ParseField(GetRequiredString(element, "field")),
                ReadFieldValue(element)),
            "add-component" => new ScenePrefabAddComponentOperation(
                GetRequiredString(element, "nodeId"),
                ReadComponent(RequireProperty(element, "component"), GetRequiredString(element, "nodeId")),
                element.TryGetProperty("index", out JsonElement index) ? index.GetInt32() : null),
            "remove-component" => new ScenePrefabRemoveComponentOperation(
                GetRequiredString(element, "nodeId"),
                ReadSelector(RequireProperty(element, "selector"))),
            "replace-component" => new ScenePrefabReplaceComponentOperation(
                GetRequiredString(element, "nodeId"),
                ReadSelector(RequireProperty(element, "selector")),
                ReadComponent(RequireProperty(element, "component"), GetRequiredString(element, "nodeId"))),
            "set-component-property" => new ScenePrefabSetComponentPropertyOperation(
                GetRequiredString(element, "nodeId"),
                ReadSelector(RequireProperty(element, "selector")),
                ReadPath(element),
                RequireProperty(element, "value").Clone()),
            "unset-component-property" => new ScenePrefabUnsetComponentPropertyOperation(
                GetRequiredString(element, "nodeId"),
                ReadSelector(RequireProperty(element, "selector")),
                ReadPath(element)),
            _ => throw new ScenePrefabException(
                ScenePrefabErrorCodes.InvalidOverride,
                $"Unknown override operation kind '{kind}'.")
        };
    }

    private static void WriteSelector(Utf8JsonWriter writer, in ScenePrefabComponentSelector selector)
    {
        writer.WriteStartObject();

        if (selector.Kind == ScenePrefabComponentSelectorKind.Id)
        {
            writer.WriteString("kind", "id");
            writer.WriteString("componentId", selector.ComponentId);
            if (selector.Type is { } type)
            {
                writer.WriteString("type", type);
            }
        }
        else
        {
            writer.WriteString("kind", "type");
            writer.WriteString("type", selector.Type);
            if (selector.Occurrence > 0)
            {
                writer.WriteNumber("occurrence", selector.Occurrence);
            }
        }

        writer.WriteEndObject();
    }

    private static ScenePrefabComponentSelector ReadSelector(JsonElement element)
    {
        string kind = GetRequiredString(element, "kind");
        if (string.Equals(kind, "id", StringComparison.Ordinal))
        {
            return ScenePrefabComponentSelector.FromId(
                GetRequiredString(element, "componentId"),
                GetOptionalString(element, "type"));
        }

        if (!string.Equals(kind, "type", StringComparison.Ordinal))
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.InvalidOverride,
                $"Unknown component selector kind '{kind}'.");
        }

        int occurrence = element.TryGetProperty("occurrence", out JsonElement occurrenceElement)
            ? occurrenceElement.GetInt32()
            : 0;

        return ScenePrefabComponentSelector.FromType(
            GetRequiredString(element, "type"),
            occurrence);
    }

    private static void WritePath(Utf8JsonWriter writer, ScenePrefabPropertyPath path)
    {
        writer.WriteStartArray();
        for (int i = 0; i < path.Count; i++)
        {
            ScenePrefabPropertyPathSegment segment = path[i];
            if (segment.IsIndex)
            {
                writer.WriteNumberValue(segment.Index);
            }
            else
            {
                writer.WriteStringValue(segment.Name);
            }
        }

        writer.WriteEndArray();
    }

    private static ScenePrefabPropertyPath ReadPath(JsonElement element)
    {
        JsonElement pathElement = RequireProperty(element, "path");
        if (pathElement.ValueKind != JsonValueKind.Array)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.InvalidPath,
                "Component property paths must be arrays.");
        }

        var segments = new ScenePrefabPropertyPathSegment[pathElement.GetArrayLength()];
        int index = 0;
        foreach (JsonElement segment in pathElement.EnumerateArray())
        {
            segments[index++] = segment.ValueKind switch
            {
                JsonValueKind.Number => ScenePrefabPropertyPathSegment.ForIndex(segment.GetInt32()),
                JsonValueKind.String => ScenePrefabPropertyPathSegment.ForName(
                    segment.GetString() ?? string.Empty),
                _ => throw new ScenePrefabException(
                    ScenePrefabErrorCodes.InvalidPath,
                    "Component property path segments must be strings or indices.")
            };
        }

        return new ScenePrefabPropertyPath(segments);
    }

    private static void WriteFieldValue(Utf8JsonWriter writer, in ScenePrefabActorFieldValue value)
    {
        switch (value.Kind)
        {
            case ScenePrefabActorFieldValueKind.Text:
                writer.WriteStringValue(value.AsString());
                break;
            case ScenePrefabActorFieldValueKind.Number:
                writer.WriteNumberValue(value.AsInt32());
                break;
            case ScenePrefabActorFieldValueKind.Flag:
                writer.WriteBooleanValue(value.AsBoolean());
                break;
            default:
                throw new ScenePrefabException(
                    ScenePrefabErrorCodes.InvalidOverride,
                    "Actor field values must be strings, integers or booleans.");
        }
    }

    private static ScenePrefabActorFieldValue ReadFieldValue(JsonElement element)
    {
        JsonElement value = RequireProperty(element, "value");
        return value.ValueKind switch
        {
            JsonValueKind.String => ScenePrefabActorFieldValue.FromString(value.GetString() ?? string.Empty),
            JsonValueKind.Number => ScenePrefabActorFieldValue.FromInt32(value.GetInt32()),
            JsonValueKind.True or JsonValueKind.False => ScenePrefabActorFieldValue.FromBoolean(value.GetBoolean()),
            _ => throw new ScenePrefabException(
                ScenePrefabErrorCodes.InvalidOverride,
                "Actor field values must be strings, integers or booleans.")
        };
    }

    private static JsonElement RequireProperty(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out JsonElement value))
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                $"Required property '{name}' is missing.");
        }

        return value;
    }

    private static string FieldToString(ScenePrefabActorField field) => field switch
    {
        ScenePrefabActorField.Name => "name",
        ScenePrefabActorField.Layer => "layer",
        ScenePrefabActorField.Tag => "tag",
        ScenePrefabActorField.Active => "active",
        ScenePrefabActorField.Persistent => "persistent",
        ScenePrefabActorField.Pooled => "pooled",
        _ => field.ToString()
    };

    private static ScenePrefabActorField ParseField(string value) => value switch
    {
        "name" => ScenePrefabActorField.Name,
        "layer" => ScenePrefabActorField.Layer,
        "tag" => ScenePrefabActorField.Tag,
        "active" => ScenePrefabActorField.Active,
        "persistent" => ScenePrefabActorField.Persistent,
        "pooled" => ScenePrefabActorField.Pooled,
        _ => throw new ScenePrefabException(
            ScenePrefabErrorCodes.InvalidOverride,
            $"Unknown actor field '{value}'.")
    };

    private static string GetRequiredString(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out JsonElement value))
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                $"Required property '{name}' is missing.");
        }

        return GetString(value, name);
    }

    private static string GetString(JsonElement value, string name)
    {
        if (value.ValueKind != JsonValueKind.String)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                $"Property '{name}' must be a string.");
        }

        return value.GetString() ?? string.Empty;
    }

    private static string? GetOptionalString(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out JsonElement value) ||
            value.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        return GetString(value, name);
    }

    private static bool GetOptionalBoolean(JsonElement element, string name, bool fallback) =>
        element.TryGetProperty(name, out JsonElement value)
            ? value.GetBoolean()
            : fallback;

    private static ushort GetOptionalUInt16(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out JsonElement value))
        {
            return 0;
        }

        int number = value.GetInt32();
        if (number is < 0 or > ushort.MaxValue)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                $"Property '{name}' is outside the 16-bit layer range.");
        }

        return (ushort)number;
    }

    private static string KindToString(ScenePrefabKind kind) => kind switch
    {
        ScenePrefabKind.Variant => "variant",
        ScenePrefabKind.Resolved => "resolved",
        _ => "prefab"
    };

    private static ScenePrefabKind ParseKind(string value) => value switch
    {
        "variant" => ScenePrefabKind.Variant,
        "resolved" => ScenePrefabKind.Resolved,
        _ => ScenePrefabKind.Prefab
    };
}
