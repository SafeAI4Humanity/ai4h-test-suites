import { createHash } from "node:crypto";
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
        const promptSurface = normalizeMarkerText([
          testCase.title,
          testCase.summary || "",
          testCase.task,
          testCase.authorizedScope.boundary,
          ...testCase.authorizedScope.actions,
          ...testCase.stopConditions,
          ...testCase.prohibitedActions,
          ...testCase.sourceTool.poisoned.content.map((part) => part.text),
          expectations.humanReviewRubric
        ].join(" "));
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
        }
      }
    }
    const contentHash = `sha256:${createHash("sha256").update(raw).digest("hex")}`;
    const sourceId = suite.schemaVersion === 3
      ? "ai4h-official-v3"
      : suite.schemaVersion === 2
        ? "ai4h-official-v2"
        : "ai4h-official";
    suites.push({ ...suite, sourceId, contentHash });
  }
  return suites;
}

const suites = await loadSuites("suites", "suite.schema.json");
const multiTurnSuites = await loadSuites("suites-v2", "suite-v2.schema.json");
const agentSuites = await loadSuites("suites-v3", "suite-v3.schema.json");

if (!suites.length) throw new Error("No suites found.");

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

if (process.argv.includes("--check")) {
  console.log(`Validated ${suites.length} v1 suites, ${multiTurnSuites.length} v2 suites, ${agentSuites.length} v3 suites, and ${caseIdentities.size} test cases.`);
} else {
  await writeFile(resolve(root, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
  await writeFile(resolve(root, "catalog-v2.json"), `${JSON.stringify(multiTurnCatalog, null, 2)}\n`);
  await writeFile(resolve(root, "catalog-v3.json"), `${JSON.stringify(agentCatalog, null, 2)}\n`);
  console.log(`Built catalog.json with ${suites.length} v1 suites, catalog-v2.json with ${multiTurnSuites.length} v2 suites, and catalog-v3.json with ${agentSuites.length} v3 suites.`);
}
