import type { UIRuntime } from '../runtime';
import type { WidgetId } from '../types';
import type { WidgetController, WidgetControllerContext } from '../widget';
import { asArray, asString } from './internals';

export const PAGE_CONTROLLER_TYPE = 'page-controller';

export interface PageControllerProps {
    readonly page?: string;
    readonly pages?: readonly string[];
    readonly onPageChange?: string;
}

export interface PageControllerState {
    page: string;
}

type PageContext = WidgetControllerContext<
    Record<string, unknown>,
    PageControllerState,
    UIRuntime
>;

export const pageController: WidgetController<
    typeof PAGE_CONTROLLER_TYPE,
    Record<string, unknown>,
    PageControllerState,
    UIRuntime,
    unknown
> = {
    type: PAGE_CONTROLLER_TYPE,
    createState: (props) => {
        const pageProps = props as PageControllerProps;
        return {
            page: asString(pageProps.page),
        };
    },
    mount: (context) => {
        const typed = context as PageContext;
        const props = typed.props as PageControllerProps;
        typed.state.page = asString(props.page);
    },
    update: (context, previousProps) => {
        const typed = context as PageContext;
        const props = typed.props as PageControllerProps;
        const previous = previousProps as PageControllerProps;
        if (props.page !== previous.page) {
            const next = asString(props.page);
            if (next !== typed.state.page) {
                typed.state.page = next;
                const name = asString(props.onPageChange);
                if (name) {
                    const pages = asArray(props.pages);
                    const index = pages.indexOf(next);
                    typed.runtime.emitControllerEvent(typed.widget as WidgetId, name, { page: next, index });
                }
            }
        }
    },
    input: () => false,
};

export const getPage = (
    runtime: UIRuntime,
    widget: WidgetId
): string | null => {
    const state = runtime.getWidgetState(widget) as PageControllerState | null;
    return state && typeof state.page === 'string' ? state.page : null;
};
