#!/usr/bin/env node
/**
 * Test suite for utility macros
 * Stores all macros and tests them on multiple websites
 *
 * PREREQUISITES:
 * 1. Browser MCP extension must be installed in Chrome
 * 2. MCP server must be running (npm start)
 * 3. Extension must be connected to the server
 *
 * The test will automatically attach to a new tab if none are attached.
 *
 * Run: npm run test:utility-macros
 */

import { WebSocket } from 'ws';

const WS_URL = 'ws://localhost:9010/ws';
let ws;
let testCount = 0;
let passCount = 0;
let failCount = 0;
let messageId = 0;

// Define all macros inline (since we can't easily import from the utility-macros.js file)
const allMacrosToStore = [
  // Tier 1
  {
    site: "*",
    category: "exploration",
    name: "get_interactive_elements",
    description: "Get all interactive elements (buttons, links, inputs, selects) on the page with minimal token usage",
    parameters: {
      limit: { type: "number", description: "Maximum number of elements to return (default: 50)", required: false, default: 50 },
      includeHidden: { type: "boolean", description: "Include hidden elements (default: false)", required: false, default: false }
    },
    code: `(params) => {
      const { limit = 50, includeHidden = false } = params;
      const elements = [];
      const isVisible = (el) => {
        if (includeHidden) return true;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && el.offsetParent !== null;
      };
      const getSelector = (el) => {
        if (el.id) return '#' + el.id;
        if (el.className && typeof el.className === 'string') {
          const classes = el.className.trim().split(/\\s+/).slice(0, 2).join('.');
          if (classes) return el.tagName.toLowerCase() + '.' + classes;
        }
        return el.tagName.toLowerCase();
      };
      document.querySelectorAll('button').forEach(btn => {
        if (isVisible(btn) && elements.length < limit) {
          elements.push({ type: 'button', text: btn.textContent.trim().substring(0, 50), selector: getSelector(btn), disabled: btn.disabled, ariaLabel: btn.getAttribute('aria-label') });
        }
      });
      document.querySelectorAll('a[href]').forEach(link => {
        if (isVisible(link) && elements.length < limit) {
          elements.push({ type: 'link', text: link.textContent.trim().substring(0, 50), href: link.href, selector: getSelector(link), opensNewTab: link.target === '_blank' });
        }
      });
      document.querySelectorAll('input, textarea').forEach(input => {
        if (isVisible(input) && elements.length < limit) {
          const label = input.labels?.[0]?.textContent.trim() || input.placeholder || input.name || input.id;
          elements.push({ type: 'input', inputType: input.type || 'textarea', label: label?.substring(0, 50), name: input.name, value: input.value ? '(has value)' : '', required: input.required, selector: getSelector(input) });
        }
      });
      document.querySelectorAll('select').forEach(select => {
        if (isVisible(select) && elements.length < limit) {
          const label = select.labels?.[0]?.textContent.trim() || select.name || select.id;
          elements.push({ type: 'select', label: label?.substring(0, 50), name: select.name, optionsCount: select.options.length, selectedValue: select.value, selector: getSelector(select) });
        }
      });
      return { count: elements.length, elements: elements, truncated: elements.length >= limit };
    }`,
    returnType: "Object with count, elements array, and truncated flag",
    reliability: "high",
    tags: ["exploration", "navigation", "interactive"]
  },
  {
    site: "*",
    category: "exploration",
    name: "discover_forms",
    description: "Discover all forms on the page with their fields, actions, and submit buttons",
    parameters: {},
    code: `(params) => {
      const forms = [];
      document.querySelectorAll('form').forEach((form, idx) => {
        const fields = [];
        form.querySelectorAll('input, textarea, select').forEach(field => {
          const label = field.labels?.[0]?.textContent.trim() || field.placeholder || field.getAttribute('aria-label') || field.name || field.id || 'unlabeled';
          const fieldInfo = { type: field.type || field.tagName.toLowerCase(), name: field.name, label: label.substring(0, 50), required: field.required, value: field.value ? '(has value)' : '', disabled: field.disabled };
          if (field.tagName === 'SELECT') fieldInfo.optionsCount = field.options.length;
          fields.push(fieldInfo);
        });
        const submitBtn = form.querySelector('[type="submit"], button:not([type="button"])');
        forms.push({ formId: form.id || \`form-\${idx}\`, name: form.name, action: form.action || '(current page)', method: form.method || 'get', fieldCount: fields.length, fields: fields, submitButton: submitBtn?.textContent.trim() || 'Submit' });
      });
      return { formCount: forms.length, forms: forms };
    }`,
    returnType: "Object with formCount and forms array",
    reliability: "high",
    tags: ["forms", "exploration", "automation"]
  },
  {
    site: "*",
    category: "exploration",
    name: "detect_messages",
    description: "Detect all error, warning, success, and info messages on the page",
    parameters: {},
    code: `(params) => {
      const messages = { errors: [], warnings: [], successes: [], info: [], total: 0 };
      const patterns = { error: ['error', 'danger', 'alert-danger', 'alert-error', 'invalid', 'failure'], warning: ['warning', 'alert-warning', 'caution'], success: ['success', 'alert-success', 'confirmation', 'confirmed'], info: ['info', 'alert-info', 'notice', 'notification'] };
      document.querySelectorAll('[class*="alert"], [class*="message"], [class*="error"], [class*="warning"], [class*="success"], [role="alert"], [role="status"]').forEach(el => {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return;
        const text = el.textContent.trim();
        if (!text || text.length < 2) return;
        const className = el.className.toLowerCase();
        const role = el.getAttribute('role');
        const message = { text: text.substring(0, 100), location: el.getBoundingClientRect().top < window.innerHeight ? 'visible' : 'below fold', dismissible: !!el.querySelector('[aria-label*="close" i], .close, [data-dismiss]') };
        let categorized = false;
        for (const [type, keywords] of Object.entries(patterns)) {
          if (keywords.some(kw => className.includes(kw)) || role === type) {
            messages[type + 's'].push(message);
            messages.total++;
            categorized = true;
            break;
          }
        }
        if (!categorized && role === 'alert') { messages.info.push(message); messages.total++; }
      });
      return messages;
    }`,
    returnType: "Object with errors, warnings, successes, info arrays and total count",
    reliability: "high",
    tags: ["exploration", "debugging", "validation"]
  },
  {
    site: "*",
    category: "util",
    name: "find_element_by_description",
    description: "Find elements using natural language description (e.g., 'the blue submit button')",
    parameters: {
      description: { type: "string", description: "Natural language description of the element to find", required: true }
    },
    code: `(params) => {
      const { description } = params;
      const desc = description.toLowerCase();
      const matches = [];
      const words = desc.split(/\\s+/);
      const colors = ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'black', 'white', 'gray'];
      const types = ['button', 'link', 'input', 'field', 'select', 'dropdown', 'checkbox', 'radio'];
      let targetType = types.find(t => desc.includes(t)) || 'any';
      let searchText = words.filter(w => !types.includes(w) && !colors.includes(w)).join(' ');
      let selector = '*';
      if (targetType === 'button') selector = 'button, [type="button"], [type="submit"], [role="button"]';
      else if (targetType === 'link') selector = 'a[href]';
      else if (targetType === 'input' || targetType === 'field') selector = 'input, textarea';
      else if (targetType === 'select' || targetType === 'dropdown') selector = 'select';
      else if (targetType === 'checkbox') selector = 'input[type="checkbox"]';
      else if (targetType === 'radio') selector = 'input[type="radio"]';
      document.querySelectorAll(selector).forEach(el => {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return;
        let score = 0;
        const text = el.textContent.trim().toLowerCase();
        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
        const placeholder = (el.placeholder || '').toLowerCase();
        if (searchText && (text.includes(searchText) || ariaLabel.includes(searchText) || placeholder.includes(searchText))) score += 10;
        const color = colors.find(c => desc.includes(c));
        if (color && (style.backgroundColor.includes(color) || style.color.includes(color) || el.className.includes(color))) score += 5;
        words.forEach(word => {
          if (el.className.toLowerCase().includes(word)) score += 2;
          if (el.id.toLowerCase().includes(word)) score += 3;
        });
        if (score > 0) {
          matches.push({ score: score, element: el, text: text.substring(0, 50), selector: el.id ? '#' + el.id : el.className ? el.tagName.toLowerCase() + '.' + el.className.split(' ')[0] : el.tagName.toLowerCase() });
        }
      });
      matches.sort((a, b) => b.score - a.score);
      if (matches.length === 0) return { found: false, message: 'No matching elements found' };
      const best = matches[0];
      return { found: true, text: best.text, selector: best.selector, confidence: best.score > 10 ? 'high' : best.score > 5 ? 'medium' : 'low', alternativeCount: matches.length - 1 };
    }`,
    returnType: "Object with found flag, text, selector, confidence level",
    reliability: "medium",
    tags: ["search", "exploration", "util"]
  }
];

async function connectWebSocket() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(WS_URL);

    ws.on('open', () => {
      console.log('✓ Connected to WebSocket\n');
      resolve();
    });

    ws.on('error', (error) => {
      console.error('✗ Connection error:', error.message);
      reject(error);
    });
  });
}

async function sendMessage(type, payload) {
  return new Promise((resolve, reject) => {
    const id = `test-${++messageId}-${Date.now()}`;
    const message = { id, type, payload };

    // Longer timeout for operations that might open new tabs/windows
    const timeoutDuration = type.includes('attach') || type.includes('create') ? 30000 : 15000;
    const timeout = setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new Error(`Request timeout after ${timeoutDuration/1000} seconds`));
    }, timeoutDuration);

    const handler = (data) => {
      const response = JSON.parse(data.toString());
      if (response.type === 'messageResponse' && response.payload.requestId === id) {
        clearTimeout(timeout);
        ws.removeListener('message', handler);

        if (response.payload.error) {
          reject(new Error(response.payload.error));
        } else {
          // Parse the JSON from the text content
          let result = response.payload.result;
          if (result && result.content && result.content[0] && result.content[0].text) {
            try {
              result = JSON.parse(result.content[0].text);
            } catch (e) {
              // If parsing fails, use raw result
            }
          }
          resolve(result);
        }
      }
    };

    ws.on('message', handler);
    ws.send(JSON.stringify(message));
  });
}

async function test(description, testFn) {
  testCount++;
  process.stdout.write(`  Test ${testCount}: ${description}... `);

  try {
    const result = await testFn();
    passCount++;
    console.log('✓ PASS');
    return result;
  } catch (error) {
    failCount++;
    console.log(`✗ FAIL: ${error.message}`);
    return null;
  }
}

async function storeMacro(macro) {
  return sendMessage('browser_store_macro', {
    site: macro.site,
    category: macro.category,
    name: macro.name,
    description: macro.description,
    parameters: macro.parameters,
    code: macro.code,
    returnType: macro.returnType,
    reliability: macro.reliability,
    tags: macro.tags
  });
}

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  BROWSER MCP UTILITY MACROS TEST SUITE');
  console.log('  Storing and testing 4 core utility macros');
  console.log('═══════════════════════════════════════════════════════════════\n');

  try {
    await connectWebSocket();

    // Wait for extension connection
    console.log('Waiting 2 seconds for extension connection...\n');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check if any tabs are already attached, if not, attach to a new one
    const attachedTabs = await test('Check for attached tabs', async () => {
      const result = await sendMessage('browser_list_attached_tabs', {});
      return result;
    });

    // If no tabs attached, open and attach to a new one
    if (!attachedTabs || !attachedTabs.content || !attachedTabs.content[0] ||
        attachedTabs.content[0].text.includes('No tabs currently attached')) {
      console.log('\n  No tabs attached, opening new tab...\n');

      await test('Attach to new browser tab', async () => {
        const result = await sendMessage('browser_attach_tab', {
          autoOpenUrl: 'https://example.com'
        });
        console.log(`\n    → Successfully attached to new tab`);
        return result;
      });

      // Give the tab time to fully load
      await new Promise(resolve => setTimeout(resolve, 3000));
    } else {
      console.log('\n  ✓ Found existing attached tab(s)\n');
    }

    // ====================================================================
    // PHASE 1: VERIFY/STORE ALL MACROS
    // ====================================================================
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║  PHASE 1: Verify/Store All Macros                       ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    // Get list of existing macros first
    const existingList = await test('List existing macros', async () => {
      const result = await sendMessage('browser_list_macros', { site: '*' });
      console.log(`\n    → Found ${result.count} existing macros in database`);
      return result;
    });

    const existingMacrosMap = {};
    if (existingList && existingList.macros) {
      existingList.macros.forEach(m => {
        existingMacrosMap[`${m.site}:${m.name}`] = m.id;
      });
    }

    for (const macro of allMacrosToStore) {
      await test(`Verify/Store macro: ${macro.name}`, async () => {
        const key = `${macro.site}:${macro.name}`;
        if (existingMacrosMap[key]) {
          return { id: existingMacrosMap[key], name: macro.name, status: 'already_exists' };
        }

        const result = await storeMacro(macro);
        if (!result.id) throw new Error('No macro ID returned');
        existingMacrosMap[key] = result.id;
        return { ...result, status: 'created' };
      });
    }

    // ====================================================================
    // PHASE 2: TEST ON EXAMPLE.COM (Simple Page)
    // ====================================================================
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║  PHASE 2: Test on example.com (Simple Page)             ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    await test('Navigate to example.com', async () => {
      return await sendMessage('browser_navigate', {
        url: 'https://example.com'
      });
    });

    await new Promise(resolve => setTimeout(resolve, 2000));

    // List stored macros
    await test('List stored macros', async () => {
      const result = await sendMessage('browser_list_macros', {});
      console.log(`\n    → Found ${result.count} stored macros`);
      return result;
    });

    // Test Tier 1 macros
    const result1 = await test('Execute: get_interactive_elements', async () => {
      const listResult = await sendMessage('browser_list_macros', { search: 'get_interactive_elements' });
      if (!listResult.macros || listResult.macros.length === 0) throw new Error('Macro not found');
      const response = await sendMessage('browser_execute_macro', {
        id: listResult.macros[0].id,
        params: { limit: 20 }
      });

      // Extract the actual macro result from the response wrapper
      const result = response.result || response;

      if (typeof result.count === 'undefined') {
        throw new Error('Invalid result format: missing count field');
      }

      console.log(`\n    → Found ${result.count} interactive elements`);
      if (result.count > 0 && result.elements && result.elements.length > 0) {
        console.log(`    → First element: ${result.elements[0].type} - "${result.elements[0].text}"`);
      }
      return result;
    });

    await test('Execute: detect_messages', async () => {
      const listResult = await sendMessage('browser_list_macros', { search: 'detect_messages' });
      if (!listResult.macros || listResult.macros.length === 0) throw new Error('Macro not found');
      const response = await sendMessage('browser_execute_macro', {
        id: listResult.macros[0].id,
        params: {}
      });
      const result = response.result || response;
      console.log(`\n    → Found ${result.total} messages on page`);
      return result;
    });

    // ====================================================================
    // PHASE 3: TEST ON GITHUB.COM (Complex Page with Forms)
    // ====================================================================
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║  PHASE 3: Test on github.com (Complex Page)             ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    await test('Navigate to github.com', async () => {
      return await sendMessage('browser_navigate', {
        url: 'https://github.com'
      });
    });

    await new Promise(resolve => setTimeout(resolve, 3000));

    await test('Execute: discover_forms', async () => {
      const listResult = await sendMessage('browser_list_macros', { search: 'discover_forms' });
      if (!listResult.macros || listResult.macros.length === 0) throw new Error('Macro not found');
      const response = await sendMessage('browser_execute_macro', {
        id: listResult.macros[0].id,
        params: {}
      });
      const result = response.result || response;
      console.log(`\n    → Found ${result.formCount} forms`);
      if (result.formCount > 0) {
        console.log(`    → First form has ${result.forms[0].fieldCount} fields`);
        console.log(`    → Action: ${result.forms[0].action}`);
      }
      return result;
    });

    await test('Execute: find_element_by_description', async () => {
      const listResult = await sendMessage('browser_list_macros', { search: 'find_element_by_description' });
      if (!listResult.macros || listResult.macros.length === 0) throw new Error('Macro not found');
      const response = await sendMessage('browser_execute_macro', {
        id: listResult.macros[0].id,
        params: { description: 'search input' }
      });
      const result = response.result || response;
      if (result.found) {
        console.log(`\n    → Found element: "${result.text}"`);
        console.log(`    → Confidence: ${result.confidence}`);
        console.log(`    → Selector: ${result.selector}`);
      } else {
        console.log(`\n    → No matching element found`);
      }
      return result;
    });

    // Print final summary
    console.log('\n\n═══════════════════════════════════════════════════════════════');
    console.log('  TEST SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log(`  Total Tests:    ${testCount}`);
    console.log(`  ✓ Passed:       ${passCount}`);
    console.log(`  ✗ Failed:       ${failCount}`);
    console.log(`  Pass Rate:      ${((passCount / testCount) * 100).toFixed(1)}%\n`);

    if (failCount === 0) {
      console.log('🎉 ALL TESTS PASSED! Core utility macros are working! 🎉\n');
    } else {
      console.log(`⚠️  ${failCount} test(s) failed\n`);
      process.exit(1);
    }

  } catch (error) {
    console.error('\n✗ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (ws) {
      ws.close();
    }
  }
}

runTests().catch(console.error);
