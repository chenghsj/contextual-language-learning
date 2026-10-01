export const VIDEO_COMMAND_ERROR_CODES = [
  "TRACK_UNAVAILABLE",
  "CAPTION_EMPTY",
  "CAPTION_TIMEOUT",
  "CAPTION_FAILED",
  "VIDEO_CHANGED",
  "CAPTION_TOO_LARGE",
  "READER_UNAVAILABLE",
] as const;
export type VideoCommandErrorCode = (typeof VIDEO_COMMAND_ERROR_CODES)[number];

export function isVideoCommandErrorCode(value: unknown): value is VideoCommandErrorCode {
  return typeof value === "string" && VIDEO_COMMAND_ERROR_CODES.some(code => code === value);
}

/** Machine-readable failure; diagnostic text is separate from localized UI copy. */
export class CaptionRetrievalError extends Error {
  constructor(
    message: string,
    readonly code: VideoCommandErrorCode,
  ) {
    super(message);
    this.name = "CaptionRetrievalError";
  }
}
