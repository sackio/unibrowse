#!/usr/bin/env node

const { MongoClient } = require('mongodb');

async function fixMacro() {
  const client = new MongoClient('mongodb://localhost:27017');

  try {
    await client.connect();
    const db = client.db('browser_mcp');
    const macros = db.collection('macros');

    // Get current macro code and fix the selector
    const macro = await macros.findOne({ name: 'amazon_get_related_products' });

    // Replace invalid :has-text() selectors with null
    const fixedCode = macro.code.replace(
      /const deliveryElement = productEl\.querySelector\('\[data-csa-c-delivery-price\], \.a-color-secondary:has-text\("delivery"\), \.a-size-base:has-text\("delivery"\)'\);/g,
      `const deliveryElement = productEl.querySelector('[data-csa-c-delivery-price]');`
    );

    // Increment version
    const [major, minor, patch] = macro.version.split('.').map(Number);
    const newVersion = `${major}.${minor}.${patch + 1}`;

    await macros.updateOne(
      { name: 'amazon_get_related_products' },
      {
        $set: {
          code: fixedCode,
          version: newVersion,
          updatedAt: new Date()
        }
      }
    );

    console.log('✅ Fixed invalid CSS selector');
    console.log('New version:', newVersion);

  } finally {
    await client.close();
  }
}

fixMacro().catch(console.error);
