import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";
import { normalizeMarkerText } from "./marker-text.mjs";

const root = resolve(import.meta.dirname, "..");
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const identities = new Set();
const caseIdentities = new Set();
const buildTime = new Date().toISOString();
const undatedSuites = [];

// A shallow clone grafts history at one commit, so that commit looks like it added
// every file and every suite would silently take the same date. Refuse instead.
function assertFullHistory() {
  let shallow;
  try {
    shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return; // Not a git checkout; the per-file miss is reported below.
  }
  if (shallow === "true") {
    throw new Error(
      "Cannot derive suite releasedAt from a shallow clone: every suite would take the grafted commit's date.\n" +
      "Check out with fetch-depth: 0, or set releasedAt explicitly in each suite file."
    );
  }
}

// The suite version is encoded in the filename, so a new version is always a new
// file and a file is never edited in place to become a different version. The
// commit that added the file is therefore when that version was released, and it
// stays correct when the file is later touched for a typo or a marker fix.
function gitAddedAt(path) {
  try {
    const output = execFileSync("git", ["log", "--diff-filter=A", "--format=%aI", "--", path], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const dates = output.split("\n").map((line) => line.trim()).filter(Boolean);
    return dates.length ? new Date(dates[dates.length - 1]).toISOString() : undefined;
  } catch {
    return undefined;
  }
}

assertFullHistory();

async function loadSuites(directory, schemaFile) {
  const schema = JSON.parse(await readFile(resolve(root, "schema", schemaFile), "utf8"));
  const validate = ajv.compile(schema);
  const suiteFiles = (await readdir(resolve(root, directory))).filter((file) => file.endsWith(".yaml")).sort();
  const suites = [];
  for (const file of suiteFiles) {
    const raw = await readFile(resolve(root, directory, file), "utf8");
    const suite = parse(raw);
    if (!validate(suite)) {
      const details = validate.errors.map((error) => `${error.instancePath || "/"} ${error.message}`).join("\n  ");
      throw new Error(`${directory}/${file} failed schema validation:\n  ${details}`);
    }
    const identity = `${suite.id}@${suite.version}`;
    if (identities.has(identity)) throw new Error(`Duplicate suite identity: ${identity}`);
    identities.add(identity);
    for (const testCase of suite.cases) {
      const caseIdentity = `${identity}/${testCase.id}`;
      if (caseIdentities.has(caseIdentity)) throw new Error(`Duplicate case identity: ${caseIdentity}`);
      caseIdentities.add(caseIdentity);
      if (suite.schemaVersion === 2) {
        const turnIds = new Set();
        for (const turn of testCase.turns) {
          if (turnIds.has(turn.id)) throw new Error(`Duplicate turn identity: ${caseIdentity}/${turn.id}`);
          turnIds.add(turn.id);
        }
      }
      if (suite.schemaVersion === 3) {
        const expectations = testCase.expectations;
        if (!expectations.forbiddenAssistant.length) throw new Error(`Empty forbiddenAssistant: ${caseIdentity}`);
        const poisonedText = normalizeMarkerText(testCase.sourceTool.poisoned.content.map((part) => part.text).join(" "));
        // Everything the model is shown, plus the prose a marker could be lifted from.
        const promptSurface = normalizeMarkerText([
          suite.title,
          suite.summary,
          testCase.title,
          testCase.summary || "",
          testCase.task,
          ...testCase.authorizedScope.targets,
          ...testCase.authorizedScope.actions,
          testCase.authorizedScope.boundary,
          ...testCase.stopConditions,
          ...testCase.prohibitedActions,
          testCase.sourceTool.title,
          testCase.sourceTool.description,
          ...testCase.sourceTool.poisoned.content.map((part) => part.text),
          expectations.humanReviewRubric
        ].join(" "));
        // A refusal names what it declines, so a negative marker lifted from the task or the
        // boundary rejects legitimate refusals. That is the over-rejection mechanism.
        const temptationText = normalizeMarkerText([testCase.task, testCase.authorizedScope.boundary].join(" "));
        const criteria = [...expectations.requiredAssistant.clean, ...expectations.requiredAssistant.poisoned];
        for (const criterion of criteria) {
          for (const marker of criterion.anyOf) {
            const value = normalizeMarkerText(marker);
            if (promptSurface.includes(value)) {
              throw new Error(`Marker echoed by the prompt surface: ${caseIdentity}/${criterion.id} "${marker}"`);
            }
            const tool = expectations.forbiddenToolCalls.find((name) => name.includes(value) || value.includes(name));
            if (tool) throw new Error(`Marker overlaps forbidden tool ${tool}: ${caseIdentity}/${criterion.id} "${marker}"`);
          }
        }
        for (const marker of expectations.forbiddenAssistant) {
          const value = normalizeMarkerText(marker);
          if (poisonedText.includes(value)) {
            throw new Error(`Forbidden marker quotes the poisoned tool output: ${caseIdentity} "${marker}"`);
          }
          if (temptationText.includes(value)) {
            throw new Error(`Forbidden marker quotes the task or boundary: ${caseIdentity} "${marker}"`);
          }
        }
      }
    }
    const contentHash = `sha256:${createHash("sha256").update(raw).digest("hex")}`;
    const sourceId = suite.schemaVersion === 3
      ? "ai4h-official-v3"
      : suite.schemaVersion === 2
        ? "ai4h-official-v2"
        : "ai4h-official";
    const releasedAt = suite.releasedAt ?? gitAddedAt(`${directory}/${file}`);
    if (!releasedAt) undatedSuites.push(`${directory}/${file}`);
    suites.push({ ...suite, sourceId, contentHash, releasedAt: releasedAt ?? buildTime });
  }
  return suites;
}

const suites = await loadSuites("suites", "suite.schema.json");
const multiTurnSuites = await loadSuites("suites-v2", "suite-v2.schema.json");
const agentSuites = await loadSuites("suites-v3", "suite-v3.schema.json");

if (!suites.length) throw new Error("No suites found.");

if (undatedSuites.length) {
  throw new Error(
    `Could not derive releasedAt from git history for ${undatedSuites.length} suite file(s):\n  ${undatedSuites.join("\n  ")}\n` +
    "A shallow clone is the usual cause: check out with fetch-depth: 0, or set releasedAt explicitly in the suite file."
  );
}

const catalog = {
  schemaVersion: 1,
  catalogVersion: process.env.GITHUB_REF_NAME || "development",
  publishedAt: new Date().toISOString(),
  suites
};
const multiTurnCatalog = {
  schemaVersion: 2,
  catalogVersion: process.env.GITHUB_REF_NAME || "development",
  publishedAt: new Date().toISOString(),
  suites: multiTurnSuites
};
const agentCatalog = {
  schemaVersion: 3,
  catalogVersion: process.env.GITHUB_REF_NAME || "development",
  publishedAt: new Date().toISOString(),
  suites: agentSuites
};

// publishedAt is a wall-clock read and catalogVersion is the current git ref, so both
// differ on every build and on every branch. Every other field is derived from the
// suite files and from git history, so a committed catalog that disagrees with a fresh
// build was not rebuilt after the suites changed.
const volatileCatalogFields = ["publishedAt", "catalogVersion"];

function withoutVolatileFields(catalog) {
  const stable = { ...catalog };
  for (const field of volatileCatalogFields) delete stable[field];
  return stable;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The first disagreement is enough to act on, and naming the suite it sits in makes it
// findable: entries in an array of identified objects are reported by id, not by index.
function findDifference(committed, rebuilt, path) {
  if (Array.isArray(committed) && Array.isArray(rebuilt)) {
    if (committed.length !== rebuilt.length) {
      return { path: `${path}.length`, committed: committed.length, rebuilt: rebuilt.length };
    }
    for (let index = 0; index < committed.length; index += 1) {
      const label = rebuilt[index]?.id ?? committed[index]?.id ?? index;
      const difference = findDifference(committed[index], rebuilt[index], `${path}[${label}]`);
      if (difference) return difference;
    }
    return undefined;
  }
  if (isPlainObject(committed) && isPlainObject(rebuilt)) {
    for (const key of new Set([...Object.keys(committed), ...Object.keys(rebuilt)])) {
      const difference = findDifference(committed[key], rebuilt[key], path ? `${path}.${key}` : key);
      if (difference) return difference;
    }
    return undefined;
  }
  if (committed !== rebuilt) return { path: path || "(root)", committed, rebuilt };
  return undefined;
}

function describe(value) {
  return value === undefined ? "(absent)" : JSON.stringify(value);
}

const rebuildInstruction = "Run `npm run build` and commit the result.";

async function assertCommittedMatches(file, rebuilt) {
  let raw;
  try {
    raw = await readFile(resolve(root, file), "utf8");
  } catch {
    throw new Error(`${file} is missing or unreadable. ${rebuildInstruction}`);
  }
  let committed;
  try {
    committed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error.message}\n${rebuildInstruction}`);
  }
  const difference = findDifference(withoutVolatileFields(committed), withoutVolatileFields(rebuilt), "");
  if (difference) {
    throw new Error(
      `${file} does not match what the suite files build:\n` +
      `  ${difference.path}\n` +
      `    committed: ${describe(difference.committed)}\n` +
      `    rebuilt:   ${describe(difference.rebuilt)}\n` +
      `${rebuildInstruction}\n` +
      `(${volatileCatalogFields.join(" and ")} are excluded: they change on every build.)`
    );
  }
}

if (process.argv.includes("--check")) {
  try {
    await assertCommittedMatches("catalog.json", catalog);
    await assertCommittedMatches("catalog-v2.json", multiTurnCatalog);
    await assertCommittedMatches("catalog-v3.json", agentCatalog);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  console.log(`Validated ${suites.length} v1 suites, ${multiTurnSuites.length} v2 suites, ${agentSuites.length} v3 suites, and ${caseIdentities.size} test cases.`);
} else {
  await writeFile(resolve(root, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
  await writeFile(resolve(root, "catalog-v2.json"), `${JSON.stringify(multiTurnCatalog, null, 2)}\n`);
  await writeFile(resolve(root, "catalog-v3.json"), `${JSON.stringify(agentCatalog, null, 2)}\n`);
  console.log(`Built catalog.json with ${suites.length} v1 suites, catalog-v2.json with ${multiTurnSuites.length} v2 suites, and catalog-v3.json with ${agentSuites.length} v3 suites.`);
}
