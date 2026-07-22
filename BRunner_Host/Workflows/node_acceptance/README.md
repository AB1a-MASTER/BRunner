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

These workflows are source acceptance assets, not release-package evidence.
