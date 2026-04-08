/* =====================================================
   WA Bulk Sender – Popup Controller
   Handles UI and communicates with Background Engine
   ===================================================== */

const State = {
  contacts:       [],
  attachedFiles:  [],
  campaign: {
    running:      false,
    paused:       false,
    loopActive:   false,
    currentIndex: 0,
    sent:         0,
    failed:       0,
  },
  logs: [],
  settings: {
    delayType:       'fixed',
    fixedDelay:      10,
    randomMin:       8,
    randomMax:       15,
    dailyLimit:      80,
    smartSleepCount: 50,
    smartSleepMins:  10,
    stopOnClose:     true,
    retryCount:      1,
  },
};

const EMOJIS = ['😊','😂','❤️','👍','🙏','🔥','✅','🎉','💪','😍',
  '🤝','📞','💰','🎁','⭐','📢','✨','🚀','💡','📱',
  '🌟','👋','😎','🤔','💬','📩','🏆','💼','🎯','⚡',
  '😃','😁','🥳','👌','🤩','💥','🔔','📌','🎀','🍀'];

// ── Utility ─────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function formatTime(d = new Date()) { return d.toLocaleTimeString('en-GB', { hour12: false }); }
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/1024/1024).toFixed(1) + ' MB';
}
function getFileIcon(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (['jpg','jpeg','png','gif','webp'].includes(ext)) return '🖼️';
  if (ext === 'pdf') return '📕';
  if (['doc','docx'].includes(ext)) return '📝';
  if (['xls','xlsx'].includes(ext)) return '📊';
  return '📄';
}
function validatePhoneNumber(num) {
  const cleaned = num.replace(/\D/g, '');
  return cleaned.length >= 10 && cleaned.length <= 15;
}
function cleanNumber(num) {
  return num.replace(/\D/g, '').replace(/^0+/, '');
}

// ── Background Sync ───────────────────────────────────────
function syncWithBackground() {
  chrome.runtime.sendMessage({ action: 'getStatus' }, (res) => {
    if (res && res.state) {
      const bgState = res.state;
      
      State.campaign = bgState.campaign;
      State.settings = bgState.settings;
      State.dailyStats = bgState.dailyStats; // For UI display
      
      // Update Daily Sent Badge
      const limit = State.settings.dailyLimit;
      const todaySent = State.dailyStats ? State.dailyStats.sent : 0;
      $('stat-daily-limit').textContent = `${todaySent} / ${limit}`;

      // FETCH PERSISTENT FILES: If popup just opened and local files are empty
      if (State.attachedFiles.length === 0 && bgState.attachedFiles.length > 0) {
          State.attachedFiles = bgState.attachedFiles;
          renderFiles();
      }

      if (bgState.campaign.running || bgState.campaign.loopActive || bgState.contacts.length > 0) {
          State.contacts = bgState.contacts;
          renderContactList();
      }

      updateProgressUI();
      setControlsState(State.campaign.running, State.campaign.paused);
      
      if (State.campaign.running) {
          $('progress-section').style.display = 'block';
          const type = State.campaign.type === 'validation' ? 'Validating' : 'Sending to';
          const current = State.contacts[State.campaign.currentIndex];
          if (current) setStatus(`${type} +${current.number}... (${State.campaign.currentIndex + 1}/${State.contacts.length})`);
      }
    }
  });
}

// ── UI Rendering ──────────────────────────────────────────
function addLog(msg, type = 'info') {
  const time = formatTime();
  const container = $('log-container');
  const empty = container.querySelector('.log-empty');
  if (empty) empty.remove();

  const el = document.createElement('div');
  el.className = `log-item log-${type}`;
  el.innerHTML = `<span class="log-time">${time}</span><span class="log-msg">${msg}</span>`;
  container.prepend(el);
  $('logs-footer').style.display = 'block';

  const items = container.querySelectorAll('.log-item');
  if (items.length > 200) items[items.length - 1].remove();
}

function renderContactList() {
  const list = $('contact-list');
  const section = $('contacts-preview-section');
  if (!State.contacts.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';

  const valid = State.contacts.filter(c => c.valid).length;
  const invalid = State.contacts.filter(c => !c.valid).length;
  const failCount = State.contacts.filter(c => c.waStatus === 'fail').length;
  
  $('valid-count-badge').textContent = `${valid} valid`;
  $('invalid-count-badge').textContent = `${invalid} invalid`;
  $('invalid-count-badge').style.display = invalid ? 'inline-flex' : 'none';
  $('btn-remove-invalid').style.display = invalid ? 'inline-flex' : 'none';
  $('btn-clean-list').style.display = failCount ? 'inline-flex' : 'none';
  
  // Dynamic Visibility: Hide Validate button if no contacts exist
  $('btn-validate-contacts').style.display = State.contacts.length > 0 ? 'inline-flex' : 'none';

  list.innerHTML = '';
  State.contacts.forEach((c, i) => {
    const item = document.createElement('div');
    item.className = 'contact-item';
    const nameSpan = c.name ? `<span style="font-size: 10px; color: var(--text-muted); margin-left: 6px;">(${c.name})</span>` : '';
    let statusHtml = '';
    if (!c.valid) statusHtml = '<span class="contact-status-invalid">✗ Invalid</span>';
    else {
      switch (c.waStatus) {
        case 'checking': statusHtml = '<span class="contact-status-checking">Checking...</span>'; break;
        case 'ready':    statusHtml = '<span class="contact-status-wa-ready">✓ WA OK</span>'; break;
        case 'fail':     statusHtml = '<span class="contact-status-wa-fail">✗ Not WA</span>'; break;
        default:         statusHtml = '<span class="contact-status-valid">✓ Format OK</span>';
      }
    }
    item.innerHTML = `<div><span class="contact-number">+${c.number}</span>${nameSpan}</div>${statusHtml}`;
    list.appendChild(item);
  });
}

function updateProgressUI() {
  const total = State.contacts.filter(c => c.valid).length;
  const sent = State.campaign.sent;
  const failed = State.campaign.failed;
  const pct = total > 0 ? Math.round((State.campaign.currentIndex / total) * 100) : 0;

  $('stat-total').textContent = total;
  $('stat-sent').textContent = sent;
  $('stat-failed').textContent = failed;
  $('stat-remaining').textContent = Math.max(0, total - State.campaign.currentIndex);
  $('progress-bar-fill').style.width = pct + '%';
  $('progress-percent').textContent = pct + '%';
}

function setStatus(msg) { $('current-status').textContent = msg; }
function setControlsState(running, paused) {
  $('btn-start').style.display = running ? 'none' : '';
  $('btn-pause').style.display = (running && !paused) ? '' : 'none';
  $('btn-resume').style.display = (running && paused) ? '' : 'none';
  $('btn-stop').style.display = running ? '' : 'none';
}

// ── Formatting/Processing ─────────────────────────────────
function parseSpintax(text) {
  const spintaxRegex = /\{([^}]+)\}/g;
  let matches;
  while ((matches = spintaxRegex.exec(text)) !== null) {
      if (matches[1].toLowerCase() === 'name') continue;
      const options = matches[1].split('|');
      const randomOption = options[Math.floor(Math.random() * options.length)];
      text = text.substring(0, matches.index) + randomOption + text.substring(matches.index + matches[0].length);
      spintaxRegex.lastIndex = 0;
  }
  return text;
}
function processMessage(msgTemplate, contactName) {
  if (!msgTemplate) return '';
  let finalMsg = parseSpintax(msgTemplate);
  return finalMsg.replace(/\{name\}/gi, contactName ? contactName.trim() : '').trim();
}

// ── Tab Check ─────────────────────────────────────────────
function getWaTab(callback) {
  chrome.tabs.query({}, (tabs) => {
    const waTabs = tabs.filter(t => t.url && t.url.includes('whatsapp.com'));
    if (waTabs.length > 0) return callback(waTabs[0]);
    chrome.tabs.query({ active: true, currentWindow: true }, (at) => callback(at[0]));
  });
}
function checkWhatsAppStatus() {
  getWaTab((tab) => {
    const badge = $('whatsapp-status');
    const isWa = tab && tab.url && tab.url.includes('whatsapp.com');
    badge.className = isWa ? 'status-badge status-online' : 'status-badge status-offline';
    badge.querySelector('.status-text').textContent = isWa ? 'WA Open' : 'WA Closed';
  });
}

// ── Contact Handling ─────────────────────────────────────
function parseContacts() {
  const raw = $('contacts-manual').value.trim();
  if (!raw) return;
  const lines = raw.split(/[\n;\r]+/).map(l => l.trim()).filter(Boolean);
  const seen = new Set();
  const parsed = [];
  lines.forEach(line => {
    const numMatch = line.match(/(\d[\d\s\-\(\)]{9,})/);
    if (!numMatch) { parsed.push({ number: line, name: '', valid: false }); return; }
    const num = cleanNumber(numMatch[1]);
    let name = line.replace(numMatch[0], '').replace(/^[,:\s-]+|[,:\s-]+$/g, '').trim();
    if (seen.has(num)) return;
    seen.add(num);
    parsed.push({ number: num, name: name, valid: validatePhoneNumber(num), waStatus: 'unchecked' });
  });
  State.contacts = parsed;
  renderContactList();
}

// ── Initialization ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Sync periodically
  setInterval(syncWithBackground, 1000);
  setInterval(checkWhatsAppStatus, 5000);
  syncWithBackground();
  checkWhatsAppStatus();

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $('panel-' + btn.dataset.tab).classList.add('active');
    });
  });

  // Emoji picker
  EMOJIS.forEach(em => {
    const btn = document.createElement('button');
    btn.className = 'emoji-btn-item';
    btn.textContent = em;
    btn.addEventListener('click', () => {
      const ta = $('message-input');
      const pos = ta.selectionStart;
      ta.value = ta.value.slice(0, pos) + em + ta.value.slice(pos);
      updateCharCount();
      $('emoji-panel').classList.add('hidden');
    });
    $('emoji-grid').appendChild(btn);
  });
  $('emoji-btn').addEventListener('click', (e) => { e.stopPropagation(); $('emoji-panel').classList.toggle('hidden'); });
  document.addEventListener('click', () => $('emoji-panel').classList.add('hidden'));

  // File Handling
  $('file-input').addEventListener('change', async () => {
    const files = Array.from($('file-input').files);
    for (const f of files) {
        const readFile = (file) => new Promise(res => {
            const r = new FileReader();
            r.onload = e => res({ dataUrl: e.target.result, name: file.name, type: file.type, size: file.size });
            r.readAsDataURL(file);
        });
        const payload = await readFile(f);
        State.attachedFiles.push(payload);
    }
    renderFiles();
    // SYNC FILES TO BACKGROUND
    chrome.runtime.sendMessage({ action: 'updateFiles', files: State.attachedFiles });
  });
  function renderFiles() {
    const list = $('file-preview-list');
    list.innerHTML = '';
    $('drop-zone-content').style.display = State.attachedFiles.length ? 'none' : 'block';
    State.attachedFiles.forEach((f, i) => {
      const el = document.createElement('div');
      el.className = 'file-preview';
      el.innerHTML = `<div class="file-preview-icon">📄</div><div class="file-preview-info"><span class="file-preview-name">${f.name}</span></div><button class="file-remove-btn" data-index="${i}">✕</button>`;
      list.appendChild(el);
    });
    list.querySelectorAll('.file-remove-btn').forEach(b => b.addEventListener('click', (e) => {
        State.attachedFiles.splice(e.target.dataset.index, 1);
        renderFiles();
        // SYNC FILES TO BACKGROUND
        chrome.runtime.sendMessage({ action: 'updateFiles', files: State.attachedFiles });
    }));
  }

  // Settings
  $('btn-save-settings').addEventListener('click', () => {
    const settings = {
        delayType: $('delay-fixed').checked ? 'fixed' : 'random',
        fixedDelay: parseInt($('fixed-delay-val').value),
        randomMin: parseInt($('random-min').value),
        randomMax: parseInt($('random-max').value),
        dailyLimit: parseInt($('daily-limit').value),
        smartSleepCount: parseInt($('smart-sleep-count').value),
        smartSleepMins: parseInt($('smart-sleep-mins').value),
        stopOnClose: $('stop-on-close').checked,
        retryCount: parseInt($('retry-count').value),
    };
    chrome.runtime.sendMessage({ action: 'updateSettings', settings });
    $('settings-saved-msg').classList.remove('hidden');
    setTimeout(() => $('settings-saved-msg').classList.add('hidden'), 2000);
  });

  // Contacts
  $('btn-parse-contacts').addEventListener('click', parseContacts);
  
  // Clear Main Input & State
  $('btn-clear-contacts').addEventListener('click', () => { 
      $('contacts-manual').value = ''; 
      State.contacts = []; 
      renderContactList(); 
      chrome.runtime.sendMessage({ action: 'updateContacts', contacts: [] });
  });

  // Clear Parsed List Only (Keep Main Input)
  $('btn-clear-all-parsed').addEventListener('click', () => {
      State.contacts = []; 
      renderContactList(); 
      chrome.runtime.sendMessage({ action: 'updateContacts', contacts: [] });
      addLog('Cleared parsed contacts.', 'info');
  });

  // Remove invalid (formatting only)
  $('btn-remove-invalid').addEventListener('click', () => { 
      State.contacts = State.contacts.filter(c => c.valid); 
      renderContactList();
      chrome.runtime.sendMessage({ action: 'updateContacts', contacts: State.contacts });
  });
  
  // Clean List Button (Not on WA)
  $('btn-clean-list').addEventListener('click', () => {
      State.contacts = State.contacts.filter(c => c.waStatus !== 'fail');
      renderContactList();
      chrome.runtime.sendMessage({ action: 'updateContacts', contacts: State.contacts });
      addLog('Cleared non-WhatsApp numbers from campaign.', 'info');
  });

  // Campaign Actions
  $('btn-start').addEventListener('click', () => {
    if (!State.contacts.length) return addLog('No contacts loaded!', 'warn');
    const msg = $('message-input').value.trim();
    if (!msg) return addLog('Please enter a message!', 'warn');

    chrome.runtime.sendMessage({ 
        action: 'startCampaign', 
        payload: { 
            contacts: State.contacts,
            attachedFiles: State.attachedFiles,
            messageTemplate: msg, // Pass template, background handles spintax
            campaign: { running: true, currentIndex: 0, sent: 0, failed: 0 }
        }
    });
    addLog('Campaign started (running in background)', 'info');
  });

  $('btn-validate-contacts').addEventListener('click', () => {
    if (!State.contacts.length) return addLog('No contacts loaded!', 'warn');
    chrome.runtime.sendMessage({ 
        action: 'startCampaign', 
        campaignType: 'validation',
        payload: { 
            contacts: State.contacts,
            campaign: { currentIndex: 0, sent: 0, failed: 0 } 
        }
    });
    addLog('Validation started (running in background)', 'info');
  });

  $('btn-pause').addEventListener('click', () => chrome.runtime.sendMessage({ action: 'pauseCampaign' }));
  $('btn-resume').addEventListener('click', () => chrome.runtime.sendMessage({ action: 'resumeCampaign' }));
  $('btn-stop').addEventListener('click', () => chrome.runtime.sendMessage({ action: 'stopCampaign' }));

  $('message-input').addEventListener('input', updateCharCount);
  function updateCharCount() { $('char-count').textContent = $('message-input').value.length + ' chars'; }
});
