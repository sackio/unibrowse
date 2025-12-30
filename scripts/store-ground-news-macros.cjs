#!/usr/bin/env node

/**
 * Store Ground.News Macros in MongoDB
 * Loads Ground.News macro definitions and stores them in the unibrowse database
 */

const { MongoClient } = require('mongodb');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// MongoDB connection
const MONGO_URL = 'mongodb://localhost:27018';
const DB_NAME = 'unibrowse';
const COLLECTION_NAME = 'macros';

async function storeMacros() {
  const client = new MongoClient(MONGO_URL);

  try {
    console.log('Connecting to MongoDB...');
    await client.connect();
    console.log('Connected successfully');

    const db = client.db(DB_NAME);
    const macros = db.collection(COLLECTION_NAME);

    // Load macro definitions
    const macroDefinitionsPath = path.join(__dirname, 'ground-news-macros-definitions.cjs');
    const groundNewsMacros = require(macroDefinitionsPath);

    console.log(`\nLoading ${groundNewsMacros.length} Ground.News macros...`);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const macroDef of groundNewsMacros) {
      // Check if macro already exists
      const existing = await macros.findOne({
        site: macroDef.site,
        name: macroDef.name
      });

      if (existing) {
        // Check if code has changed
        if (existing.code === macroDef.code) {
          console.log(`  ⏭  Skipping (no changes): ${macroDef.name}`);
          skipped++;
          continue;
        }

        // Update existing macro
        console.log(`  ✏️  Updating: ${macroDef.name}`);

        // Increment version
        const versionParts = (existing.version || '1.0.0').split('.');
        versionParts[2] = parseInt(versionParts[2]) + 1;
        const newVersion = versionParts.join('.');

        await macros.updateOne(
          { id: existing.id },
          {
            $set: {
              ...macroDef,
              version: newVersion,
              updatedAt: new Date(),
              lastVerified: new Date()
            }
          }
        );
        updated++;
      } else {
        // Create new macro
        console.log(`  ✨ Creating: ${macroDef.name}`);

        const macroDoc = {
          id: uuidv4(),
          ...macroDef,
          version: '1.0.0',
          createdAt: new Date(),
          updatedAt: new Date(),
          lastVerified: new Date(),
          usageCount: 0,
          successRate: 0
        };

        await macros.insertOne(macroDoc);
        created++;
      }
    }

    console.log('\n📊 Summary:');
    console.log(`  ✨ Created: ${created}`);
    console.log(`  ✏️  Updated: ${updated}`);
    console.log(`  ⏭  Skipped: ${skipped}`);
    console.log(`  📦 Total: ${groundNewsMacros.length}`);

    // List all Ground.News macros
    console.log('\n📋 Ground.News Macros in Database:');
    const allGroundNewsMacros = await macros.find({ site: 'ground.news' }).sort({ name: 1 }).toArray();
    for (const macro of allGroundNewsMacros) {
      console.log(`  - ${macro.name} (v${macro.version}) [${macro.category}]`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\n✅ Done!');
  }
}

// Run if executed directly
if (require.main === module) {
  storeMacros().catch(console.error);
}

module.exports = storeMacros;
