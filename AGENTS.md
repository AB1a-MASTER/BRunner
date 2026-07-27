# BRunner Node Program Instructions

These instructions apply to the entire repository during the finalized node
program. They supplement the product boundary in `README.md` and must not be
used to expand product scope.

## Authority

Use these sources in order:

1. `README.md` for product and trust boundaries.
2. `docs/BRUNNER_MASTER_ROADMAP.md` for milestone order.
3. `workflow_nodes_implementation_blueprint.md` for finalized node contracts.
4. `docs/NODE_IMPLEMENTATION_STATUS.md` for the live work checklist.
5. `docs/NODE_USER_CATALOG.md` for behavior that is actually available to end
   users.

Historical specifications and provisional runtime code are implementation
references only. Never treat provisional behavior as a compatibility contract.

## Required work order

1. Close every unchecked **Base Contract and Graph Studio Consolidation** item in the
   node tracker before accepting Node 1.
2. Implement finalized nodes strictly by catalog number, one at a time.
3. Do not begin the next node until the current node satisfies every completion
   gate below and its tracker row is marked complete.
4. Keep release work and the V2 saved-map viewer deferred unless the user
   explicitly starts those milestones.

## Power-loss-resilient work SOP

Use this procedure for every implementation, fix, cleanup, migration, or
documentation item. The repository documents are the recovery authority; Git
status may supplement them but must not replace these checkpoints.

1. Before changing files, read the current item in the highest-authority
   roadmap/tracker document and confirm its scope, status, prerequisites, and
   acceptance boundary.
2. Create or update a dedicated step record under
   `docs/work_items/<item-id>_<slug>.md` before implementation begins. The
   record must contain:
   - objective and explicit non-goals;
   - affected surfaces and expected files;
   - ordered, atomic implementation steps;
   - verification required for each step;
   - one current resume checkpoint;
   - per-step status and evidence; and
   - item-level completion gates.
3. Register the step-record path and current status in the main tracker. Only
   one item and one step may be marked **In progress** at a time.
4. Before starting an implementation step, mark that step **In progress** and
   write what must be rechecked if execution is interrupted.
5. Complete only that step, run its focused verification, then immediately mark
   it **Complete** with the changed files and evidence before starting the next
   step. Update the main tracker whenever the item-level status or boundary
   changes.
6. If work is interrupted, leave the current step **In progress**. Do not infer
   completion from memory, timestamps, or partial source changes.
7. When resuming:
   - read the main roadmap/tracker and identify the latest active item;
   - read that item's dedicated step record;
   - inspect the files and behavior named by its current resume checkpoint;
   - verify every recorded completed step still satisfies its focused check;
   - classify the active step as not started, partial, or complete; and
   - repair or finish that step before continuing in order.
8. After the final step, run the complete item-level acceptance gate, update the
   step record and main tracker to **Complete**, synchronize affected handoff
   and user documentation, and record any remaining external/manual evidence.
9. Never start the next tracker item while the current record has an incomplete
   step or unmet completion gate.

## One canonical Graph Studio workflow and node model

- Graph Studio is the only supported workflow-authoring Studio. It must read,
  edit, validate, save, and run the canonical mapper-graph workflow JSON with
  exact node type IDs, contract versions, ports, configuration, targets, and
  output schemas.
- Sequential Studio is deprecated and disabled. Keep normal Studio launches
  routed to Graph Studio, keep its former URL fail-closed, and keep its
  scripts/styles unexposed without deleting `BRunner/studio/`. Do not repair,
  extend, test for parity with, or document it as supported.
- Delete the dormant Sequential Studio source and exclusively owned
  tests/documentation only during the final cleanup milestone after integrated
  V1 source acceptance and before V2 work begins.
- The Graph Studio editor, saved canonical JSON, background validation, and
  finalized graph runtime must share the same registry, validators, field
  definitions, autocomplete semantics, entry node, routes, and value types.
- Finalized workflows must never depend on a Studio-specific conversion or the
  legacy linear executor. Keep that executor only while provisional non-Studio
  behavior still requires it, then remove it through its own tracked cleanup.

## Node versioning

- Address a node contract by `(type, version)`, never by `type` alone.
- New finalized type IDs start at version `1`.
- A finalized contract that reuses a provisional type ID starts at version `2`
  unless an explicit reviewed migration proves that version `1` is identical.
- Schema, port, output, retry, or execution-semantics changes require a version
  bump and a migration or an explicit fail-closed unsupported-version result.
- Never silently reinterpret an old node configuration as a new contract.

## Per-node completion gate

A node is complete only when all of the following are true:

- frozen definition with stable type, version, category, capabilities, ports,
  services, retry safety, protected-page behavior, and output schema;
- validated configuration with defaults, help text, advanced settings, and
  clear examples for every user-entered field;
- shared autocomplete for variables, prior outputs, tab/file references, and
  other applicable values;
- checkbox/dropdown selection for identifier kind, matching mode, scope,
  behavior, or capability wherever free-form guessing would be ambiguous;
- one shared editor contract rendered correctly in Graph Studio;
- executor, output builder, stable errors, cancellation, timeout, logging,
  retry/side-effect safety, resolver behavior, and host policy as applicable;
- deterministic unit, integration, failure, disabled, retry, timeout, output,
  logging, and Graph-editor/save/runtime semantic round-trip tests as
  applicable;
- a synthetic live workflow at
  `BRunner_Host/Workflows/node_acceptance/NNN_<node-slug>_acceptance.json`;
- focused live acceptance of that workflow when browser/host behavior applies;
- an end-user entry in `docs/NODE_USER_CATALOG.md` covering purpose,
  requirements, fields, examples, outputs, failures, and Graph Studio usage;
- removal or isolation of replaced provisional registry/editor/executor paths;
- tracker row updated with acceptance evidence and commit hash after the user
  commits the accepted slice.

## Acceptance workflow rules

- Use only synthetic, disposable data and repository fixtures.
- Exercise the finalized node contract, its important output, and at least one
  expected failure or safe alternate route when practical.
- Validate acceptance workflow schema in the automated suite.
- Do not use release packages as evidence. Run from source and the unpacked
  extension during the node milestone.

## Git and documentation discipline

- The user controls staging, commits, branches, pushes, and pull requests.
- After a successful node, propose a small Conventional Commit such as
  `feat(nodes): implement Navigate`; do not commit unless explicitly asked.
- Update the tracker, user catalogue, roadmap/handoff when priority changes,
  and affected developer documentation in the same node slice.
- Rebuild `BRunner/studio-graph/` whenever Graph Studio source or imported
  shared modules change.
- Preserve unrelated user work and keep local runtime configuration, logs, and
  generated acceptance output out of commits.

## Product and safety boundaries

- Target local Windows plus Chrome/Chromium, one cooperating user/profile.
- Treat pairing as a cooperative profile lock, not authentication.
- Make no credential, redaction, privacy, or hostile-local-user guarantee.
- Never interact with an unresolved or materially ambiguous target.
- Keep physical input visible, foreground-verified, opt-in, and last-resort.
- Keep graph branching, loops, joins, scopes, and error routes in the canonical
  graph runtime, never inside the legacy linear executor.
