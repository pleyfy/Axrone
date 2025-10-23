export class ShaderCache {
    private readonly programs = new Map<string, ShaderProgram>();
    private readonly gl: WebGL2RenderingContext;

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
    }

    getOrCreate(
        vertexSource: string,
        fragmentSource: string,
        defines: Record<string, any> = {},
        key = this.generateKey(vertexSource, fragmentSource, defines)
    ): ShaderProgram {
        if (this.programs.has(key)) {
            return this.programs.get(key)!;
        }

        const program = createShaderProgram(this.gl, vertexSource, fragmentSource, { defines });
        this.programs.set(key, program);

        return program;
    }

    private generateKey(vertexSource: string, fragmentSource: string, defines: Record<string, any>): string {
        const definesKey = Object.entries(defines)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}:${value}`)
            .join('|');

        const vsHash = this.hashString(vertexSource);
        const fsHash = this.hashString(fragmentSource);
        const defHash = this.hashString(definesKey);

        return `${vsHash}_${fsHash}_${defHash}`;
    }

    private hashString(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(36);
    }

    clear(): void {
        for (const program of this.programs.values()) {
            program.dispose();
        }
        this.programs.clear();
    }

    dispose(): void {
        this.clear();
    }
}