# Browser MCP Task Automation

Execute browser automation tasks using the browser MCP with an intelligent macro-first strategy.

## Task Description
{{ARGUMENTS}}

## Execution Strategy

### Phase 1: Macro Discovery (Prioritize Reusable Automation)

1. **Identify the target site** from the task description
2. **Search for existing macros** that match the task:
   ```
   mcp__browser__browser_list_macros(site="example.com", category="search|extraction|interaction|form|navigation")
   ```
3. **If macros exist**:
   - Review macro parameters and capabilities
   - Execute the macro with appropriate parameters: `mcp__browser__browser_execute_macro(id="macro_id", params={...})`
   - Verify results and complete task
   - ✅ **Success path: Task completed efficiently with proven automation**

### Phase 2: Manual Tool Execution (Fallback Approach)

4. **If no suitable macros exist**, use browser MCP tools directly:
   - **Navigate**: `mcp__browser__browser_navigate(url="...")`
   - **Inspect**: `mcp__browser__browser_snapshot()` to understand page structure
   - **Interact**: Use `browser_click()`, `browser_type()`, `browser_fill_form()`, etc.
   - **Extract**: Use `browser_get_visible_text()`, `browser_query_dom()`, etc.
   - Complete the task step by step

### Phase 3: Macro Creation (Future Optimization)

5. **After successfully completing the task manually**:
   - Consider if this is a repeatable workflow
   - If yes, **create a macro** for future use:
     ```
     mcp__browser__browser_store_macro(
       site="example.com",
       category="search|extraction|interaction|form|navigation|util",
       name="descriptive_macro_name",
       description="Clear explanation of what this macro does and when to use it",
       parameters={
         "param_name": {
           "type": "string|number|boolean|object|array",
           "description": "What this parameter does",
           "required": true|false,
           "default": "optional_default_value"
         }
       },
       code="(params) => { /* JavaScript function code */ return result; }",
       returnType="Description of what the macro returns",
       reliability="untested|low|medium|high",
       tags=["tag1", "tag2"]
     )
     ```
   - ✅ **Future optimization: Next time this task will use Phase 1**

## Macro Categories

- **search**: Site-specific search operations
- **extraction**: Data scraping and extraction patterns
- **navigation**: Common navigation workflows
- **interaction**: Interactive elements (buttons, menus, etc.)
- **form**: Form filling and submission
- **util**: Utility functions (parsing, formatting, etc.)

## Best Practices

1. **Always check for macros first** - save time and use proven automation
2. **Universal macros** (site="*") work across all sites - check these too
3. **When creating macros**:
   - Use clear, descriptive names
   - Document parameters thoroughly
   - Include reliability ratings as you test them
   - Add relevant tags for easy discovery
4. **Multi-tab operations**: Use `tabTarget` parameter to work across multiple browser tabs
5. **Error handling**: If a macro fails, fall back to manual tools and update/fix the macro

## Expected Outcome

By the end of this task, you should have:
- ✅ Completed the requested browser automation task
- ✅ Used existing macros if available (efficient path)
- ✅ Created new macros if the task is repeatable (optimization for future)
- ✅ A clear record of what worked and what didn't

## Example Usage

```
/browse Search for "best pizza" on Yelp and extract the top 3 restaurant names with ratings
```

This command will:
1. Check if Yelp search/extraction macros exist
2. Use them if available, or manually search and extract
3. Optionally create macros for future Yelp searches
