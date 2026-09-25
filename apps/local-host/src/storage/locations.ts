import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

export interface StorageLocation { id: string; kind: "local" | "google-drive-desktop"; label: string; path: string; account?: string }

export async function listStorageLocations(): Promise<StorageLocation[]> {
  const home = homedir();
  const locations: StorageLocation[] = [{
    id: "default", kind: "local", label: "Documents / Immersive Learning",
    path: join(home, "Documents", "Immersive Learning"),
  }];
  const cloud = join(home, "Library", "CloudStorage");
  try {
    for (const name of await readdir(cloud)) {
      if (!name.startsWith("GoogleDrive-")) continue;
      locations.push({
        id: "gdrive:" + name, kind: "google-drive-desktop",
        label: "Google Drive · " + name.slice("GoogleDrive-".length),
        path: join(cloud, name, "My Drive", "Immersive Learning"),
        account: name.slice("GoogleDrive-".length),
      });
    }
  } catch {}
  return locations;
}

export function validateUserStoragePath(input: string): string {
  const home = resolve(homedir());
  const target = resolve(input);
  if (target !== home && !target.startsWith(home + sep)) throw new Error("Storage folder must be inside your home directory");
  return target;
}
