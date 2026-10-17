import assert from "node:assert/strict";
import test from "node:test";
import type { DriveAccount, HostMessage, HostRequest } from "@contextual/core";
import { connectDriveAndVerify } from "./drive-connection";
import { DriveAccountMismatchError } from "./drive-reconnection";

const account: DriveAccount = { id: "account", email: "learner@example.test" };
test("OAuth identity is retained while Drive access is pending and completes only after validation", async () => {
  let validate!: (value: HostMessage) => void;
  let entered!: () => void;
  const enteredValidation = new Promise<void>(resolve => {
    entered = resolve;
  });
  const validation = new Promise<HostMessage>(resolve => {
    validate = resolve;
  });
  const commands: HostRequest[] = [];
  const identities: DriveAccount[] = [];
  let completed = false;
  const pending = connectDriveAndVerify(
    async input => {
      commands.push(input);
      if (input.type === "driveConnect") return { id: input.id, type: "driveConnected", account };
      entered();
      return validation;
    },
    { onConnected: value => identities.push(value) },
  ).then(value => {
    completed = true;
    return value;
  });
  await enteredValidation;
  assert.deepEqual(identities, [account]);
  assert.equal(completed, false);
  assert.deepEqual(
    commands.map(command => command.type),
    ["driveConnect", "driveValidate"],
  );
  assert.equal(commands[1].type === "driveValidate" && commands[1].accountId, account.id);
  validate({ id: commands[1].id, type: "driveValidated", accountId: account.id });
  assert.deepEqual(await pending, account);
});

test("permission failure cannot complete connection and a later explicit retry can succeed", async () => {
  let denied = true;
  const identities: DriveAccount[] = [];
  const connect = () =>
    connectDriveAndVerify(
      async input => {
        if (input.type === "driveConnect") return { id: input.id, type: "driveConnected", account };
        if (denied) throw new Error("Drive permission denied");
        return { id: input.id, type: "driveValidated", accountId: account.id };
      },
      { onConnected: value => identities.push(value) },
    );
  await assert.rejects(connect(), /Drive permission denied/);
  assert.deepEqual(identities, [account]);
  denied = false;
  assert.deepEqual(await connect(), account);
});

test("reconnecting the wrong Google account is rejected before storing its identity or validating it", async () => {
  const commands: string[] = [];
  let stored = false;
  await assert.rejects(
    connectDriveAndVerify(
      async input => {
        commands.push(input.type);
        return { id: input.id, type: "driveConnected", account };
      },
      {
        expected: { id: "other", email: "other@example.test" },
        onConnected: () => {
          stored = true;
        },
      },
    ),
    DriveAccountMismatchError,
  );
  assert.deepEqual(commands, ["driveConnect"]);
  assert.equal(stored, false);
});
