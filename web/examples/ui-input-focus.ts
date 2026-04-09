import { createDemoPanel, createDemoText, createUIExampleHost } from './ui/example-helpers';
import type { ExampleContext, SceneExample } from './example-types';

const uiInputFocusExample: SceneExample = {
    id: 'ui-input-focus',
    title: 'UI Input And Focus',
    description: 'Interactive example for pointer hover, focus navigation, button activation, and text input editing routed through the runtime.',
    tags: ['ui', 'input', 'focus', 'overlay'],
    order: 9,
    async mount({ container }: ExampleContext) {
        const host = await createUIExampleHost({ container, bindInput: true });
        const { runtime } = host;

        const state = {
            value: 'TYPE HERE',
            cursor: 9,
            selectedAction: 'BUILD',
            log: 'CLICK OR TAB THROUGH THE UI',
            hoveredAction: null as string | null,
            focusedAction: null as string | null,
            inputFocused: false,
        };

        const clampCursor = () => {
            state.cursor = Math.max(0, Math.min(state.cursor, state.value.length));
        };

        const panel = createDemoPanel(runtime, { width: 620, height: 340, gap: 16 });
        const title = createDemoText(runtime, 'INPUT AND FOCUS', 20, { color: '#f8fafcff', layout: { height: 26 } });
        const instructions = createDemoText(runtime, 'TAB FOCUS TYPE BACKSPACE ENTER', 12, {
            color: '#93c5fdff',
            layout: { width: '100%', height: 16 },
            text: { wrap: 'none' },
        });
        const actionRow = runtime.createWidget({
            layout: { display: 'stack', direction: 'row', gap: 12, width: '100%', height: 44 },
        });
        const contentRow = runtime.createWidget({
            layout: { display: 'stack', direction: 'row', gap: 12, width: '100%', height: 116 },
        });
        const inputCard = runtime.createWidget({
            layout: { width: 258, padding: 14, display: 'stack', direction: 'column', gap: 10, height: 116 },
            style: { background: '#111827ff', borderColor: '#334155ff', borderWidth: 1, radius: 14 },
        });
        const statusCard = runtime.createWidget({
            layout: { grow: 1, padding: 14, display: 'stack', direction: 'column', gap: 8, height: 116 },
            style: { background: '#111827ff', borderColor: '#334155ff', borderWidth: 1, radius: 14 },
        });

        const inputWidget = runtime.createWidget({
            role: 'input',
            interactive: true,
            focus: { focusable: true, scope: true },
            layout: { width: '100%', height: 44, padding: [12, 12] },
            style: { background: '#020617ff', borderColor: '#334155ff', borderWidth: 1, radius: 12 },
            text: {
                value: state.value,
                family: 'OverlayBitmap',
                size: 16,
                color: '#f8fafcff',
                caretIndex: state.cursor,
                caretColor: '#f8fafcff',
                caretWidth: 2,
                caretInset: 1,
                wrap: 'none',
            },
            handlers: {
                focus: () => {
                    state.inputFocused = true;
                    state.log = 'INPUT FOCUSED';
                    syncInput();
                    syncStatus();
                },
                blur: () => {
                    state.inputFocused = false;
                    syncInput();
                    syncStatus();
                },
                keyDown: (event) => {
                    if (event.key === 'Backspace') {
                        if (state.cursor > 0) {
                            state.value = `${state.value.slice(0, state.cursor - 1)}${state.value.slice(state.cursor)}`;
                            state.cursor -= 1;
                            clampCursor();
                            state.log = 'BACKSPACE';
                            syncInput();
                            syncStatus();
                        }
                        return true;
                    }
                    if (event.key === 'Delete') {
                        if (state.cursor < state.value.length) {
                            state.value = `${state.value.slice(0, state.cursor)}${state.value.slice(state.cursor + 1)}`;
                            clampCursor();
                            state.log = 'DELETE';
                            syncInput();
                            syncStatus();
                        }
                        return true;
                    }
                    if (event.key === 'ArrowLeft') {
                        state.cursor = Math.max(0, state.cursor - 1);
                        clampCursor();
                        syncInput();
                        return true;
                    }
                    if (event.key === 'ArrowRight') {
                        state.cursor = Math.min(state.value.length, state.cursor + 1);
                        clampCursor();
                        syncInput();
                        return true;
                    }
                    if (event.key === 'Home') {
                        state.cursor = 0;
                        syncInput();
                        return true;
                    }
                    if (event.key === 'End') {
                        state.cursor = state.value.length;
                        syncInput();
                        return true;
                    }
                    return false;
                },
                textInput: (event) => {
                    if (!event.text) {
                        return false;
                    }
                    const nextText = event.text.replace(/\s+/g, ' ').toUpperCase();
                    state.value = `${state.value.slice(0, state.cursor)}${nextText}${state.value.slice(state.cursor)}`;
                    state.cursor += nextText.length;
                    clampCursor();
                    state.log = `TEXT ${nextText}`;
                    syncInput();
                    syncStatus();
                    return true;
                },
            },
        });

        const selectedLabel = createDemoText(runtime, `ACTION ${state.selectedAction}`, 14, {
            color: '#7dd3fcff',
            layout: { width: '100%', height: 18 },
            text: { wrap: 'none' },
        });
        const logLabel = createDemoText(runtime, state.log, 12, {
            color: '#cbd5e1ff',
            layout: { width: '100%', height: 34 },
            text: { wrap: 'word', maxLines: 2 },
        });

        type ActionButton = { readonly action: string; readonly widget: number; readonly label: number };
        const actions: ActionButton[] = [];

        const syncButton = (button: ActionButton) => {
            const hovered = state.hoveredAction === button.action;
            const focused = state.focusedAction === button.action;
            const active = state.selectedAction === button.action;

            runtime.updateWidget(button.widget as never, {
                style: {
                    background: active ? '#0f3d66ff' : hovered ? '#172554ff' : '#0f172aff',
                    borderColor: focused ? '#38bdf8ff' : active ? '#0ea5e9ff' : '#334155ff',
                    borderWidth: 1,
                    radius: 12,
                },
            });
            runtime.updateWidget(button.label as never, {
                text: {
                    value: button.action,
                    color: active || focused ? '#f8fafcff' : hovered ? '#dbeafeff' : '#93c5fdff',
                },
            });
        };

        const syncButtons = () => {
            for (const button of actions) {
                syncButton(button);
            }
        };

        const syncInput = () => {
            runtime.updateWidget(inputWidget, {
                style: {
                    background: state.inputFocused ? '#082f49ff' : '#020617ff',
                    borderColor: state.inputFocused ? '#38bdf8ff' : '#334155ff',
                    borderWidth: 1,
                    radius: 12,
                },
                text: {
                    value: state.value,
                    caretIndex: state.cursor,
                    caretColor: state.inputFocused ? '#f8fafcff' : '#00000000',
                },
            });
        };

        const syncStatus = () => {
            runtime.updateWidget(selectedLabel, { text: { value: `ACTION ${state.selectedAction}` } });
            runtime.updateWidget(logLabel, { text: { value: state.log } });
        };

        const createActionButton = (action: string) => {
            let widget = 0;
            let label = 0;
            widget = runtime.createWidget({
                role: 'button',
                interactive: true,
                focus: { focusable: true, order: actions.length },
                layout: { grow: 1, height: 42, padding: [10, 14] },
                style: { background: '#0f172aff', borderColor: '#334155ff', borderWidth: 1, radius: 12 },
                handlers: {
                    pointerEnter: () => {
                        state.hoveredAction = action;
                        syncButtons();
                    },
                    pointerLeave: () => {
                        if (state.hoveredAction === action) {
                            state.hoveredAction = null;
                            syncButtons();
                        }
                    },
                    pointerDown: () => {
                        state.selectedAction = action;
                        state.log = `ACTION ${action}`;
                        syncButtons();
                        syncStatus();
                        return true;
                    },
                    focus: () => {
                        state.focusedAction = action;
                        syncButtons();
                    },
                    blur: () => {
                        if (state.focusedAction === action) {
                            state.focusedAction = null;
                            syncButtons();
                        }
                    },
                    keyDown: (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            state.selectedAction = action;
                            state.log = `ACTION ${action}`;
                            syncButtons();
                            syncStatus();
                            return true;
                        }
                        return false;
                    },
                },
            });
            label = createDemoText(runtime, action, 14, {
                color: '#93c5fdff',
                layout: { width: '100%', height: 18 },
                text: { align: 'center', wrap: 'none' },
            });
            runtime.appendChild(widget, label);
            const descriptor = { action, widget, label };
            actions.push(descriptor);
            syncButton(descriptor);
            return widget;
        };

        runtime.appendChild(runtime.root, panel);
        runtime.appendChild(panel, title);
        runtime.appendChild(panel, instructions);
        runtime.appendChild(panel, actionRow);
        runtime.appendChild(panel, contentRow);

        runtime.appendChild(actionRow, createActionButton('NAV'));
        runtime.appendChild(actionRow, createActionButton('SAVE'));
        runtime.appendChild(actionRow, createActionButton('BUILD'));

        runtime.appendChild(contentRow, inputCard);
        runtime.appendChild(contentRow, statusCard);

        runtime.appendChild(inputCard, createDemoText(runtime, 'TEXT FIELD', 14, { color: '#f8fafcff', layout: { width: '100%', height: 18 }, text: { wrap: 'none' } }));
        runtime.appendChild(inputCard, inputWidget);

        runtime.appendChild(statusCard, createDemoText(runtime, 'STATUS', 14, { color: '#f8fafcff', layout: { width: '100%', height: 18 }, text: { wrap: 'none' } }));
        runtime.appendChild(statusCard, selectedLabel);
        runtime.appendChild(statusCard, logLabel);

        syncInput();
        syncStatus();
        syncButtons();

        return host;
    },
};

export default uiInputFocusExample;