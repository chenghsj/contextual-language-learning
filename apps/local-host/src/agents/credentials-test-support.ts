import { createSecureCredentialStore } from "./credentials";
import { createPiRuntime } from "./pi";

/** Tests inject storage explicitly; production never selects a memory fallback. */
export function createTestPiRuntime(root: string) {
  let value: string | undefined;
  return createPiRuntime(
    root,
    createSecureCredentialStore(root, {
      vault: {
        read: async () => value,
        write: async next => {
          value = next;
        },
      },
    }),
  );
}
