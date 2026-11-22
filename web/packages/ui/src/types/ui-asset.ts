import type { WidgetSerializableKey } from './foundation';
import type { WidgetSnapshot } from './render-frame';

/**
 * Determines how the UI canvas scales from its reference resolution
 * to the actual viewport size.
 *
 * - `match-width`: Scale uniformly so that the canvas width matches the viewport width.
 *   Height may be cropped or letterboxed.
 * - `match-height`: Scale uniformly so that the canvas height matches the viewport height.
 *   Width may be cropped or letterboxed.
 * - `match-width-or-height`: Scale uniformly using a bias between width and height matching.
 *   A `matchBias` of 0 behaves like `match-width`; 1 behaves like `match-height`.
 * - `fill`: Scale non-uniformly so the canvas exactly fills the viewport (may stretch).
 * - `fixed`: No scaling (1:1 pixel mapping), centered with possible letterboxing.
 */
export type UICanvasScaleMode =
    | 'match-width'
    | 'match-height'
    | 'match-width-or-height'
    | 'fill'
    | 'fixed';

/**
 * Safe-area insets expressed in CSS/reference-resolution pixels.
 * Used to keep UI content away from notches, rounded corners, or status bars.
 */
export interface UISafeAreaInset {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
}

/**
 * Canvas configuration for a UI asset.
 * Defines the reference resolution and how the UI scales to different viewports.
 */
export interface UICanvasConfig {
    /** Design-time width in logical pixels (e.g. 1920). Must be > 0. */
    readonly referenceWidth: number;
    /** Design-time height in logical pixels (e.g. 1080). Must be > 0. */
    readonly referenceHeight: number;
    /** How the canvas scales from reference to actual viewport. */
    readonly scaleMode: UICanvasScaleMode;
    /**
     * Bias for `match-width-or-height` mode.
     * 0 = match width, 1 = match height, 0.5 = equal blend.
     * Ignored by other scale modes. Clamped to [0, 1].
     */
    readonly matchBias: number;
    /** Optional safe-area inset in reference-resolution pixels. */
    readonly safeAreaInset?: UISafeAreaInset;
}

/**
 * A standalone UI asset that can be serialized as `.ui.json`.
 *
 * This is the top-level document for the Unreal/UMG-style "UI as independent asset"
 * architecture. A UI asset contains its own canvas configuration and widget tree,
 * independent of any 3D scene. Scenes reference UI assets by ID.
 */
export interface UIComponentVariant {
    readonly textOverrides?: Readonly<Record<string, string>>;
    readonly propOverrides?: Readonly<Record<string, unknown>>;
}

export interface UIComponentDefinition {
    readonly name: string;
    readonly root: WidgetSnapshot;
    readonly variants?: Readonly<Record<string, UIComponentVariant>>;
}

export interface UIComponentInstanceProps {
    readonly componentId: string;
    readonly variant?: string;
    readonly textOverrides?: Readonly<Record<string, string>>;
    readonly propOverrides?: Readonly<Record<string, unknown>>;
}

export const COMPONENT_INSTANCE_ROLE = 'custom:instance';

export interface UIAsset {
    /** Unique identifier for this UI asset. */
    readonly id: string;
    /** Human-readable name. */
    readonly name: string;
    /** Schema version for forward-compatible migration. */
    readonly version: number;
    /** Canvas configuration (reference resolution, scale mode, safe area). */
    readonly canvas: UICanvasConfig;
    /** Root of the widget tree (same format as UIRuntimeSnapshot.root). */
    readonly root: WidgetSnapshot;
    readonly components?: Readonly<Record<string, UIComponentDefinition>>;
    /**
     * Optional named bindings that map symbolic names to widget `key` values
     * (as declared on WidgetSnapshot.key). Widget IDs are regenerated on restore,
     * so bindings resolve by key; UIRuntime.loadFromAsset() builds the
     * name -> WidgetId table exposed via getBoundWidget()/getBindingTable().
     */
    readonly bindings?: Readonly<Record<string, WidgetSerializableKey>>;
}
