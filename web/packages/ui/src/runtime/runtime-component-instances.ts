import { COMPONENT_INSTANCE_ROLE } from '../types/ui-asset';
import type {
    UIComponentDefinition,
    UIComponentInstanceProps,
    WidgetId,
    WidgetKey,
    WidgetSnapshot,
} from '../types';
import { NodeFlag } from './node-flags';
import { restoreChildSnapshot, type RuntimeSnapshotHost } from './runtime-snapshot';

export interface RuntimeComponentHost<TRuntime = unknown> extends RuntimeSnapshotHost<TRuntime> {
    readonly flags: Uint32Array;
    readonly parent: Int32Array;
    readonly nextSibling: Int32Array;
    removeWidget(widget: WidgetId): void;
    insertChildBefore(parent: WidgetId, child: WidgetId, before: WidgetId | null): void;
}

export function cloneSnapshotForInstance(
    snapshot: WidgetSnapshot,
    instanceKey: string,
    remap: Map<string, string>
): WidgetSnapshot {
    const rawKey = typeof snapshot.key === 'string' ? snapshot.key : null;
    const nextKey = rawKey ? `${instanceKey}__${rawKey}` : snapshot.key;
    if (rawKey && typeof nextKey === 'string') {
        remap.set(rawKey, nextKey);
    }
    return {
        role: snapshot.role,
        controller: snapshot.controller,
        key: nextKey,
        props: snapshot.props,
        enabled: snapshot.enabled,
        interactive: snapshot.interactive,
        layout: snapshot.layout,
        style: snapshot.style,
        text: snapshot.text,
        image: snapshot.image,
        focus: snapshot.focus,
        children: (snapshot.children ?? []).map((child) =>
            cloneSnapshotForInstance(child, instanceKey, remap)
        ),
    };
}

export function remapSnapshotRefs(snapshot: WidgetSnapshot, remap: Map<string, string>): void {
    const props = snapshot.props as Record<string, unknown> | undefined;
    if (props) {
        for (const [name, value] of Object.entries(props)) {
            if (typeof value === 'string' && remap.has(value)) {
                props[name] = remap.get(value);
            }
        }
    }
    for (const child of snapshot.children ?? []) {
        remapSnapshotRefs(child, remap);
    }
}

export function findSnapshotNode(snapshot: WidgetSnapshot, key: string): WidgetSnapshot | null {
    if (snapshot.key === key) {
        return snapshot;
    }
    for (const child of snapshot.children ?? []) {
        const found = findSnapshotNode(child, key);
        if (found) {
            return found;
        }
    }
    return null;
}

export function expandInstanceNode<TRuntime>(
    host: RuntimeComponentHost<TRuntime>,
    instance: WidgetId,
    definitions: Readonly<Record<string, UIComponentDefinition>>,
    created: Map<string, WidgetId>,
    replaced: Set<WidgetKey>
): boolean {
    const index = instance as number;
    const record = host.records[index];
    if (!record || (host.flags[index] & NodeFlag.Allocated) === 0) {
        return false;
    }
    const props = record.props as unknown as UIComponentInstanceProps;
    const componentId = typeof props.componentId === 'string' ? props.componentId : '';
    const definition = componentId ? definitions[componentId] : undefined;
    if (!definition) {
        return false;
    }
    const parent = host.parent[index];
    if (parent === 0) {
        return false;
    }
    if (record.key !== undefined) {
        replaced.add(record.key);
    }
    const recordKey = typeof record.key === 'string' && record.key ? record.key : `inst${index}`;
    const before = host.nextSibling[index] !== 0 ? (host.nextSibling[index] as WidgetId) : null;
    const remap = new Map<string, string>();
    const cloned = cloneSnapshotForInstance(definition.root, recordKey, remap);
    const instanceLayout = host.records[index]?.layoutInput as
        | { position?: unknown; inset?: unknown }
        | undefined;
    if (instanceLayout && typeof instanceLayout === 'object') {
        const placement: Record<string, unknown> = {};
        if (instanceLayout.position !== undefined) {
            placement['position'] = instanceLayout.position;
        }
        if (instanceLayout.inset !== undefined) {
            placement['inset'] = instanceLayout.inset;
        }
        if (Object.keys(placement).length > 0) {
            (cloned as { layout?: unknown }).layout = {
                ...((cloned.layout as Record<string, unknown> | undefined) ?? {}),
                ...placement,
            };
        }
    }
    const variantName = typeof props.variant === 'string' ? props.variant : '';
    const variant = variantName ? definition.variants?.[variantName] : undefined;
    const mergedProps: Record<string, unknown> = {
        ...((cloned.props as Record<string, unknown> | undefined) ?? {}),
    };
    const propLayers = [variant?.propOverrides, props.propOverrides];
    for (const layer of propLayers) {
        if (layer && typeof layer === 'object' && !Array.isArray(layer)) {
            Object.assign(mergedProps, layer);
        }
    }
    (cloned as { props?: unknown }).props = mergedProps;
    remapSnapshotRefs(cloned, remap);
    const textLayers = [variant?.textOverrides, props.textOverrides];
    for (const layer of textLayers) {
        if (!layer || typeof layer !== 'object' || Array.isArray(layer)) {
            continue;
        }
        for (const [masterKey, value] of Object.entries(layer)) {
            if (typeof value !== 'string') {
                continue;
            }
            const resolved = remap.get(masterKey);
            const target = resolved ? findSnapshotNode(cloned, resolved) : null;
            const text = target?.text as { value?: unknown } | undefined;
            if (target && text && typeof text === 'object') {
                text.value = value;
            }
        }
    }
    host.removeWidget(instance);
    const expanded = new Map<string, WidgetId>();
    restoreChildSnapshot(host, parent as WidgetId, cloned, expanded);
    const expandedRoot = expanded.get(cloned.key as string);
    if (expandedRoot !== undefined) {
        if (typeof record.key === 'string') {
            created.set(record.key, expandedRoot);
        }
        if (before !== null) {
            host.insertChildBefore(parent as WidgetId, expandedRoot, before);
        }
    }
    for (const [name, widget] of expanded) {
        created.set(name, widget);
    }
    return true;
}

export function expandComponentInstances<TRuntime>(
    host: RuntimeComponentHost<TRuntime>,
    definitions: Readonly<Record<string, UIComponentDefinition>> | undefined
): { created: Map<string, WidgetId>; replaced: Set<WidgetKey> } {
    const created = new Map<string, WidgetId>();
    const replaced = new Set<WidgetKey>();
    if (!definitions) {
        return { created, replaced };
    }
    for (let pass = 0; pass < 16; pass += 1) {
        const pending: number[] = [];
        for (let index = 0; index < host.records.length; index += 1) {
            const record = host.records[index];
            if (!record || (host.flags[index] & NodeFlag.Allocated) === 0) {
                continue;
            }
            if (record.role !== COMPONENT_INSTANCE_ROLE) {
                continue;
            }
            pending.push(index);
        }
        if (pending.length === 0) {
            break;
        }
        let progressed = false;
        for (const index of pending) {
            if (expandInstanceNode(host, index as WidgetId, definitions, created, replaced)) {
                progressed = true;
            }
        }
        if (!progressed) {
            break;
        }
    }
    return { created, replaced };
}
