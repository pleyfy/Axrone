declare module 'draco3dgltf' {
    export function createDecoderModule(
        options?: Readonly<Record<string, unknown>>
    ): Promise<any>;
    export function createEncoderModule(
        options?: Readonly<Record<string, unknown>>
    ): Promise<any>;
}

declare module 'draco3dgltf/draco_decoder_gltf_nodejs.js' {
    const DracoDecoderModule: (
        options?: Readonly<{
            locateFile?: (path: string, scriptDirectory: string) => string;
        }>
    ) => Promise<any>;

    export { DracoDecoderModule };
    export default DracoDecoderModule;
}