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
