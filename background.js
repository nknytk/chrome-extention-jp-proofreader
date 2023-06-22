import {RemoteCorrector, LocalCorrector} from './correctors.js'

const modelFileName = 'models/corrector.onnx'
const vocabFileName = 'models/vocab.json'
let localCorrector = null
let remoteCorrector = null


/* 拡張機能インストール時、コンテキストメニューを登録 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    type: 'normal',
    id: 'jp-proofreader',
    title: '日本語誤字チェック',
    contexts: ['page', 'selection', 'editable']
  });
})


/* コンテキストメニュークリック時、日本語校正の実行 */
chrome.contextMenus.onClicked.addListener((info, tab) => {
  // コンテキストメニューで校正が要求されたことをタブ側に知らせる
  chrome.tabs.sendMessage(tab.id, 'openCorrectionModal', () => {})
  // 選択された文字列をタブ側に要求する
  chrome.tabs.sendMessage(tab.id, 'getSelectedText', async function(response) {
    // 選択文字列を取得できなかったら即終了
    if ((!response) || (!response.value)) {
      chrome.tabs.sendMessage(tab.id, 'finishedProcessing', () => {})
      return
    }

    try {
      // 校正器の取得
      let corrector = null
      const config = await chrome.storage.local.get(['corrector', 'serverUrl', 'apiKey'])
      if (config.corrector == 'server') {
        if (remoteCorrector == null) remoteCorrector = new RemoteCorrector(config.serverUrl, config.apiKey)
        corrector = remoteCorrector
      } else {
        if (localCorrector == null) localCorrector = await LocalCorrector.create(modelFileName, vocabFileName)
        corrector = localCorrector
      }

      // タブから受け取った文字列に対して日本語校正を行い、結果をタブに送り返す
      const rows = splitText(response.value, corrector.maxLength)
      chrome.tabs.sendMessage(tab.id, `startProcessing:${rows.length}`, () => {})
      for (let row of rows) {
        const correctionResult = await corrector.process(row)
        const messageContent = 'correctionResult:' + JSON.stringify(correctionResult)
        chrome.tabs.sendMessage(tab.id, messageContent, () => {})
      }
      chrome.tabs.sendMessage(tab.id, 'finishedProcessing', () => {})
    } catch (e) {
      if (e.stack) {
        chrome.tabs.sendMessage(tab.id, 'error:' + e.stack, () => {})
      } else {
        chrome.tabs.sendMessage(tab.id, 'error:' + e.message, () => {})
      }
    }
  })
})


/* 文字列を処理可能な長さに分割する。可能なら句読点で、無理なら長さで分ける */
function splitText(text, maxLength) {
  const sentences = []
  const sentenceEndMarks = ['。', '？', '?', '！', '!', '、']
  while ((text.length > 0) || (text.indexOf('。') != -1)) {
    let endIdx = maxLength 
    for (let mark of sentenceEndMarks) {
      const markIdx = text.indexOf(mark)
      if ((-1 < markIdx) && (markIdx < maxLength)) {
        endIdx = markIdx + 1
        break
      }
    }
    sentences.push(text.slice(0, endIdx))
    text = text.slice(endIdx, text.length)
  }
  return sentences
}
