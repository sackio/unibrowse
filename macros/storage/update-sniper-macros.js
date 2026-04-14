#!/usr/bin/env node
/**
 * Direct MongoDB update for eBay Sniper Macros
 */

import { MongoClient } from 'mongodb';
import { ebaySniperMacros } from '../ebay-sniper-macros.js';

async function updateMacros() {
  const client = await MongoClient.connect('mongodb://localhost:27018');
  const db = client.db('unibrowse');
  const collection = db.collection('macros');

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  UPDATING EBAY SNIPER MACROS');
  console.log(`  Total macros to update: ${ebaySniperMacros.length}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  let updated = 0;
  let failed = 0;

  for (const macro of ebaySniperMacros) {
    process.stdout.write(`Updating: ${macro.name.padEnd(40)}... `);

    try {
      const result = await collection.updateOne(
        { site: macro.site, name: macro.name },
        {
          $set: {
            code: macro.code,
            description: macro.description,
            parameters: macro.parameters,
            returnType: macro.returnType,
            reliability: macro.reliability,
            tags: macro.tags,
            updatedAt: new Date(),
            version: '1.0.1'
          }
        }
      );

      if (result.modifiedCount > 0) {
        console.log('✓ UPDATED');
        updated++;
      } else if (result.matchedCount > 0) {
        console.log('✓ NO CHANGES (already up to date)');
        updated++;
      } else {
        console.log('✗ NOT FOUND');
        failed++;
      }
    } catch (error) {
      console.log('✗ ERROR:', error.message);
      failed++;
    }
  }

  await client.close();

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Macros updated:         ${updated}`);
  console.log(`  Failed:                 ${failed}`);
  console.log(`  Total processed:        ${ebaySniperMacros.length}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

updateMacros().catch(error => {
  console.error('\n✗ Fatal error:', error.message);
  process.exit(1);
});
