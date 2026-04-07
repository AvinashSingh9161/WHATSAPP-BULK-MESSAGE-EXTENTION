/* =====================================================
   WA Bulk Sender – Popup Script
   Handles: tabs, contacts, emoji, file preview,
            campaign control, progress, logs, settings
   ===================================================== */

// ── State ──────────────────────────────────────────────
const State = {
  contacts:       [],    // array of { number, valid }
  attachedFile:   null,  // File object
  campaign: {
    running:      false,
    paused:       false,
    currentIndex: 0,
    sent:         0,
    failed:       0,
    timer:        null,
  },
  logs: [],
  settings: {
    delayType:    'fixed',
    fixedDelay:   10,
    randomMin:    8,
    randomMax:    15,
    dailyLimit:   80,
    stopOnClose:  true,
    retryCount:   1,
  },
};

// ── Emojis ──────────────────────────────────────────────
const EMOJIS = ['😊','😂','❤️','👍','🙏','🔥','✅','🎉','💪','😍',
  '🤝','📞','💰','🎁','⭐','📢','✨','🚀','💡','📱',
  '🌟','👋','😎','🤔','💬','📩','🏆','💼','🎯','⚡',
  '😃','😁','🥳','👌','🤩','💥','🔔','📌','🎀','🍀'];

// ── Utility ─────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

function formatTime(d = new Date()) {
  return d.toLocaleTimeString('en-GB', { hour12: false });
}

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function validatePhoneNumber(num) {
  const cleaned = num.replace(/\D/g, '');
  return cleaned.length >= 10 && cleaned.length <= 15;
}

function cleanNumber(num) {
  return num.replace(/\D/g, '').replace(/^0+/, '');
}

// ── Log System ───────────────────────────────────────────
function addLog(msg, type = 'info') {
  const entry = { msg, type, time: formatTime() };
  State.logs.push(entry);

  const container = $('log-container');
  const empty = container.querySelector('.log-empty');
  if (empty) empty.remove();

  const el = document.createElement('div');
  el.className = `log-item log-${type}`;
  el.innerHTML = `<span class="log-time">${entry.time}</span><span class="log-msg">${msg}</span>`;
  container.prepend(el);

  // Show export button
  $('logs-footer').style.display = 'block';

  // Keep max 200 logs in DOM
  const items = container.querySelectorAll('.log-item');
  if (items.length > 200) items[items.length - 1].remove();
}

// ── Settings Persistence ─────────────────────────────────
function saveSettings() {
  chrome.storage.local.set({ wa_settings: State.settings });
}

function loadSettings(cb) {
  chrome.storage.local.get('wa_settings', ({ wa_settings }) => {
    if (wa_settings) Object.assign(State.settings, wa_settings);
    applySettingsToUI();
    if (cb) cb();
  });
}

function applySettingsToUI() {
  $('fixed-delay-val').value = State.settings.fixedDelay;
  $('random-min').value      = State.settings.randomMin;
  $('random-max').value      = State.settings.randomMax;
  $('daily-limit').value     = State.settings.dailyLimit;
  $('stop-on-close').checked = State.settings.stopOnClose;
  $('retry-count').value     = State.settings.retryCount;

  $('delay-fixed').checked   = State.settings.delayType === 'fixed';
  $('delay-random').checked  = State.settings.delayType === 'random';
  updateDelayUI();
}

function readSettingsFromUI() {
  State.settings.delayType   = $('delay-fixed').checked ? 'fixed' : 'random';
  State.settings.fixedDelay  = parseInt($('fixed-delay-val').value) || 10;
  State.settings.randomMin   = parseInt($('random-min').value) || 8;
  State.settings.randomMax   = parseInt($('random-max').value) || 15;
  State.settings.dailyLimit  = parseInt($('daily-limit').value) || 80;
  State.settings.stopOnClose = $('stop-on-close').checked;
  State.settings.retryCount  = parseInt($('retry-count').value) || 1;
}

function updateDelayUI() {
  if ($('delay-fixed').checked) {
    $('fixed-delay-settings').classList.remove('hidden');
    $('random-delay-settings').classList.add('hidden');
  } else {
    $('fixed-delay-settings').classList.add('hidden');
    $('random-delay-settings').classList.remove('hidden');
  }
}

// ── Chrome Tab Helper ────────────────────────────────────
function getWaTab(callback) {
  chrome.tabs.query({}, (tabs) => {
    // Try to find a tab with whatsapp URL
    const waTabs = tabs.filter(t => t.url && t.url.includes('whatsapp.com'));
    if (waTabs && waTabs.length > 0) {
      return callback(waTabs[0]);
    }
    
    // Fallback if URL permissions fail or it's hidden: take the current active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
      if (activeTabs && activeTabs.length > 0) {
        return callback(activeTabs[0]);
      }
      callback(null);
    });
  });
}

// ── WhatsApp Status Check ────────────────────────────────
function checkWhatsAppStatus() {
  const badge = $('whatsapp-status');
  badge.className = 'status-badge status-checking';
  badge.querySelector('.status-text').textContent = 'Checking...';

  getWaTab((tab) => {
    if (tab) {
      badge.className = 'status-badge status-online';
      badge.querySelector('.status-text').textContent = 'WA Open';
    } else {
      badge.className = 'status-badge status-offline';
      badge.querySelector('.status-text').textContent = 'WA Closed';
    }
  });
}

// ── Tab Switching ────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $('panel-' + btn.dataset.tab).classList.add('active');
    });
  });
}

// ── Emoji Picker ─────────────────────────────────────────
function initEmojiPicker() {
  const grid = $('emoji-grid');
  EMOJIS.forEach(em => {
    const btn = document.createElement('button');
    btn.className = 'emoji-btn-item';
    btn.textContent = em;
    btn.title = em;
    btn.addEventListener('click', () => {
      const ta = $('message-input');
      const pos = ta.selectionStart;
      const val = ta.value;
      ta.value = val.slice(0, pos) + em + val.slice(pos);
      ta.selectionStart = ta.selectionEnd = pos + em.length;
      ta.focus();
      updateCharCount();
      $('emoji-panel').classList.add('hidden');
    });
    grid.appendChild(btn);
  });

  $('emoji-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('emoji-panel').classList.toggle('hidden');
  });

  document.addEventListener('click', () => {
    $('emoji-panel').classList.add('hidden');
  });
}

// ── Char Count ───────────────────────────────────────────
function updateCharCount() {
  const len = $('message-input').value.length;
  $('char-count').textContent = `${len} char${len !== 1 ? 's' : ''}`;
}

// ── File Attachment ─────────────────────────────────────
function initFileAttachment() {
  const input   = $('file-input');
  const zone    = $('drop-zone');
  const content = $('drop-zone-content');
  const preview = $('file-preview');

  function setFile(file) {
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) {
      addLog('File too large (max 16 MB)', 'warn');
      return;
    }
    State.attachedFile = file;
    $('file-preview-icon').textContent = getFileIcon(file);
    $('file-preview-name').textContent = file.name;
    $('file-preview-size').textContent = formatBytes(file.size);
    content.style.display = 'none';
    preview.classList.remove('hidden');
  }

  input.addEventListener('change', () => setFile(input.files[0]));

  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    setFile(e.dataTransfer.files[0]);
  });

  $('file-remove-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    State.attachedFile = null;
    input.value = '';
    content.style.display = '';
    preview.classList.add('hidden');
  });
}

// ── Contact CSV/TXT Uploader ──────────────────────────────
function initContactUpload() {
  const fileInput = $('contacts-file-input');
  const dropZone  = $('contact-drop-zone');

  function readFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      $('contacts-manual').value = e.target.result;
      parseContacts();
    };
    reader.readAsText(file);
  }

  fileInput.addEventListener('change', () => readFile(fileInput.files[0]));
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    readFile(e.dataTransfer.files[0]);
  });
  dropZone.addEventListener('click', () => fileInput.click());
}

// ── Parse Contacts ────────────────────────────────────────
function parseContacts() {
  const raw   = $('contacts-manual').value.trim();
  if (!raw) return;

  // Split by newlines or commas or semicolons
  const lines = raw.split(/[\n,;]+/).map(l => l.trim()).filter(Boolean);

  // Deduplicate
  const seen  = new Set();
  const parsed = [];

  lines.forEach(line => {
    // Try to extract number (handles "Name, 919876543210" CSV style)
    const match = line.match(/(\d[\d\s\-\(\)]{9,})/);
    if (!match) {
      parsed.push({ number: line, valid: false });
      return;
    }
    const num = cleanNumber(match[1]);
    if (seen.has(num)) return;
    seen.add(num);
    parsed.push({ number: num, valid: validatePhoneNumber(num) });
  });

  State.contacts = parsed;
  renderContactList();
}

function renderContactList() {
  const list    = $('contact-list');
  const section = $('contacts-preview-section');

  if (!State.contacts.length) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';

  const valid   = State.contacts.filter(c => c.valid).length;
  const invalid = State.contacts.filter(c => !c.valid).length;

  $('valid-count-badge').textContent  = `${valid} valid`;
  $('invalid-count-badge').textContent = `${invalid} invalid`;
  $('invalid-count-badge').style.display = invalid ? 'inline-flex' : 'none';
  $('btn-remove-invalid').style.display  = invalid ? 'inline-flex' : 'none';

  list.innerHTML = '';
  State.contacts.forEach((c, i) => {
    const item = document.createElement('div');
    item.className = 'contact-item';
    item.innerHTML = `
      <span class="contact-number">+${c.number}</span>
      <span class="${c.valid ? 'contact-status-valid' : 'contact-status-invalid'}">${c.valid ? '✓ Valid' : '✗ Invalid'}</span>
    `;
    list.appendChild(item);
  });
}

// ── Campaign Engine ───────────────────────────────────────
function getValidContacts() {
  return State.contacts.filter(c => c.valid);
}

function getDelay() {
  const s = State.settings;
  if (s.delayType === 'fixed') return s.fixedDelay * 1000;
  return randomBetween(s.randomMin, s.randomMax) * 1000;
}

function updateProgress() {
  const total     = getValidContacts().length;
  const sent      = State.campaign.sent;
  const failed    = State.campaign.failed;
  const remaining = Math.max(0, total - State.campaign.currentIndex);
  const pct       = total > 0 ? Math.round((State.campaign.currentIndex / total) * 100) : 0;

  $('stat-total').textContent     = total;
  $('stat-sent').textContent      = sent;
  $('stat-failed').textContent    = failed;
  $('stat-remaining').textContent = remaining;
  $('progress-bar-fill').style.width = pct + '%';
  $('progress-percent').textContent  = pct + '%';
}

function setStatus(msg) {
  $('current-status').textContent = msg;
}

function setControlsState(running, paused) {
  $('btn-start').style.display  = running ? 'none' : '';
  $('btn-pause').style.display  = (running && !paused) ? '' : 'none';
  $('btn-resume').style.display = (running && paused) ? '' : 'none';
  $('btn-stop').style.display   = running ? '' : 'none';
}

async function sendToNumber(number, message, fileDataUrl, fileName, fileType, retryLeft) {
  return new Promise((resolve) => {
    getWaTab((waTab) => {
      if (!waTab) {
        resolve({ success: false, error: 'WhatsApp Web not open' });
        return;
      }
      const url   = `https://web.whatsapp.com/send?phone=${number}`;

      chrome.tabs.update(waTab.id, { url }, () => {
        // Give WhatsApp Web time to load the chat
        const waitTime = 8000 + Math.round(Math.random() * 2000);

        setTimeout(() => {
          const payload = {
            action:     'sendMessage',
            number,
            message,
            fileDataUrl,
            fileName,
            fileType,
          };

          chrome.tabs.sendMessage(waTab.id, payload, (response) => {
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message });
            } else if (response && response.success) {
              resolve({ success: true });
            } else {
              const err = response ? response.error : 'Unknown error';
              if (retryLeft > 0) {
                setTimeout(() => {
                  sendToNumber(number, message, fileDataUrl, fileName, fileType, retryLeft - 1)
                    .then(resolve);
                }, 3000);
              } else {
                resolve({ success: false, error: err });
              }
            }
          });
        }, waitTime);
      });
    });
  });
}

async function runCampaign() {
  const validContacts = getValidContacts();
  const message       = $('message-input').value.trim();
  const maxAllowed    = State.settings.dailyLimit;

  if (!message) {
    addLog('Please enter a message before starting.', 'warn');
    return;
  }
  if (!validContacts.length) {
    addLog('No valid contacts to send to.', 'warn');
    return;
  }

  // Warn if over daily limit
  const toSend = validContacts.slice(State.campaign.currentIndex);
  if (toSend.length > maxAllowed) {
    addLog(`Daily limit is ${maxAllowed}. Will send to first ${maxAllowed} contacts.`, 'warn');
  }

  // Prepare file if any
  let fileDataUrl = null;
  let fileName    = null;
  let fileType    = null;

  if (State.attachedFile) {
    const readFile = (file) => new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = (e) => res(e.target.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    fileDataUrl = await readFile(State.attachedFile);
    fileName    = State.attachedFile.name;
    fileType    = State.attachedFile.type;
    addLog(`Attachment ready: ${fileName}`, 'info');
  }

  State.campaign.running = true;
  State.campaign.paused  = false;

  $('progress-section').style.display = 'block';
  setControlsState(true, false);
  addLog(`Campaign started. Sending to ${Math.min(toSend.length, maxAllowed)} contacts.`, 'info');

  let sentToday = 0;

  for (let i = State.campaign.currentIndex; i < validContacts.length; i++) {
    // Check limits
    if (sentToday >= maxAllowed) {
      addLog(`Daily limit of ${maxAllowed} reached. Campaign paused.`, 'warn');
      State.campaign.paused = true;
      setControlsState(true, true);
      setStatus('Daily limit reached. Resume tomorrow.');
      break;
    }

    // Pause check
    while (State.campaign.paused && State.campaign.running) {
      setStatus('Paused – click Resume to continue...');
      await sleep(1000);
    }

    // Stop check
    if (!State.campaign.running) {
      addLog('Campaign stopped by user.', 'warn');
      setStatus('Campaign stopped.');
      break;
    }

    State.campaign.currentIndex = i;
    const contact = validContacts[i];

    setStatus(`Sending to +${contact.number}… (${i + 1}/${validContacts.length})`);
    updateProgress();

    const result = await sendToNumber(
      contact.number,
      message,
      fileDataUrl,
      fileName,
      fileType,
      State.settings.retryCount
    );

    if (result.success) {
      State.campaign.sent++;
      sentToday++;
      addLog(`✓ Sent to +${contact.number}`, 'success');
    } else {
      State.campaign.failed++;
      addLog(`✗ Failed +${contact.number}: ${result.error}`, 'fail');
    }

    updateProgress();

    // Delay before next (skip delay after last)
    if (i < validContacts.length - 1 && State.campaign.running && !State.campaign.paused) {
      const delay = getDelay();
      const secs  = Math.round(delay / 1000);
      setStatus(`Waiting ${secs}s before next message…`);
      await sleep(delay);
    }
  }

  if (State.campaign.running && !State.campaign.paused) {
    State.campaign.running = false;
    setControlsState(false, false);
    updateProgress();
    setStatus(`Campaign complete! Sent: ${State.campaign.sent}, Failed: ${State.campaign.failed}`);
    addLog(`Campaign finished. Sent: ${State.campaign.sent}, Failed: ${State.campaign.failed}`, 'info');
  }
}

// ── Export Logs as CSV ────────────────────────────────────
function exportLogs() {
  const rows = [['Time', 'Type', 'Message']];
  State.logs.forEach(l => rows.push([l.time, l.type, l.msg]));
  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `wa-bulk-sender-log-${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Init ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Load settings first
  loadSettings(() => {
    initTabs();
    initEmojiPicker();
    initFileAttachment();
    initContactUpload();
    checkWhatsAppStatus();

    // Char counter
    $('message-input').addEventListener('input', updateCharCount);

    // Delay type toggle
    $('delay-fixed').addEventListener('change', updateDelayUI);
    $('delay-random').addEventListener('change', updateDelayUI);

    // Parse contacts
    $('btn-parse-contacts').addEventListener('click', parseContacts);

    // Clear contacts
    $('btn-clear-contacts').addEventListener('click', () => {
      $('contacts-manual').value = '';
      State.contacts = [];
      $('contacts-preview-section').style.display = 'none';
    });

    // Remove invalid
    $('btn-remove-invalid').addEventListener('click', () => {
      State.contacts = State.contacts.filter(c => c.valid);
      renderContactList();
    });

    // Save settings
    $('btn-save-settings').addEventListener('click', () => {
      readSettingsFromUI();
      saveSettings();
      $('settings-saved-msg').classList.remove('hidden');
      setTimeout(() => $('settings-saved-msg').classList.add('hidden'), 2000);
    });

    // Clear logs
    $('btn-clear-logs').addEventListener('click', () => {
      State.logs = [];
      $('log-container').innerHTML = '<div class="log-empty">No activity yet. Start a campaign to see logs.</div>';
      $('logs-footer').style.display = 'none';
    });

    // Export logs
    $('btn-export-logs').addEventListener('click', exportLogs);

    // Campaign controls
    $('btn-start').addEventListener('click', () => {
      State.campaign.currentIndex = 0;
      State.campaign.sent         = 0;
      State.campaign.failed       = 0;
      runCampaign();
    });

    $('btn-pause').addEventListener('click', () => {
      State.campaign.paused = true;
      setControlsState(true, true);
      addLog('Campaign paused.', 'info');
    });

    $('btn-resume').addEventListener('click', () => {
      State.campaign.paused = false;
      setControlsState(true, false);
      addLog('Campaign resumed.', 'info');
    });

    $('btn-stop').addEventListener('click', () => {
      State.campaign.running = false;
      State.campaign.paused  = false;
      setControlsState(false, false);
      setStatus('Campaign stopped by user.');
      addLog('Campaign stopped.', 'warn');
    });

    // Periodic WA status check
    setInterval(checkWhatsAppStatus, 10000);
  });
});
