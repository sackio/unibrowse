# Browser MCP Agents

This directory contains specialized agents for Browser MCP automation.

## Available Agents

### browser-agent

**Purpose:** Browser agent with macro awareness

**Capabilities:**
- Executes stored macros for common browser tasks
- Falls back to direct browser control when needed
- Automatically receives updated macro lists on navigation
- Suggests new macros when discovering useful workflows

**Tools:** All `mcp__browser__*` tools

**Usage:**
```bash
# Invoke the agent in Claude Code
# The agent will automatically query macros and handle browser tasks
```

## How It Works

### Auto-Context Updates

The `browser-agent` receives automatic context updates via hooks:

1. **On Navigation** - When you navigate to a new site, hooks inject available macros
2. **On Tab Switch** - When switching tabs, context refreshes for new tab
3. **On Click** - If a click causes navigation, macros update

This means the agent always knows what macros are available for the current site.

### Hook Configuration

Hooks are configured in `.claude/hooks/browser-navigation.json`:

- `PostToolUse: browser_navigate` → Updates macro context
- `PostToolUse: browser_switch_tab` → Updates macro context
- `PostToolUse: browser_click` → Checks for navigation, updates if needed

### Helper Scripts

**Get macros for a site:**
```bash
./scripts/get-macros-for-site.sh amazon.com
```

**Manual context update:**
```bash
./scripts/hooks/update-macro-context.sh
```

## Workflow Example

```
User: "Find cheap wireless headphones on Google Shopping"
  ↓
[Launch browser-agent]
  ↓
Agent:
  1. Lists macros for current site
  2. Finds google_shopping_search macro
  3. Executes search with user's query
  4. Hook automatically updates context after navigation
  5. Finds google_shopping_apply_filter macro
  6. Applies price filter
  7. Extracts products
  ↓
Agent returns structured results
```

## Creating New Agents

To create a new specialized agent:

1. Create a markdown file in this directory
2. Add YAML frontmatter with configuration
3. Write detailed instructions in the markdown body

Example:

```markdown
---
name: my-agent
description: My specialized agent
tools:
  - mcp__browser__*
  - Read
model: sonnet
---

# My Agent

Instructions for the agent...
```

## Testing

Test the hook system:

```bash
# Start a browser session
# Navigate to a site with macros (e.g., amazon.com)
# The hook should trigger and display available macros
```

Test macro querying:

```bash
./scripts/get-macros-for-site.sh amazon.com
./scripts/get-macros-for-site.sh shopping.google.com
```

## Troubleshooting

**Hooks not firing:**
- Check that hooks are enabled in Claude Code settings
- Verify scripts are executable: `chmod +x scripts/hooks/*.sh`
- Check hook configuration: `.claude/hooks/browser-navigation.json`

**Macros not showing:**
- Ensure MongoDB container is running: `docker ps | grep mongodb`
- Check macros exist: `./scripts/get-macros-for-site.sh <domain>`
- Verify backup: `./scripts/backup-mongodb.sh`

**Agent not aware of macros:**
- Check that hooks are configured correctly
- Ensure agent is actually `browser-agent` name
- Manually test: `./scripts/hooks/update-macro-context.sh`

## Best Practices

1. **Keep agent focused** - One clear purpose per agent
2. **Document thoroughly** - Clear instructions help the agent
3. **Limit tools** - Only provide necessary tools
4. **Test macros first** - Ensure macros work before agent relies on them
5. **Update context** - Hooks keep context fresh automatically
