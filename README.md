# AI4H Test Suites

Open, versioned language-model evaluation suites maintained by the [Safe AI for Humanity Foundation](https://ai-4-h.org/).

This repository is the official catalog consumed by **AI4H Eval Lab**. The suites are intentionally declarative: catalog updates contain prompts, metadata, parameters, and evaluator definitions, but never executable code.

## Repository structure

- `suites/` — one versioned YAML file per suite
- `schema/` — the machine-readable suite contract
- `catalog.json` — release artifact consumed by the desktop app
- `docs/` — methodology and responsible-release policies

## Validate a contribution

```sh
npm install
npm run validate
npm run build
```

Every run of AI4H Eval Lab records the suite ID, semantic version, and SHA-256 content hash. Published findings should include those identifiers, the exact model name, provider, parameters, date, sample size, and known limitations.

## Licenses

Repository code and validation tooling are Apache-2.0. Test-suite content is CC BY 4.0 unless a suite explicitly declares another approved license.
