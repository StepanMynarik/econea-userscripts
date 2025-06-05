// ==UserScript==
// @name         Econea Utils - Froala Edition
// @namespace    https://econea.cz/
// @version      1.3.5
// @description  Replaces specified Shopify metafield editors with Froala WYSIWYG editor
// @author       Stepan
// @match        https://*.myshopify.com/admin/products/*
// @match        https://admin.shopify.com/store/*/products/*
// @grant        GM_addStyle
// @require      https://cdn.jsdelivr.net/npm/froala-editor@4.5.2/js/froala_editor.pkgd.min.js
// @resource     FroalaCSS https://cdn.jsdelivr.net/npm/froala-editor@4.5.2/css/froala_editor.pkgd.min.css
// @resource     FroalaThemeCSS https://cdn.jsdelivr.net/npm/froala-editor@4.5.2/css/themes/gray.min.css
// @license      MIT
// ==/UserScript==

(function() {
  'use strict';

  const CONFIG = {
    targetMetafields: {
      ids: ['256299762003'],
    },

    // Enable debug logging
    debug: true,

    editorConfig: {
      toolbarButtons: [
        'bold', 'italic', 'underline', 'strikeThrough', '|',
        'formatOL', 'formatUL', 'outdent', 'indent', '|',
        'insertLink', 'quote', 'insertHR', '|',
        'paragraphFormat', 'fontSize', 'textColor', 'backgroundColor', '|',
        'align', 'clearFormatting', 'html'
      ],
      toolbarButtonsXS: [
        'bold', 'italic', 'formatOL', 'formatUL', 'insertLink'
      ],
      paragraphFormat: {
        N: 'Normal',
        H1: 'Heading 1',
        H2: 'Heading 2',
        H3: 'Heading 3'
      },
      fontSize: ['8', '10', '12', '14', '16', '18', '20', '24'],
      colorsBackground: [
        '#61BD6D', '#1ABC9C', '#54ACD2', '#2C82C9', '#9365B8', '#475577',
        '#CCCCCC', '#41A85F', '#00A885', '#3D8EB9', '#2969B0', '#553982',
        '#28324E', '#000000', '#F7DA64', '#FBA026', '#EB6B56', '#E25041',
        '#A38F84', '#EFEFEF', '#FFFFFF', '#FAD5A5', '#F9CA88', '#F8AFA6',
        '#F97A6D', '#C09853', '#DCDCDC', '#D1D5D8'
      ],
      colorsText: [
        '#61BD6D', '#1ABC9C', '#54ACD2', '#2C82C9', '#9365B8', '#475577',
        '#CCCCCC', '#41A85F', '#00A885', '#3D8EB9', '#2969B0', '#553982',
        '#28324E', '#000000', '#F7DA64', '#FBA026', '#EB6B56', '#E25041',
        '#A38F84', '#EFEFEF', '#FFFFFF'
      ],
      heightMin: 120,
      heightMax: 300,
      placeholderText: '',
      theme: 'gray',
      attribution: true, // Remove "Powered by Froala" if you have a license
      // License key - you'll need to add your own if you have one
      // key: 'YOUR_LICENSE_KEY_HERE'
    }
  };

  let processedElements = new Set();
  let observer;
  let froalaInstances = new Map();
  let froalaReady = false;
  let initAttempts = 0;
  const MAX_INIT_ATTEMPTS = 20;

  // Load Froala CSS
  GM_addStyle(`
    @import url('https://cdn.jsdelivr.net/npm/froala-editor@4.5.2/css/froala_editor.pkgd.min.css');
    @import url('https://cdn.jsdelivr.net/npm/froala-editor@4.5.2/css/themes/gray.min.css');
    
    /* Main wrapper styling */
    .wysiwyg-editor-wrapper {
      margin: 0 !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      position: relative !important;
      width: 100% !important;
      background: white !important;
      border-radius: 8px !important;
      overflow: hidden !important;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1) !important;
    }
    
    /* Froala editor container */
    .wysiwyg-editor-wrapper .fr-box {
      border: 1px solid #d1d5db !important;
      border-radius: 8px !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    }
    
    /* Froala editor content */
    .wysiwyg-editor-wrapper .fr-element {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      font-size: 14px !important;
      line-height: 1.6 !important;
      color: #374151 !important;
      padding: 16px !important;
    }
    
    /* Froala toolbar */
    .wysiwyg-editor-wrapper .fr-toolbar {
      border-bottom: 1px solid #d1d5db !important;
      background: #f9fafb !important;
    }
  `);

  function log(...args) {
    if (CONFIG.debug) {
      console.log('[Shopify WYSIWYG]', ...args);
    }
  }

  function logError(...args) {
    if (CONFIG.debug) {
      console.error('[Shopify WYSIWYG]', ...args);
    }
  }

  function checkFroalaAvailability() {
    return new Promise((resolve) => {
      const checkFroala = () => {
        // Check if FroalaEditor is available globally
        if (typeof window.FroalaEditor !== 'undefined' && window.FroalaEditor) {
          try {
            // Test if we can access FroalaEditor methods
            if (typeof window.FroalaEditor === 'function') {
              log('Froala Editor detected and ready');
              resolve(true);
              return;
            }
          } catch (error) {
            logError('Froala test failed:', error);
          }
        }

        initAttempts++;
        if (initAttempts < MAX_INIT_ATTEMPTS) {
          log(`Froala check attempt ${initAttempts}/${MAX_INIT_ATTEMPTS}...`);
          setTimeout(checkFroala, 500);
        } else {
          log('Max attempts reached, Froala not available');
          resolve(false);
        }
      };

      checkFroala();
    });
  }

  function isProductPage() {
    const url = window.location.href;
    return url.includes('/products/') &&
      (url.includes('myshopify.com/admin') || url.includes('admin.shopify.com'));
  }

  // Enhanced metafield detection using the exact DOM structure
  function findMetafieldElements() {
    const elements = [];

    // Look for the specific structure from your DOM
    const metafieldRows = document.querySelectorAll('div._RowWrapper_xxurb_22');

    metafieldRows.forEach(row => {
      try {
        // Find the metafield link to get ID and name
        const link = row.querySelector('a[href*="/metafields/"]');
        if (!link) return;

        const href = link.getAttribute('href');
        const metafieldId = href.match(/metafields\/(\d+)/)?.[1];
        const metafieldName = link.textContent.trim();

        // Find the textarea in this row
        const textarea = row.querySelector('textarea.Polaris-TextField__Input[aria-multiline="true"]');
        if (!textarea || processedElements.has(textarea)) return;

        // Check if this metafield should be targeted
        const shouldTarget = shouldTargetMetafield(metafieldId, metafieldName);

        if (shouldTarget) {
          elements.push({
            textarea: textarea,
            metafieldId: metafieldId,
            metafieldName: metafieldName,
            row: row
          });
          log('Found target metafield:', metafieldName, 'ID:', metafieldId);
        }
      } catch (error) {
        logError('Error processing metafield row:', error);
      }
    });

    return elements;
  }

  function shouldTargetMetafield(id, name) {
    const { ids } = CONFIG.targetMetafields;

    // If targeting specific IDs
    if (ids.length > 0 && ids.includes(id)) {
      return true;
    }

    return false;
  }

  function createWYSIWYGEditor(metafieldData) {
    try {
      const { textarea, metafieldId, metafieldName, row } = metafieldData;

      log('Creating WYSIWYG for:', metafieldName, 'ID:', metafieldId);

      // Find the TextField container
      const textFieldContainer = textarea.closest('.Polaris-TextField');
      if (!textFieldContainer) {
        log('Could not find TextField container');
        return null;
      }

      // Create wrapper
      const editorWrapper = document.createElement('div');
      editorWrapper.className = 'wysiwyg-editor-wrapper';
      editorWrapper.style.position = 'relative';

      // Create editor div
      const editorId = 'wysiwyg-' + metafieldId + '-' + Date.now();
      const editorDiv = document.createElement('div');
      editorDiv.id = editorId;

            // Get initial content before creating editor
      const initialContent = textarea.value || '';
      let hasInitialContent = initialContent && initialContent.trim();
      
      // Set initial content directly in the div if present
      if (hasInitialContent) {
        editorDiv.innerHTML = initialContent;
        log('Pre-populating editor div with initial content for', metafieldName);
      }

      editorWrapper.appendChild(editorDiv);

      // Replace the TextField but keep the original hidden
      textFieldContainer.parentNode.insertBefore(editorWrapper, textFieldContainer);
      textFieldContainer.style.display = 'none';

      // Store references
      editorWrapper.originalElement = textarea;
      editorWrapper.originalContainer = textFieldContainer;
      processedElements.add(textarea);

      // Prepare editor config - don't set htmlSet as it's not reliable
      const editorConfig = { ...CONFIG.editorConfig };
      
      // Log initial content for debugging
      if (hasInitialContent) {
        log('Initial content found for', metafieldName, ':', initialContent.substring(0, 100) + (initialContent.length > 100 ? '...' : ''));
      }

      // Initialize Froala with proper error handling
      let froalaEditor;
      try {
        froalaEditor = new FroalaEditor(editorDiv, editorConfig);
        
        // Validate that the editor was created properly
        if (!froalaEditor || typeof froalaEditor !== 'object') {
          throw new Error('Froala editor instance is invalid');
        }
        
        // Note: Don't check for events here as it might not be available immediately
        // The events object is created during the editor initialization process
        
      } catch (error) {
        logError('Failed to create Froala instance:', error);
        // Restore original element
        textFieldContainer.style.display = '';
        editorWrapper.remove();
        processedElements.delete(textarea);
        return null;
      }

      froalaInstances.set(editorId, {
        editor: froalaEditor,
        originalTextarea: textarea,
        metafieldName: metafieldName
      });

      // Content synchronization function
      const syncContent = () => {
        try {
          // Make sure editor is ready
          if (!froalaEditor || !froalaEditor.html || typeof froalaEditor.html.get !== 'function') {
            logError('Editor not ready for sync');
            return;
          }
          
          const content = froalaEditor.html.get();
          
          // Check if content is just empty paragraph(s)
          const isEmpty = !content ||
            content.trim() === '<p><br></p>' ||
            content.trim() === '<p></p>' ||
            content.trim() === '' ||
            froalaEditor.html.get(true).trim() === ''; // Get clean HTML

          // Update the original textarea
          const oldValue = textarea.value;
          const newValue = isEmpty ? '' : content;
          textarea.value = newValue;

          // Only trigger events if content actually changed
          if (oldValue !== newValue && (hasInitialContent || !isEmpty)) {
            // Create and dispatch multiple events to ensure Shopify detects the change
            const events = [
              new Event('input', { bubbles: true, cancelable: true }),
              new Event('change', { bubbles: true, cancelable: true }),
              new Event('blur', { bubbles: true, cancelable: true }),
              new KeyboardEvent('keyup', { bubbles: true, cancelable: true }),
              new Event('focusout', { bubbles: true, cancelable: true })
            ];

            events.forEach(event => {
              textarea.dispatchEvent(event);
            });

            // Also try to trigger React/Vue change detection
            const reactProps = Object.keys(textarea).find(key => key.startsWith('__react'));
            if (reactProps) {
              const reactInternalInstance = textarea[reactProps];
              if (reactInternalInstance && reactInternalInstance.memoizedProps && reactInternalInstance.memoizedProps.onChange) {
                try {
                  reactInternalInstance.memoizedProps.onChange({
                    target: textarea,
                    currentTarget: textarea
                  });
                } catch (e) {
                  logError('React onChange trigger failed:', e);
                }
              }
            }

            // Force a property descriptor update
            try {
              const descriptor = Object.getOwnPropertyDescriptor(textarea, 'value') ||
                Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
              if (descriptor && descriptor.set) {
                descriptor.set.call(textarea, newValue);
              }
            } catch (e) {
              logError(e);
            }

            log('Content synced for:', metafieldName, 'Length:', newValue.length);
          }
        } catch (error) {
          logError('Error syncing content:', error);
        }
      };

      // Set up change listeners with debouncing
      let syncTimeout;
      let userHasInteracted = false;

      // Wait for editor to be fully initialized before setting content or events
      // Use a more robust approach to wait for editor readiness
      const setupEditor = () => {
        try {
          // Check if events object is now available
          if (!froalaEditor.events || typeof froalaEditor.events.on !== 'function') {
            // If events aren't available yet, wait a bit more
            setTimeout(setupEditor, 100);
            return;
          }

          froalaEditor.events.on('initialized', function () {
            log('Froala editor initialized for:', metafieldName);
            
            // Set initial content after editor is fully initialized
            if (hasInitialContent) {
              try {
                log('Setting initial content for', metafieldName, ':', initialContent.length, 'characters');
                froalaEditor.html.set(initialContent);
                log('Initial content set successfully');
              } catch (e) {
                logError('Error setting initial content after init:', e);
                try {
                  froalaEditor.html.set("!CHYBA! Neukládat změny, napsat Štěpánovi.");
                } catch (e2) {
                  logError('Error setting error message:', e2);
                }
              }
            } else {
              log('No initial content found for', metafieldName);
            }

            // Focus editor by default
            setTimeout(() => {
              try {
                if (froalaEditor.events && typeof froalaEditor.events.focus === 'function') {
                  froalaEditor.events.focus();
                }
              } catch (e) {
                logError('Error focusing editor:', e);
              }
            }, 100);

            // Set up content change listeners after initialization
            try {
              froalaEditor.events.on('contentChanged', function () {
                userHasInteracted = true;
                clearTimeout(syncTimeout);
                syncTimeout = setTimeout(syncContent, 300);
              });

              // Also sync when editor loses focus
              froalaEditor.events.on('blur', function () {
                if (userHasInteracted) {
                  clearTimeout(syncTimeout);
                  syncContent();
                }
              });

              // Sync initially if there was actual content (after a small delay)
              if (hasInitialContent) {
                setTimeout(syncContent, 500);
              }
            } catch (e) {
              logError('Error setting up event listeners:', e);
            }
          });
        } catch (error) {
          logError('Error setting up editor events:', error);
          // Clean up if we can't set up events
          textFieldContainer.style.display = '';
          editorWrapper.remove();
          processedElements.delete(textarea);
          froalaInstances.delete(editorId);
        }
      };

      // Start the setup process
      setTimeout(setupEditor, 50);

      log('WYSIWYG editor created successfully for:', metafieldName);
      return editorWrapper;

    } catch (error) {
      logError('Failed to create WYSIWYG editor:', error);
      if (metafieldData.textarea) {
        processedElements.delete(metafieldData.textarea);
      }
      return null;
    }
  }

  async function processMetafields() {
    try {
      if (!isProductPage()) {
        log('Not on product page, skipping...');
        return;
      }

      if (!froalaReady) {
        log('Froala not ready yet, checking availability...');
        froalaReady = await checkFroalaAvailability();
        if (!froalaReady) {
          log('Froala failed to load properly');
          return;
        }
      }

      log('Processing metafields...');
      const metafieldElements = findMetafieldElements();
      let processedCount = 0;

      metafieldElements.forEach(metafieldData => {
        try {
          const result = createWYSIWYGEditor(metafieldData);
          if (result) {
            processedCount++;
          }
        } catch (error) {
          logError('Failed to create editor for metafield:', error);
        }
      });

      log(`Successfully processed ${processedCount} metafield(s)`);
    } catch (error) {
      logError('Error in processMetafields:', error);
    }
  }

  let processTimeout;
  function debouncedProcess() {
    clearTimeout(processTimeout);
    processTimeout = setTimeout(processMetafields, 200);
  }

  // Setup observer for dynamic content
  function setupObserver() {
    try {
      if (observer) {
        observer.disconnect();
      }

      observer = new MutationObserver((mutations) => {
        let shouldProcess = false;

        for (const mutation of mutations) {
          if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            for (const node of mutation.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.matches && (
                    node.matches('div._RowWrapper_xxurb_22') ||
                    node.matches('a[href*="/metafields/"]') ||
                    node.matches('textarea[aria-multiline="true"]')
                  )) {
                  shouldProcess = true;
                  break;
                } else if (node.querySelector && (
                    node.querySelector('div._RowWrapper_xxurb_22') ||
                    node.querySelector('a[href*="/metafields/"]') ||
                    node.querySelector('textarea[aria-multiline="true"]')
                  )) {
                  shouldProcess = true;
                  break;
                }
              }
            }
            if (shouldProcess) break;
          }
        }

        if (shouldProcess) {
          log('DOM changes detected, reprocessing...');
          debouncedProcess();
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: false,
        attributeOldValue: false,
        characterData: false,
        characterDataOldValue: false
      });

      log('Observer set up successfully');
    } catch (error) {
      logError('Error setting up observer:', error);
    }
  }

  // Initialize the script
  async function initialize() {
    try {
      if (!isProductPage()) return;

      log('Initializing Shopify Metafield WYSIWYG Editor with Froala...');
      log('Target config:', CONFIG.targetMetafields);

      // Wait for Froala to be ready
      froalaReady = await checkFroalaAvailability();

      if (froalaReady) {
        log('Froala is ready, processing metafields...');
        setTimeout(processMetafields, 500);
        setTimeout(processMetafields, 2000); // Backup processing
        setupObserver();
      } else {
        log('Failed to initialize: Froala not available');
      }
    } catch (error) {
      logError('Error in initialize:', error);
    }
  }

  // Handle page navigation
  let currentUrl = window.location.href;

  function handleUrlChange() {
    if (currentUrl !== window.location.href) {
      currentUrl = window.location.href;
      log('URL changed, reinitializing...');

      // Clean up
      processedElements.clear();
      if (observer) observer.disconnect();
      froalaInstances.forEach((instance, id) => {
        try {
          if (instance.editor && typeof instance.editor.destroy === 'function') {
            instance.editor.destroy();
          }
        } catch (e) {
          logError(e);
        }
      });
      froalaInstances.clear();
      froalaReady = false;
      initAttempts = 0;

      // Reinitialize
      setTimeout(initialize, 1000);
    }
  }

  setInterval(handleUrlChange, 1000);

  // Start the script
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    setTimeout(initialize, 1000);
  }

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    try {
      if (observer) observer.disconnect();
      froalaInstances.forEach((instance) => {
        try {
          if (instance.editor && typeof instance.editor.destroy === 'function') {
            instance.editor.destroy();
          }
        } catch (e) {
          logError(e);
        }
      });
      froalaInstances.clear();
    } catch (error) {
      logError('Error during cleanup:', error);
    }
  });

  // Debug functions
  window.debugWYSIWYG = {
    processMetafields: processMetafields,
    getInstances: () => froalaInstances,
    getProcessed: () => processedElements,
    checkFroala: () => checkFroalaAvailability(),
    forceSync: () => {
      froalaInstances.forEach((instance, id) => {
        try {
          if (instance.editor && instance.editor.html && typeof instance.editor.html.get === 'function') {
            const content = instance.editor.html.get();
            instance.originalTextarea.value = content;
            instance.originalTextarea.dispatchEvent(new Event('input', { bubbles: true }));
            instance.originalTextarea.dispatchEvent(new Event('change', { bubbles: true }));
            log('Force synced:', instance.metafieldName);
          }
        } catch (e) {
          logError('Error force syncing:', instance.metafieldName, e);
        }
      });
    }
  };

  log('Shopify Metafield WYSIWYG Editor with Froala loaded successfully');
})();
