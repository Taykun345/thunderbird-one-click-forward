let selectedCount = 0
let selectedMessageIds = []
let pendingConfig = null
let settings = { confirmBeforeSend: true }
let errorTimer = null

async function init() {
  try {
    listenForProgress()
    setupConfirmButtons()

    // A batch may already be running (popup reopened, shortcut, ...)
    const running = await browser.runtime.sendMessage({ action: 'getBatchProgress' })
    if (running) {
      showProgress(running.compose, running.total)
      if (running.results) renderProgress(running.current, running.total, running.results)
      return
    }

    settings = await browser.runtime.sendMessage({ action: 'getSettings' }) || settings
    await loadSelectionInfo()
    await buildConfigList()
  } catch (e) {
    console.error(e)
    showError(`Could not load: ${e}`)
  }
}

// ============================================================
// Selection info
// ============================================================

async function loadSelectionInfo() {
  const infoDiv = document.getElementById('selectionInfo')
  const countDiv = document.getElementById('selectionCount')
  const previewDiv = document.getElementById('selectionPreview')
  try {
    const result = await browser.runtime.sendMessage({ action: 'getSelectedCount' })
    selectedCount = result.count
    selectedMessageIds = result.messageIds
    previewDiv.replaceChildren()

    if (selectedCount === 0) {
      infoDiv.classList.add('no-selection')
      countDiv.textContent = 'No emails selected'
      appendLine(previewDiv, 'Select emails in the message list first.')
    } else {
      countDiv.textContent = `${selectedCount} email${selectedCount > 1 ? 's' : ''} selected`
      for (const subject of result.subjects) {
        appendLine(previewDiv, subject).title = subject
      }
      if (selectedCount > 5) {
        appendLine(previewDiv, `...and ${selectedCount - 5} more`)
      }
    }
  } catch (e) {
    console.error('Failed to get selection:', e)
    selectedCount = 0
    selectedMessageIds = []
    countDiv.textContent = 'Could not read selection'
  }
}

function appendLine(parent, text) {
  const div = document.createElement('div')
  div.textContent = text
  parent.appendChild(div)
  return div
}

// ============================================================
// Config list (forwarding targets)
// ============================================================

async function buildConfigList() {
  const { forwardingConfigs } = await browser.storage.local.get({ forwardingConfigs: [] })
  const { migrated, didMigrate } = migrateV2ToV2_1Configs(forwardingConfigs)
  if (didMigrate) {
    await browser.storage.local.set({ forwardingConfigs: migrated })
  }

  const container = document.getElementById('configList')

  if (!migrated.length) {
    const msg = document.createElement('div')
    msg.style.cssText = 'text-align:center; padding:12px; color:#888;'
    msg.innerHTML = 'No forwarding configs. <a href="#" id="openSettings">Create one</a>'
    container.appendChild(msg)
    msg.querySelector('#openSettings').addEventListener('click', () => {
      browser.runtime.openOptionsPage()
      window.close()
    })
    return
  }

  const actionLabels = {
    none: 'Keep',
    archive: 'Archive',
    trash: 'Trash',
    delete: 'Delete'
  }

  for (const config of migrated) {
    const btn = document.createElement('button')
    btn.className = 'config-btn'

    const displayName = config.name || getDefaultTitle(config.recipients) || '(unnamed)'
    const recipientList = config.recipients.join(', ')
    const actionLabel = actionLabels[config.actionAfter] || 'Keep'
    const typeLabel = config.forwardType === 'attachment' ? 'Attachment' : 'Inline'

    btn.innerHTML = `
      <span class="config-name">${escapeHtml(displayName)}</span>
      <span class="config-recipients">${escapeHtml(recipientList)}</span>
      <span class="config-detail">${typeLabel} | After: ${actionLabel}</span>
    `

    btn.addEventListener('click', (e) => {
      if (selectedCount === 0) {
        showError('Select emails in the message list first.')
        return
      }

      if (e.shiftKey) {
        // Shift+click = open compose windows for review
        startBatchForward(config, true)
        return
      }

      // Permanent delete always asks, whatever the setting says
      if (settings.confirmBeforeSend || config.actionAfter === 'delete') {
        showConfirmation(config)
      } else {
        startBatchForward(config, false)
      }
    })

    container.appendChild(btn)
  }
}

// ============================================================
// Confirmation
// ============================================================

function showConfirmation(config) {
  pendingConfig = config
  const displayName = config.name || getDefaultTitle(config.recipients) || config.recipients.join(', ')
  const afterText = {
    archive: ' The originals will be archived.',
    trash: ' The originals will be moved to Trash.',
    delete: ' The originals will be DELETED PERMANENTLY.'
  }[config.actionAfter] || ''

  document.getElementById('confirmText').innerHTML =
    `Forward <strong>${selectedCount} email${selectedCount > 1 ? 's' : ''}</strong> ` +
    `to <strong>${escapeHtml(displayName)}</strong> ` +
    `(${escapeHtml(config.recipients.join(', '))})?${afterText}`

  document.getElementById('confirmSection').classList.add('active')
}

function setupConfirmButtons() {
  document.getElementById('confirmSend').addEventListener('click', () => {
    if (pendingConfig) {
      startBatchForward(pendingConfig, false)
    }
  })

  document.getElementById('confirmCompose').addEventListener('click', () => {
    if (pendingConfig) {
      startBatchForward(pendingConfig, true)
    }
  })

  document.getElementById('confirmCancel').addEventListener('click', () => {
    pendingConfig = null
    document.getElementById('confirmSection').classList.remove('active')
  })
}

// ============================================================
// Batch forward execution
// ============================================================

function showProgress(compose, total) {
  document.getElementById('confirmSection').classList.remove('active')
  document.getElementById('progressOverlay').classList.add('active')
  document.getElementById('progressText').textContent = compose
    ? 'Opening compose windows...'
    : 'Forwarding emails...'
  document.getElementById('progressDetail').textContent = `0 / ${total}`
  document.getElementById('progressBar').style.width = '0%'
}

function hideProgress() {
  document.getElementById('progressOverlay').classList.remove('active')
}

async function startBatchForward(config, compose) {
  showProgress(compose, selectedCount)

  // Forward exactly the messages that were previewed and confirmed
  try {
    const response = await browser.runtime.sendMessage({
      action: 'batchForward',
      config,
      compose,
      messageIds: selectedMessageIds
    })
    if (response && response.error && !response.results) {
      hideProgress()
      showError(response.error)
    }
  } catch (e) {
    hideProgress()
    showError(`Bulk forward failed: ${e}`)
  }
}

// ============================================================
// Progress listener
// ============================================================

function summarize(results, compose) {
  const parts = [compose ? `${results.opened} opened for review` : `${results.sent} sent`]
  if (results.queued) parts.push(`${results.queued} queued in Outbox`)
  if (results.cleanupFailed) parts.push(`${results.cleanupFailed} post-action failed`)
  if (results.failed) parts.push(`${results.failed} failed`)
  return parts.join(', ')
}

function renderProgress(current, total, results) {
  const pct = total ? Math.round((current / total) * 100) : 0
  document.getElementById('progressBar').style.width = pct + '%'
  document.getElementById('progressDetail').textContent =
    `${current} / ${total}` +
    (results.failed ? ` (${results.failed} failed)` : '')
  return current >= total
}

function listenForProgress() {
  browser.runtime.onMessage.addListener((message) => {
    if (message.action !== 'batchProgress') return
    const { current, total, results, compose } = message
    if (!document.getElementById('progressOverlay').classList.contains('active')) {
      showProgress(compose, total)
    }
    if (!renderProgress(current, total, results)) return

    // These messages are done; a second click must not forward them again
    selectedCount = 0
    selectedMessageIds = []
    pendingConfig = null

    setTimeout(() => {
      document.getElementById('progressText').textContent = 'Done!'
      document.getElementById('progressDetail').textContent = summarize(results, compose)

      const problems = results.errors || []
      if (problems.length) {
        // Keep the popup open so failures can be read
        showError(problems.slice(0, 3).map(p => `${p.subject}: ${p.error}`).join('\n'), 0)
        hideProgress()
        document.getElementById('selectionCount').textContent = `Done - ${summarize(results, compose)}`
        return
      }
      setTimeout(() => window.close(), 2000)
    }, 300)
  })
}

// ============================================================
// Helpers
// ============================================================

// Escapes for element content AND quoted attributes
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function showError(msg, timeoutMs = 4000) {
  const el = document.getElementById('error')
  el.textContent = msg
  el.classList.add('active')
  clearTimeout(errorTimer)
  if (timeoutMs) errorTimer = setTimeout(() => el.classList.remove('active'), timeoutMs)
}

document.addEventListener('DOMContentLoaded', init)
