#!/usr/bin/env node

/**
 * Backup Unibrowse Macros Collection
 * Exports macros to JSON and creates BSON backup
 */

const { MongoClient } = require('mongodb');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

// Configuration
const BACKUP_DIR = '/mnt/backup/unibrowse-macros';
const MONGO_URI = 'mongodb://localhost:27018';
const DB_NAME = 'unibrowse';
const COLLECTION_NAME = 'macros';
const DATE = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

async function backupMacros() {
  // Create backup directory
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const backupPath = path.join(BACKUP_DIR, DATE);
  fs.mkdirSync(backupPath, { recursive: true });

  console.log('Starting macros backup...');
  console.log(`Date: ${new Date().toLocaleString()}`);
  console.log(`Backup location: ${backupPath}`);
  console.log('');

  // Connect to MongoDB
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const macros = db.collection(COLLECTION_NAME);

    // Get all macros
    const allMacros = await macros.find({}).toArray();
    console.log(`Found ${allMacros.length} macros to backup`);

    // Export to JSON
    const jsonPath = path.join(backupPath, 'macros.json');
    fs.writeFileSync(jsonPath, JSON.stringify(allMacros, null, 2));
    console.log(`✓ Exported to JSON: ${jsonPath}`);

    // Export by site
    const sites = [...new Set(allMacros.map(m => m.site))];
    for (const site of sites) {
      const siteMacros = allMacros.filter(m => m.site === site);
      const sitePath = path.join(backupPath, `macros-${site.replace(/\./g, '-')}.json`);
      fs.writeFileSync(sitePath, JSON.stringify(siteMacros, null, 2));
      console.log(`✓ Exported ${site}: ${siteMacros.length} macros`);
    }

    // Create BSON backup using mongodump
    console.log('');
    console.log('Creating BSON backup...');
    try {
      execSync(`${process.env.HOME}/code/scripts/mongodump --uri="${MONGO_URI}" --db="${DB_NAME}" --collection="${COLLECTION_NAME}" --out="${backupPath}/bson"`, {
        stdio: 'inherit'
      });
      console.log('✓ BSON backup created');
    } catch (error) {
      console.log('⚠ BSON backup failed (non-critical)');
    }

    // Compress backup
    console.log('');
    console.log('Compressing backup...');
    execSync(`tar -czf "${backupPath}.tar.gz" -C "${BACKUP_DIR}" "${DATE}"`, {
      stdio: 'inherit'
    });

    // Remove uncompressed backup
    execSync(`rm -rf "${backupPath}"`, { stdio: 'inherit' });

    // Get backup size
    const stats = fs.statSync(`${backupPath}.tar.gz`);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

    console.log('');
    console.log('✓ Backup completed successfully!');
    console.log(`  File: ${backupPath}.tar.gz`);
    console.log(`  Size: ${sizeMB} MB`);
    console.log(`  Macros backed up: ${allMacros.length}`);
    console.log('');

    // Summary by site
    console.log('Macros by site:');
    for (const site of sites.sort()) {
      const count = allMacros.filter(m => m.site === site).length;
      console.log(`  - ${site}: ${count} macros`);
    }
    console.log('');

    // List recent backups
    console.log('Recent backups:');
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.tar.gz'))
      .map(f => {
        const stats = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, mtime: stats.mtime, size: stats.size };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 5);

    files.forEach(f => {
      const sizeMB = (f.size / 1024 / 1024).toFixed(2);
      const date = f.mtime.toLocaleString();
      console.log(`  ${f.name} (${sizeMB} MB) - ${date}`);
    });

  } finally {
    await client.close();
  }
}

// Run if executed directly
if (require.main === module) {
  backupMacros().catch(error => {
    console.error('❌ Backup failed:', error.message);
    process.exit(1);
  });
}

module.exports = backupMacros;
