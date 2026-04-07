/* =====================================================
   WA Bulk Sender – Content Script
   Provides DOM interaction to automate WhatsApp Web
   ===================================================== */

const DELAY = ms => new Promise(res => setTimeout(res, ms));

function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Element not found: ${selector}`));
    }, timeout);
  });
}

function dataUrlToFile(dataUrl, filename, mimeType) {
  const arr = dataUrl.split(',');
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mimeType });
}

async function simulatePaste(element, text) {
  element.focus();
  
  // Clear any existing text (prevents duplicate text on retries)
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);

  // Use DataTransfer for a robust paste
  const dataTransfer = new DataTransfer();
  dataTransfer.setData('text', text);
  const pasteEvent = new ClipboardEvent('paste', {
    clipboardData: dataTransfer,
    bubbles: true,
    cancelable: true
  });
  element.dispatchEvent(pasteEvent);
}

async function attachFile(fileDataUrl, fileName, fileType) {
  try {
    // Click attachment clip icon
    const attachBtnSelector = 'div[title="Attach"], span[data-icon="clip"]';
    const attachBtn = await waitForElement(attachBtnSelector, 5000);
    attachBtn.closest('div[role="button"]').click();
    await DELAY(500);

    // Find the right input based on file type
    const isImage = fileType.startsWith('image/');
    const inputSelector = isImage
      ? 'input[accept="image/*,video/mp4,video/3gpp,video/quicktime"]'
      : 'input[accept="*"]';

    const fileInput = await waitForElement(inputSelector, 5000);
    const file = dataUrlToFile(fileDataUrl, fileName, fileType);

    // Create DataTransfer to simulate drop
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;

    // Dispatch change event
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await DELAY(2000); // Wait for preview to load

    // Click send on attachment modal
    const sendBtnSelector = 'button[aria-label="Send"], span[data-icon="send"], span[data-icon="wds-ic-send-filled"]';
    const sendBtn = await waitForElement(sendBtnSelector, 5000);
    const btnEl = sendBtn.closest('button') || sendBtn.parentElement || sendBtn;
    btnEl.click();
    await DELAY(1000);

    return true;
  } catch (error) {
    console.error('WA Bulk Sender - Attach error:', error);
    return false;
  }
}

async function sendMessage(message, fileDataUrl, fileName, fileType) {
  try {
    // Handle invalid number popup
    const invalidSelector = 'div[data-animate-modal-popup="true"]';
    const isInvalid = document.querySelector(invalidSelector);
    if (isInvalid && isInvalid.innerText.includes('Phone number shared via url is invalid')) {
        const okBtn = isInvalid.querySelector('button');
        if(okBtn) okBtn.click();
        throw new Error('Phone number is invalid.');
    }

    // Wait for the main input box
    const chatBoxSelector = 'div[contenteditable="true"][data-tab="10"], div[title="Type a message"]';
    const chatBox = await waitForElement(chatBoxSelector, 15000); // Wait up to 15s because web.whatsapp is incredibly slow

    // If file is attached, process it first
    if (fileDataUrl) {
      const attachSuccess = await attachFile(fileDataUrl, fileName, fileType);
      if (!attachSuccess) throw new Error('Failed to attach file');
      // Adding additional delay to ensure attachment is sent if message is also present
      if(message) await DELAY(2000);
    }

    // If there's a text message, type and send it
    if (message) {
      await simulatePaste(chatBox, message);
      await DELAY(1000);

      // Focus and dispatch a robust 'Enter' keystroke
      chatBox.focus();
      const enterEvt1 = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, keyCode: 13, which: 13, key: 'Enter', code: 'Enter' });
      const enterEvt2 = new KeyboardEvent('keyup',   { bubbles: true, cancelable: true, keyCode: 13, which: 13, key: 'Enter', code: 'Enter' });
      chatBox.dispatchEvent(enterEvt1);
      chatBox.dispatchEvent(enterEvt2);
      
      // Fallback: Exhaustive MouseEvent dispatches on the send button hierarchy
      const sendBtn = document.querySelector('button[aria-label="Send"], span[data-icon="send"], span[data-icon="wds-ic-send-filled"]');
      if (sendBtn) {
        const btnEl = sendBtn.closest('button') || sendBtn;
        
        // 1. Dispatch robust modern mouse events to the Button wrapper
        ['mouseover', 'mousedown', 'mouseup', 'click'].forEach(evtType => {
          btnEl.dispatchEvent(new MouseEvent(evtType, { view: window, bubbles: true, cancelable: true, buttons: 1 }));
        });

        // 2. Dispatch legacy mouse events directly to the span/icon (React occasionally bonds handlers to inner SVG containers)
        ['mouseover', 'mousedown', 'mouseup', 'click'].forEach(evtType => {
          const dispatchEvt = document.createEvent('MouseEvents');
          dispatchEvt.initEvent(evtType, true, true);
          sendBtn.dispatchEvent(dispatchEvt);
        });

        // 3. Simple native click
        try { btnEl.click(); } catch(e){}
      }

      await DELAY(1000); // Wait for send animation
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'sendMessage') {
    sendMessage(request.message, request.fileDataUrl, request.fileName, request.fileType)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.toString() }));
    return true; // Keep channel open for async
  }
});
