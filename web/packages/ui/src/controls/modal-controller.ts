import type { UIRuntime } from '../runtime';
import type { UIInputEvent, WidgetId } from '../types';
import type { WidgetController, WidgetControllerContext } from '../widget';
import { asBoolean, asString, hitTestBoundWidget, setWidgetVisible } from './internals';

export const MODAL_CONTROLLER_TYPE = 'modal';

export interface ModalControllerProps {
    readonly open?: boolean;
    readonly backdropKey?: string;
    readonly panelKey?: string;
    readonly dismissOnOutside?: boolean;
    readonly onClose?: string;
}

export interface ModalControllerState {
    open: boolean;
}

type ModalContext = WidgetControllerContext<
    Record<string, unknown>,
    ModalControllerState,
    UIRuntime
>;

const applyVisibility = (context: ModalContext): void => {
    const props = context.props as ModalControllerProps;
    const runtime = context.runtime;
    const open = context.state.open;
    const backdropKey = asString(props.backdropKey);
    if (backdropKey) {
        const backdrop = runtime.getBoundWidget(backdropKey);
        if (backdrop !== null) {
            setWidgetVisible(runtime, backdrop, open);
        }
    }
    const panelKey = asString(props.panelKey);
    if (panelKey) {
        const panel = runtime.getBoundWidget(panelKey);
        if (panel !== null) {
            setWidgetVisible(runtime, panel, open);
        }
    }
};

export const modalController: WidgetController<
    typeof MODAL_CONTROLLER_TYPE,
    Record<string, unknown>,
    ModalControllerState,
    UIRuntime,
    unknown
> = {
    type: MODAL_CONTROLLER_TYPE,
    createState: (props) => {
        const modalProps = props as ModalControllerProps;
        return {
            open: asBoolean(modalProps.open, false),
        };
    },
    mount: (context) => {
        applyVisibility(context as ModalContext);
    },
    update: (context, previousProps) => {
        const typed = context as ModalContext;
        const props = typed.props as ModalControllerProps;
        const previous = previousProps as ModalControllerProps;
        if (
            props.open !== previous.open ||
            props.backdropKey !== previous.backdropKey ||
            props.panelKey !== previous.panelKey
        ) {
            typed.state.open = asBoolean(props.open, typed.state.open);
            applyVisibility(typed);
        }
    },
    input: (event: Readonly<UIInputEvent>, context) => {
        const typed = context as ModalContext;
        const state = typed.state;
        if (!state) {
            return false;
        }
        if (event.type !== 'pointer' || event.phase !== 'down') {
            return false;
        }
        if (!state.open) {
            return false;
        }
        const props = typed.props as ModalControllerProps;
        if (!asBoolean(props.dismissOnOutside, true)) {
            return false;
        }
        const panelKey = asString(props.panelKey);
        if (!panelKey) {
            return false;
        }
        const panel = typed.runtime.getBoundWidget(panelKey);
        if (panel === null) {
            return false;
        }
        if (hitTestBoundWidget(typed.runtime, panel, event.x, event.y)) {
            return false;
        }
        state.open = false;
        applyVisibility(typed);
        const onClose = asString(props.onClose);
        if (onClose) {
            typed.runtime.emitControllerEvent(typed.widget as WidgetId, onClose, {
                dismissed: true,
            });
        }
        return true;
    },
};

export const getModalOpen = (
    runtime: UIRuntime,
    widget: WidgetId
): boolean | null => {
    const state = runtime.getWidgetState(widget) as ModalControllerState | null;
    return state && typeof state.open === 'boolean' ? state.open : null;
};
