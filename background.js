// ============================================================
// Bulk Inline Forward - Thunderbird Extension
// Based on One-Click Forward by David Trapp (CherryDT)
// Extended with multi-select batch forwarding
// ============================================================

// Migrate old configs on extension load
const initPromise = (async () => {
  const { forwardingConfigs, forwardingAddresses } = await browser.storage.local.get({
    forwardingConfigs: [],
    forwardingAddresses: []
  })
  if (!forwardingConfigs.length && forwardingAddresses.length) {
    const migrated = migrateV1ToV2Configs(forwardingAddresses)
    await browser.storage.local.set({ forwardingConfigs: migrated })
    await browser.storage.local.remove('forwardingAddresses')
    return
  }
  const { migrated, didMigrate } = migrateV2ToV2_1Configs(forwardingConfigs)
  if (didMigrate) {
    await browser.storage.local.set({ forwardingConfigs: migrated })
  }
})().catch(e => console.error('Config migration failed:', e))

async function getConfigs() {
  await initPromise
  const { forwardingConfigs } = await browser.storage.local.get({ forwardingConfigs: [] })
  return forwardingConfigs
}

// Load settings with defaults
async function getSettings() {
  const defaults = {
    delayBetweenSends: 1500,
    confirmBeforeSend: true
  }
  const stored = await browser.storage.local.get({ bulkSettings: defaults })
  const settings = { ...defaults, ...stored.bulkSettings }
  const delay = Number(settings.delayBetweenSends)
  settings.delayBetweenSends = Number.isFinite(delay) ? Math.min(10000, Math.max(500, delay)) : 1500
  settings.confirmBeforeSend = settings.confirmBeforeSend !== false
  return settings
}

// Instant paths (shortcut, Alt+click) may skip the popup only when the user
// turned confirmation off, and never when the originals get deleted.
function requiresConfirmation(config, settings) {
  return settings.confirmBeforeSend || config.actionAfter === 'delete'
}

// ============================================================
// Identity resolution helpers
// ============================================================

async function getIdentityIdForMessage(messageId) {
  const messageHeader = await browser.messages.get(messageId)
  if (!messageHeader.folder) {
    throw new Error('Message has no folder - choose a sender identity in the configuration.')
  }
  const account = await browser.accounts.get(messageHeader.folder.accountId)
  const addressed = [
    ...(messageHeader.recipients || []),
    ...(messageHeader.ccList || [])
  ].map(r => r.replace(/^.*<|>.*$/g, '').trim().toLowerCase())
  const identity = (account.identities || []).find(id =>
    addressed.includes(id.email.toLowerCase())
  )
  if (identity) return identity.id

  const fallback = await browser.identities.getDefault(account.id)
  if (!fallback) {
    throw new Error(`Account "${account.name}" has no sender identity - choose one in the configuration.`)
  }
  return fallback.id
}

async function listIdentities() {
  const accounts = await browser.accounts.list()
  return accounts.flatMap(account => account.identities || [])
}

// Configs store an identity id. Older configs stored an email address; that
// is only accepted when it matches exactly one identity. A missing or
// ambiguous sender is an error, never a silent fallback to another account.
async function getIdentityIdFromConfig(messageId, fromIdentity) {
  if (fromIdentity === 'default') {
    return getIdentityIdForMessage(messageId)
  }
  const identities = await listIdentities()
  const byId = identities.find(id => id.id === fromIdentity)
  if (byId) return byId.id

  const byEmail = identities.filter(id => id.email === fromIdentity)
  if (byEmail.length === 1) return byEmail[0].id
  if (byEmail.length > 1) {
    throw new Error(`Sender "${fromIdentity}" matches several identities - pick one in the settings.`)
  }
  throw new Error(`Sender identity "${fromIdentity}" no longer exists - pick one in the settings.`)
}

// ============================================================
// Folder helpers (from original)
// ============================================================

async function getTrashFolderId(accountId) {
  const account = await browser.accounts.get(accountId)
  let trashFolder = account.folders.find(f => f.type === 'trash')
  if (trashFolder) return trashFolder.id

  const accounts = await browser.accounts.list()
  const localAccount = accounts.find(acc => acc.type === 'none')
  if (localAccount) {
    trashFolder = localAccount.folders.find(f => f.type === 'trash')
    if (trashFolder) return trashFolder.id
  }
  return null
}

async function getArchiveFolderId(accountId) {
  const account = await browser.accounts.get(accountId)
  let archiveFolder = account.folders.find(f => f.type === 'archive' || f.type === 'archives')
  if (archiveFolder) return archiveFolder.id

  const accounts = await browser.accounts.list()
  const localAccount = accounts.find(acc => acc.type === 'none')
  if (localAccount) {
    archiveFolder = localAccount.folders.find(f => f.type === 'archive' || f.type === 'archives')
    if (archiveFolder) return archiveFolder.id
  }
  return null
}

// ============================================================
// Post-forward action (from original)
// ============================================================

async function applyPostForwardAction(actionAfter, messageId, accountId) {
  if (actionAfter === 'archive') {
    if (browser.messages.archive) {
      await browser.messages.archive([messageId])
      return
    }
    const archiveId = await getArchiveFolderId(accountId)
    if (archiveId) {
      await browser.messages.move([messageId], archiveId)
    }
    return
  }

  if (actionAfter === 'trash') {
    const trashId = await getTrashFolderId(accountId)
    if (trashId) {
      await browser.messages.move([messageId], trashId)
    }
    return
  }

  if (actionAfter === 'delete') {
    if (browser.messages.delete) {
      await browser.messages.delete([messageId], true)
    }
  }
}

// ============================================================
// Sending
// ============================================================

// Sends immediately. Returns true only when Thunderbird reports the message
// as sent; a message placed in the Outbox (send later / offline) returns
// false so that the original is never archived or deleted before delivery.
async function sendComposeNow(tabId) {
  const result = await browser.compose.sendMessage(tabId, { mode: 'sendNow' })
  if (result === false) return false
  if (result && typeof result === 'object' && result.mode && result.mode !== 'sendNow') {
    return false
  }
  return true
}

function buildComposeDetails(config, identityId) {
  return {
    to: config.recipients.map(r =>
      (r.includes('@') || r.includes('<')) ? r : `${r} <${r}>`
    ),
    identityId
  }
}

// Forwards one message. Sending and cleanup are reported separately: once
// the forward is sent it counts as sent, even if the cleanup fails, so that
// a retry never produces a duplicate.
// Returns { status: 'sent' | 'queued' | 'opened', cleanupError }.
async function forwardOne(config, messageId, compose, delay) {
  const identityId = await getIdentityIdFromConfig(messageId, config.fromIdentity)
  const forwardType = config.forwardType === 'attachment' ? 'forwardAsAttachment' : 'forwardInline'
  const tab = await browser.compose.beginForward(messageId, forwardType, buildComposeDetails(config, identityId))

  if (compose) return { status: 'opened', cleanupError: null }

  // Wait for compose window to be ready
  await new Promise(resolve => setTimeout(resolve, delay))
  const sentNow = await sendComposeNow(tab.id)
  if (!sentNow) return { status: 'queued', cleanupError: null }

  if (config.actionAfter === 'none') return { status: 'sent', cleanupError: null }
  try {
    const header = await browser.messages.get(messageId)
    await applyPostForwardAction(config.actionAfter, messageId, header.folder.accountId)
    return { status: 'sent', cleanupError: null }
  } catch (e) {
    console.error('Post-forward action failed:', e)
    return { status: 'sent', cleanupError: String(e) }
  }
}

// ============================================================
// Single-message forward (original, for message_display_action)
// ============================================================

async function getDisplayedMessageId() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true })
  const message = await browser.messageDisplay.getDisplayedMessage(tabs[0].id)
  return message.id
}

async function performSingleForward(config, compose = false) {
  config = migrateV2ToV2_1Config(config)
  const messageId = await getDisplayedMessageId()
  const { status, cleanupError } = await forwardOne(config, messageId, compose, 1500)

  if (status === 'queued') {
    browser.notifications.create({
      type: 'basic',
      title: 'Forward queued',
      message: 'The forward was placed in the Outbox. The original was left untouched.'
    })
  } else if (cleanupError) {
    browser.notifications.create({
      type: 'basic',
      title: 'Forwarded, but post-forward action failed',
      message: cleanupError
    })
  }
}

// ============================================================
// BATCH forward - the new feature
// ============================================================

// Active batch operation; doubles as the lock that prevents overlapping
// batches (popup, context menu, shortcut and Alt+click all end up here).
let activeBatch = null

// Messages captured when the bulk popup is opened. The context menu can
// target messages other than the normal selection, and the popup may open
// as a separate window (toolbar button removed) where "current window" no
// longer is the mail window - so the popup previews these instead of
// re-reading the selection.
let pendingSelection = null
const PENDING_SELECTION_TTL_MS = 60000

async function collectMessageList(list) {
  let messages = list.messages || []
  let nextPage = list.id
  while (nextPage) {
    // A failed page aborts: forwarding a silent subset is worse than nothing
    const more = await browser.messages.continueList(nextPage)
    messages = messages.concat(more.messages || [])
    nextPage = more.id
  }
  return messages
}

async function getSelectedMessages() {
  const mailTabs = await browser.mailTabs.query({ active: true, currentWindow: true })
  if (!mailTabs.length) return []

  const selectedList = await browser.mailTabs.getSelectedMessages(mailTabs[0].id)
  return collectMessageList(selectedList)
}

// Messages the popup should preview: the ones captured when it was opened,
// otherwise the current selection.
async function getPreviewMessages() {
  if (pendingSelection && Date.now() - pendingSelection.at < PENDING_SELECTION_TTL_MS) {
    return pendingSelection.messages
  }
  pendingSelection = null
  return getSelectedMessages()
}

async function getMessagesByIds(messageIds) {
  const messages = []
  for (const id of messageIds) {
    messages.push(await browser.messages.get(id))
  }
  return messages
}

function notifyBatchBusy() {
  browser.notifications.create({
    type: 'basic',
    title: 'Bulk Forward',
    message: 'A batch forward is already running. Wait for it to finish.'
  })
}

// messageIds: the exact messages the user confirmed. Without it (instant
// paths) the current selection is used.
async function performBatchForward(config, compose = false, messageIds = null) {
  if (activeBatch) {
    notifyBatchBusy()
    return { success: false, error: 'A batch forward is already running' }
  }
  // Take the lock before the first await
  activeBatch = { total: 0, current: 0, compose, results: null }

  try {
    config = migrateV2ToV2_1Config(config)
    const settings = await getSettings()
    const messages = messageIds ? await getMessagesByIds(messageIds) : await getSelectedMessages()
    pendingSelection = null

    if (!messages.length) {
      browser.notifications.create({
        type: 'basic',
        title: 'Bulk Forward',
        message: 'No emails selected. Select emails in the message list first.'
      })
      return { success: false, error: 'No emails selected' }
    }

    const total = messages.length
    const delay = settings.delayBetweenSends
    const results = { sent: 0, queued: 0, opened: 0, failed: 0, cleanupFailed: 0, errors: [] }
    activeBatch.total = total
    activeBatch.results = results

    for (let i = 0; i < total; i++) {
      const msg = messages[i]
      activeBatch.current = i + 1

      try {
        const { status, cleanupError } = await forwardOne(config, msg.id, compose, delay)
        results[status]++
        if (cleanupError) {
          results.cleanupFailed++
          results.errors.push({ subject: msg.subject || '(no subject)', stage: 'cleanup', error: cleanupError })
        }
      } catch (e) {
        results.failed++
        results.errors.push({ subject: msg.subject || '(no subject)', stage: 'send', error: String(e) })
        console.error(`Failed to forward message "${msg.subject}":`, e)
      }

      // Broadcast progress to any open popup
      browser.runtime.sendMessage({
        action: 'batchProgress',
        current: i + 1,
        total,
        compose,
        results: { ...results }
      }).catch(() => {}) // Popup might be closed
    }

    // Summary notification
    const parts = []
    if (compose) {
      parts.push(`Opened ${results.opened} compose window(s) for review.`)
    } else {
      parts.push(`Forwarded ${results.sent}/${total} email(s).`)
      if (results.queued) parts.push(`${results.queued} queued in Outbox (originals kept).`)
      if (results.cleanupFailed) parts.push(`${results.cleanupFailed} post-forward action(s) failed.`)
    }
    if (results.failed) parts.push(`${results.failed} failed.`)
    browser.notifications.create({
      type: 'basic',
      title: compose ? 'Bulk Forward' : 'Bulk Forward Complete',
      message: parts.join(' ')
    })

    return { success: results.failed === 0, results }
  } finally {
    activeBatch = null
  }
}

// ============================================================
// Event listeners
// ============================================================

// Opens the bulk popup for `messages` (captured by the caller while the mail
// window is still the current one). Uses the toolbar button's popup; when
// that is unavailable (button removed from the toolbar, or the window has
// no toolbar) the same page opens as a small separate window.
async function openBulkPopup(tabId, messages) {
  pendingSelection = { messages, at: Date.now() }

  let opened = false
  try {
    await browser.browserAction.setPopup({
      tabId,
      popup: 'popup/bulkForward.html'
    })
    // Returns false (or throws) when the action is not available
    opened = (await browser.browserAction.openPopup()) !== false
  } catch (e) {
    console.warn('Toolbar popup unavailable, opening a window instead:', e)
  } finally {
    await browser.browserAction.setPopup({
      tabId,
      popup: ''
    }).catch(() => {})
  }

  if (!opened) {
    await browser.windows.create({
      url: browser.runtime.getURL('popup/bulkForward.html'),
      type: 'popup',
      width: 400,
      height: 560
    })
  }
}

async function getActiveTabId() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true })
  return tabs.length ? tabs[0].id : undefined
}

// Shortcut / Alt+click: forward with the first config, unless confirmation
// is required, in which case the popup is opened instead.
async function instantBatchForward(tabId) {
  const forwardingConfigs = await getConfigs()
  if (!forwardingConfigs.length) {
    browser.notifications.create({
      type: 'basic',
      title: 'Bulk Forward',
      message: 'No forwarding configurations. Open extension settings first.'
    })
    return
  }
  const config = migrateV2ToV2_1Config(forwardingConfigs[0])
  const settings = await getSettings()
  if (requiresConfirmation(config, settings)) {
    const messages = await getSelectedMessages()
    if (tabId === undefined) tabId = await getActiveTabId()
    if (tabId === undefined) return
    await openBulkPopup(tabId, messages)
    return
  }
  await performBatchForward(config)
}

// --- browser_action: toolbar button for BATCH forwarding ---
browser.browserAction.onClicked.addListener(async (tab, info) => {
  try {
    if (info && info.modifiers && info.modifiers.includes('Alt')) {
      await instantBatchForward(tab.id)
    } else {
      await openBulkPopup(tab.id, await getSelectedMessages())
    }
  } catch (e) {
    console.error(e)
    browser.notifications.create({
      type: 'basic',
      title: 'Bulk forward failed!',
      message: String(e)
    })
  }
})

// --- message_display_action: single-message quick forward (original behavior) ---
browser.messageDisplayAction.onClicked.addListener(async (tab, info) => {
  const forwardingConfigs = await getConfigs()

  if (info.modifiers.includes('Alt') && forwardingConfigs.length) {
    try {
      await performSingleForward(forwardingConfigs[0])
    } catch (e) {
      console.error(e)
      browser.notifications.create({
        type: 'basic',
        title: 'Auto-forwarding failed!',
        message: String(e)
      })
    }
  } else {
    try {
      await browser.messageDisplayAction.setPopup({
        tabId: tab.id,
        popup: 'popup/chooseRecipient.html'
      })
      await browser.messageDisplayAction.openPopup()
    } finally {
      await browser.messageDisplayAction.setPopup({
        tabId: tab.id,
        popup: ''
      })
    }
  }
})

// --- Keyboard shortcut: Ctrl+Shift+F ---
browser.commands.onCommand.addListener(async (command) => {
  if (command === 'bulk-forward-first') {
    try {
      await instantBatchForward()
    } catch (e) {
      console.error(e)
      browser.notifications.create({
        type: 'basic',
        title: 'Bulk forward failed!',
        message: String(e)
      })
    }
  }
})

// --- Message handler from popups ---
browser.runtime.onMessage.addListener(async (message) => {
  // Single forward from message display popup
  if (message.action === 'chooseRecipient') {
    try {
      await performSingleForward(message.config, message.compose)
    } catch (e) {
      console.error(e)
      browser.notifications.create({
        type: 'basic',
        title: 'Forwarding failed!',
        message: String(e)
      })
    }
  }

  // Batch forward from toolbar popup
  if (message.action === 'batchForward') {
    try {
      return await performBatchForward(message.config, message.compose, message.messageIds)
    } catch (e) {
      console.error(e)
      browser.notifications.create({
        type: 'basic',
        title: 'Bulk forward failed!',
        message: String(e)
      })
      return { success: false, error: String(e) }
    }
  }

  // Messages the popup will forward: count, preview subjects and exact ids
  if (message.action === 'getSelectedCount') {
    const msgs = await getPreviewMessages()
    return {
      count: msgs.length,
      messageIds: msgs.map(m => m.id),
      subjects: msgs.slice(0, 5).map(m => m.subject || '(no subject)')
    }
  }

  // Request active batch progress
  if (message.action === 'getBatchProgress') {
    return activeBatch
  }

  if (message.action === 'getSettings') {
    return getSettings()
  }
})

// --- Context menu: right-click on selected messages ---
browser.menus.create({
  id: 'bulk-forward-menu',
  title: 'Bulk Forward Selected',
  contexts: ['message_list']
})

browser.menus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'bulk-forward-menu') return
  try {
    // Capture the context-menu target now: it can differ from the selection
    const messages = info.selectedMessages
      ? await collectMessageList(info.selectedMessages)
      : await getSelectedMessages()

    let tabId = tab && tab.id
    if (tabId === undefined) tabId = await getActiveTabId()
    if (tabId === undefined) return
    await openBulkPopup(tabId, messages)
  } catch (e) {
    console.error(e)
    browser.notifications.create({
      type: 'basic',
      title: 'Bulk forward failed!',
      message: String(e)
    })
  }
})
