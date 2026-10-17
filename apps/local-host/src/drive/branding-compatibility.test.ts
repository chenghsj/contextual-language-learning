import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDriveFile, isLearningDriveFile, propertyMatch } from "./api";

test("custom metadata normalization leaves retired standard backups hidden with current metadata taking precedence", () => {
  const legacy = {
    appProperties: {
      immersiveSchemaVersion: "5",
      immersiveTitle: "Saved lesson",
      immersiveFormat: "json",
    },
  };
  assert.equal(isLearningDriveFile(legacy), false);
  assert.deepEqual(normalizeDriveFile(legacy).appProperties, {
    contextualSchemaVersion: "5",
    contextualTitle: "Saved lesson",
    contextualFormat: "json",
  });
  assert.equal(legacy.appProperties.immersiveTitle, "Saved lesson");
  assert.equal(isLearningDriveFile({ appProperties: { immersiveSchemaVersion: "4" } }), false);
  assert.equal(
    normalizeDriveFile({ appProperties: { immersiveTitle: "Old", contextualTitle: "New" } })
      .appProperties?.contextualTitle,
    "New",
  );
  const query = propertyMatch("contextualSchemaVersion", "custom-v1");
  assert.match(query, /key='contextualSchemaVersion'/);
  assert.match(query, /key='immersiveSchemaVersion'/);
  assert.match(query, /^\(.* or .*\)$/);
  assert.throws(() => propertyMatch("contextualTitle", "' or trashed=true"), /Invalid/);
});
