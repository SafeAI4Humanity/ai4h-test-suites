import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "..");
const schema = JSON.parse(await readFile(resolve(root, "schema/suite.schema.json"), "utf8"));
const suiteFiles = (await readdir(resolve(root, "suites"))).filter((file) => file.endsWith(".yaml")).sort();
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);
const suites = [];
const identities = new Set();
const caseIdentities = new Set();

for (const file of suiteFiles) {
  const raw = await readFile(resolve(root, "suites", file), "utf8");
  const suite = parse(raw);
  if (!validate(suite)) {
    const details = validate.errors.map((error) => `${error.instancePath || "/"} ${error.message}`).join("\n  ");
    throw new Error(`${file} failed schema validation:\n  ${details}`);
  }
  const identity = `${suite.id}@${suite.version}`;
  if (identities.has(identity)) throw new Error(`Duplicate suite identity: ${identity}`);
  identities.add(identity);
  for (const testCase of suite.cases) {
    const caseIdentity = `${identity}/${testCase.id}`;
    if (caseIdentities.has(caseIdentity)) throw new Error(`Duplicate case identity: ${caseIdentity}`);
    caseIdentities.add(caseIdentity);
  }
  const contentHash = `sha256:${createHash("sha256").update(raw).digest("hex")}`;
  suites.push({ ...suite, sourceId: "ai4h-official", contentHash });
}

if (!suites.length) throw new Error("No suites found.");

const catalog = {
  schemaVersion: 1,
  catalogVersion: process.env.GITHUB_REF_NAME || "development",
  publishedAt: new Date().toISOString(),
  suites
};
const output = `${JSON.stringify(catalog, null, 2)}\n`;

if (process.argv.includes("--check")) {
  console.log(`Validated ${suites.length} suites and ${caseIdentities.size} test cases.`);
} else {
  await writeFile(resolve(root, "catalog.json"), output);
  console.log(`Built catalog.json with ${suites.length} suites and ${caseIdentities.size} test cases.`);
}
