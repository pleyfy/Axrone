import type { CameraLocale } from './camera-culling-types';

export type CameraCullingErrorCode =
    | 'CAMERA_DISPOSED'
    | 'CULLER_DISPOSED'
    | 'FRUSTUM_DISPOSED'
    | 'INVALID_ARGUMENT'
    | 'INVALID_BOUNDS'
    | 'INVALID_CAMERA_ID'
    | 'INVALID_MATRIX'
    | 'INVALID_POSE'
    | 'INVALID_PROJECTION'
    | 'INVALID_RADIUS'
    | 'INVALID_SERIALIZED_CAMERA'
    | 'INVALID_VECTOR'
    | 'OPERATION_ABORTED'
    | 'RESULT_OVERFLOW';

export type CameraCullingErrorContext = Readonly<Record<string, unknown>>;

const EN_MESSAGES: Record<CameraCullingErrorCode, string> = {
    CAMERA_DISPOSED: 'camera has already been disposed',
    CULLER_DISPOSED: 'frustum culler has already been disposed',
    FRUSTUM_DISPOSED: 'frustum has already been disposed',
    INVALID_ARGUMENT: 'invalid argument supplied',
    INVALID_BOUNDS: 'invalid bounding volume supplied',
    INVALID_CAMERA_ID: 'camera id must be a non-empty string',
    INVALID_MATRIX: 'matrix must contain 16 finite numeric elements',
    INVALID_POSE: 'camera pose must describe a valid look direction and up vector',
    INVALID_PROJECTION: 'projection settings are invalid',
    INVALID_RADIUS: 'sphere radius must be a finite value greater than or equal to zero',
    INVALID_SERIALIZED_CAMERA: 'serialized camera payload is invalid',
    INVALID_VECTOR: 'vector must contain finite numeric components',
    OPERATION_ABORTED: 'operation was aborted',
    RESULT_OVERFLOW: 'visible result budget was exceeded',
};

const TR_MESSAGES: Record<CameraCullingErrorCode, string> = {
    CAMERA_DISPOSED: 'kamera zaten sonlandirildi',
    CULLER_DISPOSED: 'gorunum hacmi ayiklayicisi zaten sonlandirildi',
    FRUSTUM_DISPOSED: 'frustum zaten sonlandirildi',
    INVALID_ARGUMENT: 'gecersiz bagimsiz degisken verildi',
    INVALID_BOUNDS: 'gecersiz sinir hacmi verildi',
    INVALID_CAMERA_ID: 'kamera kimligi bos olmayan bir metin olmali',
    INVALID_MATRIX: 'matris 16 adet sonlu sayisal eleman icermeli',
    INVALID_POSE: 'kamera pozu gecerli bir bakis yonu ve yukari vektoru tanimlamali',
    INVALID_PROJECTION: 'projeksiyon ayarlari gecersiz',
    INVALID_RADIUS: 'kure yaricapi sonlu ve sifirdan buyuk veya esit olmali',
    INVALID_SERIALIZED_CAMERA: 'serilestirilmis kamera verisi gecersiz',
    INVALID_VECTOR: 'vektor sonlu sayisal bilesenler icermeli',
    OPERATION_ABORTED: 'islem iptal edildi',
    RESULT_OVERFLOW: 'gorunur sonuc butcesi asildi',
};

const MESSAGE_TABLE: Readonly<Record<'en' | 'tr', Record<CameraCullingErrorCode, string>>> = {
    en: EN_MESSAGES,
    tr: TR_MESSAGES,
};

export const resolveCameraCullingMessage = (
    code: CameraCullingErrorCode,
    locale: CameraLocale = 'en'
): string => {
    if (locale === 'tr') {
        return MESSAGE_TABLE.tr[code];
    }
    return MESSAGE_TABLE.en[code];
};

export class CameraCullingError extends Error {
    readonly name = 'CameraCullingError';

    constructor(
        public readonly code: CameraCullingErrorCode,
        public readonly locale: CameraLocale = 'en',
        public readonly context: CameraCullingErrorContext = {},
        public override readonly cause?: unknown
    ) {
        super(resolveCameraCullingMessage(code, locale));
    }
}

export class CameraValidationError extends CameraCullingError {
    readonly name = 'CameraValidationError';

    constructor(
        code: Extract<
            CameraCullingErrorCode,
            | 'CAMERA_DISPOSED'
            | 'CULLER_DISPOSED'
            | 'FRUSTUM_DISPOSED'
            | 'INVALID_ARGUMENT'
            | 'INVALID_BOUNDS'
            | 'INVALID_CAMERA_ID'
            | 'INVALID_MATRIX'
            | 'INVALID_POSE'
            | 'INVALID_PROJECTION'
            | 'INVALID_RADIUS'
            | 'INVALID_VECTOR'
            | 'OPERATION_ABORTED'
            | 'RESULT_OVERFLOW'
        >,
        locale: CameraLocale = 'en',
        context: CameraCullingErrorContext = {},
        cause?: unknown
    ) {
        super(code, locale, context, cause);
    }
}

export class CameraSerializationError extends CameraCullingError {
    readonly name = 'CameraSerializationError';

    constructor(
        locale: CameraLocale = 'en',
        context: CameraCullingErrorContext = {},
        cause?: unknown
    ) {
        super('INVALID_SERIALIZED_CAMERA', locale, context, cause);
    }
}