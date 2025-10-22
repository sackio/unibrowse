#!/usr/bin/env node

const { MongoClient } = require('mongodb');
const fs = require('fs');

async function getMacroCode() {
  const client = new MongoClient('mongodb://localhost:27017');

  try {
    await client.connect();
    const db = client.db('browser_mcp');
    const macros = db.collection('macros');

    const macro = await macros.findOne(
      { name: 'amazon_get_product_info' },
      { projection: { code: 1, _id: 0, name: 1, id: 1, version: 1 } }
    );

    if (macro) {
      const output = `=== ${macro.name} ===
ID: ${macro.id}
Version: ${macro.version}

=== CODE ===

${macro.code}
`;

      fs.writeFileSync('/tmp/amazon_get_product_info_macro.txt', output);
      console.log('✅ Macro code saved to /tmp/amazon_get_product_info_macro.txt');
    } else {
      console.log('Macro not found');
    }
  } finally {
    await client.close();
  }
}

getMacroCode().catch(console.error);
