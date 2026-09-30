export type RepeatOption = "2" | "3" | "5" | "infinite";
export type LoopPreferences = {
  repeat: RepeatOption;
  delay: number;
  sceneRepeat: RepeatOption;
  sceneDelay: number;
};

function readRepeat(value: unknown): RepeatOption | null {
  return value === "2" || value === "3" || value === "5" || value === "infinite" ? value : null;
}

function readDelay(value: unknown): number | null {
  return typeof value === "number" && [0, 1, 2, 3].includes(value) ? value : null;
}

/** Existing cue/legacy settings seed scene settings only once; later values remain independent. */
export function restoreLoopPreferences(saved: Record<string, unknown>): LoopPreferences {
  const repeat = readRepeat(saved.repeat) ?? "3";
  const delay = readDelay(saved.delay) ?? 1;
  return {
    repeat, delay,
    sceneRepeat: readRepeat(saved.sceneRepeat) ?? repeat,
    sceneDelay: readDelay(saved.sceneDelay) ?? delay,
  };
}
