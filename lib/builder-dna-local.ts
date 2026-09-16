import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseBuilderDnaExamples, type BuilderDnaExample } from "./builder-dna";

export async function getBuilderDnaExample(
  handle: string,
): Promise<BuilderDnaExample | null> {
  const examples = await getBuilderDnaExamples();
  return (
    examples.find(
      (example) => example.handle.toLowerCase() === handle.toLowerCase(),
    ) ?? null
  );
}

/** Server-only, opt-in local snapshot loader. No database, SDK or network calls. */
export async function getBuilderDnaExamples(): Promise<BuilderDnaExample[]> {
  if (process.env.BUILDER_DNA_PREVIEW !== "1") return [];
  try {
    const sourcePath =
      process.env.BUILDER_DNA_SNAPSHOT_FILE ===
      "tests/fixtures/builder-dna.json"
        ? path.join(process.cwd(), "tests", "fixtures", "builder-dna.json")
        : path.join(process.cwd(), ".local", "builder-dna-examples.json");
    // Local research must never be bundled into a deployable server artifact.
    const source = await readFile(
      /* turbopackIgnore: true */ sourcePath,
      "utf8",
    );
    return parseBuilderDnaExamples(JSON.parse(source));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
