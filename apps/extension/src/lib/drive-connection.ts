import type { DriveAccount, HostMessage, HostRequest } from "@contextual/core";
import { DriveAccountMismatchError } from "./drive-reconnection";

type ConnectionRequest = Extract<HostRequest, { type: "driveConnect" | "driveValidate" }>;

/** Remember OAuth identity immediately, but complete only after Drive access is verified. */
export async function connectDriveAndVerify(
  request: (input: ConnectionRequest) => Promise<HostMessage>,
  {
    expected,
    onConnected,
  }: {
    expected?: { id: string; email?: string };
    onConnected: (account: DriveAccount) => void;
  },
): Promise<DriveAccount> {
  const response = await request({ id: crypto.randomUUID(), type: "driveConnect" });
  if (response.type !== "driveConnected") throw new Error("Unexpected Google account response");
  const account = response.account;
  if (expected && expected.id !== account.id)
    throw new DriveAccountMismatchError(expected, account);
  onConnected(account);
  const verified = await request({
    id: crypto.randomUUID(),
    type: "driveValidate",
    accountId: account.id,
  });
  if (verified.type !== "driveValidated")
    throw new Error("Google Drive access could not be verified.");
  return account;
}
