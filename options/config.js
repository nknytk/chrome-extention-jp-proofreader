function getConfig() {
  const modalLocationSelections = document.getElementsByName('modal-location')
  let modalLocation = ''
  for (let i = 0; i < modalLocationSelections.length; i++) {
    if (modalLocationSelections[i].checked) modalLocation = modalLocationSelections[i].value
  }

  const correctorSelections = document.getElementsByName('corrector')
  let corrector = 'local'
  for (let i = 0; i < correctorSelections.length; i++) {
    if (correctorSelections[i].checked) corrector = correctorSelections[i].value
  }

  config = {modalLocation: modalLocation, corrector: corrector}
  if (corrector == 'server') {
    config.serverUrl = document.getElementById('corrector-server-url').value
    config.apiKey = document.getElementById('corrector-server-apikey').value
  }

  return config
}

function setConfig(config) {
  const modalLocationSelections = document.getElementsByName('modal-location')
  for (let i = 0; i < modalLocationSelections.length; i++) {
    if (modalLocationSelections[i].value == config.modalLocation) modalLocationSelections[i].checked = true
  }

  const correctorSelections = document.getElementsByName('corrector')
  for (let i = 0; i < correctorSelections.length; i++) {
    if (correctorSelections[i].value == config.corrector) correctorSelections[i].checked = true
  }

  if (config.serverUrl) document.getElementById('corrector-server-url').value = config.serverUrl
  if (config.apiKey) document.getElementById('corrector-server-apikey').value = config.apiKey
}

async function loadConfig() {
  const config = await chrome.storage.local.get({modalLocation: '', corrector: 'local', serverUrl: '', apiKey: ''})
  console.log('loaded', config)
  return config
}

async function saveConfig(config) {
  await chrome.storage.local.set(config)
  console.log('saved', config)
}

async function init() {
  setConfig(await loadConfig())
  const configElements = document.getElementsByClassName('jp-corrector-config')
  for (let i = 0; i < configElements.length; i++) {
    configElements[i].addEventListener('change', async function() {saveConfig(getConfig())})
  }
}

document.addEventListener('DOMContentLoaded', init)
