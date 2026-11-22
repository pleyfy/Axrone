import { clamp } from '@axrone/numeric';
import type { UIRuntime } from '../runtime';
import type { LayoutBox, WidgetId } from '../types';
import { setWidgetVisible } from './internals';

// ─── Public types ───────────────────────────────────────────────────────────

export type PopupPosition =
    | 'top'
    | 'bottom'
    | 'left'
    | 'right'
    | 'top-start'
    | 'top-end'
    | 'bottom-start'
    | 'bottom-end';

export interface PopupConfig {
    /** The widget that triggers the popup (anchor). */
    readonly anchor: WidgetId;
    /** The popup widget to show. Will be reparented to root. */
    readonly popup: WidgetId;
    /** Preferred position relative to anchor. */
    readonly position?: PopupPosition;
    /** Gap between anchor and popup (pixels). */
    readonly offset?: number;
    /** Whether to flip position when overflowing viewport. */
    readonly autoFlip?: boolean;
    /** Whether to dismiss on outside click. */
    readonly dismissOnOutsideClick?: boolean;
    /** Callback when popup opens. */
    readonly onOpen?: () => void;
    /** Callback when popup closes. */
    readonly onClose?: () => void;
    /**
     * The widget the popup should be restored to on close. Defaults to
     * runtime.root when not provided. Callers that reparent the popup from a
     * non-root container should pass that container here so the widget is
     * returned to its original location when the popup closes.
     */
    readonly originalParent?: WidgetId;
}

export interface PopupHandle {
    /** Close the popup. */
    close(): void;
    /** Whether the popup is currently open. */
    readonly isOpen: boolean;
    /** The popup widget ID. */
    readonly popup: WidgetId;
}

export interface PopupManager {
    /** Open a popup. Returns a handle to close it. */
    open(config: PopupConfig): PopupHandle;
    /** Close all open popups. */
    closeAll(): void;
    /** Number of currently open popups. */
    readonly count: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const POPUP_BASE_Z_INDEX = 1000;
const POPUP_Z_INDEX_STEP = 10;
const DEFAULT_OFFSET = 8;

// ─── Internal types ─────────────────────────────────────────────────────────

interface ActivePopupEntry {
    readonly config: PopupConfig;
    readonly popupWidget: WidgetId;
    readonly originalParent: WidgetId;
    backdrop: WidgetId | null;
    readonly zIndex: number;
    closed: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Safely reads a widget's layout box, returning null when the widget has been
 * disposed. This avoids throwing WidgetNotFoundError during popup positioning
 * or cleanup when an anchor or popup widget is removed while the popup is open.
 */
const tryGetLayoutBox = (runtime: UIRuntime, widget: WidgetId): LayoutBox | null => {
    try {
        return runtime.getLayoutBox(widget);
    } catch {
        return null;
    }
};

/**
 * Returns the opposite position for auto-flip. Vertical positions flip to
 * their vertical opposite; horizontal positions flip to their horizontal
 * opposite. The -start/-end suffix is preserved.
 */
const flipPosition = (position: PopupPosition): PopupPosition => {
    switch (position) {
        case 'top':
            return 'bottom';
        case 'bottom':
            return 'top';
        case 'left':
            return 'right';
        case 'right':
            return 'left';
        case 'top-start':
            return 'bottom-start';
        case 'top-end':
            return 'bottom-end';
        case 'bottom-start':
            return 'top-start';
        case 'bottom-end':
            return 'top-end';
    }
};

/**
 * Computes the absolute left/top position for a popup relative to an anchor
 * box, given the popup's measured size, the desired position, and the gap
 * offset between anchor and popup.
 */
const computePosition = (
    anchorBox: LayoutBox,
    popupWidth: number,
    popupHeight: number,
    position: PopupPosition,
    offset: number,
): { left: number; top: number } => {
    switch (position) {
        case 'bottom':
            return {
                left: anchorBox.x + (anchorBox.width - popupWidth) * 0.5,
                top: anchorBox.y + anchorBox.height + offset,
            };
        case 'top':
            return {
                left: anchorBox.x + (anchorBox.width - popupWidth) * 0.5,
                top: anchorBox.y - offset - popupHeight,
            };
        case 'right':
            return {
                left: anchorBox.x + anchorBox.width + offset,
                top: anchorBox.y + (anchorBox.height - popupHeight) * 0.5,
            };
        case 'left':
            return {
                left: anchorBox.x - offset - popupWidth,
                top: anchorBox.y + (anchorBox.height - popupHeight) * 0.5,
            };
        case 'bottom-start':
            return {
                left: anchorBox.x,
                top: anchorBox.y + anchorBox.height + offset,
            };
        case 'bottom-end':
            return {
                left: anchorBox.x + anchorBox.width - popupWidth,
                top: anchorBox.y + anchorBox.height + offset,
            };
        case 'top-start':
            return {
                left: anchorBox.x,
                top: anchorBox.y - offset - popupHeight,
            };
        case 'top-end':
            return {
                left: anchorBox.x + anchorBox.width - popupWidth,
                top: anchorBox.y - offset - popupHeight,
            };
    }
};

/**
 * Returns true when a rect with the given position and size extends beyond
 * the root bounds on any edge.
 */
const overflowsRoot = (
    left: number,
    top: number,
    popupWidth: number,
    popupHeight: number,
    rootBox: LayoutBox,
): boolean => {
    return (
        left < rootBox.x ||
        top < rootBox.y ||
        left + popupWidth > rootBox.x + rootBox.width ||
        top + popupHeight > rootBox.y + rootBox.height
    );
};

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Creates a PopupManager that any controller can use to show popups at the
 * root level with z-ordering, click-outside-to-dismiss, anchor positioning,
 * and auto-flip when overflowing the viewport.
 *
 * The manager is a utility, not a controller. Controllers call `open()` to
 * display a popup and receive a handle they can use to close it.
 */
export const createPopupManager = (runtime: UIRuntime): PopupManager => {
    const activePopups: ActivePopupEntry[] = [];

    /**
     * Positions the popup widget relative to the anchor using absolute inset
     * values. When autoFlip is enabled and the popup would overflow the root
     * bounds, the position is flipped to the opposite side and re-checked.
     */
    const positionPopup = (
        anchor: WidgetId,
        popupWidget: WidgetId,
        position: PopupPosition,
        offset: number,
        autoFlip: boolean,
    ): void => {
        const anchorBox = tryGetLayoutBox(runtime, anchor);
        const rootBox = tryGetLayoutBox(runtime, runtime.root);
        if (anchorBox === null || rootBox === null) {
            return;
        }

        // Read the popup's current layout box for its size. The popup was
        // just enabled with absolute positioning, so its box reflects the
        // last layout pass. If it was never laid out the size will be zero,
        // which degrades gracefully (position collapses to the anchor edge).
        const popupBox = tryGetLayoutBox(runtime, popupWidget);
        const popupWidth = popupBox?.width ?? 0;
        const popupHeight = popupBox?.height ?? 0;

        let { left, top } = computePosition(anchorBox, popupWidth, popupHeight, position, offset);

        if (autoFlip && overflowsRoot(left, top, popupWidth, popupHeight, rootBox)) {
            const flipped = flipPosition(position);
            const flippedPos = computePosition(anchorBox, popupWidth, popupHeight, flipped, offset);
            if (!overflowsRoot(flippedPos.left, flippedPos.top, popupWidth, popupHeight, rootBox)) {
                left = flippedPos.left;
                top = flippedPos.top;
            }
        }

        // Clamp to root bounds so the popup is never partially off-screen
        // when neither the preferred nor the flipped position fits entirely.
        const clampedLeft = clamp(left, rootBox.x, rootBox.x + rootBox.width - popupWidth);
        const clampedTop = clamp(top, rootBox.y, rootBox.y + rootBox.height - popupHeight);

        runtime.updateWidget(popupWidget, {
            layout: {
                position: 'absolute',
                inset: { left: clampedLeft, top: clampedTop },
            },
        });
    };

    const closeEntry = (entry: ActivePopupEntry): void => {
        if (entry.closed) {
            return;
        }
        entry.closed = true;

        // Restore the popup to its original parent so the reparenting to root
        // is not permanent. The widget may have been disposed externally, so
        // guard with a layout-box probe before touching the tree.
        const popupBox = tryGetLayoutBox(runtime, entry.popupWidget);
        if (popupBox !== null) {
            runtime.appendChild(entry.originalParent, entry.popupWidget);
            setWidgetVisible(runtime, entry.popupWidget, false);
        }

        // Remove the backdrop widget if it was created.
        if (entry.backdrop !== null) {
            const backdropBox = tryGetLayoutBox(runtime, entry.backdrop);
            if (backdropBox !== null) {
                runtime.removeWidget(entry.backdrop);
            }
            entry.backdrop = null;
        }

        // Remove from the active list.
        const index = activePopups.indexOf(entry);
        if (index >= 0) {
            activePopups.splice(index, 1);
        }

        entry.config.onClose?.();
    };

    const manager: PopupManager = {
        open(config: PopupConfig): PopupHandle {
            const position = config.position ?? 'bottom';
            const offset = config.offset ?? DEFAULT_OFFSET;
            const autoFlip = config.autoFlip ?? true;
            const dismissOnOutsideClick = config.dismissOnOutsideClick ?? true;

            // Record where the popup currently lives before reparenting it to
            // root. Callers can supply the original parent explicitly via the
            // config; otherwise we fall back to root (the safe no-op target).
            const originalParent = config.originalParent ?? runtime.root;

            // Reparent the popup widget to the root so it renders above all
            // other content and is not clipped by ancestor containers.
            runtime.appendChild(runtime.root, config.popup);

            // Assign a z-index that stacks above all currently open popups.
            const zIndex = POPUP_BASE_Z_INDEX + activePopups.length * POPUP_Z_INDEX_STEP;

            // Enable the popup with absolute positioning so it can be placed
            // independently of the normal layout flow.
            runtime.updateWidget(config.popup, {
                enabled: true,
                layout: {
                    position: 'absolute',
                    zIndex,
                },
            });

            // Build the entry before the handle so the handle's close() can
            // reference it. The backdrop is filled in after the handle exists
            // because its pointer-down handler calls handle.close().
            const entry: ActivePopupEntry = {
                config,
                popupWidget: config.popup,
                originalParent,
                backdrop: null,
                zIndex,
                closed: false,
            };

            const handle: PopupHandle = {
                close(): void {
                    closeEntry(entry);
                },
                get isOpen(): boolean {
                    return !entry.closed;
                },
                get popup(): WidgetId {
                    return config.popup;
                },
            };

            // Create a full-screen transparent backdrop behind the popup to
            // catch outside clicks. The backdrop sits at zIndex - 1 so the
            // popup (and its interactive children) receive hits first.
            if (dismissOnOutsideClick) {
                const backdrop = runtime.createWidget({
                    interactive: true,
                    layout: {
                        position: 'absolute',
                        inset: { top: 0, right: 0, bottom: 0, left: 0 },
                        zIndex: zIndex - 1,
                    },
                    style: {
                        background: '#00000000',
                    },
                    handlers: {
                        pointerDown: (): boolean => {
                            handle.close();
                            return true;
                        },
                    },
                });
                runtime.appendChild(runtime.root, backdrop);
                entry.backdrop = backdrop;
            }

            // Calculate and apply the popup's position relative to the anchor.
            positionPopup(config.anchor, config.popup, position, offset, autoFlip);

            activePopups.push(entry);
            config.onOpen?.();

            return handle;
        },

        closeAll(): void {
            // Iterate in reverse to avoid index shifts when entries are
            // spliced out during closeEntry.
            for (let i = activePopups.length - 1; i >= 0; i--) {
                closeEntry(activePopups[i]!);
            }
        },

        get count(): number {
            return activePopups.length;
        },
    };

    return manager;
};
