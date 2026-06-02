# Flicker ACP Provider Design

## Goal

Expose `flicker` as a built-in WheelMaker ACP agent provider backed by the `myflicker acp` command.

## Decision

Use `flicker` as the canonical provider and agent name everywhere WheelMaker exposes provider identities. Do not accept `myflicker` as a provider alias. The executable remains `myflicker` because that is the CLI name.

## Architecture

The integration follows the existing generic ACP provider preset path used by `opencode` and `codebuddy`.

- `protocol.ACPProvider` gains `ACPProviderFlicker = "flicker"`.
- `agent.ACPProviderPreset` gains `FlickerACPProviderPreset` with `BinaryName: "myflicker"` and `Args: []string{"acp"}`.
- `ACPFactory` registers flicker as an owned ACP connection if `myflicker acp` can launch.
- Skills discovery for `flicker` scans `.agents/skills` and `~/.agents/skills`.
- The app's agent tag variant map includes `flicker`, while `myflicker` remains absent from exposed agent names.

## Error Handling

If `myflicker` is not on PATH or in WheelMaker's local binary search paths, the provider is skipped during auto-registration and logs the same warning shape as other optional ACP providers. Explicit use of an unavailable provider returns the existing `unknown provider` path after the provider is not registered.

## Testing

Add tests that verify:

- `NewFlickerProvider().Launch()` resolves binary `myflicker` and returns args `["acp"]`.
- `ParseACPProvider("flicker")` succeeds.
- `ParseACPProvider("myflicker")` does not succeed.
- `ACPProviderNames()` exposes `flicker` and does not expose `myflicker`.
- `providerPresetByName("flicker")` succeeds and `providerPresetByName("myflicker")` does not.
- The app source-structure test verifies `flicker` has an explicit tag variant and `myflicker` is not exposed.
