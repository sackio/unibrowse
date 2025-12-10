# unibrowse Skills

This directory contains Claude Code skills for unibrowse automation.

## Available Skills

### browser

**Location:** `.claude/skills/browser/`

**Purpose:** Provides comprehensive guidelines for browser automation using the browser MCP.

**When to use:**
- Opening and navigating websites
- Web scraping and content extraction
- Form filling and submission
- Macro execution for common tasks
- Multi-tab workflows
- Page content analysis

**Key Features:**
- Tab management (create new or use existing tabs)
- Context-efficient page content retrieval (avoids wasteful snapshots)
- Macro-first approach (40+ pre-built universal macros)
- Token conservation strategies
- Site-specific macro creation

## How Skills Work

Skills are automatically detected by Claude Code from:
- Project skills: `.claude/skills/skill-name/`
- Personal skills: `~/.claude/skills/skill-name/`

Each skill must have:
- A directory: `.claude/skills/skill-name/`
- A SKILL.md file with YAML frontmatter:
  ```yaml
  ---
  name: skill-name
  description: What this does and when to use it
  ---
  ```

## Using the Browser Skill

Claude will automatically invoke the browser skill when you ask for browser-related tasks. You can also explicitly request it:

- "Use the browser skill to search Amazon for headphones"
- "Open opengameart.org and extract the latest submissions"
- "Fill out the signup form on example.com"

## Skill vs Agent

**Why skill instead of agent?**
- ✅ Skills expand prompts in the current context (maintain MCP access)
- ✅ Skills provide structured guidelines without overhead
- ❌ Agents spawned via Task tool cannot access MCP servers
- ❌ Agents create separate contexts that lose MCP connectivity

## Detection

After creating or modifying skills:
1. Restart Claude Code to detect changes
2. Or ask: "What skills are available?"
3. Skills are model-invoked based on user requests and descriptions

## References

- [Claude Code Skills Documentation](https://docs.claude.com/en/docs/claude-code/skills.md)
- unibrowse: `/macros/UTILITY_MACROS.md` and `/macros/ADVANCED_MACROS.md`
