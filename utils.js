function getDefaultTitle(recipients) {
  if (!recipients.length) return ''
  const first = recipients[0]
  const match = first.match(/(.*)\s*<(.+)>/)
  return match ? match[1].trim() : first
}

function normalizeActionAfter(actionAfter) {
  const allowed = ['none', 'archive', 'trash', 'delete']
  if (allowed.includes(actionAfter)) return actionAfter
  return 'none'
}

function migrateV2ToV2_1Config(config = {}) {
  const normalized = {
    name: '',
    recipients: [],
    fromIdentity: 'default',
    forwardType: 'inline',
    actionAfter: 'none'
  }

  if (typeof config.name === 'string') normalized.name = config.name
  if (Array.isArray(config.recipients)) normalized.recipients = config.recipients
  if (typeof config.fromIdentity === 'string') normalized.fromIdentity = config.fromIdentity
  if (config.forwardType === 'attachment' || config.forwardType === 'inline') normalized.forwardType = config.forwardType

  const actionAfter = typeof config.actionAfter === 'string' ? config.actionAfter : 'none'
  normalized.actionAfter = normalizeActionAfter(actionAfter)

  if (config.trashAfter === true && normalized.actionAfter === 'none') {
    normalized.actionAfter = 'trash'
  }

  return normalized
}

function migrateV2ToV2_1Configs(configs = []) {
  let didMigrate = false
  const migrated = configs.map(config => {
    if (typeof config.actionAfter !== 'string' || typeof config.trashAfter !== 'undefined') {
      didMigrate = true
    }
    return migrateV2ToV2_1Config(config)
  })
  return { migrated, didMigrate }
}

function migrateV1ToV2Configs(forwardingAddresses) {
  return forwardingAddresses.map(address => {
    return {
      name: '',
      recipients: [address],
      fromIdentity: 'default',
      forwardType: 'inline',
      actionAfter: 'none'
    }
  })
}
