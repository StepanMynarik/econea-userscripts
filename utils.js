// ==UserScript==
// @name         Econea Utils
// @namespace    https://econea.cz/
// @version      1.2.5
// @description  Replaces specified Shopify metafield editors with Quill WYSIWYG editor etc.
// @author       Stepan
// @match        https://*.myshopify.com/admin/products/*
// @match        https://admin.shopify.com/store/*/products/*
// @grant        GM_addStyle
// @require      https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.js
// @resource     QuillCSS https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.snow.css
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
      theme: 'snow',
      modules: {
        toolbar: [
          [{
            'header': [1, 2, 3, false]
          }],
          ['bold', 'italic', 'underline', 'strike'],
          [{
            'color': []
          }, {
            'background': []
          }],
          [{
            'list': 'ordered'
          }, {
            'list': 'bullet'
          }],
          [{
            'indent': '-1'
          }, {
            'indent': '+1'
          }],
          ['link', 'blockquote', 'code-block'],
          [{
            'align': []
          }],
          ['clean']
        ]
      },
      placeholder: '',
      formats: [
        'header', 'bold', 'italic', 'underline', 'strike',
        'color', 'background', 'list', 'indent',
        'link', 'blockquote', 'code-block', 'align'
      ]
    }
  };

  let processedElements = new Set();
  let observer;
  let quillInstances = new Map();
  let quillReady = false;
  let initAttempts = 0;
  const MAX_INIT_ATTEMPTS = 20;

  GM_addStyle(`
    @import url('https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.snow.css');
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
    /* Container styling */
    .wysiwyg-editor-wrapper .ql-container {
      border: 1px solid #d1d5db !important;
      border-top: none !important;
      background: white !important;
      font-family: inherit !important;
    }
    /* Editor content area */
    .wysiwyg-editor-wrapper .ql-editor {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      font-size: 14px !important;
      line-height: 1.6 !important;
      min-height: 120px !important;
      max-height: 300px !important;
      padding: 16px !important;
      color: #374151 !important;
      overflow-y: auto !important;
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

  function checkQuillAvailability() {
    return new Promise((resolve) => {
      const checkQuill = () => {
        // Check if Quill is available globally
        if (typeof window.Quill !== 'undefined' && window.Quill) {
          try {
            // Test if we can create a Quill instance
            const testDiv = document.createElement('div');
            testDiv.style.display = 'none';
            document.body.appendChild(testDiv);

            const testQuill = new window.Quill(testDiv, {
              theme: 'snow'
            });

            // Clean up test
            document.body.removeChild(testDiv);

            if (testQuill && typeof testQuill.getSemanticHTML === 'function') {
              log('Quill 2.x detected and ready');
              resolve(true);
              return;
            }
          } catch (error) {
            logError('Quill test failed:', error);
          }
        }

        initAttempts++;
        if (initAttempts < MAX_INIT_ATTEMPTS) {
          log(`Quill check attempt ${initAttempts}/${MAX_INIT_ATTEMPTS}...`);
          setTimeout(checkQuill, 500);
        } else {
          log('Max attempts reached, Quill not available');
          resolve(false);
        }
      };

      checkQuill();
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
    const {
      ids,
    } = CONFIG.targetMetafields;

    // If targeting specific IDs
    if (ids.length > 0 && ids.includes(id)) {
      return true;
    }

    return false;
  }

  function createWYSIWYGEditor(metafieldData) {
    try {
      const {
        textarea,
        metafieldId,
        metafieldName,
        row
      } = metafieldData;

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

      editorWrapper.appendChild(editorDiv);

      // Replace the TextField but keep the original hidden
      textFieldContainer.parentNode.insertBefore(editorWrapper, textFieldContainer);
      textFieldContainer.style.display = 'none';

      // Store references
      editorWrapper.originalElement = textarea;
      editorWrapper.originalContainer = textFieldContainer;
      processedElements.add(textarea);

      // Initialize Quill
      let quill;
      try {
        quill = new window.Quill(editorDiv, CONFIG.editorConfig);
      } catch (error) {
        logError('Failed to create Quill instance:', error);
        // Restore original element
        textFieldContainer.style.display = '';
        editorWrapper.remove();
        processedElements.delete(textarea);
        return null;
      }

      quillInstances.set(editorId, {
        quill: quill,
        originalTextarea: textarea,
        metafieldName: metafieldName
      });

      // Set initial content
      const initialContent = textarea.value || '';
      let hasInitialContent = false;

      if (initialContent && initialContent.trim()) {
        hasInitialContent = true;
        try {
          // In Quill 2.0.3, use setContents or clipboard.dangerouslyPasteHTML
          if (initialContent.includes('<') && initialContent.includes('>')) {
            quill.clipboard.dangerouslyPasteHTML(initialContent);
          } else {
            quill.setText(initialContent);
          }
        } catch (e) {
          logError('Error setting initial content:', e);
          quill.setText(initialContent);
        }
      }

      // Focus Quill by default
      setTimeout(() => {
        quill.focus();
      });

      // Simple content synchronization with enhanced event triggering
      const syncContent = () => {
        try {
          const content = quill.getSemanticHTML();

          // Check if content is just empty paragraph(s) - don't sync these
          const isEmpty = !content ||
            content.trim() === '<p><br></p>' ||
            content.trim() === '<p></p>' ||
            content.trim() === '' ||
            quill.getText().trim() === '';

          // Update the original textarea
          const oldValue = textarea.value;
          const newValue = isEmpty ? '' : content;
          textarea.value = newValue;

          // Only trigger events if content actually changed AND it's not just empty formatting
          if (oldValue !== newValue && (hasInitialContent || !isEmpty)) {
            // Create and dispatch multiple events to ensure Shopify detects the change
            const events = [
              new Event('input', {
                bubbles: true,
                cancelable: true
              }),
              new Event('change', {
                bubbles: true,
                cancelable: true
              }),
              new Event('blur', {
                bubbles: true,
                cancelable: true
              }),
              new KeyboardEvent('keyup', {
                bubbles: true,
                cancelable: true
              }),
              new Event('focusout', {
                bubbles: true,
                cancelable: true
              })
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

      // Set up change listener - sync on every change with debouncing
      let syncTimeout;
      let userHasInteracted = false;

      quill.on('text-change', (delta, oldDelta, source) => {
        if (source === 'user') {
          userHasInteracted = true;
          // Clear existing timeout
          clearTimeout(syncTimeout);
          // Debounce the sync to avoid too many events
          syncTimeout = setTimeout(syncContent, 300);
        }
      });

      // Also sync immediately when editor loses focus
      quill.on('selection-change', (range, oldRange, source) => {
        if (!range && oldRange && source === 'user' && userHasInteracted) {
          clearTimeout(syncTimeout);
          syncContent();
        }
      });

      // Only sync initially if there was actual content
      if (hasInitialContent) {
        setTimeout(syncContent, 100);
      }

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

      if (!quillReady) {
        log('Quill not ready yet, checking availability...');
        quillReady = await checkQuillAvailability();
        if (!quillReady) {
          log('Quill failed to load properly');
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
          // Only check childList mutations for efficiency
          if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            for (const node of mutation.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE) {
                // Check if this node or its descendants contain metafield elements
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
        // Only observe what we need
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

      log('Initializing Shopify Metafield WYSIWYG Editor...');
      log('Target config:', CONFIG.targetMetafields);

      // Wait for Quill to be ready
      quillReady = await checkQuillAvailability();

      if (quillReady) {
        log('Quill is ready, processing metafields...');
        setTimeout(processMetafields, 500);
        setTimeout(processMetafields, 2000); // Backup processing
        setupObserver();
      } else {
        log('Failed to initialize: Quill not available');
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
      quillInstances.forEach((instance, id) => {
        try {
          instance.quill.disable();
        } catch (e) {
          logError(e);
        }
      });
      quillInstances.clear();
      quillReady = false;
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
      quillInstances.forEach((instance) => {
        try {
          instance.quill.disable();
        } catch (e) {
          logError(e);
        }
      });
      quillInstances.clear();
    } catch (error) {
      logError('Error during cleanup:', error);
    }
  });

  // Debug functions
  window.debugWYSIWYG = {
    processMetafields: processMetafields,
    getInstances: () => quillInstances,
    getProcessed: () => processedElements,
    checkQuill: () => checkQuillAvailability(),
    forceSync: () => {
      quillInstances.forEach((instance, id) => {
        try {
          const content = instance.quill.getSemanticHTML();
          instance.originalTextarea.value = content;
          instance.originalTextarea.dispatchEvent(new Event('input', {
            bubbles: true
          }));
          instance.originalTextarea.dispatchEvent(new Event('change', {
            bubbles: true
          }));
          log('Force synced:', instance.metafieldName);
        } catch (e) {
          logError('Error force syncing:', instance.metafieldName, e);
        }
      });
    }
  };

  log('Shopify Metafield WYSIWYG Editor script loaded successfully');
})();
