# CDN Library Injection Macros

Comprehensive collection of 4 macros for safely injecting and managing external JavaScript libraries from CDNs, with support for popular libraries and batch loading.

## 📦 Storage Status

✅ **All 4 macros are stored in the MongoDB database**

To re-store or update macros:
```bash
npm run store:macros
```

## 🧪 Testing

Run the comprehensive test suite:
```bash
npm run test:cdn-injection-macros
```

This tests library detection, injection, and batch loading with timeout handling.

## 📚 Macro Catalog

### Tier 1: Essential CDN Operations (2)

Core macros for detecting and injecting individual libraries.

#### 1. `check_library_loaded`
**Category:** util
**Reliability:** high
**Description:** Check if a JavaScript library is already loaded on the page by testing window globals

**Parameters:**
- `library` (string, required): Library name to check (e.g., "jQuery", "html2canvas", "lodash", "_", "$")

**Returns:** Object with success flag, library name, loaded status, list of all available libraries, and first 50 window keys

**Use case:** Prevent duplicate library injection, detect existing libraries before automation, verify library load success.

**Common libraries detected:**
- jQuery (checks both `jQuery` and `$`)
- Lodash (checks both `lodash` and `_`)
- html2canvas
- moment
- axios
- d3
- Chart.js
- Any custom library by global name

**Window keys:** Returns first 50 function/object keys on window for debugging and discovery

---

#### 2. `inject_cdn_library`
**Category:** util
**Reliability:** high
**Description:** Inject a single JavaScript library from CDN with promise-based loading, timeout handling, and polling

**Parameters:**
- `url` (string, required): CDN URL for the library (e.g., "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js")
- `libraryName` (string, required): Global variable name to check for load completion (e.g., "html2canvas")
- `timeout` (number, optional): Timeout in milliseconds (default: 10000)

**Returns:** Promise resolving to object with success flag, message, library name, URL, and load timestamp

**Use case:** Dynamically load libraries for page manipulation (html2canvas for screenshots, jQuery for DOM manipulation, etc.)

**Features:**
- Checks if library already loaded (skips injection)
- Checks if script tag already exists (skips duplicate)
- Creates script tag with async loading
- Polls for library availability (100ms intervals)
- Timeout protection (default 10 seconds)
- Error handling for network failures
- Returns load timestamp for debugging

**States returned:**
- Already loaded: Library exists on window
- Already exists: Script tag found in DOM
- Loaded successfully: Library injected and available
- Timeout: Library didn't load within timeout period
- Failed: Network error or CDN unavailable

---

### Tier 2: Batch and Preset Operations (2)

Advanced macros for loading multiple libraries and using preset configurations.

#### 3. `inject_cdn_libraries_batch`
**Category:** util
**Reliability:** high
**Description:** Inject multiple libraries from CDNs in sequence with dependency handling and error recovery

**Parameters:**
- `libraries` (array, required): Array of objects with `{url, libraryName}` for each library
- `timeout` (number, optional): Timeout per library in milliseconds (default: 10000)

**Returns:** Object with success flag (all loaded), total count, loaded count, skipped count, and results array with per-library status

**Use case:** Load multiple dependencies in order (e.g., jQuery before jQuery plugins), batch library injection for complex automation.

**Features:**
- Sequential loading (maintains dependency order)
- Skips already-loaded libraries
- Individual timeout per library
- Stops on first failure (prevents cascade errors)
- Returns detailed results for each library
- Counts loaded vs skipped libraries

**Example libraries array:**
```javascript
[
  { url: "https://code.jquery.com/jquery-3.7.1.min.js", libraryName: "jQuery" },
  { url: "https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js", libraryName: "_" },
  { url: "https://cdn.jsdelivr.net/npm/moment@2.30.1/moment.min.js", libraryName: "moment" }
]
```

**Results format:**
```javascript
{
  success: true,
  totalLibraries: 3,
  loadedCount: 2,
  skippedCount: 1,
  results: [
    { success: true, library: "jQuery", message: "Loaded successfully", url: "..." },
    { success: true, library: "_", message: "Already loaded", skipped: true },
    { success: true, library: "moment", message: "Loaded successfully", url: "..." }
  ],
  message: "All libraries loaded successfully"
}
```

---

#### 4. `inject_popular_library`
**Category:** util
**Reliability:** high
**Description:** Inject popular libraries using preset CDN URLs with automatic version selection

**Parameters:**
- `library` (string, required): Library name - "html2canvas", "jquery", "lodash", "moment", "axios", "d3", "chartjs"
- `version` (string, optional): Version string (default: "latest" uses recommended versions)

**Returns:** Promise resolving to object with success flag, message, library name, global name, URL, and detected version

**Use case:** Quick library injection without memorizing CDN URLs, standardized library versions across automation tasks.

**Supported libraries with latest versions:**

1. **html2canvas** (v1.4.1)
   - Global: `html2canvas`
   - Use: Screenshot generation
   - URL: https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js

2. **jQuery** (v3.7.1)
   - Global: `jQuery` (also `$`)
   - Use: DOM manipulation
   - URL: https://code.jquery.com/jquery-3.7.1.min.js

3. **Lodash** (v4.17.21)
   - Global: `_`
   - Use: Utility functions
   - URL: https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js

4. **Moment.js** (v2.30.1)
   - Global: `moment`
   - Use: Date/time manipulation
   - URL: https://cdn.jsdelivr.net/npm/moment@2.30.1/moment.min.js

5. **Axios** (v1.7.9)
   - Global: `axios`
   - Use: HTTP requests
   - URL: https://cdn.jsdelivr.net/npm/axios@1.7.9/dist/axios.min.js

6. **D3.js** (v7)
   - Global: `d3`
   - Use: Data visualization
   - URL: https://d3js.org/d3.v7.min.js

7. **Chart.js** (v4.4.7)
   - Global: `Chart`
   - Use: Charts and graphs
   - URL: https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js

**Features:**
- Preset URLs for popular libraries
- Automatic version selection (latest recommended)
- Custom version support (pass version string)
- Checks if already loaded before injection
- 10-second timeout per library
- Polls for library availability
- Detects library version if available
- Returns error with available library list if unknown

---

## 🎯 Usage Examples

### Example 1: Check Before Injection
```javascript
// Check if jQuery is already loaded
const check = await browser_execute_macro({
  id: "macro-id-for-check_library_loaded",
  params: { library: "jQuery" }
});
// Result: {
//   success: true,
//   library: "jQuery",
//   loaded: true,
//   available: ["jQuery", "$", "document", "window", ...],
//   windowKeys: ["jQuery", "$", "alert", "console", ...]
// }

// If not loaded, inject it
if (!check.loaded) {
  const inject = await browser_execute_macro({
    id: "macro-id-for-inject_popular_library",
    params: { library: "jquery" }
  });
}
```

### Example 2: Inject Single Library
```javascript
// Inject html2canvas for screenshot functionality
const result = await browser_execute_macro({
  id: "macro-id-for-inject_cdn_library",
  params: {
    url: "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js",
    libraryName: "html2canvas",
    timeout: 15000  // 15 seconds
  }
});
// Result: {
//   success: true,
//   message: "Library loaded successfully",
//   library: "html2canvas",
//   url: "https://...",
//   loadedAt: "2025-12-10T14:30:00.000Z"
// }
```

### Example 3: Popular Library with Default Version
```javascript
// Inject jQuery using preset
const jquery = await browser_execute_macro({
  id: "macro-id-for-inject_popular_library",
  params: { library: "jquery" }  // Uses v3.7.1
});
// Result: {
//   success: true,
//   message: "Library loaded successfully",
//   library: "jquery",
//   globalName: "jQuery",
//   url: "https://code.jquery.com/jquery-3.7.1.min.js",
//   version: "3.7.1"
// }

// Inject specific version
const jqueryOld = await browser_execute_macro({
  id: "macro-id-for-inject_popular_library",
  params: { library: "jquery", version: "3.6.0" }
});
```

### Example 4: Batch Library Injection
```javascript
// Load multiple libraries in order
const batch = await browser_execute_macro({
  id: "macro-id-for-inject_cdn_libraries_batch",
  params: {
    libraries: [
      {
        url: "https://code.jquery.com/jquery-3.7.1.min.js",
        libraryName: "jQuery"
      },
      {
        url: "https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js",
        libraryName: "_"
      },
      {
        url: "https://cdn.jsdelivr.net/npm/moment@2.30.1/moment.min.js",
        libraryName: "moment"
      }
    ],
    timeout: 10000
  }
});
// Result: {
//   success: true,
//   totalLibraries: 3,
//   loadedCount: 3,
//   skippedCount: 0,
//   results: [
//     { success: true, library: "jQuery", message: "Loaded successfully", url: "..." },
//     { success: true, library: "_", message: "Loaded successfully", url: "..." },
//     { success: true, library: "moment", message: "Loaded successfully", url: "..." }
//   ],
//   message: "All libraries loaded successfully"
// }
```

### Example 5: Complete Workflow - Screenshot Generation
```javascript
// 1. Check if html2canvas is loaded
const check = await browser_execute_macro({
  id: "macro-id-for-check_library_loaded",
  params: { library: "html2canvas" }
});

// 2. Inject if needed
if (!check.loaded) {
  const inject = await browser_execute_macro({
    id: "macro-id-for-inject_popular_library",
    params: { library: "html2canvas" }
  });

  if (!inject.success) {
    throw new Error("Failed to load html2canvas: " + inject.error);
  }
}

// 3. Use the library via browser_evaluate
const screenshot = await browser_evaluate({
  expression: `
    (async () => {
      const canvas = await html2canvas(document.body);
      return canvas.toDataURL('image/png');
    })()
  `
});
```

### Example 6: Data Visualization Pipeline
```javascript
// Load d3.js and Chart.js for visualization
const viz = await browser_execute_macro({
  id: "macro-id-for-inject_cdn_libraries_batch",
  params: {
    libraries: [
      {
        url: "https://d3js.org/d3.v7.min.js",
        libraryName: "d3"
      },
      {
        url: "https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js",
        libraryName: "Chart"
      }
    ],
    timeout: 15000
  }
});

if (viz.success) {
  // Both libraries now available
  // Use d3 and Chart via browser_evaluate
}
```

### Example 7: Error Handling
```javascript
// Inject with error handling
const result = await browser_execute_macro({
  id: "macro-id-for-inject_cdn_library",
  params: {
    url: "https://cdn.example.com/nonexistent.js",
    libraryName: "NonExistent",
    timeout: 5000
  }
});

if (!result.success) {
  if (result.error === "Timeout waiting for library to load") {
    console.log("Library took too long to load");
  } else if (result.error === "Failed to load script from CDN") {
    console.log("Network error or invalid URL");
  }
}
```

### Example 8: Conditional Library Loading
```javascript
// Load jQuery only if not present, then load jQuery UI
const check = await browser_execute_macro({
  id: "macro-id-for-check_library_loaded",
  params: { library: "jQuery" }
});

const libraries = [];

// Add jQuery if needed
if (!check.loaded) {
  libraries.push({
    url: "https://code.jquery.com/jquery-3.7.1.min.js",
    libraryName: "jQuery"
  });
}

// Add jQuery UI (depends on jQuery)
libraries.push({
  url: "https://code.jquery.com/ui/1.13.2/jquery-ui.min.js",
  libraryName: "jQuery.ui"  // jQuery UI extends jQuery object
});

// Load all needed libraries
if (libraries.length > 0) {
  const batch = await browser_execute_macro({
    id: "macro-id-for-inject_cdn_libraries_batch",
    params: { libraries, timeout: 10000 }
  });
}
```

## 🔍 Finding Macro IDs

To get the macro ID for use in `browser_execute_macro`:

```javascript
// List all utility macros
const macros = await browser_list_macros({ site: "*", category: "util" });

// Find the macro you need
const targetMacro = macros.macros.find(m => m.name === "inject_popular_library");
const macroId = targetMacro.id;
```

## 📊 Library Categories

### Screenshot & Canvas
- html2canvas - Convert DOM elements to canvas/images

### DOM Manipulation
- jQuery - Classic DOM manipulation and AJAX
- Lodash - Functional utilities

### Date & Time
- Moment.js - Date/time parsing and manipulation

### HTTP & Networking
- Axios - Promise-based HTTP client

### Data Visualization
- D3.js - Data-driven documents
- Chart.js - Simple charts and graphs

## 🚀 Best Practices

1. **Always Check First**: Use `check_library_loaded` before injection to avoid duplicates
2. **Use Presets**: Prefer `inject_popular_library` for common libraries (simpler API)
3. **Batch Related Libraries**: Use `inject_cdn_libraries_batch` when loading multiple dependencies
4. **Respect Load Order**: Load dependencies in correct order (jQuery before jQuery plugins)
5. **Set Appropriate Timeouts**: Increase timeout for slow networks or large libraries
6. **Handle Errors**: Always check `success` flag and handle failures gracefully
7. **Version Pinning**: Use specific versions in production (avoid "latest" in critical automation)
8. **CDN Reliability**: Consider multiple CDN sources as fallbacks

## 🔄 Common Patterns

### Pattern 1: Conditional Injection
```javascript
const check = await check_library_loaded({ library: "jQuery" });
if (!check.loaded) {
  await inject_popular_library({ library: "jquery" });
}
// Use jQuery
```

### Pattern 2: Dependency Chain
```javascript
await inject_cdn_libraries_batch({
  libraries: [
    { url: "base-library.js", libraryName: "Base" },
    { url: "plugin-that-needs-base.js", libraryName: "Plugin" }
  ]
});
```

### Pattern 3: Error Recovery
```javascript
const result = await inject_cdn_library({
  url: "https://cdn1.example.com/lib.js",
  libraryName: "Lib"
});

if (!result.success) {
  // Try fallback CDN
  await inject_cdn_library({
    url: "https://cdn2.example.com/lib.js",
    libraryName: "Lib"
  });
}
```

### Pattern 4: Version Testing
```javascript
// Test with different versions
const versions = ["1.0.0", "2.0.0", "3.0.0"];
for (const version of versions) {
  const result = await inject_popular_library({
    library: "lodash",
    version: version
  });

  if (result.success) {
    // Run tests with this version
    break;
  }
}
```

## 🛠️ Development

All macros are defined in `cdn-injection-macros.js`.

To modify or add macros:
1. Edit `cdn-injection-macros.js`
2. Add new library presets to `inject_popular_library`
3. Run `npm run store:macros` to update the database
4. Run `npm run test:cdn-injection-macros` to verify functionality

## 📝 Technical Details

### Injection Mechanism
1. Create `<script>` tag dynamically
2. Set `src` to CDN URL
3. Set `async = true` (for batch: `async = false`)
4. Append to `document.head`
5. Poll window[libraryName] every 100ms
6. Timeout after specified duration
7. Trigger onerror for network failures

### Polling Strategy
- Interval: 100ms
- Default timeout: 10 seconds
- Checks: `typeof window[libraryName] !== 'undefined'`
- Cleanup: Clears interval and timeout on success/failure

### Error States
- **Timeout**: Library script loaded but global not found
- **Network Error**: Script failed to load from CDN
- **Already Loaded**: Global exists (success, skipped)
- **Already Exists**: Script tag exists (success, skipped)

### Promise Resolution
All injection macros return Promises that resolve (never reject):
- Success states resolve with `success: true`
- Error states resolve with `success: false` and `error` message
- This allows graceful error handling without try/catch

## 🔧 Troubleshooting

### Library Not Loading
1. Check CDN URL is accessible
2. Verify global name is correct (case-sensitive)
3. Increase timeout for slow networks
4. Check browser console for errors
5. Try alternative CDN source

### Library Loaded But Not Working
1. Check library version compatibility
2. Verify dependencies loaded first
3. Check for naming conflicts
4. Inspect library version with `check_library_loaded`

### Batch Loading Fails
1. Check which library failed (inspect results array)
2. Verify load order (dependencies first)
3. Test each library individually
4. Check for version conflicts

### Timeout Issues
1. Increase timeout parameter
2. Check network speed
3. Try smaller/minified versions
4. Use local CDN or mirrors

## 🎯 Quick Reference

### Detection
- `check_library_loaded` - Check if library exists on window

### Single Library
- `inject_cdn_library` - Inject any library with custom URL
- `inject_popular_library` - Inject preset library by name

### Multiple Libraries
- `inject_cdn_libraries_batch` - Inject multiple libraries in sequence

### Supported Presets
- html2canvas, jquery, lodash, moment, axios, d3, chartjs

### Default Timeout
- 10 seconds (10000ms)

### Polling Interval
- 100ms

### Load Strategy
- Single: async loading
- Batch: sequential loading (async=false)
