# unibrowse Macros Documentation

Comprehensive documentation for all unibrowse macro collections.

## 📚 Complete Macro Documentation

### Core Macro Collections

1. **[UTILITY_MACROS.md](./UTILITY_MACROS.md)** - 17 utility macros
   - Page exploration and element discovery
   - Form detection and message handling
   - Table extraction and page state analysis
   - Essential tools for browser automation

2. **[ADVANCED_MACROS.md](./ADVANCED_MACROS.md)** - 24 advanced macros
   - Content extraction (Reader Mode-like functionality)
   - Performance monitoring and metrics
   - Accessibility auditing (WCAG 2.1)
   - Page load state detection
   - Cookie consent handling

3. **[FORM_CONTROLS_MACROS.md](./FORM_CONTROLS_MACROS.md)** - 11 form control macros
   - Date pickers (7+ libraries supported)
   - Range sliders and color pickers
   - Rich text editors (TinyMCE, CKEditor, Quill)
   - Custom selects (Select2, Chosen)
   - File upload handlers (Dropzone.js)
   - Autocomplete controls

4. **[FORM_FILLING_MACROS.md](./FORM_FILLING_MACROS.md)** - 7 form filling macros
   - Intelligent field detection (19+ types)
   - Realistic test data generation
   - Smart validation and submission
   - Multi-step form wizard detection
   - Password requirement analysis

5. **[CDN_INJECTION_MACROS.md](./CDN_INJECTION_MACROS.md)** - 4 CDN injection macros
   - Dynamic library loading
   - Popular library presets (jQuery, Lodash, D3, etc.)
   - Dependency detection and management
   - Batch loading with timeout protection

## 📊 Macro Statistics

- **Total Macros:** 63
- **Categories:** 7 (extraction, form, navigation, util, interaction, exploration, cdn)
- **High Reliability:** 45+ macros
- **Universal (site: "*"):** All 63 macros

## 🚀 Quick Start

### Store All Macros

```bash
# Store all macro collections
npm run store:macros           # Utility macros (17)
npm run store:advanced-macros  # Advanced macros (24)
npm run store:form-controls    # Form controls (11)
npm run store:form-filling     # Form filling (7)
npm run store:cdn-macros       # CDN injection (4)
```

### Run Tests

```bash
# Test macro collections
npm run test:utility-macros    # Test utility macros
npm run test:advanced-macros   # Test advanced macros
```

### Use Macros via MCP

```javascript
// List all macros
await browser_list_macros({ limit: 100 });

// Search by category
await browser_list_macros({ category: "extraction" });

// Execute a macro
await browser_execute_macro({
  id: "macro_id_here",
  params: { /* macro parameters */ }
});
```

## 📁 Source Files

Macro definitions are in `/macros/`:

- `utility-macros.js` - Core utilities
- `advanced-macros.js` - Advanced features
- `advanced-form-controls-macros.js` - Form controls
- `form-filling-macros.js` - Smart form filling
- `cdn-injection-macros.js` - Library injection

Storage scripts in `/macros/storage/`:

- `store-utility-macros.js`
- `store-advanced-macros.js`
- `store-form-macros.js`
- `store-cdn-macros.js`

## 🎯 Macro Categories

| Category | Count | Description |
|----------|-------|-------------|
| **extraction** | 12 | Content, table, and data extraction |
| **form** | 18 | Form controls and filling |
| **util** | 15 | General utilities and helpers |
| **exploration** | 8 | Page discovery and analysis |
| **navigation** | 6 | Navigation and search |
| **interaction** | 3 | User interaction simulation |
| **cdn** | 4 | Library injection |

## 🏗️ Macro Object Schema

```javascript
{
  site: "*",              // Domain or "*" for universal
  category: "extraction", // Category (see table above)
  name: "macro_name",     // Unique name for the macro
  description: "...",     // What the macro does
  parameters: {           // Parameter definitions
    paramName: {
      type: "string",     // string, number, boolean, object, array
      description: "...", // Parameter purpose
      required: true,     // Whether required
      default: "..."      // Optional default value
    }
  },
  code: "(params) => {}", // Executable function code
  returnType: "...",      // Description of return value
  reliability: "high",    // high, medium, low, untested
  tags: ["tag1", "tag2"] // Tags for filtering/search
}
```

## 🔧 Development

### Creating New Macros

1. Define macro in appropriate `.js` file in `/macros/`
2. Add to export array following the schema above
3. Create/update storage script in `/macros/storage/`
4. Document in corresponding `.md` file in `/docs/macros/`
5. Store in MongoDB: `node macros/storage/store-your-macros.js`
6. Test via MCP tools

### Best Practices

- ✅ Use universal macros (`site: "*"`) for maximum reusability
- ✅ Validate all required parameters
- ✅ Return consistent object structures
- ✅ Include error handling in macro code
- ✅ Document all parameters and return values
- ✅ Test on multiple websites
- ✅ Use descriptive names and tags
- ✅ Mark reliability accurately

## 🔗 Related Documentation

- [Extension Design](../EXTENSION_DESIGN.md)
- [Tools Reference](../TOOLS_REFERENCE.md)
- [Testing Guide](../TEST_EXECUTION_GUIDE.md)
