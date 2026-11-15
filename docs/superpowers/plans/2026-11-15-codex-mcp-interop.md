# Codex MCP interoperability — implementation plan

Status: Proposed (not yet approved for runtime implementation)
Date: 2026-11-15
Target: CodexPro Full v0.34.2; preserve the active operator-owned tunnel/runtime

## Evidence and problem

On Windows, CodexPro Full v0.34.2 reports `toolMode=full`, `codexSessions=read`, 88 registered tools, and Codex config at `C:\Users\admin\.codex`. Its existing `src/capabilitiesOps.ts` discovers names from `~/.codex/config.toml`, and `src/integrationRouterOps.ts` recommends discovered names. Neither connects to downstream MCP servers nor exposes their tools. The operator's Codex CLI config lists the enabled `browser-tools` (stdio: `cmd /c npx -y @agentdeskai/browser-tools-mcp@latest --allow-input`) and `prompts_chat` (remote HTTP MCP) servers.

Goal: let authenticated ChatGPT -> CodexPro call explicitly approved tools from the same Codex-configured MCP servers while preserving CodexPro's boundaries. This is not sharing all Codex features, sessions, model access or credentials.

## Architecture decision gate

External MCP tool execution expands local-process, network and cross-service authority. Before coding, get explicit approval of this narrowly scoped architecture and operator-selected servers/tools. Do not launch every configured MCP automatically. Do not run Codex CLI (forbidden by `AGENTS.md`).

Use a **separate, opt-in downstream MCP client adapter**, not `integration_plan` as an executor. Prefer existing v2 MCP client packages from `package.json`. No generic browser-control layer, arbitrary URL client, prompt dumping, raw process command tool, extra model routing or privilege broadening.

## Proposed public interface

- Default **off**. Explicit administrator opt-in lists allowable downstream server names and exact tool names, each with a risk category (read-only or requires confirmation). No wildcard by default.
- Expose a bounded, clear invocation surface via an existing integration tool when feasible; if impossible without compatibility break, justify one dedicated top-level tool in a fresh architecture decision.
- On startup, discover metadata, but do not launch downstream programs or connect external services until explicitly invoked and approved.
- Tool listing returns sanitized name, description and bounded input schema. Tool calls validate arguments against the downstream schema, enforce payload/output limits and timeouts and sanitize error paths.
- Show provenance: server name, tool name and status; never return token values or dump raw config.

## Security requirements

1. Parse TOML with a vetted parser or narrow strict parser, with malformed entries fail closed; never use a regular expression to parse executable configuration.
2. Resolve configured `codexDir` rather than assuming `~/.codex`. Restrict read to its expected `config.toml`, avoid symbolic links and oversized files.
3. For stdio, require operator approval of executable + full argument vector and server name. Never forward the broader inherited environment; explicitly allowlist only needed variable names. Support Windows `cmd /c` safely without shell string concatenation. Treat `npx -y ... @latest` as remote executable code requiring an extra approval and ideally pin an exact version.
4. For HTTP, use verified `https:` endpoints, disallow localhost/private and redirects unless separately approved and controlled; prohibit arbitrary SSRF. Bind remote URL to approved config fingerprint. Never log query strings, credentials or sensitive prompt data.
5. Handle auth explicitly; never automatically copy Codex credentials or refresh tokens across services; keep secret-bearing values out of prompts, diagnostics, persisted task records and Git.
6. Integrate with CodexPro authenticated MCP transport, tool/policy gates, workspace authorization, explicit approval model, redaction, and activity audit (redacted metadata only).
7. Set per-call deadlines, connection/process life-cycle bounds, cancellation and cleanup. Never restart/stop the operator-owned CodexPro runtime.
8. If config or approval changes, invalidate/revoke connections; reject unknown tool names, stale fingerprints and recursive calls into CodexPro itself.
9. Output follows existing redaction and content size limits; prevent untrusted tool text from becoming trusted instructions.

## Staged implementation

1. **RED:** add fixture-based tests for enabled/disabled TOML entries, missing files, symlink/size, allowlists, malicious tool names, secret leakage, outbound URL blocking and Windows stdio argv.
2. Implement a standalone `src/mcpBridge/` module (config reader, approvals, client adapter, sanitized metadata) with dependency injection to make tests use local disposable servers; no Codex CLI.
3. Wire opt-in config/profile/launcher controls without changing any defaults; preserve existing `integration_plan` discovery behavior.
4. Wire policy, tool registration/routing, read-only diagnostics and audit metadata; expose zero direct tools when disabled.
5. Test two disposable fixtures: stdio and Streamable HTTP. Add focused MCP bridge smoke tests, `npm run build`, full `npm run smoke`, and `npm run stress` if process/concurrency/output paths change; run cross-platform CI.
6. Inspect diff and security invariants, document exact operator activation and rollback, make a reviewable PR. No automatic package release, reinstall, profile change, tunnel stop/start or MCP server launch.

## Acceptance criteria

- With bridge disabled, CodexPro tool list and existing tests remain unchanged.
- With explicit approval, a disposable downstream tool can be listed and called across stdio/HTTPS and reported with source provenance.
- Unknown, unapproved, read/write escalation, symlinked config, secret-bearing errors, private URL, oversized result, timeouts, child exit, changed config or revoked approval all fail closed.
- Both existing `browser-tools` and `prompts_chat` remain *discovered* without being implicitly started or invoked; actual invocation is separate operator-approved validation after implementation.
- No Codex CLI invocation, no user tunnel runtime mutation, no secret reproduction, no global environment inheritance.

## Known limitation

Codex CLI feature flags and native Codex model capabilities are not MCP servers. This bridge does not clone `codex features list`; it only connects authorized downstream MCP tools.
