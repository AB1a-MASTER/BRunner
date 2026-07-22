# Finalized Node Acceptance Workflows

Add exactly one focused source-checkout workflow for every finalized node:

```text
NNN_<node-slug>_acceptance.json
```

Examples:

```text
001_navigate_acceptance.json
002_scroll_acceptance.json
003_tab_control_acceptance.json
```

Each workflow must:

- use the finalized `(type, version)` contract;
- use synthetic, disposable data and repository-hosted fixtures;
- demonstrate the node's primary success behavior and observable output;
- cover an important safe failure/alternate route when practical;
- run from the unpacked extension and source companion where applicable;
- receive deterministic schema/source coverage in `tests/`; and
- be recorded in `docs/NODE_IMPLEMENTATION_STATUS.md` before the node is marked
  complete.

Each workflow is canonical graph JSON and must also include:

```json
{
  "acceptance": {
    "schemaVersion": 1,
    "catalogOrder": 1,
    "nodeType": "browser.navigate",
    "nodeVersion": 2,
    "synthetic": true,
    "primaryBehavior": "Navigate to the repository acceptance fixture.",
    "expectedOutputKeys": ["url", "title"],
    "safeFailureOrAlternate": "Reject an invalid or disallowed URL safely.",
    "fixturePaths": ["tests/fixtures/native-acceptance.html"]
  }
}
```

`fixturePaths` must contain only repository-relative paths and may be empty
when the workflow does not require a fixture. The automated test suite scans
every `*_acceptance.json` file, validates its canonical workflow structure,
and binds its filename, catalog number, type, and version to
`BRunner/nodes/catalog.js`.

These workflows are source acceptance assets, not release-package evidence.
