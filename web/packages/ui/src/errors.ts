export const enum UIErrorCode {
    InvalidArgument = 'UI_INVALID_ARGUMENT',
    WidgetNotFound = 'UI_WIDGET_NOT_FOUND',
    TreeIntegrity = 'UI_TREE_INTEGRITY',
    FontLoadFailed = 'UI_FONT_LOAD_FAILED',
    FontFamilyNotFound = 'UI_FONT_FAMILY_NOT_FOUND',
    FontFaceNotFound = 'UI_FONT_FACE_NOT_FOUND',
    Disposed = 'UI_DISPOSED',
    DuplicateController = 'UI_DUPLICATE_CONTROLLER',
    InvalidSnapshot = 'UI_INVALID_SNAPSHOT',
}

export class UIError extends Error {
    readonly code: UIErrorCode;
    readonly details?: unknown;

    constructor(code: UIErrorCode, message: string, details?: unknown) {
        super(message);
        this.name = 'UIError';
        this.code = code;
        this.details = details;
    }
}

export class WidgetNotFoundError extends UIError {
    constructor(widgetId: number) {
        super(UIErrorCode.WidgetNotFound, `Widget ${widgetId} was not found.`, { widgetId });
        this.name = 'WidgetNotFoundError';
    }
}

export class WidgetTreeIntegrityError extends UIError {
    constructor(message: string, details?: unknown) {
        super(UIErrorCode.TreeIntegrity, message, details);
        this.name = 'WidgetTreeIntegrityError';
    }
}

export class FontLoadError extends UIError {
    constructor(message: string, details?: unknown) {
        super(UIErrorCode.FontLoadFailed, message, details);
        this.name = 'FontLoadError';
    }
}

export class FontFamilyNotFoundError extends UIError {
    constructor(family: string) {
        super(UIErrorCode.FontFamilyNotFound, `Font family \"${family}\" was not found.`, { family });
        this.name = 'FontFamilyNotFoundError';
    }
}

export class FontFaceNotFoundError extends UIError {
    constructor(details?: unknown) {
        super(UIErrorCode.FontFaceNotFound, 'No font face matches the requested query.', details);
        this.name = 'FontFaceNotFoundError';
    }
}

export class DisposedUIError extends UIError {
    constructor(target: string) {
        super(UIErrorCode.Disposed, `${target} has already been disposed.`, { target });
        this.name = 'DisposedUIError';
    }
}