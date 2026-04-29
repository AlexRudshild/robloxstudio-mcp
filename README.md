# Roblox Studio MCP Server

**Connect AI assistants like Claude and Gemini to Roblox Studio**

> Fork of [boshyxd/robloxstudio-mcp](https://github.com/boshyxd/robloxstudio-mcp) — installs from this repo (`AlexRudshild/robloxstudio-mcp`) instead of npm.

---

## What is This?

An MCP server that lets AI explore your game structure, read/edit scripts, and perform bulk changes all locally and safely.

## Setup

### 1. Clone and build

```bash
git clone https://github.com/AlexRudshild/robloxstudio-mcp.git
cd robloxstudio-mcp
npm install
npm run build:all
```

This produces:
- `packages/robloxstudio-mcp/dist/index.js` and `packages/robloxstudio-mcp-inspector/dist/index.js`
- `studio-plugin/MCPPlugin.rbxmx` — the Studio plugin, **auto-copied** into your Roblox `Plugins` folder if it exists:
  - Windows: `%LOCALAPPDATA%\Roblox\Plugins`
  - macOS: `~/Documents/Roblox/Plugins`

### 2. Activate the Studio plugin

Restart Roblox Studio so it picks up the new `MCPPlugin.rbxmx`.

Then enable **Allow HTTP Requests** in Game Settings → Security.

If the auto-copy didn't run (folder didn't exist at build time), copy `studio-plugin/MCPPlugin.rbxmx` manually. **Plugins → Plugins Folder** in Studio opens the destination directly.

### 3. Connect your AI

Use the **absolute path** to the built `index.js` from step 1. Replace `C:\path\to\robloxstudio-mcp` with your clone location.

**Claude Code:**
```bash
claude mcp add robloxstudio -- node "C:\path\to\robloxstudio-mcp\packages\robloxstudio-mcp\dist\index.js"
```

**Codex CLI:**
```bash
codex mcp add robloxstudio -- node "C:\path\to\robloxstudio-mcp\packages\robloxstudio-mcp\dist\index.js"
```

**Gemini CLI:**
```bash
gemini mcp add robloxstudio node --trust -- "C:\path\to\robloxstudio-mcp\packages\robloxstudio-mcp\dist\index.js"
```

Plugin shows "Connected" when ready.

<details>
<summary>Other MCP clients (Claude Desktop, Cursor, etc.)</summary>

```json
{
  "mcpServers": {
    "robloxstudio-mcp": {
      "command": "node",
      "args": ["C:\\path\\to\\robloxstudio-mcp\\packages\\robloxstudio-mcp\\dist\\index.js"]
    }
  }
}
```

On macOS/Linux use forward slashes:
```json
{
  "mcpServers": {
    "robloxstudio-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/robloxstudio-mcp/packages/robloxstudio-mcp/dist/index.js"]
    }
  }
}
```
</details>

### Updating

One command — pulls, installs, rebuilds server + plugin, and reinstalls the plugin into your Roblox Plugins folder:

```bash
npm run update
```

Restart Studio afterward so it picks up the new plugin build.

If you only want to rebuild + reinstall the Studio plugin (no git pull):

```bash
npm run install:plugin
```

## What Can You Do?

Ask things like: *"What's the structure of this game?"*, *"Find scripts with deprecated APIs"*, *"Create 50 test NPCs in a grid"*, *"Optimize this movement code"*

## Recommended Agent Rules

Drop this into your project's `AGENTS.md` (Codex) or `CLAUDE.md` (Claude Code). Validated on 4 real Codex sessions of the same UI bug-fix task: per-turn input dropped from ~140k to ~52k tokens, `knownHash` dedup adoption rose from 0% to 70%, sub-agent forks went from 4 to 0, and the task was solved correctly only after these rules were in place.

```markdown
## Token Discipline (HARD RULES)

- Always call `get_script_source` with `startLine`/`endLine`. Run `get_script_outline` first, then read only the exact needed range. Full reads forbidden except for files under 100 lines.
- Use `grep_scripts` instead of reading whole files for search.
- After each `get_script_source` / `get_script_outline` / `edit_script_lines` response, capture the returned `knownHash` and pass it on the next call to the same script — server short-circuits to `{unchanged:true}` when nothing changed.
- After `edit_script_lines`, narrow any re-read to the returned `affectedLines:[start,end]` range, not wider.
- Group independent tool calls in parallel when there is no dependency between them.
- Sub-agents only for genuinely independent work. Use a narrow brief (3–5 lines, concrete paths/functions, expected response format), not "study everything". Default to no full-context fork; justify if you need one.
- Do not repeat just-read code in your reasoning or final answer.
- Keep the final answer concise; do not restate what is visible in the diff.
- Do not re-read project documentation files that were already read this session.
```

**Harness-specific syntax** (adapt the lines above):
- **Codex CLI** — parallel calls via `multi_tool_use.parallel`; sub-agents via `spawn_agent` with `fork_context:false` by default.
- **Claude Code** — emit multiple tool calls in one assistant message for parallel; sub-agents via the `Agent` tool.

Why these rules live in your project file rather than the server: they contain harness-specific syntax and project-tunable thresholds (e.g. the file-size cutoff for full reads). Universal tool-mechanic hints — `knownHash` chaining, outline-first navigation, `affectedLines` after edits, error codes — already ship inside each tool's description; you do not need to re-state them.

<details>
<summary><strong>Inspector Edition (Read-Only)</strong></summary>

### robloxstudio-mcp-inspector

A lighter, **read-only** version that only exposes inspection tools. No writes, no script edits, no object creation/deletion. Ideal for safely browsing game structure, reviewing scripts, and debugging without risk of accidental changes.

**21 read-only tools:** `get_file_tree`, `search_files`, `get_place_info`, `get_services`, `search_objects`, `get_instance_properties`, `get_instance_children`, `search_by_property`, `get_class_info`, `get_project_structure`, `mass_get_property`, `get_script_source`, `grep_scripts`, `get_attribute`, `get_attributes`, `get_tags`, `get_tagged`, `get_selection`, `start_playtest`, `stop_playtest`, `get_playtest_output`

**Setup** — same plugin, point to the inspector dist instead:

**Claude:**
```bash
claude mcp add robloxstudio-inspector -- node "C:\path\to\robloxstudio-mcp\packages\robloxstudio-mcp-inspector\dist\index.js"
```

**Codex:**
```bash
codex mcp add robloxstudio-inspector -- node "C:\path\to\robloxstudio-mcp\packages\robloxstudio-mcp-inspector\dist\index.js"
```

**Gemini:**
```bash
gemini mcp add robloxstudio-inspector node --trust -- "C:\path\to\robloxstudio-mcp\packages\robloxstudio-mcp-inspector\dist\index.js"
```

<details>
<summary>Other MCP clients (Claude Desktop, Cursor, etc.)</summary>

```json
{
  "mcpServers": {
    "robloxstudio-mcp-inspector": {
      "command": "node",
      "args": ["C:\\path\\to\\robloxstudio-mcp\\packages\\robloxstudio-mcp-inspector\\dist\\index.js"]
    }
  }
}
```
</details>

</details>

---

<!-- VERSION_LINE -->**v2.6.0-next.1** - 43 tools, inspector edition, monorepo architecture

[Report Issues](https://github.com/AlexRudshild/robloxstudio-mcp/issues) | Upstream: [boshyxd/robloxstudio-mcp](https://github.com/boshyxd/robloxstudio-mcp) | MIT Licensed
