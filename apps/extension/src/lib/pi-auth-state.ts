import type { PiEvent, PiPrompt } from "@contextual/core";

type Base = { id: string | null; provider: string; status: string };
export type PiAuthState =
  | (Base & { kind: "idle" })
  | (Base & {
      kind: "login";
      id: string;
      prompt: PiPrompt | null;
      event: PiEvent | null;
      value: string;
    })
  | (Base & { kind: "logout"; id: string });
export const initialPiAuthState: PiAuthState = { kind: "idle", id: null, provider: "", status: "" };
export type PiAuthAction =
  | { type: "start"; kind: "login" | "logout"; id: string; provider: string }
  | { type: "finish"; id: string; status: string }
  | { type: "event"; id: string; event: PiEvent }
  | { type: "prompt"; id: string; prompt: PiPrompt }
  | { type: "promptClosed"; id: string; promptId: string }
  | { type: "value"; id: string; value: string }
  | { type: "reset" };

/** One operation at a time; callbacks may only change the operation they belong to. */
export function piAuthReducer(state: PiAuthState, action: PiAuthAction): PiAuthState {
  if (action.type === "reset") return initialPiAuthState;
  if (action.type === "start") {
    if (state.kind !== "idle") return state;
    const base = { id: action.id, provider: action.provider, status: "" };
    return action.kind === "login"
      ? { ...base, kind: "login", prompt: null, event: null, value: "" }
      : { ...base, kind: "logout" };
  }
  if (action.id !== state.id) return state;
  if (action.type === "finish")
    return { kind: "idle", id: state.id, provider: state.provider, status: action.status };
  if (state.kind !== "login") return state;
  switch (action.type) {
    case "event":
      return { ...state, event: action.event };
    case "prompt":
      return { ...state, prompt: action.prompt, value: action.prompt.options?.[0]?.id ?? "" };
    case "promptClosed":
      return state.prompt?.promptId === action.promptId
        ? { ...state, prompt: null, value: "" }
        : state;
    case "value":
      return { ...state, value: action.value };
  }
}
