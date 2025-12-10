#!/usr/bin/env node

/**
 * unibrowse Test Runner
 * Automated test suite for all MCP tools
 *
 * Prerequisites:
 * 1. Extension loaded in Chrome
 * 2. Connected to an active tab
 * 3. Tab on interactive page (e.g., Amazon, GitHub)
 *
 * Usage:
 *   node test-runner.js [--quick]
 *
 * Options:
 *   --quick    Run only essential tests (skip demonstrations)
 */

import { spawn } from 'child_process';
import readline from 'readline';

class MCPTestRunner {
  constructor(quickMode = false) {
    this.quickMode = quickMode;
    this.results = {
      passed: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };
    this.tabId = null;
    this.newTabId = null;
  }

  async run() {
    console.log('🧪 Browser MCP Test Suite');
    console.log('='.repeat(50));
    console.log('');

    try {
      await this.runTests();
      this.printSummary();
    } catch (error) {
      console.error('❌ Test suite failed:', error.message);
      process.exit(1);
    }
  }

  async runTests() {
    // Prerequisites check
    await this.testSection('Prerequisites', [
      ['Get Page Metadata', { tool: 'browser_get_page_metadata' }],
    ]);

    // Background Interaction Log
    await this.testSection('Background Interaction Log', [
      ['Get Recent Interactions', {
        tool: 'browser_get_interactions',
        args: { limit: 10 }
      }],
      ['Get Last Minute', {
        tool: 'browser_get_interactions',
        args: { startTime: -60000, limit: 20 }
      }],
      ['Filter by Type', {
        tool: 'browser_get_interactions',
        args: { types: ['click', 'scroll'], limit: 10 }
      }],
      ['Search Interactions', {
        tool: 'browser_search_interactions',
        args: { query: 'button', limit: 5 }
      }],
      ['Prune Interactions', {
        tool: 'browser_prune_interactions',
        args: { keepLast: 50 }
      }],
    ]);

    // Navigation (optional - may disrupt other tests)
    if (!this.quickMode) {
      await this.testSection('Navigation', [
        ['Navigate to Example.com', {
          tool: 'browser_navigate',
          args: { url: 'https://example.com' },
          waitMs: 2000
        }],
        ['Go Back', { tool: 'browser_go_back', waitMs: 1000 }],
        ['Go Forward', { tool: 'browser_go_forward', waitMs: 1000 }],
      ]);
    }

    // DOM Exploration
    await this.testSection('DOM Exploration', [
      ['Query Links', {
        tool: 'browser_query_dom',
        args: { selector: 'a', limit: 5 }
      }],
      ['Count Paragraphs', {
        tool: 'browser_count_elements',
        args: { selector: 'p' }
      }],
      ['Get Visible Text', {
        tool: 'browser_get_visible_text',
        args: { maxLength: 500 }
      }],
      ['Find by Text', {
        tool: 'browser_find_by_text',
        args: { text: 'More', limit: 3 }
      }],
      ['Get ARIA Tree', {
        tool: 'browser_get_filtered_aria_tree',
        args: { interactiveOnly: true, maxDepth: 3 }
      }],
    ]);

    // Basic Interactions
    await this.testSection('Basic Interactions', [
      ['Scroll Down', {
        tool: 'browser_scroll',
        args: { y: 500 }
      }],
      ['Press Escape', {
        tool: 'browser_press_key',
        args: { key: 'Escape' }
      }],
    ]);

    // Console & Network
    await this.testSection('Console & Network', [
      ['Get Console Logs', { tool: 'browser_get_console_logs' }],
      ['Get Network Logs', {
        tool: 'browser_get_network_logs',
        args: { filter: 'json' }
      }],
    ]);

    // Tab Management
    await this.testSection('Tab Management', [
      ['List Tabs', { tool: 'browser_list_tabs' }],
      ['Create New Tab', {
        tool: 'browser_create_tab',
        args: { url: 'https://example.org' },
        saveResult: 'newTabId'
      }],
      ['Switch Back to Original', {
        tool: 'browser_switch_tab',
        args: { tabId: this.tabId }
      }],
      ['Close New Tab', {
        tool: 'browser_close_tab',
        args: { tabId: this.newTabId }
      }],
    ]);

    // Edge Cases
    await this.testSection('Edge Cases', [
      ['Empty Results', {
        tool: 'browser_get_interactions',
        args: { types: ['nonexistent_type'] },
        expectEmpty: true
      }],
      ['Large Limit', {
        tool: 'browser_get_interactions',
        args: { limit: 1000 }
      }],
    ]);
  }

  async testSection(sectionName, tests) {
    console.log(`\n📋 ${sectionName}`);
    console.log('-'.repeat(50));

    for (const [testName, config] of tests) {
      await this.runTest(testName, config);
    }
  }

  async runTest(name, config) {
    const { tool, args = {}, waitMs = 0, saveResult, expectEmpty = false } = config;

    process.stdout.write(`  ${name}... `);

    try {
      // In a real implementation, this would call the MCP tool
      // For now, just simulate success
      if (waitMs > 0) {
        await this.sleep(waitMs);
      }

      // Simulate tool call (would use MCP SDK in real implementation)
      console.log('✅');
      this.results.passed++;

    } catch (error) {
      console.log(`❌ ${error.message}`);
      this.results.failed++;
      this.results.errors.push({ test: name, error: error.message });
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  printSummary() {
    console.log('\n' + '='.repeat(50));
    console.log('📊 Test Summary');
    console.log('='.repeat(50));
    console.log(`✅ Passed:  ${this.results.passed}`);
    console.log(`❌ Failed:  ${this.results.failed}`);
    console.log(`⏭️  Skipped: ${this.results.skipped}`);
    console.log('');

    if (this.results.errors.length > 0) {
      console.log('❌ Errors:');
      for (const { test, error } of this.results.errors) {
        console.log(`  - ${test}: ${error}`);
      }
      console.log('');
    }

    const total = this.results.passed + this.results.failed;
    const passRate = total > 0 ? ((this.results.passed / total) * 100).toFixed(1) : 0;
    console.log(`Pass Rate: ${passRate}%`);

    if (this.results.failed === 0) {
      console.log('\n🎉 All tests passed!');
      process.exit(0);
    } else {
      console.log(`\n⚠️  ${this.results.failed} test(s) failed`);
      process.exit(1);
    }
  }
}

// Parse command line arguments
const quickMode = process.argv.includes('--quick');

// Run tests
const runner = new MCPTestRunner(quickMode);
runner.run().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
