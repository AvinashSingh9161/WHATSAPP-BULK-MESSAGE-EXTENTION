/* =====================================================
   WA Bulk Sender – Background Script
   Service Worker for handling lifecycle and state
   ===================================================== */

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Initialize default settings upon install
    const defaultSettings = {
      delayType: 'fixed',
      fixedDelay: 10,
      randomMin: 8,
      randomMax: 15,
      dailyLimit: 80,
      stopOnClose: true,
      retryCount: 1,
    };
    chrome.storage.local.set({ wa_settings: defaultSettings });
  }
});

// Listener to handle tab closure and pause campaign if enabled
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  chrome.storage.local.get(['wa_settings', 'campaign_running'], (data) => {
    if (data.wa_settings && data.wa_settings.stopOnClose) {
      // If the closed tab was whatsapp web, we can't easily detect here without keeping a map of tabIds.
      // A robust implementation would store the tabId when starting sending and check it here.
      // For MVP, if we know WA Bulk Sender is running and *a* tab is closed, 
      // we could halt, but for now we rely on the popup context since popup script controls the loop.
      // Actually, if the popup is closed, the popup script stops running anyway. 
      // Background worker is only needed if we move the campaign loop here. 
      // For V1, the loop is in popup.js, so closing the popup stops the campaign.
    }
  });
});
