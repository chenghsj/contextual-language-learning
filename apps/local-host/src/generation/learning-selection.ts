import { z } from "zod";
import { exactIds, uniqueIds, type LearningCandidate } from "@contextual/core";
import { ModelRequestError, type LearningExecution } from "./learning-execution";

const SelectionOutput = z.object({ selectedCandidateIds: z.array(z.string()).max(6) }).strict();
function selection(
  raw: unknown,
  candidates: LearningCandidate[],
  limit: number,
  cues: { id: string }[],
) {
  const ids = SelectionOutput.parse(raw).selectedCandidateIds;
  uniqueIds(ids, "Duplicate selected candidate");
  if (ids.length > limit) throw new Error("Selected scene count exceeds settings");
  const selected = ids.map(
    id =>
      candidates.find(c => c.id === id) ??
      (() => {
        throw new Error("Unknown selected candidate ID");
      })(),
  );
  uniqueIds(
    selected.flatMap(c => c.dialogueCueIds),
    "Overlapping selected dialogue",
  );
  const ordered = [...selected].sort(
    (a, b) =>
      cues.findIndex(c => c.id === a.dialogueCueIds[0]) -
      cues.findIndex(c => c.id === b.dialogueCueIds[0]),
  );
  exactIds(
    ids,
    ordered.map(c => c.id),
    "Selection must follow source order",
  );
  return selected;
}
/** Select source-ordered scenes, reusing persisted shortlist groups on resume. */
export async function selectScenes(execution: LearningExecution): Promise<void> {
  const { update, generate, budget } = execution;
  const { pointsSelectionPrompt, pointsPromptFits } = execution.prompts;
  if (!execution.job.learningPlan.selected) {
    await update(j => ({ ...j, summary: { ...j.summary, phase: "selecting" } }));
    let pool = execution.job.learningPlan.candidateWindows.flatMap(w => w.candidates ?? []);
    const select = async (
      prompt: string,
      id: string,
      candidates: LearningCandidate[],
      limit: number,
    ) => {
      let error: unknown;
      const canRepair = !execution.job.learningPlan.selectionRepairs.includes(id);
      for (let attempt = 0; attempt < (canRepair ? 2 : 1); attempt++) {
        try {
          return selection(
            await generate(
              prompt +
                (attempt
                  ? "\nVALIDATION REPAIR: Return the complete corrected selection. Issue (data): " +
                    JSON.stringify(
                      String(
                        error ??
                          "Previous selection interrupted; revalidate references and ordering",
                      ),
                    )
                  : ""),
              id + (attempt ? "-repair" : ""),
              "selection",
            ),
            candidates,
            limit,
            execution.job.request.cues,
          );
        } catch (e) {
          if (e instanceof ModelRequestError) throw e;
          error = e;
          if (attempt === 1 || !canRepair)
            throw new Error(
              "Selection failed after one repair; checkpoint preserved: " + String(e),
            );
          await update(j => ({
            ...j,
            learningPlan: {
              ...j.learningPlan,
              selectionRepairs: [...j.learningPlan.selectionRepairs, id],
            },
          }));
        }
      }
      throw error;
    };
    if (!pool.length)
      throw new Error("No suitable complete dialogue was found for this proficiency and source");
    let round = 0;
    while (
      !pointsPromptFits(pointsSelectionPrompt(execution.job.request, pool, budget.output), budget)
    ) {
      const groups: LearningCandidate[][] = [];
      for (const candidate of pool) {
        const last = groups.at(-1);
        if (
          last &&
          pointsPromptFits(
            pointsSelectionPrompt(execution.job.request, [...last, candidate], budget.output),
            budget,
          )
        )
          last.push(candidate);
        else {
          if (
            !pointsPromptFits(
              pointsSelectionPrompt(execution.job.request, [candidate], budget.output),
              budget,
            )
          )
            throw new Error(
              "A complete candidate exceeds selection input budget; checkpoint preserved",
            );
          groups.push([candidate]);
        }
      }
      const shortlist: LearningCandidate[] = [];
      for (const [i, group] of groups.entries()) {
        // Restrict each shortlist to ensure every comparison round makes progress.
        const max = Math.min(
          execution.job.request.profile.sceneCount,
          Math.max(1, Math.floor(group.length / 2)),
        );
        const prompt =
          pointsSelectionPrompt(execution.job.request, group, budget.output) +
          `\nThis comparison group may select at most ${max} candidates; retain the strongest useful contributions.`;
        const id = `shortlist-${round}-${i}`;
        const saved = execution.job.learningPlan.selectionGroups.find(g => g.id === id);
        if (saved) {
          exactIds(
            saved.candidateIds,
            group.map(c => c.id),
            "Saved shortlist input changed",
          );
          shortlist.push(
            ...selection(
              { selectedCandidateIds: saved.selectedIds },
              group,
              max,
              execution.job.request.cues,
            ),
          );
        } else {
          const selected = await select(prompt, id, group, max);
          await update(
            j => ({
              ...j,
              learningPlan: {
                ...j.learningPlan,
                selectionGroups: [
                  ...j.learningPlan.selectionGroups,
                  { id, candidateIds: group.map(c => c.id), selectedIds: selected.map(c => c.id) },
                ],
              },
            }),
            true,
          );
          shortlist.push(...selected);
        }
      }
      if (shortlist.length >= pool.length || !shortlist.length)
        throw new Error(
          "Selection cannot reduce candidates within model budget; checkpoint preserved",
        );
      pool = shortlist;
      round++;
    }
    const selected = await select(
      pointsSelectionPrompt(execution.job.request, pool, budget.output),
      "selection",
      pool,
      execution.job.request.profile.sceneCount,
    );
    if (!selected.length)
      throw new Error("No suitable source passages remain; no empty lesson was created");
    await update(
      j => ({
        ...j,
        learningPlan: {
          ...j.learningPlan,
          selected,
          batches: selected.map((s, i) => ({
            id: `s${i}`,
            sceneId: s.id,
            utteranceIds: s.utterances.map(u => u.id),
          })),
        },
      }),
      true,
    );
  }
}
