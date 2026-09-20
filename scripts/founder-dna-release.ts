// Operator entry point: explicit connection, private files, separate stage/activation.
import { readFile, writeFile, stat } from "node:fs/promises";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { postgresDatabase, type Database } from "../lib/enrichment/db";
import { DnaPublicationStore } from "../lib/enrichment/dna-store";
import { readFounderDnaReleaseProfile } from "../lib/founder-dna-data";
import {
  dryRunDnaBundle,
  exportDnaBundle,
  MAX_DNA_BUNDLE_BYTES,
  parseDnaBundle,
  stageDnaBundle,
} from "../lib/enrichment/dna-bundle";

type Dependencies = {
  connect?: (url: string) => Database & { close(): Promise<void> };
};
export async function main(
  args = process.argv.slice(2),
  dependencies: Dependencies = {},
) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      "database-url": { type: "string" },
      file: { type: "string" },
      release: { type: "string" },
      handle: { type: "string" },
      "confirm-write": { type: "boolean", default: false },
    },
  });
  const command = positionals[0];
  if (
    positionals.length !== 1 ||
    ![
      "export",
      "dry-run",
      "stage",
      "validate",
      "preview",
      "activate",
      "rollback",
    ].includes(command)
  )
    throw new Error(
      "Usage: founder-dna-release <export|dry-run|stage|validate|preview|activate|rollback> --database-url <explicit URL> [--file private.json] [--release ID] [--handle HANDLE] [--confirm-write]",
    );
  if (!values["database-url"])
    throw new Error(
      "Explicit --database-url required; environment files are never loaded",
    );
  if (
    ["stage", "validate", "activate", "rollback"].includes(command) &&
    !values["confirm-write"]
  )
    throw new Error("Database mutation requires --confirm-write");
  if (["export", "dry-run", "stage"].includes(command) && !values.file)
    throw new Error("--file required");
  if (
    ["export", "validate", "preview", "activate"].includes(command) &&
    !values.release
  )
    throw new Error("--release required");
  if (command === "preview" && !values.handle)
    throw new Error("--handle required");
  let bundle;
  if (["dry-run", "stage"].includes(command)) {
    if ((await stat(values.file!)).size > MAX_DNA_BUNDLE_BYTES)
      throw new Error("bundle_too_large");
    bundle = parseDnaBundle(JSON.parse(await readFile(values.file!, "utf8")));
  }
  const db = (dependencies.connect ?? postgresDatabase)(values["database-url"]),
    dna = new DnaPublicationStore(db);
  try {
    switch (command) {
      case "export": {
        const exported = await exportDnaBundle(db, values.release!);
        await writeFile(values.file!, JSON.stringify(exported), {
          mode: 0o600,
          flag: "wx",
        });
        return {
          command,
          hash: exported.hash,
          profiles: exported.manifest.cohort.length,
          costs: exported.manifest.costs,
        };
      }
      case "dry-run":
        return { command, ...(await dryRunDnaBundle(db, bundle)).summary };
      case "stage":
        return { command, ...(await stageDnaBundle(db, bundle)) };
      case "validate":
        return { command, ...(await dna.validateRelease(values.release!)) };
      case "preview":
        return {
          command,
          release: values.release,
          result: await readFounderDnaReleaseProfile(
            db,
            values.release!,
            values.handle!,
          ),
        };
      case "activate":
        await dna.activateRelease(values.release!);
        return { command, release: values.release };
      case "rollback":
        await dna.rollback();
        return { command, completed: true };
    }
  } finally {
    await db.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => {
      // Connection errors can contain credentials or private rows. Never dump them.
      const safeCode =
        error instanceof Error &&
        /^(bundle_|dna_|portrait_|release_|connection_|no_previous_dna_release)[a-zA-Z0-9_:-]{0,250}$/.test(
          error.message,
        )
          ? error.message
          : "release_command_failed";
      console.error(
        `${safeCode}. Check the explicit command, private bundle, database schema and release eligibility.`,
      );
      process.exitCode = 1;
    });
}
