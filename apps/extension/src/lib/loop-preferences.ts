export type RepeatOption = "2" | "3" | "5" | "infinite";
export type LoopPreferences = {
  repeat: RepeatOption;
  delay: number;
  sceneRepeat: RepeatOption;
  sceneDelay: number;
};
