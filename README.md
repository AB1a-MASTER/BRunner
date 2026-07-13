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

1. Stabilize the shared foundation: mapper engine, storage, extension/host
   transport, cooperative profile lock, Studio shell, and MV3 lifecycle.
2. Complete deterministic and live acceptance for those foundations.
3. Enter the node phase. Implement every node in the finalized blueprint one by
   one by upgrading, rewriting, adding, or removing provisional code.
4. Build release packages only after the product acceptance gates pass.

Do not spend time repairing a provisional node merely to preserve its current
behavior. Fix it early only when it blocks testing of a shared foundation.

## Documentation authority

When documents disagree, use this order:

1. This README for confirmed product boundaries and phase rules.
2. [`docs/BRUNNER_MASTER_ROADMAP.md`](docs/BRUNNER_MASTER_ROADMAP.md) for the
   current sequence and milestone gates.
3. [`docs/FOUNDATION_TODO_STATUS.md`](docs/FOUNDATION_TODO_STATUS.md),
   [`docs/COMPANION_TODO_STATUS.md`](docs/COMPANION_TODO_STATUS.md), and
   [`docs/MAPPER_TODO_STATUS.md`](docs/MAPPER_TODO_STATUS.md) for operational
   work remaining in the current foundation phase.
4. [`latest handoff document.txt`](latest%20handoff%20document.txt) for the last
   completed work and immediate next slice.
5. `docs/specs/07_*` through `docs/specs/11_*` for companion and mapper
   behavioral contracts, subject to the scope above.
6. [`workflow_nodes_implementation_blueprint.md`](workflow_nodes_implementation_blueprint.md)
   for the finalized node phase and node list.
7. [`docs/BRUNNER_USER_GUIDE.md`](docs/BRUNNER_USER_GUIDE.md) for currently
   supported usage.

`Design Doc.txt`, the two root transition plans, the companion DOCX, and Specs
01-06 describe design history or provisional development. They are useful
context but cannot override the sources above.

## Repository layout

- `BRunner/` — Chrome/Chromium MV3 extension.
- `BRunner/studio-graph-src/` — Graph Studio React/Vite source.
- `BRunner/studio-graph/` — built Graph Studio assets loaded by the extension.
- `BRunner_Host/` — Windows companion source.
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
