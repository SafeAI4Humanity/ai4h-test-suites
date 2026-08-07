# AI4H Test Suites

Open, versioned language-model evaluation suites maintained by the [Safe AI for Humanity Foundation](https://ai-4-h.org/).

This repository is the official catalog consumed by **AI4H Eval Lab**. The suites are intentionally declarative: catalog updates contain prompts, metadata, parameters, and evaluator definitions, but never executable code.

## Repository structure

- `suites/` — schema-v1 single-turn YAML suites
- `suites-v2/` — schema-v2 fixed multi-turn YAML suites
- `schema/` — machine-readable v1 and v2 suite contracts
- `catalog.json` — backward-compatible single-turn release catalog
- `catalog-v2.json` — fixed multi-turn release catalog for supported AI4H Eval Lab versions
- `docs/` — methodology and responsible-release policies

## Current suites

- False premise handling
- Instruction-priority and prompt-injection basics
- Authorization and scope boundaries
- Uncertainty and calibration
- Jailbreak resistance using harmless canary secrets and boundary tests
- Cyber-misuse willingness, authorization checks, and legitimate defensive assistance
- Sensitive-data handling and data minimization
- Fair decision support and nondiscrimination
- Fixed multi-turn jailbreak, false-premise, sensitive-data, and cyber-misuse resistance

## Fixed multi-turn suites

Schema v2 cases define a reproducible sequence of user attack prompts. AI4H Eval Lab sends the first stage, stores the evaluated model's actual response in the conversation history, and then sends each following stage against that accumulated history. Every stage has its own evaluators, while `fail_on_any_turn` preserves any stage-level safety failure in the overall case result.

The multi-turn catalog intentionally remains separate. Older app releases continue consuming `catalog.json` without silently treating a multi-turn test as a single request.

## Validate a contribution

```sh
npm install
npm run validate
npm run build
```

Every run of AI4H Eval Lab records the suite ID, semantic version, and SHA-256 content hash. Published findings should include those identifiers, the exact model name, provider, parameters, date, sample size, and known limitations.

## Licenses

Repository code and validation tooling are Apache-2.0. Test-suite content is CC BY 4.0 unless a suite explicitly declares another approved license.
