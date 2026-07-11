# Specification 09 - Semantic Form Fill

## Status

Feasible and approved for the final node implementation phase. Deterministic
semantic field-matching core is preparatory infrastructure only. Do not add the
workflow node, content execution, registry entry, or Studio controls before
Milestone 3.4 reaches the Phase 3 form-control nodes. The canonical node
contract lives in `workflow_nodes_implementation_blueprint.md` section E10.

## Goal

Allow one workflow node to fill a form from an object or table row without a
manually recorded node for every field. Given data such as:

```json
{
  "first_name": "Ada",
  "last_name": "Lovelace",
  "address": "12 St James's Square",
  "subject": "Mapper reliability",
  "message": "Please send details."
}
```

the runtime matches keys to compatible controls using labels, accessible names,
placeholder, title, `name`, nearby text, form context, role, input type, and
mapper component facts. It then fills only unique high-confidence assignments.

## Node Contract

Canonical node: `form.fill_from_data`.

Inputs:

- object expression or current table-row expression;
- optional field metadata containing title, description, aliases, type, and
  required/secret policy;
- optional target form/region Component ID;
- matching policy: strict by default, bounded minimum score and margin;
- overwrite policy: empty only, always, or never;
- unmatched policy: continue with diagnostics, route unresolved, or fail;
- verification policy: read back values/states after filling.

Outputs:

- matched fields with Component IDs, scores, margins, and evidence;
- unmatched data keys and controls;
- ambiguous assignments;
- filled, skipped, and verification-failed counts;
- secret-safe structured diagnostics.

## Matching Pipeline

1. Read current settled mapper facts inside the selected page/form scope.
2. Keep fill-compatible controls only: text-like inputs, textareas, selects,
   comboboxes, checkboxes, radios, switches, and supported contenteditable
   controls.
3. Normalize data keys and optional metadata. Support common aliases such as
   first/given name, last/family name, postal/ZIP code, telephone/mobile, and
   state/province.
4. Score every field/control pair from semantic, structural, type, and mapper
   evidence.
5. Solve a one-to-one assignment. A pair must be the best choice from both the
   field and control perspective and pass score plus winner-margin thresholds.
6. Do not fill ambiguous pairs. Never use DOM order as a terminal tie-breaker.
7. Dispatch the control-appropriate action: type/clear, select by visible text
   then value, or set toggle state.
8. Read values/states back and report verification results.

An external embedding or LLM service is not required for the initial release.
Deterministic aliases and token matching are faster, private, testable, and work
offline. Embeddings may later suggest candidates only; deterministic type,
scope, uniqueness, and margin gates must still approve execution.

## Safety and Privacy

- Password controls accept only explicitly password-classified data keys.
- Raw field values, passwords, tokens, and message bodies stay out of logs and
  persisted mapper records.
- Hidden, disabled, readonly, unsupported, or ambiguous controls are skipped.
- A data key maps to at most one control and a control receives at most one key.
- Submit buttons are never activated by this node.
- Verification failures route through structured unresolved behavior.
- Form filling uses current live components; it does not permanently rename map
  components from arbitrary user data keys.

## Implementation Stages

Stages 2-6 belong to the node implementation phase and must not be pulled into
the current mapper phase.

1. Pure semantic matcher with aliases, type guards, one-to-one assignment,
   confidence margins, and deterministic tests. **Implemented.**
2. Add mapper form-control scan API and bounded scope selection.
3. Add content-side fill plan executor using existing type/select/toggle helpers
   plus post-fill verification.
4. Register `form.fill_from_data`, add graph-schema unresolved output, expression
   input, overwrite/unmatched policy, and structured output variable.
5. Add Graph and Sequential Studio authoring controls without requiring manual
   Component IDs for each field.
6. Add fixtures for contact, address, login, repeated labels, hidden fields,
   dynamic forms, custom ARIA controls, and table-row iteration.

## Acceptance

- Correctly fills common contact/address forms from differently named columns.
- Uses title/description metadata when a key alone is insufficient.
- Handles text, textarea, select, checkbox/radio/switch, and supported ARIA
  controls through their native action contracts.
- Refuses duplicate `Email` or `Address` controls without enough form context.
- Never fills a password from a generic text/message field.
- Does not submit the form.
- Publishes useful mappings and unmatched diagnostics without raw secret values.
- Replays deterministically across layout, generated-ID, and non-semantic class
  changes.
