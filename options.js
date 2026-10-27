let identities = []
let radioGroupCounter = 0

// One entry per identity (not per address): two identities may share an
// address but use different accounts / SMTP servers.
async function loadIdentities() {
  const accounts = await browser.accounts.list()
  identities = []
  for (const account of accounts) {
    for (const identity of account.identities || []) {
      const who = identity.name ? `${identity.name} <${identity.email}>` : identity.email
      identities.push({ id: identity.id, email: identity.email, label: `${who} (${account.name})` })
    }
  }
}

// Resolves a stored fromIdentity (identity id, or a legacy email address)
// to an identity id; null when it is unavailable or ambiguous.
function resolveIdentityId(fromIdentity) {
  if (identities.some(i => i.id === fromIdentity)) return fromIdentity
  const byEmail = identities.filter(i => i.email === fromIdentity)
  return byEmail.length === 1 ? byEmail[0].id : null
}

function createConfigElement(config = {}) {
  const details = document.createElement('details')
  details.open = !config.recipients || !config.recipients.length

  const summary = document.createElement('summary')

  const arrowSpan = document.createElement('span')
  arrowSpan.textContent = details.open ? '\u25BC' : '\u25B6'
  arrowSpan.style.marginRight = '6px'
  arrowSpan.style.fontSize = '10px'
  summary.appendChild(arrowSpan)

  const titleSpan = document.createElement('span')
  titleSpan.className = 'config-title'
  const displayTitle = config.name || getDefaultTitle(config.recipients || []) || '(new config)'
  titleSpan.textContent = displayTitle
  summary.appendChild(titleSpan)

  // Spacer
  const spacer = document.createElement('span')
  spacer.style.flex = '1'
  summary.appendChild(spacer)

  details.addEventListener('toggle', () => {
    arrowSpan.textContent = details.open ? '\u25BC' : '\u25B6'
  })

  const moveButtons = document.createElement('div')
  moveButtons.className = 'move-buttons'

  const upButton = document.createElement('button')
  upButton.textContent = '\u2191'
  upButton.title = 'Move up'
  upButton.addEventListener('click', (e) => {
    e.stopPropagation()
    const prev = details.previousElementSibling
    if (prev) details.parentNode.insertBefore(details, prev)
  })
  moveButtons.appendChild(upButton)

  const downButton = document.createElement('button')
  downButton.textContent = '\u2193'
  downButton.title = 'Move down'
  downButton.addEventListener('click', (e) => {
    e.stopPropagation()
    const next = details.nextElementSibling
    if (next) details.parentNode.insertBefore(next, details)
  })
  moveButtons.appendChild(downButton)

  summary.appendChild(moveButtons)
  details.appendChild(summary)

  const div = document.createElement('div')

  // Name
  const nameLabel = document.createElement('label')
  nameLabel.textContent = 'Configuration Name'
  div.appendChild(nameLabel)
  const nameInput = document.createElement('input')
  nameInput.type = 'text'
  nameInput.name = 'name'
  nameInput.value = config.name || ''
  nameInput.placeholder = getDefaultTitle(config.recipients || []) || '(auto from first recipient)'
  div.appendChild(nameInput)

  // Recipients
  const recipientsLabel = document.createElement('label')
  recipientsLabel.textContent = 'Recipients (one per line)'
  div.appendChild(recipientsLabel)
  const recipientsTextarea = document.createElement('textarea')
  recipientsTextarea.name = 'recipients'
  recipientsTextarea.value = (config.recipients || []).join('\n')
  recipientsTextarea.placeholder = 'user@example.com\nJohn Doe <john@example.com>'
  div.appendChild(recipientsTextarea)

  // Update summary live
  const updateSummary = () => {
    const recipients = recipientsTextarea.value.split('\n').map(x => x.trim()).filter(x => x)
    const computed = getDefaultTitle(recipients)
    titleSpan.textContent = nameInput.value || computed || '(new config)'
    nameInput.placeholder = computed || '(auto from first recipient)'
  }
  recipientsTextarea.addEventListener('input', updateSummary)
  nameInput.addEventListener('input', updateSummary)

  // From identity
  const fromLabel = document.createElement('label')
  fromLabel.textContent = 'From Identity'
  div.appendChild(fromLabel)
  const fromSelect = document.createElement('select')
  fromSelect.name = 'fromIdentity'
  const defaultOption = document.createElement('option')
  defaultOption.value = 'default'
  defaultOption.textContent = 'Default (based on received email)'
  fromSelect.appendChild(defaultOption)
  const storedIdentity = config.fromIdentity || 'default'
  const resolvedId = storedIdentity === 'default' ? 'default' : resolveIdentityId(storedIdentity)
  for (const identity of identities) {
    const option = document.createElement('option')
    option.value = identity.id
    option.textContent = identity.label
    if (resolvedId === identity.id) option.selected = true
    fromSelect.appendChild(option)
  }
  if (!resolvedId) {
    // Keep the stored value visible instead of silently showing "Default";
    // saving is refused until the user picks a sender.
    const missing = document.createElement('option')
    missing.value = storedIdentity
    missing.dataset.unavailable = 'true'
    missing.textContent = `Unavailable: ${storedIdentity} - choose a sender`
    missing.selected = true
    fromSelect.appendChild(missing)
  }
  div.appendChild(fromSelect)

  // Forward type
  const forwardTypeLabel = document.createElement('label')
  forwardTypeLabel.textContent = 'Forward Type'
  div.appendChild(forwardTypeLabel)
  const groupName = 'forwardType_' + radioGroupCounter++
  const radioGroup = document.createElement('div')
  radioGroup.className = 'radio-group'

  const inlineLabel = document.createElement('label')
  const inlineRadio = document.createElement('input')
  inlineRadio.type = 'radio'
  inlineRadio.name = groupName
  inlineRadio.value = 'inline'
  inlineRadio.checked = (config.forwardType || 'inline') === 'inline'
  inlineLabel.appendChild(inlineRadio)
  inlineLabel.appendChild(document.createTextNode('Inline'))
  radioGroup.appendChild(inlineLabel)

  const attachLabel = document.createElement('label')
  const attachRadio = document.createElement('input')
  attachRadio.type = 'radio'
  attachRadio.name = groupName
  attachRadio.value = 'attachment'
  attachRadio.checked = config.forwardType === 'attachment'
  attachLabel.appendChild(attachRadio)
  attachLabel.appendChild(document.createTextNode('As Attachment'))
  radioGroup.appendChild(attachLabel)

  div.appendChild(radioGroup)

  // Action after forwarding
  const actionLabel = document.createElement('label')
  actionLabel.textContent = 'Action after forwarding'
  div.appendChild(actionLabel)
  const actionSelect = document.createElement('select')
  actionSelect.name = 'actionAfter'
  const actionOptions = [
    { value: 'none', label: 'Do nothing (keep in inbox)' },
    { value: 'archive', label: 'Archive' },
    { value: 'trash', label: 'Move to Trash' },
    { value: 'delete', label: 'Delete permanently' }
  ]
  for (const opt of actionOptions) {
    const option = document.createElement('option')
    option.value = opt.value
    option.textContent = opt.label
    if (config.actionAfter === opt.value) option.selected = true
    actionSelect.appendChild(option)
  }
  div.appendChild(actionSelect)

  // Remove button
  const removeButton = document.createElement('button')
  removeButton.className = 'remove-btn'
  removeButton.textContent = 'Remove this configuration'
  removeButton.addEventListener('click', () => details.remove())
  div.appendChild(removeButton)

  details.appendChild(div)
  return details
}

async function saveOptions() {
  try {
    const configs = []
    let hasEmptyRecipients = false
    let hasUnavailableIdentity = false

    for (const configDiv of document.querySelectorAll('#configs details > div')) {
      const nameInput = configDiv.querySelector('input[name="name"]')
      const name = nameInput ? nameInput.value.trim() : ''
      const recipientsTextarea = configDiv.querySelector('textarea[name="recipients"]')
      const recipients = recipientsTextarea
        ? recipientsTextarea.value.split('\n').map(x => x.trim()).filter(x => x)
        : []
      const fromSelect = configDiv.querySelector('select[name="fromIdentity"]')
      const fromIdentity = fromSelect ? fromSelect.value : 'default'
      if (fromSelect && fromSelect.selectedOptions[0]?.dataset.unavailable) {
        hasUnavailableIdentity = true
      }
      const forwardType = configDiv.querySelector('input[name*="forwardType_"][value="attachment"]:checked')
        ? 'attachment' : 'inline'
      const actionAfterSelect = configDiv.querySelector('select[name="actionAfter"]')
      const actionAfter = actionAfterSelect ? actionAfterSelect.value : 'none'

      if (recipients.length) {
        configs.push({ name, recipients, fromIdentity, forwardType, actionAfter })
      } else {
        hasEmptyRecipients = true
      }
    }

    if (hasEmptyRecipients) {
      const errorDiv = document.getElementById('error')
      errorDiv.querySelector('span.red').textContent =
        'Some configurations have no recipients and were not saved!'
      errorDiv.dataset.view = 'red'
      return
    }

    if (hasUnavailableIdentity) {
      const errorDiv = document.getElementById('error')
      errorDiv.querySelector('span.red').textContent =
        'Some configurations use a sender identity that no longer exists. Choose a sender, then save again.'
      errorDiv.dataset.view = 'red'
      return
    }

    // Save configs
    await browser.storage.local.set({ forwardingConfigs: configs })

    // Save bulk settings
    const delay = Math.max(500, parseInt(document.getElementById('delayInput').value) || 1500)
    const confirm = document.getElementById('confirmCheck').checked
    await browser.storage.local.set({
      bulkSettings: {
        delayBetweenSends: delay,
        confirmBeforeSend: confirm
      }
    })

    document.getElementById('error').dataset.view = 'green'
    setTimeout(() => { document.getElementById('error').dataset.view = 'none' }, 3000)
  } catch (e) {
    console.error(e)
    const errorDiv = document.getElementById('error')
    errorDiv.querySelector('span.red').textContent = `Saving failed: ${e}`
    errorDiv.dataset.view = 'red'
  }
}

async function restoreOptions() {
  try {
    await loadIdentities()

    // Restore forwarding configs
    const { forwardingConfigs } = await browser.storage.local.get({ forwardingConfigs: [] })
    const { migrated, didMigrate } = migrateV2ToV2_1Configs(forwardingConfigs)
    if (didMigrate) {
      await browser.storage.local.set({ forwardingConfigs: migrated })
    }

    const configsContainer = document.getElementById('configs')
    while (configsContainer.firstChild) {
      configsContainer.removeChild(configsContainer.firstChild)
    }
    for (const config of migrated) {
      configsContainer.appendChild(createConfigElement(config))
    }
    if (!migrated.length) {
      configsContainer.appendChild(createConfigElement())
    }

    // Restore bulk settings
    const defaults = { delayBetweenSends: 1500, confirmBeforeSend: true }
    const { bulkSettings } = await browser.storage.local.get({ bulkSettings: defaults })
    const settings = { ...defaults, ...bulkSettings }
    document.getElementById('delayInput').value = settings.delayBetweenSends
    document.getElementById('confirmCheck').checked = settings.confirmBeforeSend
  } catch (e) {
    console.error(e)
    const errorDiv = document.getElementById('error')
    errorDiv.querySelector('span.red').textContent = `Loading failed: ${e}`
    errorDiv.dataset.view = 'red'
  }
}

document.addEventListener('DOMContentLoaded', restoreOptions)
document.getElementById('save').addEventListener('click', saveOptions)
document.getElementById('addConfig').addEventListener('click', () => {
  document.getElementById('configs').appendChild(createConfigElement())
})
