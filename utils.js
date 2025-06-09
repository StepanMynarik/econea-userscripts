// ==UserScript==
// @name         Econea Utils
// @namespace    https://econea.cz/
// @version      1.3.8
// @description  Replaces specified Shopify metafield editors with Summernote WYSIWYG editor etc.
// @author       Stepan
// @match        https://*.myshopify.com/admin/products/*
// @match        https://admin.shopify.com/store/*/products/*
// @grant        GM_addStyle
// @require      https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.slim.min.js
// @require      https://cdn.jsdelivr.net/npm/summernote@0.9.1/dist/summernote-lite.min.js
// @resource     SummernoteCSS https://cdn.jsdelivr.net/npm/summernote@0.9.1/dist/summernote-lite.min.css
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
      minHeight: 300,
      maxHeight: 600,
      height: 300,
      placeholder: '',
      toolbar: [
        ['style', ['style']],
        ['font', ['bold', 'italic', 'underline', 'strikethrough']],
        ['color', ['color', 'backcolor']],
        ['para', ['ul', 'ol', 'paragraph']],
        ['table', ['table']],
        ['insert', ['link', 'picture', 'video', 'hr']],
        ['view', ['fullscreen', 'codeview', 'help']],
        ['misc', ['undo', 'redo']],
      ],
      styleTags: [
        'p',
        { title: 'Heading 1', tag: 'h1', className: '', value: 'h1' },
        { title: 'Heading 2', tag: 'h2', className: '', value: 'h2' },
        { title: 'Heading 3', tag: 'h3', className: '', value: 'h3' },
      ],
      fontSizes: ['8', '9', '10', '11', '12', '14', '16', '18', '20', '22', '24', '36', '48', '64', '82', '150'],
      callbacks: {
        onInit: function() {
          // Will be set per instance
        },
        onChange: function(contents, $editable) {
          // Will be set per instance
        },
        onBlur: function() {
          // Will be set per instance
        },
      },
    },
  };

  let processedElements = new Set();
  let observer;
  let summernoteInstances = new Map();
  let summernoteReady = false;
  let initAttempts = 0;
  const MAX_INIT_ATTEMPTS = 20;

  GM_addStyle(`
    @import url('https://cdn.jsdelivr.net/npm/summernote@0.9.1/dist/summernote-lite.min.css');

    /* Main wrapper styling */
    .wysiwyg-editor-wrapper {
      margin: 0 !important;
      position: relative !important;
      width: 100% !important;
      border-radius: 8px !important;
      overflow: visible !important;
    }

    /* Summernote container styling */
    .wysiwyg-editor-wrapper .note-editor {
      border: 1px solid #d1d5db !important;
      border-radius: 8px !important;
      background: white !important;
    }

    /* Summernote toolbar styling */
    .wysiwyg-editor-wrapper .note-toolbar {
      border-bottom: 1px solid #d1d5db !important;
      background: #f9fafb !important;
      padding: 8px 12px !important;
    }

    /* Editor content area */
    .wysiwyg-editor-wrapper .note-editing-area .note-editable {
      overflow-y: auto !important;
      border: none !important;
    }

    /* Hide components that might interfere with Shopify Admin UI */
    .note-modal-backdrop {
      display: none !important;
    }

    .note-modal {
      top: 60px !important;
    }

    .note-editor.note-frame.fullscreen {
      top: 60px !important;
      bottom: 0 !important;
    }

    .note-editor.note-frame.fullscreen .note-editing-area {
      height: calc(100% - 60px) !important
    }

    .note-editor.note-frame.fullscreen .note-editing-area .note-editable {
      height: 100% !important;
    }

    .note-editor.note-frame.fullscreen .note-editing-area .note-codable {
      height: 100% !important;
      max-height: unset !important;
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

  function checkSummernoteAvailability() {
    return new Promise((resolve) => {
      const checkSummernote = () => {
        // Check if jQuery and Summernote are available
        if (
          typeof window.jQuery !== 'undefined' && window.jQuery &&
          typeof window.jQuery.fn.summernote !== 'undefined'
         ) {
          log('Summernote detected and ready');
          resolve(true);
          return;
        }

        initAttempts++;
        if (initAttempts < MAX_INIT_ATTEMPTS) {
          log(`Summernote check attempt ${initAttempts}/${MAX_INIT_ATTEMPTS}...`);
          setTimeout(checkSummernote, 500);
        } else {
          log('Max attempts reached, Summernote not available');
          resolve(false);
        }
      };

      checkSummernote();
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

      // Get initial content
      const initialContent = textarea.value || '';
      let hasInitialContent = false;

      if (initialContent && initialContent.trim()) {
        hasInitialContent = true;
      }

      // Initialize Summernote with jQuery
      let $editor;
      try {
        $editor = jQuery(editorDiv);

        // Clone the config and set up callbacks for this instance
        const instanceConfig = jQuery.extend(true, {}, CONFIG.editorConfig);

        // Set up content synchronization
        let syncTimeout;
        let userHasInteracted = false;

        const syncContent = () => {
          try {
            const content = $editor.summernote('code');

            // Check if content is just empty paragraph(s) - don't sync these
            const isEmpty = !content ||
              content.trim() === '<p><br></p>' ||
              content.trim() === '<p></p>' ||
              content.trim() === '' ||
              $editor.summernote('isEmpty');

            // Update the original textarea
            const oldValue = textarea.value;
            const newValue = isEmpty ? '' : content;

            // Only trigger events if content actually changed AND it's not just empty formatting
            if (oldValue !== newValue && (hasInitialContent || !isEmpty)) {
              textarea.value = newValue;

              // Also try to trigger Shopify React change detection
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

              console.dir({
                before: oldValue,
                after: newValue,
              }, {depth:3});

              log('Content synced for:', metafieldName, 'Length:', newValue.length);
            }
          } catch (error) {
            logError('Error syncing content:', error);
          }
        };

        // Set up callbacks
        instanceConfig.callbacks.onInit = function() {
          // Set initial content after initialization
          if (hasInitialContent) {
            try {
              $editor.summernote('code', initialContent);
              setTimeout(syncContent, 100);
            } catch (e) {
              logError('Error setting initial content:', e);
              $editor.summernote('code', initialContent);
            }
          }

          // Focus editor
          setTimeout(() => {
            $editor.summernote('focus');
          }, 100);
        };

        instanceConfig.callbacks.onChange = function(contents, $editable) {
          userHasInteracted = true;
          // Clear existing timeout
          clearTimeout(syncTimeout);
          // Debounce the sync to avoid too many events
          syncTimeout = setTimeout(syncContent, 300);
        };

        instanceConfig.callbacks.onBlur = function() {
          if (userHasInteracted) {
            clearTimeout(syncTimeout);
            syncContent();
          }
        };

        // Initialize Summernote
        $editor.summernote(instanceConfig);

      } catch (error) {
        logError('Failed to create Summernote instance:', error);
        // Restore original element
        textFieldContainer.style.display = '';
        editorWrapper.remove();
        processedElements.delete(textarea);
        return null;
      }

      summernoteInstances.set(editorId, {
        $editor: $editor,
        originalTextarea: textarea,
        metafieldName: metafieldName
      });

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

      if (!summernoteReady) {
        log('Summernote not ready yet, checking availability...');
        summernoteReady = await checkSummernoteAvailability();
        if (!summernoteReady) {
          log('Summernote failed to load properly');
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

      // Wait for Summernote to be ready
      summernoteReady = await checkSummernoteAvailability();

      if (summernoteReady) {
        log('Summernote is ready, processing metafields...');
        setTimeout(processMetafields, 500);
        setTimeout(processMetafields, 2000); // Backup processing
        setupObserver();
      } else {
        log('Failed to initialize: Summernote not available');
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
      summernoteInstances.forEach((instance, id) => {
        try {
          instance.$editor.summernote('destroy');
        } catch (e) {
          logError(e);
        }
      });
      summernoteInstances.clear();
      summernoteReady = false;
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
      summernoteInstances.forEach((instance) => {
        try {
          instance.$editor.summernote('destroy');
        } catch (e) {
          logError(e);
        }
      });
      summernoteInstances.clear();
    } catch (error) {
      logError('Error during cleanup:', error);
    }
  });

  // Debug functions
  window.debugWYSIWYG = {
    processMetafields: processMetafields,
    getInstances: () => summernoteInstances,
    getProcessed: () => processedElements,
    checkSummernote: () => checkSummernoteAvailability(),
    forceSync: () => {
      summernoteInstances.forEach((instance, id) => {
        try {
          const content = instance.$editor.summernote('code');
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
