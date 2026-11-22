import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allowedPhysicsImports, REQUIRED_PHYSICS_EXPORTS } from "../loader";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("wasm import policy", () => {
    it("accepts a module with no imports", () => {
        expect(() => allowedPhysicsImports([])).not.toThrow();
    });

    it("accepts exactly one env.now function import", () => {
        expect(() => allowedPhysicsImports([
            { type: "function", module: "env", name: "now" }
        ])).not.toThrow();
    });

    it("rejects any other import", () => {
        expect(() => allowedPhysicsImports([
            { type: "function", module: "env", name: "clock" }
        ])).toThrow(/only env.now is allowed/);
        expect(() => allowedPhysicsImports([
            { type: "function", module: "env", name: "now" },
            { type: "function", module: "env", name: "extra" }
        ])).toThrow(/only env.now is allowed/);
        expect(() => allowedPhysicsImports([
            { type: "memory", module: "env", name: "now" }
        ])).toThrow(/only env.now is allowed/);
    });

    it("applies the same rule in the tooling loader", () => {
        const tooling = readFileSync(path.join(packageRoot, "scripts", "scene.mjs"), "utf8");
        expect(tooling).toContain("allowedPhysicsImports");
        expect(tooling).toContain('from "./import-policy.mjs"');
    });

    it("gives both loaders one required-export list", async () => {
        const policy = await import("../../scripts/import-policy.mjs");
        const tooling = await import("../../scripts/scene.mjs");
        expect(tooling.REQUIRED_PHYSICS_EXPORTS).toBe(policy.REQUIRED_PHYSICS_EXPORTS);
        expect(REQUIRED_PHYSICS_EXPORTS).toBe(policy.REQUIRED_PHYSICS_EXPORTS);
        expect([...REQUIRED_PHYSICS_EXPORTS]).toEqual([...tooling.REQUIRED_PHYSICS_EXPORTS]);
    });

    it("keeps one seconds unit on both measurement clocks", async () => {
        const policy = await import("../../scripts/import-policy.mjs");
        const tooling = await import("../../scripts/scene.mjs");
        const nowImport = [{ type: "function", module: "env", name: "now" }] as const;
        expect(policy.PHYSICS_NOW_UNIT).toBe("seconds");
        expect(policy.MILLISECONDS_PER_SECOND).toBe(1000);
        expect(policy.NANOSECONDS_PER_SECOND).toBe(1000000000);

        const tick = async (clock: () => number): Promise<number> => {
            const before = clock();
            await new Promise((resolve) => setTimeout(resolve, 60));
            return clock() - before;
        };

        const shippedDelta = await tick(allowedPhysicsImports(nowImport).env.now);
        const toolingDelta = await tick(tooling.allowedPhysicsImports(nowImport, "test").env.now);
        for (const delta of [shippedDelta, toolingDelta]) {
            expect(delta).toBeGreaterThan(0.02);
            expect(delta).toBeLessThan(0.6);
        }
    });

    it("hands both loaders the same import-object shape", async () => {
        const tooling = await import("../../scripts/scene.mjs");
        const shape = (value: Record<string, unknown>): string => JSON.stringify(
            Object.entries(value).map(([module, functions]) => [
                module,
                Object.entries(functions as Record<string, unknown>).map(([name, fn]) => [name, typeof fn])
            ])
        );

        for (const entry of [[], [{ type: "function", module: "env", name: "now" }]] as const) {
            expect(shape(allowedPhysicsImports(entry))).toBe(shape(tooling.allowedPhysicsImports(entry, "test")));
        }
        expect(shape(allowedPhysicsImports([]))).toBe('[["env",[["now","function"]]]]');
    });

    it("keeps timer exports out of the required list of both loaders", async () => {
        const tooling = await import("../../scripts/scene.mjs");
        expect(REQUIRED_PHYSICS_EXPORTS).not.toContain("phaseTimersView");
        expect(tooling.REQUIRED_PHYSICS_EXPORTS).not.toContain("phaseTimersView");
    });

    it("accepts and rejects identically in both loaders", async () => {
        const tooling = await import("../../scripts/scene.mjs");
        const cases: readonly (readonly { type: string; module: string; name: string }[])[] = [
            [],
            [{ type: "function", module: "env", name: "now" }],
            [{ type: "function", module: "env", name: "clock" }],
            [{ type: "memory", module: "env", name: "now" }],
            [{ type: "global", module: "env", name: "now" }],
            [{ type: "function", module: "other", name: "now" }],
            [{ type: "function", module: "env", name: "now" }, { type: "function", module: "env", name: "extra" }]
        ];

        const mismatches: string[] = [];
        for (const entry of cases) {
            const label = entry.map((item) => `${item.type} ${item.module}.${item.name}`).join("+") || "none";
            const shipped = (() => {
                try {
                    allowedPhysicsImports(entry);
                    return "accepted";
                } catch {
                    return "rejected";
                }
            })();
            const mirrored = (() => {
                try {
                    tooling.allowedPhysicsImports(entry, "test");
                    return "accepted";
                } catch {
                    return "rejected";
                }
            })();
            if (shipped !== mirrored) {
                mismatches.push(`${label}: loader=${shipped} tooling=${mirrored}`);
            }
        }
        expect(mismatches).toEqual([]);
    });
});
