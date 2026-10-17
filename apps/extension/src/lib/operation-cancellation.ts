/** Existing Hosts return these explicit cancellation outcomes as error messages.
 * Match them only in their own operation; genuine failures must stay visible. */
export function wasOperationCancelled(cause: unknown, operation: "folder" | "google"): boolean {
  const expected =
    operation === "folder" ? "Folder selection cancelled." : "Google authorization was declined";
  return cause instanceof Error && cause.message === expected;
}
