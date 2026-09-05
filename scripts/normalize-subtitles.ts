/** Offline Japanese terminology correction. No media downloads or API calls. */
import path from "node:path";
import { parseArgs } from "node:util";

import { correctSubtitleFiles } from "./lib/subtitle-normalize";
import { normalizeJapaneseTerms } from "./lib/subtitle-terminology";

async function main() {
  const { values } = parseArgs({ options: {
    apply: { type: "boolean", default: false },
    output: { type: "string", default: "subtitles" },
    "state-dir": { type: "string", default: ".subtitles" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  } });
  if (values.help) {
    console.log(`Scan local .srt/.vtt cue text for reviewed Japanese terminology corrections.

pnpm exec tsx scripts/normalize-subtitles.ts          Preview counts (default)
pnpm exec tsx scripts/normalize-subtitles.ts --json   Preview the full audit as JSON
pnpm exec tsx scripts/normalize-subtitles.ts --apply  Back up, correct and verify

--output DIR     Subtitle directory (default: subtitles)
--state-dir DIR  Generation checkpoint directory (default: .subtitles)

Runs entirely offline. Cue timing, numbering, markup and formatting are preserved.
Apply creates an audit and originals in .subtitles/terminology-backups/ and updates
known generation output hashes. Stop generation before running; the shared job
lock prevents concurrent access. Unknown edits to tracked outputs are refused.`);
    return;
  }
  const result = await correctSubtitleFiles({
    outputDirectory: path.resolve(values.output), stateDirectory: path.resolve(values["state-dir"]),
    apply: values.apply, normalize: normalizeJapaneseTerms,
  });
  if (values.json) console.log(JSON.stringify(result, null, 2));
  else {
    const { report } = result;
    console.log(`${values.apply ? "Corrected" : "Dry run:"} ${report.replacementCount} terms in ${report.filesChanged} of ${report.filesScanned} subtitle files.`);
    for (const [term, count] of Object.entries(report.terms).sort((a, b) => b[1] - a[1])) console.log(`  ${term}: ${count}`);
    if (result.reportFile) console.log(`Audit: ${result.reportFile}`);
    if (result.backupDirectory) console.log(`Originals: ${result.backupDirectory}`);
    if (!values.apply) console.log("No subtitles or checkpoints changed. Use --apply to make these corrections.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
