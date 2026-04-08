declare module 'draco3dgltf' {
    export function createDecoderModule(
        options?: Readonly<Record<string, unknown>>
    ): Promise<any>;
    export function createEncoderModule(
        options?: Readonly<Record<string, unknown>>
    ): Promise<any>;
}