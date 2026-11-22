import type {
    WidgetConfig,
    WidgetId,
    WidgetKey,
    WidgetSerializableKey,
    WidgetSnapshot,
} from '../types';
import {
    EMPTY_FOCUS_INPUT,
    EMPTY_LAYOUT_INPUT,
    EMPTY_RECORD_OBJECT,
    EMPTY_STYLE_INPUT,
    cloneData,
} from './internals';
import type { StoredWidgetRecord } from './records';

export interface RuntimeSnapshotHost<TRuntime = unknown> {
    readonly records: Array<StoredWidgetRecord<TRuntime> | null>;
    readonly firstChild: Int32Array;
    readonly nextSibling: Int32Array;
    createWidget(config: WidgetConfig<Record<string, unknown>, TRuntime>): WidgetId;
    appendChild(parent: WidgetId, child: WidgetId): void;
}

export function snapshotNode(host: RuntimeSnapshotHost, index: number): WidgetSnapshot {
    const record = host.records[index]!;
    const children: WidgetSnapshot[] = [];
    for (let child = host.firstChild[index]; child !== 0; child = host.nextSibling[child]) {
        children.push(snapshotNode(host, child));
    }
    return {
        role: record.role,
        controller: record.controller ?? undefined,
        key: serializeKey(record.key),
        props: cloneData(record.props),
        enabled: record.enabled,
        interactive: record.interactive,
        layout: cloneData(record.layoutInput),
        style: cloneData(record.styleInput),
        text: cloneData(record.textInput),
        image: cloneData(record.imageInput),
        focus: cloneData(record.focusInput),
        children,
    };
}

export function serializeKey(key: WidgetKey | undefined): WidgetSerializableKey | undefined {
    if (key === undefined) {
        return undefined;
    }
    if (typeof key === 'symbol') {
        return null;
    }
    return key;
}

export function restoreChildSnapshot<TRuntime>(
    host: RuntimeSnapshotHost<TRuntime>,
    parent: WidgetId,
    snapshot: WidgetSnapshot,
    created?: Map<string, WidgetId>
): WidgetId {
    const child = host.createWidget({
        role: snapshot.role,
        controller: snapshot.controller,
        key: snapshot.key ?? undefined,
        props: cloneData(snapshot.props ?? EMPTY_RECORD_OBJECT),
        enabled: snapshot.enabled,
        interactive: snapshot.interactive,
        layout: cloneData(snapshot.layout ?? EMPTY_LAYOUT_INPUT),
        style: cloneData(snapshot.style ?? EMPTY_STYLE_INPUT),
        text: cloneData(snapshot.text ?? null),
        image: cloneData(snapshot.image ?? null),
        focus: cloneData(snapshot.focus ?? EMPTY_FOCUS_INPUT),
    });
    if (created !== undefined && typeof snapshot.key === 'string') {
        created.set(snapshot.key, child);
    }
    host.appendChild(parent, child);
    for (const grandChild of snapshot.children) {
        restoreChildSnapshot(host, child, grandChild, created);
    }
    return child;
}
