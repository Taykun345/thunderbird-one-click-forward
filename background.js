// Migrate old configs on extension load
(async () => {
  const { forwardingConfigs, forwardingAddresses } = await browser.storage.local.get({ forwardingConfigs: [], forwardingAddresses: [] })
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
})()

async function getMessageId () {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true })
  const tabId = tabs[0].id
  const message = await browser.messageDisplay.getDisplayedMessage(tabId)
  return message.id
}

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
  const identity = (account.identities || []).find(id => addressed.includes(id.email.toLowerCase()))
  if (identity) return identity.id

  // getDefault() returns null e.g. for Local Folders without an identity
  const fallback = await browser.identities.getDefault(account.id)
  if (!fallback) {
    throw new Error(`Account "${account.name}" has no sender identity - choose one in the configuration.`)
  }
  return fallback.id
}

async function getIdentityIdFromConfig(messageId, fromIdentity) {
  if (fromIdentity === 'default') {
    return getIdentityIdForMessage(messageId)
  }
  // Configs store an identity id. Older configs stored an email address;
  // that is only accepted when it matches exactly one identity. A missing or
  // ambiguous sender is an error, never a silent fallback to another account.
  const accounts = await browser.accounts.list()
  const identities = accounts.flatMap(account => account.identities || [])
  const byId = identities.find(id => id.id === fromIdentity)
  if (byId) return byId.id

  const byEmail = identities.filter(id => id.email === fromIdentity)
  if (byEmail.length === 1) return byEmail[0].id
  if (byEmail.length > 1) {
    throw new Error(`Sender "${fromIdentity}" matches several identities - pick one in the settings.`)
  }
  throw new Error(`Sender identity "${fromIdentity}" no longer exists - pick one in the settings.`)
}

async function getTrashFolderId(accountId) {
  const account = await browser.accounts.get(accountId)
  let trashFolder = account.folders.find(f => f.type === 'trash')
  if (trashFolder) return trashFolder.id

  // Fallback to local folders trash
  const accounts = await browser.accounts.list()
  const localAccount = accounts.find(acc => acc.type === 'none') // Local Folders
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

async function performForward(config, compose = false) {
  config = migrateV2ToV2_1Config(config)
  const messageId = await getMessageId()
  const identityId = await getIdentityIdFromConfig(messageId, config.fromIdentity)

  const composeDetails = {
    to: config.recipients.map(recipient => {
      if (recipient.includes('@') || recipient.includes('<')) {
        return recipient
      } else {
        return `${recipient} <${recipient}>`
      }
    }),
    identityId
  }

  const forwardType = config.forwardType === 'attachment' ? 'forwardAsAttachment' : 'forwardInline'
  const tab = await browser.compose.beginForward(messageId, forwardType, composeDetails)
  console.log(`Forwarding window opened with tabId: ${tab.id}`)

  if (!compose) {
    await new Promise(resolve => setTimeout(resolve, 1500)) // Fails if called too quickly after beginForward!
    if (!await sendComposeNow(tab.id)) {
      browser.notifications.create({
        "type": "basic",
        "title": "Forward queued",
        "message": "The forward was placed in the Outbox. The original was left untouched."
      })
      return
    }

    // The forward is sent: a failing cleanup must not be reported as a
    // failed forward, or a retry would send a duplicate.
    try {
      const messageHeader = await browser.messages.get(messageId)
      await applyPostForwardAction(config.actionAfter, messageId, messageHeader.folder.accountId)
    } catch (e) {
      console.error(e)
      browser.notifications.create({
        "type": "basic",
        "title": "Forwarded, but post-forward action failed",
        "message": String(e)
      })
    }
  }
}

// Sends immediately. Returns true only when Thunderbird reports the message
// as sent; a message placed in the Outbox (send later / offline) returns
// false so that the original is never archived or deleted before delivery.
async function sendComposeNow(tabId) {
  const result = await browser.compose.sendMessage(tabId, { mode: 'sendNow' })
  console.log('Sent:', result)
  if (result === false) return false
  if (result && typeof result === 'object' && result.mode && result.mode !== 'sendNow') {
    return false
  }
  return true
}

// Handle Alt+Click for auto-forward
browser.messageDisplayAction.onClicked.addListener(async (tab, info) => {
  const { forwardingConfigs } = await browser.storage.local.get({ forwardingConfigs: [] })
  console.log('Button clicked:', info);
  if (info.modifiers.includes('Alt') && forwardingConfigs.length) {
    try {
      // Auto-forward with first config
      await performForward(forwardingConfigs[0])
    } catch (e) {
      console.error(e)
      browser.notifications.create({
        "type": "basic",
        "title": "Auto-forwarding failed!",
        "message": String(e)
      })
    }
  } else {
    // Open popup
    try {
      await browser.messageDisplayAction.setPopup({
        tabId: tab.id,
        popup: "popup/chooseRecipient.html"
      });
      await browser.messageDisplayAction.openPopup();
    } finally {
      // Reset popup to none to allow Alt+Click detection next time
      await browser.messageDisplayAction.setPopup({
        tabId: tab.id,
        popup: ""
      });
    }
  }
})

browser.runtime.onMessage.addListener(async (message) => {
  if (message.action === 'chooseRecipient') {
    try {
      await performForward(message.config, message.compose)
    } catch (e) {
      console.error(e)
      browser.notifications.create({
        "type": "basic",
        "title": "Forwarding failed!",
        "message": String(e)
      })
    }
  }
})
