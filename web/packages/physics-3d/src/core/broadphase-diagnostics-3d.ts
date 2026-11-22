export interface IBroadphaseDiagnostics3D {
    enabled: boolean;
    steps: number;
    shapesVisited: number;
    enabledShapes: number;
    proxiesCreated: number;
    proxiesReinserted: number;
    proxiesContained: number;
    upkeepMs: number;
    pairQueryMs: number;
    pairQueryNodeVisits: number;
    pairQueryTestedBoxes: number;
    leafPairsReported: number;
    filteredOut: number;
    candidates: number;
}

export const broadphaseDiagnostics: IBroadphaseDiagnostics3D = {
    enabled: false,
    steps: 0,
    shapesVisited: 0,
    enabledShapes: 0,
    proxiesCreated: 0,
    proxiesReinserted: 0,
    proxiesContained: 0,
    upkeepMs: 0,
    pairQueryMs: 0,
    pairQueryNodeVisits: 0,
    pairQueryTestedBoxes: 0,
    leafPairsReported: 0,
    filteredOut: 0,
    candidates: 0,
};

export function resetBroadphaseDiagnostics(): void {
    broadphaseDiagnostics.steps = 0;
    broadphaseDiagnostics.shapesVisited = 0;
    broadphaseDiagnostics.enabledShapes = 0;
    broadphaseDiagnostics.proxiesCreated = 0;
    broadphaseDiagnostics.proxiesReinserted = 0;
    broadphaseDiagnostics.proxiesContained = 0;
    broadphaseDiagnostics.upkeepMs = 0;
    broadphaseDiagnostics.pairQueryMs = 0;
    broadphaseDiagnostics.pairQueryNodeVisits = 0;
    broadphaseDiagnostics.pairQueryTestedBoxes = 0;
    broadphaseDiagnostics.leafPairsReported = 0;
    broadphaseDiagnostics.filteredOut = 0;
    broadphaseDiagnostics.candidates = 0;
}

export function setBroadphaseDiagnosticsEnabled(enabled: boolean): void {
    broadphaseDiagnostics.enabled = enabled;
    if (enabled) resetBroadphaseDiagnostics();
}
