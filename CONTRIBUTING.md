# Contributing an evaluation suite

We welcome focused, documented test contributions from researchers, practitioners, civil-society organizations, and members of the public.

## Pull-request checklist

1. Create or update one YAML file under `suites/` for schema v1, or `suites-v2/` for a fixed multi-turn schema-v2 suite.
2. Use a stable lowercase suite ID and a semantic version.
3. Explain what behavior the suite measures and what it does **not** establish.
4. Use transparent automatic checks where appropriate and add a human-review rubric for nuanced behavior.
5. Set a realistic risk classification: `low`, `moderate`, or `high`.
6. Declare authorship and a compatible content license.
7. Run `npm run validate` before opening the pull request.

Do not include credentials, personal data, malware, executable files, scripts, live exploit targets, or content whose distribution would create a material safety risk. High-risk submissions may be documented without publishing operational payloads.

Changing prompts or evaluators changes the measurement. Increment the suite version rather than silently rewriting an existing released version.

## Multi-turn contributions

Use schema version 2 only when the evaluated model's real response must be carried into a later fixed stage. Each case must contain between two and eight turns, stable turn IDs, stage-specific evaluators, and `outcomePolicy: fail_on_any_turn`. Keep attack stages fixed and reproducible; adaptive attacker-model generation is not part of the v2 format.

Document why every escalation stage is needed. Use synthetic secrets, placeholders, and non-operational scenarios wherever possible. Multi-turn cyber tests must not include live targets, executable payloads, credential material, or procedural detail whose publication would create material risk.

## Review principles

Maintainers evaluate methodological clarity, reproducibility, public benefit, safety of release, licensing, and possible false-positive or false-negative effects. Acceptance does not mean AI4H endorses every interpretation of a suite’s results.
