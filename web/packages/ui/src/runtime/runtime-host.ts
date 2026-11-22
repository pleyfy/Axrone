import type { WidgetId } from '../types';
import type { WidgetController } from '../widget';

export interface RuntimeControllerResolver {
    resolve(type: string | null | undefined): WidgetController<any, any, any> | null;
}

export interface RuntimePointerState {
    getHovered(): WidgetId | null;
    setHovered(widget: WidgetId | null): void;
    getPressed(): WidgetId | null;
    setPressed(widget: WidgetId | null): void;
}

export interface RuntimeLayoutDirtyState {
    layoutDirty: boolean;
    structuralDirty: boolean;
    readonly dirtyNodes: Set<number>;
}
