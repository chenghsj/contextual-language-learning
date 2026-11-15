import { readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const Budget = z
  .object({
    authorizedModelTasks: z.number().int().positive(),
    reservations: z.array(z.object({ step: z.string(), at: z.string() })),
  })
  .strict();
let writes = Promise.resolve();
/** Reserve before inference (including explicit safe retries), serializing concurrent scene workers. */
export function reserveValidationTask(path: string, step: string): Promise<void> {
  const task = writes.then(async () => {
    const budget = Budget.parse(JSON.parse(await readFile(path, "utf8")));
    if (budget.reservations.length >= budget.authorizedModelTasks)
      throw new Error("Authorized validation model-task budget exhausted; no new request sent");
    budget.reservations.push({ step, at: new Date().toISOString() });
    const temporary = path + "." + randomUUID() + ".tmp";
    await writeFile(temporary, JSON.stringify(budget, null, 2), { flag: "wx" });
    await rename(temporary, path);
  });
  writes = task.catch(() => undefined);
  return task;
}
