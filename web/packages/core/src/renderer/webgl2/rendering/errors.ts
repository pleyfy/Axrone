type RenderErrorCode =
    | 'PIPELINE_DISPOSED'
    | 'INVALID_CAMERA'
    | 'INVALID_VIEWPORT'
    | 'INVALID_PRIMITIVE'
    | 'INVALID_LIGHT'
    | 'INVALID_EFFECT'
    | 'RESOURCE_CONFLICT'
    | 'RESOURCE_NOT_FOUND'
    | 'BACKEND_FAILED'
    | 'PASS_EXECUTION_FAILED'
    | 'BAKE_TASK_NOT_FOUND'
    | 'INVALID_ARGUMENT';

type RenderErrorContext = Readonly<Record<string, unknown>> | undefined;

const ERROR_MESSAGES: Readonly<
    Record<
        string,
        Readonly<Record<RenderErrorCode, string>>
    >
> = Object.freeze({
    en: Object.freeze({
        PIPELINE_DISPOSED: 'render pipeline has been disposed',
        INVALID_CAMERA: 'invalid camera state provided to render pipeline',
        INVALID_VIEWPORT: 'invalid viewport provided to render pipeline',
        INVALID_PRIMITIVE: 'invalid render primitive provided to render pipeline',
        INVALID_LIGHT: 'invalid light provided to render pipeline',
        INVALID_EFFECT: 'invalid post-process effect provided to render pipeline',
        RESOURCE_CONFLICT: 'resource conflict detected inside render graph',
        RESOURCE_NOT_FOUND: 'requested render resource was not found',
        BACKEND_FAILED: 'render backend execution failed',
        PASS_EXECUTION_FAILED: 'render pass execution failed',
        BAKE_TASK_NOT_FOUND: 'requested bake task was not found',
        INVALID_ARGUMENT: 'invalid argument provided to render pipeline',
    }),
    tr: Object.freeze({
        PIPELINE_DISPOSED: 'render pipeline dispose edilmis durumda',
        INVALID_CAMERA: 'render pipeline icin gecersiz kamera durumu verildi',
        INVALID_VIEWPORT: 'render pipeline icin gecersiz viewport verildi',
        INVALID_PRIMITIVE: 'render pipeline icin gecersiz primitive verildi',
        INVALID_LIGHT: 'render pipeline icin gecersiz isik verildi',
        INVALID_EFFECT: 'gecersiz post-process effect verildi',
        RESOURCE_CONFLICT: 'render graph icinde kaynak cakismasi algilandi',
        RESOURCE_NOT_FOUND: 'istenen render kaynagi bulunamadi',
        BACKEND_FAILED: 'render backend calistirilirken hata olustu',
        PASS_EXECUTION_FAILED: 'render pass yurutulurken hata olustu',
        BAKE_TASK_NOT_FOUND: 'istenen bake gorevi bulunamadi',
        INVALID_ARGUMENT: 'render pipeline icin gecersiz arguman verildi',
    }),
});

const serializeContext = (context: RenderErrorContext): string => {
    if (!context || Object.keys(context).length === 0) {
        return '';
    }

    try {
        return ` ${JSON.stringify(context)}`;
    } catch {
        return '';
    }
};

export class RenderPipelineError extends Error {
    readonly code: RenderErrorCode;
    readonly locale: string;
    readonly context?: RenderErrorContext;

    constructor(
        code: RenderErrorCode,
        locale: string = 'en',
        context?: RenderErrorContext,
        cause?: Error
    ) {
        const catalog = ERROR_MESSAGES[locale] ?? ERROR_MESSAGES.en;
        const message = `[RenderPipeline:${code}] ${catalog[code]}${serializeContext(context)}`;
        super(message);
        this.name = 'RenderPipelineError';
        this.code = code;
        this.locale = locale;
        this.context = context;
        if (cause) {
            this.cause = cause;
        }
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class RenderValidationError extends RenderPipelineError {
    constructor(code: Extract<RenderErrorCode, 'INVALID_CAMERA' | 'INVALID_VIEWPORT' | 'INVALID_PRIMITIVE' | 'INVALID_LIGHT' | 'INVALID_EFFECT' | 'INVALID_ARGUMENT'>, locale: string = 'en', context?: RenderErrorContext) {
        super(code, locale, context);
        this.name = 'RenderValidationError';
    }
}

export class RenderResourceError extends RenderPipelineError {
    constructor(
        code: Extract<RenderErrorCode, 'RESOURCE_CONFLICT' | 'RESOURCE_NOT_FOUND'>,
        locale: string = 'en',
        context?: RenderErrorContext
    ) {
        super(code, locale, context);
        this.name = 'RenderResourceError';
    }
}

export class RenderExecutionError extends RenderPipelineError {
    constructor(
        code: Extract<RenderErrorCode, 'BACKEND_FAILED' | 'PASS_EXECUTION_FAILED'>,
        locale: string = 'en',
        context?: RenderErrorContext,
        cause?: Error
    ) {
        super(code, locale, context, cause);
        this.name = 'RenderExecutionError';
    }
}

export class RenderBakeTaskError extends RenderPipelineError {
    constructor(locale: string = 'en', context?: RenderErrorContext) {
        super('BAKE_TASK_NOT_FOUND', locale, context);
        this.name = 'RenderBakeTaskError';
    }
}

export const isRenderPipelineError = (value: unknown): value is RenderPipelineError =>
    value instanceof RenderPipelineError;
