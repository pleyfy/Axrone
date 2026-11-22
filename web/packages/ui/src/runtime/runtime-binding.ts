import { InvalidUIAssetError } from '../errors';
import type { UIAsset, WidgetId, WidgetKey } from '../types';
import { createControllerContext, type RuntimeRecordHost } from './runtime-record-apply';

export interface RuntimeBindingHost<TRuntime = unknown> extends RuntimeRecordHost<TRuntime> {
    readonly bindingTable: Map<string, WidgetId>;
}

export function rebuildBindingTable<TRuntime>(
    host: RuntimeBindingHost<TRuntime>,
    bindings: UIAsset['bindings']
): void {
    host.bindingTable.clear();
    if (!bindings) {
        return;
    }
    const widgetsByKey = new Map<WidgetKey, WidgetId>();
    const duplicateKeys = new Set<WidgetKey>();
    for (let index = 0; index < host.records.length; index += 1) {
        const record = host.records[index];
        if (!record || record.key === undefined || record.key === null) {
            continue;
        }
        if (widgetsByKey.has(record.key)) {
            duplicateKeys.add(record.key);
        } else {
            widgetsByKey.set(record.key, index as WidgetId);
        }
    }
    for (const [name, key] of Object.entries(bindings)) {
        if (key === null) {
            continue;
        }
        if (duplicateKeys.has(key)) {
            throw new InvalidUIAssetError(
                `Binding "${name}" is ambiguous: multiple widgets share the key "${String(key)}".`,
                { name, key }
            );
        }
        const widget = widgetsByKey.get(key);
        if (widget === undefined) {
            throw new InvalidUIAssetError(
                `Binding "${name}" refers to a widget key "${String(key)}" that does not exist in the asset tree.`,
                { name, key }
            );
        }
        host.bindingTable.set(name, widget);
    }
}

export function remountControllers<TRuntime>(host: RuntimeBindingHost<TRuntime>): void {
    for (let index = 0; index < host.records.length; index += 1) {
        const record = host.records[index];
        if (!record?.controller) {
            continue;
        }
        const controller = host.registry.resolve(record.controller);
        controller?.mount?.(createControllerContext(host, index));
    }
}
