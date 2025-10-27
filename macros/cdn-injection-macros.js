// CDN Library Injection Macros
// Safely inject and manage external JavaScript libraries

export const cdnInjectionMacros = [
  // Macro 1: Check if library is already loaded
  {
    site: '*',
    category: 'util',
    name: 'check_library_loaded',
    description: 'Check if a JavaScript library is already loaded on the page',
    parameters: {
      library: {
        type: 'string',
        description: 'Library name to check (e.g., "jQuery", "html2canvas", "lodash", "_", "$")',
        required: true
      }
    },
    code: `(params) => {
      const libName = params.library;
      const isLoaded = typeof window[libName] !== 'undefined';

      // Check common library variations
      const checks = {
        'jQuery': typeof window.jQuery !== 'undefined',
        '$': typeof window.$ !== 'undefined',
        'lodash': typeof window._ !== 'undefined',
        '_': typeof window._ !== 'undefined',
        'html2canvas': typeof window.html2canvas !== 'undefined',
        'moment': typeof window.moment !== 'undefined',
        'axios': typeof window.axios !== 'undefined',
        'd3': typeof window.d3 !== 'undefined',
        'Chart': typeof window.Chart !== 'undefined',
        [libName]: typeof window[libName] !== 'undefined'
      };

      return {
        success: true,
        library: libName,
        loaded: checks[libName] || false,
        available: Object.keys(checks).filter(key => checks[key]),
        windowKeys: Object.keys(window).filter(key =>
          typeof window[key] === 'function' ||
          (typeof window[key] === 'object' && window[key] !== null)
        ).slice(0, 50) // Show first 50 for reference
      };
    }`,
    returnType: 'Object with loaded status and available libraries',
    reliability: 'high',
    tags: ['library', 'cdn', 'check', 'loaded']
  },

  // Macro 2: Inject single library from CDN
  {
    site: '*',
    category: 'util',
    name: 'inject_cdn_library',
    description: 'Inject a JavaScript library from CDN with promise-based loading and timeout',
    parameters: {
      url: {
        type: 'string',
        description: 'CDN URL for the library (e.g., "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js")',
        required: true
      },
      libraryName: {
        type: 'string',
        description: 'Global variable name to check for load completion (e.g., "html2canvas")',
        required: true
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 10000)',
        required: false,
        default: 10000
      }
    },
    code: `(params) => {
      return new Promise((resolve) => {
        const url = params.url;
        const libName = params.libraryName;
        const timeout = params.timeout || 10000;

        // Check if already loaded
        if (typeof window[libName] !== 'undefined') {
          resolve({
            success: true,
            message: 'Library already loaded',
            library: libName,
            alreadyLoaded: true
          });
          return;
        }

        // Check if script already exists
        const existingScript = document.querySelector(\`script[src="\${url}"]\`);
        if (existingScript) {
          resolve({
            success: true,
            message: 'Script tag already exists, waiting for load',
            library: libName,
            alreadyExists: true
          });
          return;
        }

        const script = document.createElement('script');
        script.src = url;
        script.async = true;

        let timeoutId;
        let loadInterval;

        const cleanup = () => {
          clearTimeout(timeoutId);
          clearInterval(loadInterval);
        };

        // Set timeout
        timeoutId = setTimeout(() => {
          cleanup();
          resolve({
            success: false,
            error: 'Timeout waiting for library to load',
            library: libName,
            url: url,
            timeout: timeout
          });
        }, timeout);

        // Poll for library availability
        loadInterval = setInterval(() => {
          if (typeof window[libName] !== 'undefined') {
            cleanup();
            resolve({
              success: true,
              message: 'Library loaded successfully',
              library: libName,
              url: url,
              loadedAt: new Date().toISOString()
            });
          }
        }, 100);

        script.onerror = () => {
          cleanup();
          resolve({
            success: false,
            error: 'Failed to load script from CDN',
            library: libName,
            url: url
          });
        };

        document.head.appendChild(script);
      });
    }`,
    returnType: 'Object with success flag, library name, and load status',
    reliability: 'high',
    tags: ['library', 'cdn', 'inject', 'load']
  },

  // Macro 3: Inject multiple libraries in sequence
  {
    site: '*',
    category: 'util',
    name: 'inject_cdn_libraries_batch',
    description: 'Inject multiple libraries from CDNs in sequence with dependency handling',
    parameters: {
      libraries: {
        type: 'array',
        description: 'Array of objects with {url, libraryName} for each library',
        required: true
      },
      timeout: {
        type: 'number',
        description: 'Timeout per library in milliseconds (default: 10000)',
        required: false,
        default: 10000
      }
    },
    code: `async (params) => {
      const libraries = params.libraries;
      const timeout = params.timeout || 10000;
      const results = [];

      for (const lib of libraries) {
        // Check if already loaded
        if (typeof window[lib.libraryName] !== 'undefined') {
          results.push({
            success: true,
            library: lib.libraryName,
            message: 'Already loaded',
            skipped: true
          });
          continue;
        }

        // Inject library
        const result = await new Promise((resolve) => {
          const script = document.createElement('script');
          script.src = lib.url;
          script.async = false; // Load in order

          let timeoutId;
          let loadInterval;

          const cleanup = () => {
            clearTimeout(timeoutId);
            clearInterval(loadInterval);
          };

          timeoutId = setTimeout(() => {
            cleanup();
            resolve({
              success: false,
              library: lib.libraryName,
              error: 'Timeout',
              url: lib.url
            });
          }, timeout);

          loadInterval = setInterval(() => {
            if (typeof window[lib.libraryName] !== 'undefined') {
              cleanup();
              resolve({
                success: true,
                library: lib.libraryName,
                message: 'Loaded successfully',
                url: lib.url
              });
            }
          }, 100);

          script.onerror = () => {
            cleanup();
            resolve({
              success: false,
              library: lib.libraryName,
              error: 'Failed to load',
              url: lib.url
            });
          };

          document.head.appendChild(script);
        });

        results.push(result);

        // Stop if a library fails to load
        if (!result.success) {
          break;
        }
      }

      const allSuccess = results.every(r => r.success);
      const loadedCount = results.filter(r => r.success && !r.skipped).length;

      return {
        success: allSuccess,
        totalLibraries: libraries.length,
        loadedCount: loadedCount,
        skippedCount: results.filter(r => r.skipped).length,
        results: results,
        message: allSuccess ? 'All libraries loaded successfully' : 'Some libraries failed to load'
      };
    }`,
    returnType: 'Object with batch load results for all libraries',
    reliability: 'high',
    tags: ['library', 'cdn', 'inject', 'batch', 'load']
  },

  // Macro 4: Popular libraries preset
  {
    site: '*',
    category: 'util',
    name: 'inject_popular_library',
    description: 'Inject a popular library using preset CDN URLs (html2canvas, jQuery, lodash, moment, axios, d3, Chart.js)',
    parameters: {
      library: {
        type: 'string',
        description: 'Library name: "html2canvas", "jquery", "lodash", "moment", "axios", "d3", "chartjs"',
        required: true
      },
      version: {
        type: 'string',
        description: 'Optional version string (default: latest)',
        required: false,
        default: 'latest'
      }
    },
    code: `(params) => {
      return new Promise((resolve) => {
        const library = params.library.toLowerCase();
        const version = params.version || 'latest';

        const cdnUrls = {
          'html2canvas': {
            url: version === 'latest'
              ? 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'
              : \`https://cdn.jsdelivr.net/npm/html2canvas@\${version}/dist/html2canvas.min.js\`,
            globalName: 'html2canvas'
          },
          'jquery': {
            url: version === 'latest'
              ? 'https://code.jquery.com/jquery-3.7.1.min.js'
              : \`https://code.jquery.com/jquery-\${version}.min.js\`,
            globalName: 'jQuery'
          },
          'lodash': {
            url: version === 'latest'
              ? 'https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js'
              : \`https://cdn.jsdelivr.net/npm/lodash@\${version}/lodash.min.js\`,
            globalName: '_'
          },
          'moment': {
            url: version === 'latest'
              ? 'https://cdn.jsdelivr.net/npm/moment@2.30.1/moment.min.js'
              : \`https://cdn.jsdelivr.net/npm/moment@\${version}/moment.min.js\`,
            globalName: 'moment'
          },
          'axios': {
            url: version === 'latest'
              ? 'https://cdn.jsdelivr.net/npm/axios@1.7.9/dist/axios.min.js'
              : \`https://cdn.jsdelivr.net/npm/axios@\${version}/dist/axios.min.js\`,
            globalName: 'axios'
          },
          'd3': {
            url: version === 'latest'
              ? 'https://d3js.org/d3.v7.min.js'
              : \`https://d3js.org/d3.v\${version}.min.js\`,
            globalName: 'd3'
          },
          'chartjs': {
            url: version === 'latest'
              ? 'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js'
              : \`https://cdn.jsdelivr.net/npm/chart.js@\${version}/dist/chart.umd.min.js\`,
            globalName: 'Chart'
          }
        };

        const libConfig = cdnUrls[library];

        if (!libConfig) {
          resolve({
            success: false,
            error: 'Unknown library',
            library: library,
            available: Object.keys(cdnUrls)
          });
          return;
        }

        const globalName = libConfig.globalName;

        // Check if already loaded
        if (typeof window[globalName] !== 'undefined') {
          resolve({
            success: true,
            message: 'Library already loaded',
            library: library,
            globalName: globalName,
            alreadyLoaded: true
          });
          return;
        }

        const script = document.createElement('script');
        script.src = libConfig.url;
        script.async = true;

        let timeoutId;
        let loadInterval;

        const cleanup = () => {
          clearTimeout(timeoutId);
          clearInterval(loadInterval);
        };

        timeoutId = setTimeout(() => {
          cleanup();
          resolve({
            success: false,
            error: 'Timeout waiting for library',
            library: library,
            globalName: globalName,
            url: libConfig.url
          });
        }, 10000);

        loadInterval = setInterval(() => {
          if (typeof window[globalName] !== 'undefined') {
            cleanup();
            resolve({
              success: true,
              message: 'Library loaded successfully',
              library: library,
              globalName: globalName,
              url: libConfig.url,
              version: typeof window[globalName].version === 'string'
                ? window[globalName].version
                : 'unknown'
            });
          }
        }, 100);

        script.onerror = () => {
          cleanup();
          resolve({
            success: false,
            error: 'Failed to load script from CDN',
            library: library,
            globalName: globalName,
            url: libConfig.url
          });
        };

        document.head.appendChild(script);
      });
    }`,
    returnType: 'Object with success flag and library load details',
    reliability: 'high',
    tags: ['library', 'cdn', 'inject', 'preset', 'popular']
  }
];
