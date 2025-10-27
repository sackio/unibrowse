# Browser MCP Macros

This directory contains macro definition files for Browser MCP.

## Structure

- `*.js` - Macro definition files containing arrays of macro objects
- `storage/` - Scripts to store macros into MongoDB database
- `*.md` - Documentation for macro collections

## Macro Definition Files

- **advanced-macros.js** - 24 advanced macros for performance monitoring, accessibility auditing, content extraction, and testing automation
- **advanced-form-controls-macros.js** - 8 macros for handling complex form widgets (date pickers, color pickers, rich text editors, autocomplete)
- **cdn-injection-macros.js** - Macros for injecting CDN libraries (jQuery, React, Vue, etc.)
- **form-filling-macros.js** - Macros for smart form filling and validation
- **utility-macros.js** - General utility macros for common browser automation tasks

## Storage Scripts

The `storage/` subdirectory contains scripts to load macro definitions into MongoDB:

- `store-advanced-macros.js` - Store advanced form controls macros
- `store-cdn-macros.js` - Store CDN injection macros
- `store-form-macros.js` - Store form filling macros
- `store-utility-macros.js` - Store utility macros

## Usage

1. Define macros in a `.js` file following the macro object schema
2. Create a storage script in `storage/` to load them into MongoDB
3. Run the storage script: `node macros/storage/store-your-macros.js`
4. Use macros via Browser MCP tools: `browser_list_macros`, `browser_execute_macro`

## Macro Object Schema

```javascript
{
  site: "*",              // Domain or "*" for universal
  category: "extraction", // Category: extraction, form, navigation, etc.
  name: "macro_name",     // Unique name for the macro
  description: "...",     // What the macro does
  parameters: {},         // Parameter definitions
  code: "(params) => {}", // Executable function code
  returnType: "...",      // Description of return value
  reliability: "high",    // high, medium, low, or untested
  tags: []               // Tags for filtering
}
```
