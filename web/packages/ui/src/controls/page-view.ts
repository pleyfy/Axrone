import type { UIRuntime } from '../runtime';
import type { WidgetId } from '../types';
import type { UIPageViewHandle, UIPageViewOptions } from './types';
import { attachToParent, clamp, disposeWidget } from './internals';
import { resolveTheme } from './theme';

export const createUIPageView = <TRuntime>(
    runtime: UIRuntime<TRuntime>,
    options: UIPageViewOptions = {}
): UIPageViewHandle => {
    const theme = resolveTheme(options.theme);
    const indicatorSize = Math.max(8, Math.round(theme.controlHeight * 0.24));
    const state = {
        page: Math.max(0, options.page ?? 0),
        disabled: options.disabled ?? false,
        showIndicators: options.showIndicators ?? true,
    };
    const pages: WidgetId[] = [];
    const indicatorDots: WidgetId[] = [];

    const root = runtime.createWidget({
        role: 'custom:page-view',
        key: options.key,
        enabled: !state.disabled,
        interactive: !state.disabled,
        focus: {
            focusable: !state.disabled,
            ...(options.focus ?? {}),
        },
        layout: {
            display: 'overlay',
            width: 320,
            height: 200,
            ...(options.layout ?? {}),
        },
        style: {
            background: options.style?.background ?? theme.panelColor,
            borderColor: options.style?.borderColor ?? theme.borderColor,
            borderWidth: options.style?.borderWidth ?? theme.borderWidth,
            radius: options.style?.radius ?? theme.controlRadius,
            clip: true,
            ...(options.style ?? {}),
        },
        handlers: {
            keyDown: (event) => {
                if (state.disabled || pages.length === 0) {
                    return false;
                }
                if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
                    setPageInternal(state.page - 1);
                    return true;
                }
                if (event.key === 'ArrowRight' || event.key === 'PageDown') {
                    setPageInternal(state.page + 1);
                    return true;
                }
                return false;
            },
        },
    });
    const content = runtime.createWidget({
        role: 'container:page-view-content',
        layout: {
            position: 'absolute',
            anchor: 'stretch',
            display: 'overlay',
        },
    });
    const indicators = runtime.createWidget({
        role: 'container:page-view-indicators',
        layout: {
            position: 'absolute',
            anchor: 'bottom',
            inset: { bottom: Math.max(10, Math.round(theme.controlHeight * 0.28)) },
            display: 'stack',
            direction: 'row',
            gap: Math.max(6, Math.round(theme.controlHeight * 0.18)),
            justifyContent: 'center',
            alignItems: 'center',
            width: 'content',
            height: 'content',
        },
    });

    attachToParent(runtime, options.parent, root);
    runtime.appendChild(root, content);
    if (state.showIndicators) {
        runtime.appendChild(root, indicators);
    }

    const updateIndicators = (): void => {
        if (!state.showIndicators) {
            return;
        }
        while (indicatorDots.length < pages.length) {
            const dotIndex = indicatorDots.length;
            const dot = runtime.createWidget({
                role: 'custom:page-view-dot',
                interactive: true,
                focus: { focusable: false },
                layout: {
                    width: indicatorSize,
                    height: indicatorSize,
                    shrink: 0,
                },
                handlers: {
                    pointerUp: () => {
                        setPageInternal(dotIndex);
                        return true;
                    },
                },
            });
            indicatorDots.push(dot);
            runtime.appendChild(indicators, dot);
        }
        for (let index = 0; index < indicatorDots.length; index += 1) {
            runtime.updateWidget(indicatorDots[index], {
                style: {
                    background: index === state.page ? theme.accentColor : theme.surfaceRaisedColor,
                    borderColor: index === state.page ? theme.focusColor : theme.borderColor,
                    borderWidth: 1,
                    radius: 999,
                    opacity: index === state.page ? 1 : 0.85,
                },
            });
        }
    };

    const setPageInternal = (index: number): void => {
        if (pages.length === 0) {
            state.page = 0;
            return;
        }
        state.page = clamp(index, 0, pages.length - 1);
        for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
            runtime.updateWidget(pages[pageIndex], {
                layout: {
                    position: 'absolute',
                    anchor: 'stretch',
                },
                style: {
                    visible: pageIndex === state.page,
                },
            });
        }
        updateIndicators();
    };

    updateIndicators();

    return {
        root,
        content,
        getPage() {
            return state.page;
        },
        setPage(index) {
            setPageInternal(index);
        },
        addPage(page) {
            pages.push(page);
            runtime.appendChild(content, page);
            setPageInternal(state.page);
            return pages.length - 1;
        },
        next() {
            setPageInternal(state.page + 1);
            return state.page;
        },
        previous() {
            setPageInternal(state.page - 1);
            return state.page;
        },
        dispose() {
            disposeWidget(runtime, root);
        },
    };
};