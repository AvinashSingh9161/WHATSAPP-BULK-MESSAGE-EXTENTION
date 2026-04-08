/* =====================================================
   WA Bulk Sender – Popup Script
   Handles: tabs, contacts, emoji, file preview,
            campaign control, progress, logs, settings
   ===================================================== */

// ── State ──────────────────────────────────────────────
const State = {
  contacts:       [],    // array of { number, name, valid }
  attachedFiles:  [],    // array of File objects
  campaign: {
    running:      false,
    paused:       false,
    loopActive:   false,
    currentIndex: 0,
    sent:         0,
    failed:       0,
    timer:        null,
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
function addLog(msg, type = 'info', skipSave = false, time = null) {
  const entry = { msg, type, time: time || formatTime() };
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

  if (!skipSave && typeof saveState === 'function') saveState();
}

// ── State & Settings Persistence ─────────────────────────
function saveState() {
  chrome.storage.local.set({ 
    wa_data: {
      message: $('message-input').value,
      contactsRaw: $('contacts-manual').value,
      campaignSent: State.campaign.sent,
      campaignFailed: State.campaign.failed,
      campaignIndex: State.campaign.currentIndex,
      logs: State.logs.slice(-50)
    }
  });
}

function loadState(cb) {
  chrome.storage.local.get('wa_data', ({ wa_data }) => {
    if (wa_data) {
      if (wa_data.message) {
        $('message-input').value = wa_data.message;
        updateCharCount();
      }
      if (wa_data.contactsRaw) {
        $('contacts-manual').value = wa_data.contactsRaw;
        parseContacts();
      }
      if (wa_data.campaignIndex !== undefined && wa_data.campaignIndex > 0) {
        State.campaign.sent = wa_data.campaignSent || 0;
        State.campaign.failed = wa_data.campaignFailed || 0;
        State.campaign.currentIndex = wa_data.campaignIndex || 0;
        $('progress-section').style.display = 'block';
        updateProgress();
        
        if (State.campaign.currentIndex < State.contacts.length) {
          State.campaign.paused = true;
          State.campaign.running = true;
          setControlsState(true, true);
          setStatus('Campaign paused (Popup was closed). Click Resume to continue.');
        } else {
          setControlsState(false, false);
          setStatus('Campaign completed previously.');
        }
      }
      if (wa_data.logs && wa_data.logs.length > 0) {
         State.logs = []; // clear first
         wa_data.logs.forEach(l => addLog(l.msg, l.type, true, l.time));
      }
    }
    if (cb) cb();
  });
}

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
  $('smart-sleep-count').value = State.settings.smartSleepCount;
  $('smart-sleep-mins').value  = State.settings.smartSleepMins;
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
  State.settings.smartSleepCount = parseInt($('smart-sleep-count').value) || 50;
  State.settings.smartSleepMins  = parseInt($('smart-sleep-mins').value) || 10;
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
      if (typeof saveState === 'function') saveState();
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
  const list    = $('file-preview-list');

  function renderFiles() {
    list.innerHTML = '';
    
    if (State.attachedFiles.length === 0) {
      content.style.display = 'block';
      return;
    }
    content.style.display = 'none';

    State.attachedFiles.forEach((file, index) => {
      const el = document.createElement('div');
      el.className = 'file-preview';
      el.innerHTML = `
        <div class="file-preview-icon">${getFileIcon(file)}</div>
        <div class="file-preview-info">
          <span class="file-preview-name">${file.name}</span>
          <span class="file-preview-size">${formatBytes(file.size)}</span>
        </div>
        <button class="file-remove-btn" data-index="${index}" title="Remove file">✕</button>
      `;
      list.appendChild(el);
    });

    list.querySelectorAll('.file-remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(e.target.dataset.index);
        State.attachedFiles.splice(idx, 1);
        renderFiles();
      });
    });
  }

  function addFiles(files) {
    if (!files || !files.length) return;
    
    let totalSize = State.attachedFiles.reduce((acc, f) => acc + f.size, 0);
    
    for (let i = 0; i < files.length; i++) {
        totalSize += files[i].size;
    }
    
    if (totalSize > 16 * 1024 * 1024) {
      addLog('Total files too large (max 16 MB)', 'warn');
      return;
    }

    State.attachedFiles = [...State.attachedFiles, ...Array.from(files)];
    renderFiles();
  }

  input.addEventListener('change', () => addFiles(input.files));

  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    addFiles(e.dataTransfer.files);
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

// ── Spintax & Personalization ──────────────────────────────
function parseSpintax(text) {
  const spintaxRegex = /\{([^}]+)\}/g;
  let matches;
  while ((matches = spintaxRegex.exec(text)) !== null) {
      if (matches[1].toLowerCase() === 'name') continue; // Skip {name}
      const options = matches[1].split('|');
      const randomOption = options[Math.floor(Math.random() * options.length)];
      text = text.substring(0, matches.index) + randomOption + text.substring(matches.index + matches[0].length);
      spintaxRegex.lastIndex = 0; // Reset index to rescan
  }
  return text;
}

function processMessage(msgTemplate, contactName) {
  if (!msgTemplate) return '';
  let finalMsg = parseSpintax(msgTemplate);
  if (contactName) {
    finalMsg = finalMsg.replace(/\{name\}/gi, contactName.trim());
  } else {
    finalMsg = finalMsg.replace(/\{name\}/gi, ''); // Fallback empty
  }
  return finalMsg.trim();
}

// ── Parse Contacts ────────────────────────────────────────
function parseContacts() {
  const raw   = $('contacts-manual').value.trim();
  if (!raw) return;

  // Split by newlines (we don't split by commas anymore because CSV has commas for names)
  const lines = raw.split(/[\n;\r]+/).map(l => l.trim()).filter(Boolean);

  // Deduplicate
  const seen  = new Set();
  const parsed = [];

  lines.forEach(line => {
    // Try to extract number (handles "Name, 919876543210" CSV style)
    const numMatch = line.match(/(\d[\d\s\-\(\)]{9,})/);
    if (!numMatch) {
      parsed.push({ number: line, name: '', valid: false });
      return;
    }
    const num = cleanNumber(numMatch[1]);
    
    // Extract everything else as a potential name
    let name = line.replace(numMatch[0], '').replace(/^[,:\s-]+|[,:\s-]+$/g, '').trim();

    if (seen.has(num)) return;
    seen.add(num);
    parsed.push({ number: num, name: name, valid: validatePhoneNumber(num) });
  });

  State.contacts = parsed;
  renderContactList();
  if (typeof saveState === 'function') saveState();
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
    const nameSpan = c.name ? `<span style="font-size: 10px; color: var(--text-muted); margin-left: 6px;">(${c.name})</span>` : '';
    item.innerHTML = `
      <div>
        <span class="contact-number">+${c.number}</span>
        ${nameSpan}
      </div>
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

  if (typeof saveState === 'function') saveState();
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

async function sendToNumber(number, message, files, retryLeft) {
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
            files
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
                  sendToNumber(number, message, files, retryLeft - 1)
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

  // Prepare files if any
  let filePayloads = [];

  if (State.attachedFiles && State.attachedFiles.length > 0) {
    const readFile = (file) => new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = (e) => res({ dataUrl: e.target.result, name: file.name, type: file.type });
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    for (const f of State.attachedFiles) {
      filePayloads.push(await readFile(f));
    }
    addLog(`${filePayloads.length} attachment(s) ready`, 'info');
  }

  State.campaign.running = true;
  State.campaign.paused  = false;
  State.campaign.loopActive = true;

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

    // Personalize message
    const processedMsg = processMessage(message, contact.name);

    setStatus(`Sending to +${contact.number}… (${i + 1}/${validContacts.length})`);
    updateProgress();

    const result = await sendToNumber(
      contact.number,
      processedMsg,
      filePayloads,
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
    if (typeof saveState === 'function') saveState();

    // Delay before next (skip delay after last)
    if (i < validContacts.length - 1 && State.campaign.running && !State.campaign.paused) {
      // Smart Sleep check
      if ((sentToday % State.settings.smartSleepCount) === 0 && sentToday > 0) {
         const sleepMins = State.settings.smartSleepMins;
         addLog(`Anti-Ban: Sleeping for ${sleepMins} mins...`, 'info');
         for (let m = sleepMins * 60; m > 0; m--) {
             if (!State.campaign.running || State.campaign.paused) break;
             setStatus(`Anti-Ban Sleep: ${m}s remaining`);
             await sleep(1000);
         }
      }
      
      const delay = getDelay();
      const secs  = Math.round(delay / 1000);
      setStatus(`Waiting ${secs}s before next message…`);
      await sleep(delay);
    }
  }

  State.campaign.loopActive = false;
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
    loadState(() => {
      initTabs();
      initEmojiPicker();
      initFileAttachment();
      initContactUpload();
      checkWhatsAppStatus();
    });

    // Char counter
    $('message-input').addEventListener('input', () => {
      updateCharCount();
      if (typeof saveState === 'function') saveState();
    });

    $('contacts-manual').addEventListener('input', () => {
      if (typeof saveState === 'function') saveState();
    });

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
      if (typeof saveState === 'function') saveState();
    });

    // Remove invalid
    $('btn-remove-invalid').addEventListener('click', () => {
      State.contacts = State.contacts.filter(c => c.valid);
      $('contacts-manual').value = State.contacts.map(c => c.number).join('\n');
      renderContactList();
      if (typeof saveState === 'function') saveState();
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
      if (typeof saveState === 'function') saveState();
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
      if (!State.campaign.loopActive) {
        runCampaign();
      }
    });

    $('btn-stop').addEventListener('click', () => {
      State.campaign.running = false;
      State.campaign.paused  = false;
      setControlsState(false, false);
      setStatus('Campaign stopped by user.');
      addLog('Campaign stopped.', 'warn');
    });

    // Quick Chat
    $('btn-quickchat-open').addEventListener('click', () => {
      const num = cleanNumber($('quickchat-number').value);
      if (validatePhoneNumber(num)) {
        getWaTab((waTab) => {
          const url = `https://web.whatsapp.com/send?phone=${num}`;
          if (waTab) {
            chrome.tabs.update(waTab.id, { active: true, url });
          } else {
            chrome.tabs.create({ url });
          }
        });
      } else {
        alert('Please enter a valid phone number with country code.');
      }
    });

    // Extract Group Contacts
    const btnExtract = document.getElementById('btn-extract-group');
    if (btnExtract) {
      btnExtract.addEventListener('click', () => {
        getWaTab((waTab) => {
          if (!waTab) {
            alert('Please open WhatsApp Web first.');
            return;
          }
          chrome.tabs.update(waTab.id, { active: true });
          chrome.tabs.sendMessage(waTab.id, { action: 'extractGroup' }, (res) => {
            if (res && res.contacts) {
              const curr = $('contacts-manual').value.trim();
              $('contacts-manual').value = (curr ? curr + '\n' : '') + res.contacts.join('\n');
              parseContacts();
              addLog(`Extracted ${res.contacts.length} group contacts`, 'success');
              if (typeof saveState === 'function') saveState();
            } else {
              alert('Failed to extract. Make sure a Group info sidebar is open on WhatsApp web.');
            }
          });
        });
      });
    }

    // Periodic WA status check
    setInterval(checkWhatsAppStatus, 10000);
  });
});
