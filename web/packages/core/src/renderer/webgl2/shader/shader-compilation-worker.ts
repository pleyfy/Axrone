export class ShaderCompilationWorker {
    private readonly worker: Worker;
    private readonly pendingCompilations = new Map<string, (shader: string) => void>();

    constructor() {
        const workerCode = `
        self.onmessage = function(e) {
          const { id, source, type, options } = e.data;
          
          try {
            // Process shader
            const processed = processShader(source, type, options);
            
            // Send result back
            self.postMessage({
              id,
              success: true,
              shader: processed
            });
          } catch (error) {
            // Send error
            self.postMessage({
              id,
              success: false,
              error: error.message
            });
          }
        };
        
        function processShader(source, type, options) {
          const { defines = {}, version = '300 es', precision = 'highp' } = options || {};
          
          // Add version
          let result = \`#version \${version}\\n\`;
          
          // Add defines
          for (const [key, value] of Object.entries(defines)) {
            if (value === true) {
              result += \`#define \${key}\\n\`;
            } else if (value !== false) {
              result += \`#define \${key} \${value}\\n\`;
            }
          }
          
          // Add precision for fragment shaders
          if (type === 'fragment') {
            result += \`precision \${precision} float;\\n\`;
          }
          
          // Add source
          result += source;
          
          return result;
        }
      `;

        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);

        this.worker = new Worker(url);

        URL.revokeObjectURL(url);

        this.worker.onmessage = this.handleMessage.bind(this);
    }

    compile(
        source: string,
        type: 'vertex' | 'fragment',
        options?: { defines?: Record<string, any>; version?: string; precision?: string }
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const id = `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

            this.pendingCompilations.set(id, resolve);

            this.worker.postMessage({
                id,
                source,
                type,
                options,
            });
        });
    }

    private handleMessage(event: MessageEvent): void {
        const { id, success, shader, error } = event.data;

        const callback = this.pendingCompilations.get(id);
        if (!callback) return;

        this.pendingCompilations.delete(id);

        if (success) {
            callback(shader);
        } else {
            throw new Error(`Shader compilation failed: ${error}`);
        }
    }

    terminate(): void {
        this.worker.terminate();
        this.pendingCompilations.clear();
    }
}
