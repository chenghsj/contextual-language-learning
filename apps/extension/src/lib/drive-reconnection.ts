import type { DriveAccount } from "@contextual/core";

export class DriveAccountMismatchError extends Error {
  constructor(
    readonly expected: { id: string; email?: string },
    readonly actual: DriveAccount,
  ) {
    super("The connected Google account does not match the account that needs reconnection.");
    this.name = "DriveAccountMismatchError";
  }
}
