import {
    AXRONE_DEFAULT_UI_FONT_FAMILY,
    createDefaultUIFontAsset,
    ensureDefaultUIFont,
} from '../font';
import type { ColorInput } from '../types';
import type { UIControlTheme, UIControlVariant } from './types';

export const AXRONE_FALLBACK_UI_FONT_FAMILY = AXRONE_DEFAULT_UI_FONT_FAMILY;
export const createFallbackUIFontAsset = createDefaultUIFontAsset;
export const ensureFallbackUIFont = ensureDefaultUIFont;

export const defaultUIControlTheme: Readonly<UIControlTheme> = Object.freeze({
    fontSize: 15,
    controlHeight: 44,
    controlRadius: 14,
    borderWidth: 1,
    canvasColor: '#07101dcc',
    panelColor: '#0d1728dd',
    surfaceColor: '#132133f2',
    surfaceRaisedColor: '#1c2d45ff',
    surfaceHoverColor: '#263d5cff',
    surfacePressedColor: '#101a2bff',
    surfaceDisabledColor: '#132033b8',
    borderColor: '#dbe7ff26',
    borderMutedColor: '#dbe7ff16',
    focusColor: '#60a5faff',
    textColor: '#f8fbffff',
    textMutedColor: '#8fa1bbff',
    placeholderColor: '#72839dff',
    accentColor: '#2563ebff',
    accentHoverColor: '#3b82f6ff',
    accentPressedColor: '#1d4ed8ff',
    successColor: '#22c55eff',
    successHoverColor: '#4ade80ff',
    successPressedColor: '#16a34aff',
    warningColor: '#f59e0bff',
    warningHoverColor: '#fbbf24ff',
    warningPressedColor: '#d97706ff',
    dangerColor: '#ef4444ff',
    dangerHoverColor: '#f87171ff',
    dangerPressedColor: '#dc2626ff',
    thumbColor: '#f8fbffff',
    trackColor: '#0b1220ff',
});

export const resolveTheme = (theme: Partial<UIControlTheme> | undefined): UIControlTheme => ({
    ...defaultUIControlTheme,
    ...(theme ?? {}),
});

export const resolveThemeScale = (theme: UIControlTheme): number =>
    Math.max(theme.controlHeight / defaultUIControlTheme.controlHeight, 0.5);

export const resolveVariantPalette = (
    theme: UIControlTheme,
    variant: UIControlVariant
): Readonly<{
    idle: ColorInput;
    hover: ColorInput;
    pressed: ColorInput;
    text: ColorInput;
    border: ColorInput;
}> => {
    switch (variant) {
        case 'primary':
            return {
                idle: theme.accentColor,
                hover: theme.accentHoverColor,
                pressed: theme.accentPressedColor,
                text: '#f8fbffff',
                border: '#93c5fd88',
            };
        case 'success':
            return {
                idle: theme.successColor,
                hover: theme.successHoverColor,
                pressed: theme.successPressedColor,
                text: '#f8fbffff',
                border: '#86efacaa',
            };
        case 'warning':
            return {
                idle: theme.warningColor,
                hover: theme.warningHoverColor,
                pressed: theme.warningPressedColor,
                text: '#140d03ff',
                border: '#fcd34daa',
            };
        case 'danger':
            return {
                idle: theme.dangerColor,
                hover: theme.dangerHoverColor,
                pressed: theme.dangerPressedColor,
                text: '#f8fbffff',
                border: '#fca5a5aa',
            };
        case 'neutral':
        default:
            return {
                idle: theme.surfaceRaisedColor,
                hover: theme.surfaceHoverColor,
                pressed: theme.surfacePressedColor,
                text: theme.textColor,
                border: theme.borderColor,
            };
    }
};
