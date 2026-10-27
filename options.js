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
  details.open = !config.recipients || !config.recipients.length // Open for new or empty configs

  const summary = document.createElement('summary')
  summary.style.display = 'flex'
  summary.style.alignItems = 'center'
  summary.style.justifyContent = 'space-between'
  summary.style.cursor = 'pointer'

  const arrowSpan = document.createElement('span')
  arrowSpan.textContent = details.open ? '▼' : '▶'
  arrowSpan.style.marginRight = '5px'
  summary.appendChild(arrowSpan)

  const titleSpan = document.createElement('span')
  const displayTitle = config.name || getDefaultTitle(config.recipients || []) || '(auto)'
  titleSpan.textContent = displayTitle
  titleSpan.style.fontWeight = 'bold'
  titleSpan.style.color = 'black'
  titleSpan.style.cursor = 'pointer'
  summary.appendChild(titleSpan)

  // Update arrow on toggle
  details.addEventListener('toggle', () => {
    arrowSpan.textContent = details.open ? '▼' : '▶'
  })

  const moveButtons = document.createElement('div')
  moveButtons.style.display = 'flex'
  moveButtons.style.gap = '2px'

  const upButton = document.createElement('button')
  upButton.textContent = '↑'
  upButton.title = 'Move up'
  upButton.style.fontSize = '10px'
  upButton.style.padding = '2px 4px'
  upButton.addEventListener('click', (e) => {
    e.stopPropagation() // Prevent toggling details
    const prev = details.previousElementSibling
    if (prev) {
      details.parentNode.insertBefore(details, prev)
    }
  })
  moveButtons.appendChild(upButton)

  const downButton = document.createElement('button')
  downButton.textContent = '↓'
  downButton.title = 'Move down'
  downButton.style.fontSize = '10px'
  downButton.style.padding = '2px 4px'
  downButton.addEventListener('click', (e) => {
    e.stopPropagation() // Prevent toggling details
    const next = details.nextElementSibling
    if (next) {
      details.parentNode.insertBefore(next, details)
    }
  })
  moveButtons.appendChild(downButton)

  summary.appendChild(moveButtons)

  details.appendChild(summary)

  const div = document.createElement('div')
  div.style.marginLeft = '20px'
  div.style.marginBottom = '10px'

  const nameLabel = document.createElement('label')
  nameLabel.textContent = 'Configuration Name: '
  const nameInput = document.createElement('input')
  nameInput.type = 'text'
  nameInput.name = 'name'
  nameInput.value = config.name || ''
  nameInput.placeholder = getDefaultTitle(config.recipients || []) || '(auto)'
  nameLabel.appendChild(nameInput)
  div.appendChild(nameLabel)
  div.appendChild(document.createElement('br'))

  const recipientsLabel = document.createElement('label')
  recipientsLabel.textContent = 'Recipients (one per line): '
  div.appendChild(recipientsLabel)
  div.appendChild(document.createElement('br'))
  const recipientsTextarea = document.createElement('textarea')
  recipientsTextarea.name = 'recipients'
  recipientsTextarea.value = (config.recipients || []).join('\n')
  div.appendChild(recipientsTextarea)
  div.appendChild(document.createElement('br'))

  // Update summary live
  const updateSummary = () => {
    const recipients = recipientsTextarea.value.split('\n').map(x => x.trim()).filter(x => x)
    const computed = getDefaultTitle(recipients)
    titleSpan.textContent = nameInput.value || computed || '(auto)'
    nameInput.placeholder = computed || '(auto)'
  }
  recipientsTextarea.addEventListener('input', updateSummary)
  nameInput.addEventListener('input', updateSummary)

  const fromLabel = document.createElement('label')
  fromLabel.textContent = 'From Identity: '
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
  fromLabel.appendChild(fromSelect)
  div.appendChild(fromLabel)
  div.appendChild(document.createElement('br'))

  const forwardTypeLabel = document.createElement('label')
  forwardTypeLabel.textContent = 'Forward Type: '
  const groupName = 'forwardType_' + radioGroupCounter++
  const inlineRadio = document.createElement('input')
  inlineRadio.type = 'radio'
  inlineRadio.name = groupName
  inlineRadio.value = 'inline'
  inlineRadio.checked = (config.forwardType || 'inline') === 'inline'
  forwardTypeLabel.appendChild(inlineRadio)
  forwardTypeLabel.appendChild(document.createTextNode(' Inline '))
  const attachmentRadio = document.createElement('input')
  attachmentRadio.type = 'radio'
  attachmentRadio.name = groupName
  attachmentRadio.value = 'attachment'
  attachmentRadio.checked = config.forwardType === 'attachment'
  forwardTypeLabel.appendChild(attachmentRadio)
  forwardTypeLabel.appendChild(document.createTextNode(' As Attachment '))
  div.appendChild(forwardTypeLabel)
  div.appendChild(document.createElement('br'))

  const actionAfterLabel = document.createElement('label')
  actionAfterLabel.textContent = 'Action after forwarding: '
  const actionAfterSelect = document.createElement('select')
  actionAfterSelect.name = 'actionAfter'
  const actionOptions = [
    { value: 'none', label: 'Do nothing' },
    { value: 'archive', label: 'Archive' },
    { value: 'trash', label: 'Trash' },
    { value: 'delete', label: 'Delete permanently' }
  ]
  for (const optionDef of actionOptions) {
    const option = document.createElement('option')
    option.value = optionDef.value
    option.textContent = optionDef.label
    if (config.actionAfter === optionDef.value) option.selected = true
    actionAfterSelect.appendChild(option)
  }
  actionAfterLabel.appendChild(actionAfterSelect)
  div.appendChild(actionAfterLabel)
  div.appendChild(document.createElement('br'))

  const removeButton = document.createElement('button')
  removeButton.textContent = 'Remove'
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
    for (const configDiv of document.querySelectorAll('details > div')) {
      const nameInput = configDiv.querySelector('input[name="name"]')
      const name = nameInput ? nameInput.value.trim() : ''
      const recipientsTextarea = configDiv.querySelector('textarea[name="recipients"]')
      const recipients = recipientsTextarea ? recipientsTextarea.value.split('\n').map(x => x.trim()).filter(x => x) : []
      const fromSelect = configDiv.querySelector('select[name="fromIdentity"]')
      const fromIdentity = fromSelect ? fromSelect.value : 'default'
      if (fromSelect && fromSelect.selectedOptions[0]?.dataset.unavailable) {
        hasUnavailableIdentity = true
      }
      const forwardType = configDiv.querySelector('input[name*="forwardType_"][value="attachment"]:checked') ? 'attachment' : 'inline'
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
      const redSpan = errorDiv.querySelector('span.red')
      redSpan.textContent = 'Some configurations have no recipients and were not saved!'
      errorDiv.dataset.view = 'red'
      return
    }
    if (hasUnavailableIdentity) {
      const errorDiv = document.getElementById('error')
      const redSpan = errorDiv.querySelector('span.red')
      redSpan.textContent = 'Some configurations use a sender identity that no longer exists. Choose a sender, then save again.'
      errorDiv.dataset.view = 'red'
      return
    }
    await browser.storage.local.set({ forwardingConfigs: configs })

    document.getElementById('error').dataset.view = 'green'
  } catch (e) {
    console.error(e)
    const errorDiv = document.getElementById('error')
    const redSpan = errorDiv.querySelector('span.red')
    redSpan.textContent = `Saving options failed! ${e}`
    errorDiv.dataset.view = 'red'
  }
}

async function restoreOptions() {
  try {
    await loadIdentities()
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
  } catch (e) {
    console.error(e)
    const errorDiv = document.getElementById('error')
    const redSpan = errorDiv.querySelector('span.red')
    redSpan.textContent = `Loading options failed! ${e}`
    errorDiv.dataset.view = 'red'
  }
}

document.addEventListener('DOMContentLoaded', restoreOptions)
document.getElementById('save').addEventListener('click', saveOptions)
document.getElementById('addConfig').addEventListener('click', () => {
  document.getElementById('configs').appendChild(createConfigElement())
})
