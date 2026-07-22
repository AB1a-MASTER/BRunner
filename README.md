# BRunner

BRunner is a local browser-automation project for **Windows and
Chrome/Chromium**. The browser extension owns page mapping, workflow authoring,
and browser execution. The Windows companion supplies local workflow storage,
approved-folder access, and opt-in visible operating-system fallback.

The project is still under development. Generated packages and the provisional
node implementations are not release contracts.

## Confirmed product boundary

- Local Windows companion only.
- Chrome/Chromium extension only.
- Local, single-user operation.
- The mapper engine is a primary reliability foundation. It discovers and
  tracks actionable/semantic page elements and the context needed to resolve
  them reliably.
- The polished saved-map explorer/Mapper Inspector is deferred to V2. A minimal
  developer diagnostic view may remain during mapper development.
- Workflow, map, log, clipboard, and Code Node content is ordinary local user
  data. BRunner does not provide redaction, credential storage, secret masking,
  or protection from a malicious local user or process.
- Companion pairing is a cooperative one-profile lock, not authentication. One
  generated non-secret profile instance ID may be paired at a time.
- Code Node is intentionally unrestricted.
- The finalized node catalog in
  [`workflow_nodes_implementation_blueprint.md`](workflow_nodes_implementation_blueprint.md)
  is the sole node contract. Existing node implementations are development
  scaffolding and have no compatibility or preservation guarantee.

## Current phase order

1. Preserve the accepted mapper, extension, companion, storage, Studio-shell,
   and MV3 foundations.
2. Close the node base-contract and Studio-unification gate: one versioned node
   model, one workflow schema, shared validation/runtime behavior, and two
   editor presentations.
3. Implement every node in finalized catalog order, one at a time, with a
   node-specific acceptance workflow, automated and live evidence, end-user
   documentation, tracker update, and user-controlled Git commit.
4. Complete integrated source acceptance, then build release packages only
   after the product acceptance gates pass and the user starts release work.

Do not spend time repairing a provisional node merely to preserve its current
behavior. Fix it early only when it blocks testing of a shared foundation.

## Documentation authority

When documents disagree, use this order:

1. This README for confirmed product boundaries and phase rules.
2. [`docs/BRUNNER_MASTER_ROADMAP.md`](docs/BRUNNER_MASTER_ROADMAP.md) for the
   current sequence and milestone gates.
3. [`AGENTS.md`](AGENTS.md) for persistent implementation and evidence rules.
4. [`workflow_nodes_implementation_blueprint.md`](workflow_nodes_implementation_blueprint.md)
   for the finalized node catalog and contract.
5. [`docs/NODE_IMPLEMENTATION_STATUS.md`](docs/NODE_IMPLEMENTATION_STATUS.md)
   for the living node-program TODO, status, evidence, and commit ledger.
6. [`docs/FOUNDATION_TODO_STATUS.md`](docs/FOUNDATION_TODO_STATUS.md),
   [`docs/COMPANION_TODO_STATUS.md`](docs/COMPANION_TODO_STATUS.md), and
   [`docs/MAPPER_TODO_STATUS.md`](docs/MAPPER_TODO_STATUS.md) as accepted
   foundation records.
7. [`latest handoff document.txt`](latest%20handoff%20document.txt) for the last
   completed work and immediate next slice.
8. `docs/specs/07_*` through `docs/specs/11_*` for companion and mapper
   behavioral contracts, subject to the scope above.
9. [`docs/BRUNNER_USER_GUIDE.md`](docs/BRUNNER_USER_GUIDE.md) and
   [`docs/NODE_USER_CATALOG.md`](docs/NODE_USER_CATALOG.md) for currently
   supported end-user behavior.

`Design Doc.txt`, the two root transition plans, the companion DOCX, and Specs
01-06 describe design history or provisional development. They are useful
context but cannot override the sources above.

## Repository layout

- `BRunner/` — Chrome/Chromium MV3 extension.
- `BRunner/studio-graph-src/` — Graph Studio React/Vite source.
- `BRunner/studio-graph/` — built Graph Studio assets loaded by the extension.
- `BRunner_Host/` — Windows companion source.
- `BRunner_Host/Workflows/node_acceptance/` — focused acceptance workflow for
  each finalized node.
- `docs/` — roadmap, current status, specifications, and acceptance material.
- `tests/` — JavaScript and Python tests.

## Development commands

Install JavaScript dependencies and build Graph Studio:

```powershell
npm install
npm run studio:build
```

Run the JavaScript tests:

```powershell
node --test tests\*.mjs
```

Install and run the Windows companion from source:

```powershell
python -m pip install -r BRunner_Host\requirements.txt
python BRunner_Host\app.py
```

Run the Python tests:

```powershell
python -m unittest discover -s tests -p "test_*.py"
```

Load `BRunner/` as an unpacked extension in Chrome/Chromium for live testing.

## Generated artifacts

`release/`, `BRunner_Host/build/`, and `BRunner_Host/dist/` are disposable
generated output. They are not evidence of a supported release and should not
be committed. Release packaging is deferred until the actual release phase.
