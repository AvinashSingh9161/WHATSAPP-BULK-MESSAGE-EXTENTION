/* =====================================================
   WA Bulk Sender – Background Service Worker (V2)
   Advanced Engine with Persistent State & Security
   ===================================================== */

const State = {
  contacts: [],
  attachedFiles: [],
  campaign: {
    running: false,
    paused: false,
    loopActive: false,
    currentIndex: 0,
    sent: 0,
    failed: 0,
    type: 'message',
    targetTabId: null, // Tab Locking
    messageTemplate: '', // Dynamic Spintax support
  },
  settings: {
    delayType: 'fixed',
    fixedDelay: 10,
    randomMin: 8,
    randomMax: 15,
    dailyLimit: 80,
    smartSleepCount: 50,
    smartSleepMins: 10,
    stopOnClose: true,
    retryCount: 1,
  },
  dailyStats: {
      date: new Date().toISOString().split('T')[0],
      sent: 0
  }
};

// ── Utility ─────────────────────────────────────────────
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }
function randomBetween(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// Dynamic Spintax Engine (Moved from Popup)
function parseSpintax(text) {
  const spintaxRegex = /\{([^}]+)\}/g;
  let matches;
  while ((matches = spintaxRegex.exec(text)) !== null) {
      if (matches[1].toLowerCase() === 'name') continue;
      const options = matches[1].split('|');
      text = text.substring(0, matches.index) + options[Math.floor(Math.random() * options.length)] + text.substring(matches.index + matches[0].length);
      spintaxRegex.lastIndex = 0;
  }
  return text;
}
function processMessage(msgTemplate, contactName) {
  if (!msgTemplate) return '';
  let finalMsg = parseSpintax(msgTemplate);
  return finalMsg.replace(/\{name\}/gi, contactName ? contactName.trim() : '').trim();
}

function getWaTab(callback) {
  // If we have a locked tab, check if it's still alive
  if (State.campaign.targetTabId) {
      chrome.tabs.get(State.campaign.targetTabId, (tab) => {
          if (chrome.runtime.lastError || !tab) {
              State.campaign.targetTabId = null; // Lost it
              return findNewWaTab(callback);
          }
          callback(tab);
      });
  } else {
      findNewWaTab(callback);
  }
}

function findNewWaTab(callback) {
    chrome.tabs.query({}, (tabs) => {
        const waTabs = tabs.filter(t => t.url && t.url.includes('whatsapp.com'));
        if (waTabs.length > 0) {
            State.campaign.targetTabId = waTabs[0].id; // Lock it
            return callback(waTabs[0]);
        }
        callback(null);
    });
}

// ── Persistence ──────────────────────────────────────────
async function updateDailyStats() {
    const today = new Date().toISOString().split('T')[0];
    const data = await chrome.storage.local.get('wa_daily_stats');
    const stats = data.wa_daily_stats || {};
    
    if (stats.date !== today) {
        stats.date = today;
        stats.sent = 0;
    }
    stats.sent++;
    State.dailyStats = stats;
    await chrome.storage.local.set({ wa_daily_stats: stats });
}

async function checkDailyLimit() {
    const today = new Date().toISOString().split('T')[0];
    const data = await chrome.storage.local.get('wa_daily_stats');
    const stats = data.wa_daily_stats || { date: today, sent: 0 };
    State.dailyStats = stats;
    return stats.sent >= State.settings.dailyLimit;
}

// ── Campaign Logic ───────────────────────────────────────
async function sendToNumber(number, message, files, retryLeft) {
  return new Promise((resolve) => {
    getWaTab((waTab) => {
      if (!waTab) {
        resolve({ success: false, error: 'WhatsApp Web not open' });
        return;
      }
      const url = `https://web.whatsapp.com/send?phone=${number}`;

      chrome.tabs.update(waTab.id, { url }, () => {
        const waitTime = 10000 + Math.round(Math.random() * 2000);
        const safetyTimeout = setTimeout(() => resolve({ success: false, error: 'TIMEOUT' }), 60000);

        setTimeout(() => {
          chrome.tabs.sendMessage(waTab.id, { action: 'sendMessage', number, message, files }, (response) => {
            clearTimeout(safetyTimeout);
            if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
            else if (response && response.success) resolve({ success: true });
            else {
              const err = response ? response.error : 'Unknown error';
              if (err === 'INVALID_NUMBER') resolve({ success: false, error: 'Not on WA', isInvalid: true });
              else if (retryLeft > 0) setTimeout(() => sendToNumber(number, message, files, retryLeft - 1).then(resolve), 3000);
              else resolve({ success: false, error: err });
            }
          });
        }, waitTime);
      });
    });
  });
}

async function runLoop() {
  if (State.campaign.loopActive) return;
  State.campaign.loopActive = true;

  const type = State.campaign.type;
  
  for (let i = State.campaign.currentIndex; i < State.contacts.length; i++) {
    if (!State.campaign.running) break;
    while (State.campaign.paused && State.campaign.running) await sleep(1000);
    if (!State.campaign.running) break;

    const contact = State.contacts[i];
    if (!contact.valid || contact.waStatus === 'fail') continue;
    if (type === 'validation' && contact.waStatus !== 'unchecked') continue;

    // Daily Limit Enforcement
    if (type === 'message' && await checkDailyLimit()) {
        State.campaign.paused = true;
        State.campaign.running = false;
        break;
    }

    State.campaign.currentIndex = i;
    if (type === 'validation') contact.waStatus = 'checking';

    // DYNAMIC PROCESSING: Generate spintax/personalization RIGHT NOW
    const finalMsg = type === 'message' ? processMessage(State.campaign.messageTemplate, contact.name) : '';

    const result = await sendToNumber(
        contact.number, 
        finalMsg, 
        type === 'message' ? State.attachedFiles : [],
        type === 'message' ? State.settings.retryCount : 0
    );

    if (result.success || (type === 'validation' && result.error === 'TIMEOUT_CHAT_NOT_LOADED')) {
      if (type === 'message') {
          State.campaign.sent++;
          await updateDailyStats(); // Persistent increment
      }
      contact.waStatus = 'ready';
    } else {
      if (type === 'message') State.campaign.failed++;
      if (result.isInvalid) contact.waStatus = 'fail';
      else if (type === 'validation') contact.waStatus = 'unchecked';
    }

    // Delays
    if (State.campaign.running && !State.campaign.paused && i < State.contacts.length - 1) {
        if (type === 'message') {
            if ((State.campaign.sent % State.settings.smartSleepCount) === 0 && State.campaign.sent > 0) {
                await sleep(State.settings.smartSleepMins * 60 * 1000);
            }
            const d = State.settings.delayType === 'fixed' ? State.settings.fixedDelay * 1000 : randomBetween(State.settings.randomMin, State.settings.randomMax) * 1000;
            await sleep(d);
        } else { await sleep(2000); }
    }
  }
  State.campaign.loopActive = false;
  State.campaign.running = false;
}

// ── Messaging API ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startCampaign') {
    if (request.payload.contacts) State.contacts = request.payload.contacts;
    if (request.payload.attachedFiles) State.attachedFiles = request.payload.attachedFiles;
    
    const campaign = request.payload.campaign || {};
    State.campaign.running = true;
    State.campaign.paused = false;
    State.campaign.currentIndex = campaign.currentIndex !== undefined ? campaign.currentIndex : 0;
    State.campaign.sent = campaign.sent || 0;
    State.campaign.failed = campaign.failed || 0;
    State.campaign.type = request.campaignType || 'message';
    State.campaign.messageTemplate = request.payload.messageTemplate || '';
    
    runLoop();
    sendResponse({ success: true });
  }

  if (request.action === 'getStatus') {
    sendResponse({ state: State });
  }

  if (request.action === 'updateFiles') {
      State.attachedFiles = request.files;
      sendResponse({ success: true });
  }

  if (request.action === 'pauseCampaign') { State.campaign.paused = true; sendResponse({ success: true }); }
  if (request.action === 'resumeCampaign') { State.campaign.paused = false; if (!State.campaign.loopActive) runLoop(); sendResponse({ success: true }); }
  if (request.action === 'stopCampaign') { State.campaign.running = false; State.campaign.paused = false; sendResponse({ success: true }); }
  if (request.action === 'updateContacts') { State.contacts = request.contacts; sendResponse({ success: true }); }
  if (request.action === 'updateSettings') { Object.assign(State.settings, request.settings); sendResponse({ success: true }); }

  return true;
});

// Initialization
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['wa_settings', 'wa_daily_stats'], (res) => {
      if (res.wa_settings) Object.assign(State.settings, res.wa_settings);
      if (res.wa_daily_stats) State.dailyStats = res.wa_daily_stats;
  });
});
