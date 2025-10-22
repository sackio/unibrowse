#!/usr/bin/env node

const { MongoClient } = require('mongodb');

async function getMacroCode() {
  const client = new MongoClient('mongodb://localhost:27017');

  try {
    await client.connect();
    const db = client.db('browser_mcp');
    const macros = db.collection('macros');

    const macro = await macros.findOne(
      { name: 'amazon_get_product_info' },
      { projection: { code: 1, _id: 0, parameters: 1, returnType: 1, name: 1, id: 1, version: 1 } }
    );

    if (macro) {
      console.log('=== MACRO:', macro.name, '===');
      console.log('ID:', macro.id);
      console.log('Version:', macro.version);
      console.log('\nPARAMETERS:');
      console.log(JSON.stringify(macro.parameters, null, 2));
      console.log('\nRETURN TYPE:');
      console.log(macro.returnType);
      console.log('\n=== CODE (first 500 chars) ===\n');
      console.log(macro.code.substring(0, 500));
      console.log('\n...[truncated]...\n');
      console.log('\n============\n');
    } else {
      console.log('Macro not found');
    }
  } finally {
    await client.close();
  }
}

getMacroCode().catch(console.error);
