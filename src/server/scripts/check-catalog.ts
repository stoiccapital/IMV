import path from "node:path";
import { readAndAnalyzeCatalog } from "../services/catalog-import.ts";

const fileArgIndex = process.argv.indexOf("--file");
const file = fileArgIndex >= 0 ? process.argv[fileArgIndex + 1] : process.env.CATALOG_BOOTSTRAP_FILE;
if (!file) throw new Error("Usage: pnpm qa:catalog -- --file <private.csv>");
const { analysis } = await readAndAnalyzeCatalog(path.resolve(file));
const controls = {
  recordCount: { expected: 6719, actual: analysis.recordCount, passed: analysis.recordCount === 6719 },
  kgkCodeCount: { expected: 1055, actual: analysis.kgkCodeCount, passed: analysis.kgkCodeCount === 1055 },
  reviewNoteCount: { expected: 1591, actual: analysis.reviewNoteCount, passed: analysis.reviewNoteCount === 1591 },
  sourceIdsUnique: { expected: true, actual: analysis.duplicateDatasetIds.length === 0, passed: analysis.duplicateDatasetIds.length === 0 },
};
console.log(JSON.stringify({ controls, analysis }, null, 2));
if (Object.values(controls).some((control) => !control.passed)) process.exitCode = 1;
