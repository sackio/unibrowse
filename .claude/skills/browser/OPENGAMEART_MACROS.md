# 🤨 OpenGameArt Macros Reference

Complete reference for all 3 OpenGameArt-specific macros for asset search, extraction, and discovery.

## Table of Contents

1. [Overview](#overview)
2. [Search Macros (1)](#search-macros)
3. [Extraction Macros (2)](#extraction-macros)
4. [Complete Workflows](#complete-workflows)
5. [Best Practices](#best-practices)
6. [Troubleshooting](#troubleshooting)

---

## Overview

**OpenGameArt macros** are specialized JavaScript functions stored in MongoDB that automate OpenGameArt.org operations. They handle asset search, advanced filtering, asset details extraction, and media management for game development resources.

**Total OpenGameArt Macros**: 3
- **Search**: 1 macro
- **Extraction**: 2 macros

**Site**: `opengameart.org`

**Usage Pattern**:
```javascript
// 1. List available macros
const macros = await mcp__browser__browser_list_macros({ site: "opengameart.org" });

// 2. Execute macro
const result = await mcp__browser__browser_execute_macro({
  id: "search_assets",
  params: {
    tags: "sword, weapon",
    artTypes: ["2d", "3d"]
  },
  tabTarget: tabId
});

// 3. Use results
console.log("Search URL:", result.content.searchUrl);
```

---

## Search Macros

### `search_assets`

**Description**: Advanced search for OpenGameArt assets with filtering by tags, art type, and license

**Site**: `opengameart.org`

**Category**: search

**Parameters**:
- `tags` (string, optional): Comma-separated tags to search for (e.g., 'sword, weapon, item')
- `tagOperator` (string, optional): Tag search logic - "one_of" (OR), "all_of" (AND), "none_of" (NOT). Default: 'one_of'
- `artTypes` (array, optional): Array of art types from: "2d", "3d", "concept", "texture", "music", "sound", "document"
- `licenses` (array, optional): Array of license types (e.g., ["cc-by-3", "oga-by-3", "cc0", "gpl-3"])
- `sortBy` (string, optional): Sort order - "relevance", "date", "favorites". Default: 'relevance'
- `itemsPerPage` (number, optional): Results per page: 24, 48, 72, 96, 120, 144. Default: 48

**Returns**:
```javascript
{
  "success": true,
  "searchUrl": "https://opengameart.org/art-search-advanced?keys=sword&field_art_tags_tid_op=one_of&sort_by=search_api_relevance&items_per_page=48",
  "params": {
    "tags": "sword",
    "tagOperator": "one_of",
    "artTypes": [],
    "licenses": [],
    "sortBy": "relevance",
    "itemsPerPage": 48
  }
}
```

**Example**:
```javascript
// Search for sword assets in 2D and 3D
const result = await mcp__browser__browser_execute_macro({
  id: "search_assets",
  params: {
    tags: "sword, weapon, medieval",
    tagOperator: "all_of",
    artTypes: ["2d", "3d"],
    sortBy: "favorites",
    itemsPerPage: 72
  },
  tabTarget: tabId
});

console.log("Searching:", result.content.searchUrl);

// Then extract results from the search page
await mcp__browser__browser_navigate({
  url: result.content.searchUrl,
  tabTarget: tabId
});

// Wait for results to load
await new Promise(resolve => setTimeout(resolve, 2000));

// Extract found assets
const assets = await mcp__browser__browser_execute_macro({
  id: "extract_asset_list",
  params: { limit: 24 },
  tabTarget: tabId
});
```

**Use Cases**:
- Search for game assets by tags and type
- Find CC0 or openly-licensed assets
- Discover 2D/3D assets by category
- Research available game resources
- Filter by specific license requirements

**Search Tips**:
- `one_of` (OR): Returns assets matching ANY tag - broader results
- `all_of` (AND): Returns assets matching ALL tags - narrower results
- `none_of` (NOT): Excludes assets with specified tags

**Available Licenses**:
- `cc-by-3` - Creative Commons Attribution 3.0
- `oga-by-3` - OGA-BY 3.0 (OpenGameArt.org)
- `cc0` - CC0 1.0 Universal (public domain)
- `gpl-3` - GNU General Public License v3
- `cc-by-sa-3` - Creative Commons Attribution Share-Alike 3.0

**Notes**:
- Navigates to advanced search results page
- Creates filtered search URL
- Results depend on page structure and available filters
- Must extract assets from results page after navigation

---

## Extraction Macros

### `extract_asset_list`

**Description**: Extract asset details from search results or browse pages

**Site**: `opengameart.org`

**Category**: extraction

**Parameters**:
- `limit` (number, optional): Maximum number of assets to extract (default: 24)

**Returns**:
```javascript
{
  "success": true,
  "count": 12,
  "totalFound": 45,
  "assets": [
    {
      "title": "Medieval Sword",
      "url": "https://opengameart.org/content/medieval-sword",
      "previewImage": "https://opengameart.org/sites/default/files/sword.png",
      "previewAlt": "Medieval Sword preview",
      "author": "ArtistName",
      "authorUrl": "https://opengameart.org/users/artistname",
      "licenses": ["CC-BY 3.0"],
      "tags": ["weapon", "sword", "medieval", "2d"],
      "id": "medieval-sword"
    },
    {
      "title": "3D Treasure Chest",
      "url": "https://opengameart.org/content/3d-treasure-chest",
      "previewImage": "https://opengameart.org/sites/default/files/chest.jpg",
      "previewAlt": "3D Treasure Chest",
      "author": "Creator123",
      "authorUrl": "https://opengameart.org/users/creator123",
      "licenses": ["OGA-BY 3.0"],
      "tags": ["3d", "prop", "treasure", "game-ready"],
      "id": "3d-treasure-chest"
    }
  ],
  "truncated": true
}
```

**Example**:
```javascript
// Search for sword assets
await mcp__browser__browser_execute_macro({
  id: "search_assets",
  params: {
    tags: "sword",
    artTypes: ["2d"],
    sortBy: "favorites"
  },
  tabTarget: tabId
});

// Wait for page to load
await new Promise(resolve => setTimeout(resolve, 2000));

// Extract visible assets
const assets = await mcp__browser__browser_execute_macro({
  id: "extract_asset_list",
  params: { limit: 48 },
  tabTarget: tabId
});

console.log(`Found ${assets.content.count} assets`);

// Process each asset
assets.content.assets.forEach(asset => {
  console.log(`${asset.title} by ${asset.author}`);
  console.log(`Licenses: ${asset.licenses.join(", ")}`);
  console.log(`URL: ${asset.url}`);
});

// Check if more assets available
if (assets.content.truncated) {
  console.log(`${assets.content.totalFound - assets.content.count} more assets available`);
}
```

**Use Cases**:
- Browse and collect game assets
- Analyze available resources by category
- Find assets by specific creators
- Research asset licensing
- Build asset collections for projects

**Extracted Fields**:
- **title**: Asset name
- **url**: Direct link to asset page
- **previewImage**: Thumbnail for preview
- **author**: Creator's name
- **authorUrl**: Link to creator's profile
- **licenses**: Array of applicable licenses
- **tags**: Categorization tags
- **id**: Unique asset identifier

**Notes**:
- Extracts preview data from list view
- Preview images are usually thumbnails
- Full licenses and details available on asset page
- Tags help categorize and filter results
- Download links available on full asset page

---

### `extract_asset_details`

**Description**: Extract complete details from an individual asset page

**Site**: `opengameart.org`

**Category**: extraction

**Parameters**: None

**Returns**:
```javascript
{
  "success": true,
  "title": "Medieval Sword",
  "author": "ArtistName",
  "authorUrl": "https://opengameart.org/users/artistname",
  "description": "A detailed medieval sword suitable for 2D games. Includes multiple animations...",
  "licenses": ["CC-BY 3.0"],
  "tags": ["weapon", "sword", "medieval", "2d", "pixel-art"],
  "artType": "2D",
  "files": [
    {
      "name": "sword.png",
      "url": "https://opengameart.org/sites/default/files/sword.png",
      "size": "2.4 MB"
    },
    {
      "name": "sword-spritesheet.png",
      "url": "https://opengameart.org/sites/default/files/sword-spritesheet.png",
      "size": "1.8 MB"
    }
  ],
  "previewImages": [
    {
      "url": "https://opengameart.org/sites/default/files/sword-preview1.png",
      "alt": "Sword in-game view"
    },
    {
      "url": "https://opengameart.org/sites/default/files/sword-preview2.png",
      "alt": "Sword detail"
    }
  ],
  "favorites": 42,
  "downloads": 3250,
  "submittedDate": "Nov 15, 2023",
  "url": "https://opengameart.org/content/medieval-sword"
}
```

**Example**:
```javascript
// Navigate to asset page
await mcp__browser__browser_navigate({
  url: "https://opengameart.org/content/medieval-sword",
  tabTarget: tabId
});

// Extract full details
const details = await mcp__browser__browser_execute_macro({
  id: "extract_asset_details",
  tabTarget: tabId
});

console.log(`Asset: ${details.content.title}`);
console.log(`By: ${details.content.author}`);
console.log(`Description: ${details.content.description.substring(0, 100)}...`);

// List available downloads
console.log(`\nDownloads available:`);
details.content.files.forEach(file => {
  console.log(`- ${file.name} (${file.size})`);
  console.log(`  URL: ${file.url}`);
});

// Check licensing
console.log(`\nLicenses: ${details.content.licenses.join(", ")}`);

// Get preview images
console.log(`\nPreview images: ${details.content.previewImages.length}`);
details.content.previewImages.forEach(img => {
  console.log(`- ${img.alt}`);
  console.log(`  ${img.url}`);
});

// Check popularity
console.log(`\nPopularity:`);
console.log(`Favorites: ${details.content.favorites}`);
console.log(`Downloads: ${details.content.downloads}`);
```

**Use Cases**:
- Download game assets for projects
- Verify license compatibility
- Check asset quality and reviews
- Read asset descriptions
- Access download links
- Research asset creation date and creator

**Full Extraction Includes**:
- Complete asset description
- All applicable licenses
- All downloadable files with direct URLs
- File sizes
- Multiple preview images
- Popularity metrics (favorites, downloads)
- Author information and profile link
- Tags and categorization
- Submission date

**Notes**:
- Requires navigating to individual asset page
- Extracts all downloadable files
- Shows complete license information
- Includes asset popularity metrics
- Full file download URLs provided

---

## Complete Workflows

### Workflow 1: Find and Download Assets for Game Development

```javascript
// Step 1: Search for specific asset type
const search = await mcp__browser__browser_execute_macro({
  id: "search_assets",
  params: {
    tags: "sword, weapon, medieval",
    artTypes: ["2d"],
    sortBy: "favorites",
    itemsPerPage: 48
  },
  tabTarget: tabId
});

// Step 2: Navigate to search results
await mcp__browser__browser_navigate({
  url: search.content.searchUrl,
  tabTarget: tabId
});

// Wait for results
await new Promise(resolve => setTimeout(resolve, 2000));

// Step 3: Extract asset list
const assets = await mcp__browser__browser_execute_macro({
  id: "extract_asset_list",
  params: { limit: 24 },
  tabTarget: tabId
});

// Step 4: Download details from top asset
const topAsset = assets.content.assets[0];
await mcp__browser__browser_navigate({
  url: topAsset.url,
  tabTarget: tabId
});

// Wait for page load
await new Promise(resolve => setTimeout(resolve, 1500));

// Step 5: Extract full details
const details = await mcp__browser__browser_execute_macro({
  id: "extract_asset_details",
  tabTarget: tabId
});

// Step 6: Review and download
console.log("Asset found:", details.content.title);
console.log("License:", details.content.licenses[0]);
console.log("Downloads available:");
details.content.files.forEach(file => {
  console.log(`- ${file.name}: ${file.url}`);
});
```

### Workflow 2: Research and Compare Multiple Assets

```javascript
// Step 1: Search for category
const search = await mcp__browser__browser_execute_macro({
  id: "search_assets",
  params: {
    tags: "treasure chest",
    artTypes: ["3d"],
    sortBy: "favorites",
    itemsPerPage: 72
  },
  tabTarget: tabId
});

// Step 2: Navigate to results
await mcp__browser__browser_navigate({
  url: search.content.searchUrl,
  tabTarget: tabId
});

await new Promise(resolve => setTimeout(resolve, 2000));

// Step 3: Extract asset list
const assets = await mcp__browser__browser_execute_macro({
  id: "extract_asset_list",
  params: { limit: 72 },
  tabTarget: tabId
});

// Step 4: Extract details from top 3 assets
const topAssets = [];
for (const asset of assets.content.assets.slice(0, 3)) {
  await mcp__browser__browser_navigate({
    url: asset.url,
    tabTarget: tabId
  });

  await new Promise(resolve => setTimeout(resolve, 1500));

  const details = await mcp__browser__browser_execute_macro({
    id: "extract_asset_details",
    tabTarget: tabId
  });

  topAssets.push({
    basic: asset,
    full: details.content
  });
}

// Step 5: Compare assets
console.log("Asset Comparison:");
topAssets.forEach(a => {
  console.log(`\n${a.full.title}`);
  console.log(`By: ${a.full.author}`);
  console.log(`License: ${a.full.licenses[0]}`);
  console.log(`Files: ${a.full.files.length}`);
  console.log(`Downloads: ${a.full.downloads}`);
  console.log(`Favorites: ${a.full.favorites}`);
});
```

### Workflow 3: Find CC0 Assets Only

```javascript
// Step 1: Search specifically for CC0 licensed assets
const search = await mcp__browser__browser_execute_macro({
  id: "search_assets",
  params: {
    tags: "game-ready",
    licenses: ["cc0"],
    sortBy: "date",
    itemsPerPage: 48
  },
  tabTarget: tabId
});

// Step 2: Navigate to results
await mcp__browser__browser_navigate({
  url: search.content.searchUrl,
  tabTarget: tabId
});

await new Promise(resolve => setTimeout(resolve, 2000));

// Step 3: Extract all CC0 assets
const assets = await mcp__browser__browser_execute_macro({
  id: "extract_asset_list",
  params: { limit: 48 },
  tabTarget: tabId
});

// Step 4: Filter for CC0 only
const cc0Assets = assets.content.assets.filter(a =>
  a.licenses.some(l => l.includes("CC0") || l.includes("cc0"))
);

console.log(`Found ${cc0Assets.length} CC0 assets`);

// Step 5: Extract details for each CC0 asset
const cc0Details = [];
for (const asset of cc0Assets.slice(0, 5)) {
  await mcp__browser__browser_navigate({
    url: asset.url,
    tabTarget: tabId
  });

  await new Promise(resolve => setTimeout(resolve, 1000));

  const details = await mcp__browser__browser_execute_macro({
    id: "extract_asset_details",
    tabTarget: tabId
  });

  cc0Details.push(details.content);
}

// Step 6: Create inventory
console.log("CC0 Asset Inventory:");
cc0Details.forEach(asset => {
  console.log(`\n${asset.title}`);
  console.log(`  Author: ${asset.author}`);
  console.log(`  Type: ${asset.artType}`);
  console.log(`  Files: ${asset.files.map(f => f.name).join(", ")}`);
});
```

---

## Best Practices

### 1. Always Use Advanced Search

Use the search macro with specific filters for better results:

```javascript
// ✅ Good: Specific search with filters
const result = await mcp__browser__browser_execute_macro({
  id: "search_assets",
  params: {
    tags: "sword",
    artTypes: ["2d"],
    licenses: ["cc0"],
    sortBy: "favorites"
  }
});

// ❌ Bad: Generic search
const result = await mcp__browser__browser_execute_macro({
  id: "search_assets",
  params: {
    tags: "asset"
  }
});
```

### 2. Extract List Before Opening Individual Assets

Always extract the asset list first to see all options:

```javascript
// ✅ Good: List first, then open details
const list = await mcp__browser__browser_execute_macro({
  id: "extract_asset_list",
  params: { limit: 24 }
});

const chosen = list.content.assets[0];
await mcp__browser__browser_navigate({ url: chosen.url });

const details = await mcp__browser__browser_execute_macro({
  id: "extract_asset_details"
});

// ❌ Bad: Open first asset without reviewing list
const details = await mcp__browser__browser_execute_macro({
  id: "extract_asset_details"
});
```

### 3. Verify License Compatibility

Always check licenses before using assets:

```javascript
// ✅ Good: Verify license
const details = await mcp__browser__browser_execute_macro({
  id: "extract_asset_details"
});

if (details.content.licenses.includes("CC0")) {
  console.log("Public domain - can use freely");
} else if (details.content.licenses.includes("CC-BY")) {
  console.log("Requires attribution");
} else {
  console.log("Check license:", details.content.licenses);
}
```

### 4. Use Tag Operators Wisely

Choose the right tag operator for your search:

```javascript
// ✅ one_of (OR) - Broader results
// Returns assets tagged with "sword" OR "weapon" OR "medieval"
await mcp__browser__browser_execute_macro({
  id: "search_assets",
  params: {
    tags: "sword, weapon, medieval",
    tagOperator: "one_of"  // OR logic
  }
});

// ✅ all_of (AND) - Narrower results
// Returns assets tagged with "sword" AND "weapon" AND "medieval"
await mcp__browser__browser_execute_macro({
  id: "search_assets",
  params: {
    tags: "sword, weapon, medieval",
    tagOperator: "all_of"  // AND logic
  }
});
```

### 5. Sort by Relevance for Quality

Sort by relevance or favorites to find quality assets:

```javascript
// ✅ Good: Sort by relevance or favorites
const result = await mcp__browser__browser_execute_macro({
  id: "search_assets",
  params: {
    tags: "sword",
    sortBy: "favorites"  // Popular = usually good
  }
});

// Sort by date for newest additions
const result = await mcp__browser__browser_execute_macro({
  id: "search_assets",
  params: {
    tags: "sword",
    sortBy: "date"  // Latest uploads
  }
});
```

---

## Troubleshooting

### Issue: Search Returns No Results

**Cause**: Tag doesn't exist or filtering is too restrictive

**Solution**:
```javascript
// Try simpler tags
const result = await mcp__browser__browser_execute_macro({
  id: "search_assets",
  params: {
    tags: "weapon",
    tagOperator: "one_of"  // Use OR for broader search
  }
});

// Or remove art type filter
const result = await mcp__browser__browser_execute_macro({
  id: "search_assets",
  params: {
    tags: "sword"
    // No artTypes specified - search all types
  }
});
```

### Issue: Extract Asset List Returns Nothing

**Cause**: Page not fully loaded or different page structure

**Solution**:
```javascript
// Wait longer for page load
await new Promise(resolve => setTimeout(resolve, 3000));

// Then extract
const assets = await mcp__browser__browser_execute_macro({
  id: "extract_asset_list",
  params: { limit: 24 }
});

if (assets.content.count === 0) {
  console.log("Try different search or verify page structure");
}
```

### Issue: Extract Asset Details Returns Missing Data

**Cause**: Asset page structure varies or page not fully loaded

**Solution**:
```javascript
// Ensure asset page is loaded
await new Promise(resolve => setTimeout(resolve, 2000));

// Then extract
const details = await mcp__browser__browser_execute_macro({
  id: "extract_asset_details"
});

// Check what was extracted
if (!details.content.success) {
  console.log("Asset details could not be extracted fully");
  console.log("Try accessing directly:", details.content.url);
}
```

### Issue: License Information Incomplete

**Cause**: License field not visible in current view

**Solution**:
```javascript
// Navigate directly to asset page
await mcp__browser__browser_navigate({
  url: "https://opengameart.org/content/asset-name"
});

// Wait and extract
await new Promise(resolve => setTimeout(resolve, 2000));

const details = await mcp__browser__browser_execute_macro({
  id: "extract_asset_details"
});

// Licenses should be in details
console.log("Licenses:", details.content.licenses);
```

---

## Related Documentation

- **[MACROS.md](./MACROS.md)** - Complete macro reference (57+ macros)
- **[UPWORK_MACROS.md](./UPWORK_MACROS.md)** - Upwork-specific macros
- **[FIDELITY_MACROS.md](./FIDELITY_MACROS.md)** - Fidelity-specific macros
- **[MULTI_TAB.md](./MULTI_TAB.md)** - Multi-tab workflow patterns
- **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** - Comprehensive troubleshooting guide

---

**Built with 🤨 by the Unibrowse team**
