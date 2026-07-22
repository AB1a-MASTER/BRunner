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

1. Close every unchecked **Base Contract and Studio Unification** item in the
   node tracker before accepting Node 1.
2. Implement finalized nodes strictly by catalog number, one at a time.
3. Do not begin the next node until the current node satisfies every completion
   gate below and its tracker row is marked complete.
4. Keep release work and the V2 saved-map viewer deferred unless the user
   explicitly starts those milestones.

## One canonical workflow and node model

- Graph Studio and Sequential Studio must read, edit, validate, save, and run
  the same canonical workflow JSON, node type IDs, node contract versions,
  ports, configuration, targets, and output schemas.
- The Studios may differ only in presentation and interaction complexity.
  Graph Studio uses a canvas; Sequential Studio uses a simpler ordered/nested
  representation. Neither Studio may own a separate node type or lossy schema.
- A workflow saved by either Studio must open in the other without semantic
  conversion or loss. Studio-specific layout metadata must be preserved.
- Both Studios must consume the same finalized node registry, validators,
  field definitions, autocomplete sources, and runtime dispatcher.

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
- one shared editor contract rendered correctly in Graph and Sequential Studio;
- executor, output builder, stable errors, cancellation, timeout, logging,
  retry/side-effect safety, resolver behavior, and host policy as applicable;
- deterministic unit, integration, failure, disabled, retry, timeout, output,
  logging, and cross-Studio round-trip tests as applicable;
- a synthetic live workflow at
  `BRunner_Host/Workflows/node_acceptance/NNN_<node-slug>_acceptance.json`;
- focused live acceptance of that workflow when browser/host behavior applies;
- an end-user entry in `docs/NODE_USER_CATALOG.md` covering purpose,
  requirements, fields, examples, outputs, failures, and both Studio views;
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
