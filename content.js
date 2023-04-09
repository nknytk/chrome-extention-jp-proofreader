let selectedElement = null
let selectedText = null
let selectedPosition = null
let selectionType = null
let correctionModalManager = null

class CorrectionModalManager {
  constructor() {
    this.modalDiv = document.createElement('div')
    this.modalDiv.setAttribute('id', 'jp-corrector-modal')
    this.modalDiv.classList.add('jp-corrector-modal')
    this.modalDiv.classList.add('hidden')
    this.modalTitle = document.createElement('h4')
    this.modalTitle.innerText = '校正提案'
    this.modalTitle.classList.add('jp-corrector-modal-title')
    this.modalDiv.appendChild(this.modalTitle)
    this.modalContent = document.createElement('div')
    this.modalContent.classList.add('jp-corrector-modal-text')
    this.modalDiv.appendChild(this.modalContent)
    this.modalAttention = document.createElement('div')
    this.modalAttention.setAttribute('id', 'jp-corrector-modal-attention')
    this.modalAttention.classList.add('jp-corrector-modal-attention')
    this.modalAttention.classList.add('hidden')
    this.modalDiv.appendChild(this.modalAttention)
    this.modalCloseButton = document.createElement('button')
    this.modalCloseButton.classList.add('jp-corrector-modal-button')
    this.modalCloseButton.innerText = '閉じる'
    this.modalCloseButton.onclick = this.close
    this.modalDiv.appendChild(this.modalCloseButton)
    document.body.appendChild(this.modalDiv)
  }

  open(position) {
    // 位置指定を一旦全て削除する
    this.modalDiv.style.top = null
    this.modalDiv.style.bottom = null
    this.modalDiv.style.left = null
    this.modalDiv.style.right = null
    const positionSuffixes = ['fixed', 'absolute', 'top-left', 'top-right', 'bottom-right', 'bottom-left']
    for (let p of positionSuffixes) {
      const removedPosition = `jp-corrector-modal-${p}`
      if (this.modalDiv.classList.contains(removedPosition)) this.modalDiv.classList.remove(removedPosition)
    }

    if (position != '') {
      // 固定位置指定の場合、位置に合わせたstyleが設定されたclassを追加
      this.modalDiv.classList.add(`jp-corrector-modal-fixed`)
      this.modalDiv.classList.add(`jp-corrector-modal-${position}`)
    } else {
      // 変動位置指定の場合に対し
      // 縦位置: 選択位置の真上、真上に入らない場合は真下
      // 横位置: 選択位置と左揃え、できない場合は右端
      let targetElement = selectedElement
      const targetX = selectedPosition.x + window.scrollX
      const targetY = selectedPosition.y + window.scrollY
      if (window.innerWidth - targetX > 960) {
        this.modalDiv.style.left = parseInt(targetX) + 'px'
      } else {
        this.modalDiv.style.right = '0px'
      }
      if ((selectedPosition.y > 640) && (targetY > 640)) {
        this.modalDiv.style.bottom = parseInt(window.innerHeight - selectedPosition.y) + 'px'
      } else {
        this.modalDiv.style.top = parseInt(targetY + selectedPosition.height) + 'px'
      }
      this.modalDiv.classList.add(`jp-corrector-modal-absolute`)
    }

    // 表示内容を初期化してモーダルを可視化
    for (let c of this.modalContent.children) c.remove()
    this.modalContent.innerText = ''
    this.modalAttention.innerText = '初期化中...'
    this.modalAttention.classList.remove('hidden')
    this.modalAttention.classList.add('visible')
    this.modalDiv.classList.remove('hidden')
    this.modalDiv.classList.add('visible')
  }

  startProcessing(numRows) {
    this.numRows = numRows
    this.numCorrectedRows = 0
    this.currentIdx = 0
    this.lastCorrectedIdx = 0
    this.modalAttention.innerText = '処理中 0%'
  }

  endProcessing() {
    this.modalAttention.innerText = ''
    this.modalAttention.classList.remove('visible')
    this.modalAttention.classList.add('hidden')

    if (this.numCorrectedRows == 0) {
      this.modalContent.innerText = '校正提案はありません'
    }
  }

  addResult(correctionResult) {
    this.currentIdx += 1
    const progressPercent = parseInt(100 * this.currentIdx / this.numRows)
    this.modalAttention.innerText = `処理中 ${progressPercent}%`

    let isCorrected = false
    for (let diff of correctionResult.diff) {
      if (diff.op) {
        isCorrected = true
        break
      }
    }
    if (!isCorrected) return

    this.numCorrectedRows++
    if (this.currentIdx > this.lastCorrectedIdx + 1) {
      const skippedRow = document.createElement('div')
      skippedRow.innerText = '...'
      this.modalContent.appendChild(skippedRow)
    }
    this.lastCorrectedIdx = this.currentIdx

    const row = document.createElement('div')
    for (let part of correctionResult.diff) {
      const partSpan = document.createElement('span')
      if (part.op == null) {
        partSpan.innerText = part.to
        row.appendChild(partSpan)
      } else if (part.op == 'delete') {
        const partFrom = document.createElement('span')
        partFrom.innerText = part.from
        partFrom.classList.add('jp-corrector-modal-deleted')
        row.appendChild(partFrom)
      } else if (part.op == 'replace') {
        const partFrom = document.createElement('span')
        const partTo = document.createElement('span')
        partFrom.innerText = part.from
        partFrom.classList.add('jp-corrector-modal-deleted')
        partTo.innerText = part.to
        partTo.classList.add('jp-corrector-modal-replaced')
        row.appendChild(partFrom)
        row.appendChild(partTo)
      }
    }
    this.modalContent.appendChild(row)
  }

  addError(errorMessage) {
    this.modalAttention.innerText = `エラーが発生しました: ${errorMessage}`
  }

  close() {
    const modal = document.getElementById('jp-corrector-modal')
    modal.classList.remove('visible')
    modal.classList.add('hidden')
    const modalAttention = document.getElementById('jp-corrector-modal-attention')
    modalAttention.classList.remove('visible')
    modalAttention.classList.add('hidden')
  }
}

/* 選択された文字列を取得 */
function getSelectedText()  {
  const selection = window.getSelection()
  if (selection.type == 'None') {
    selectedElement = null
    selectedText = null
  } else if (selection.isCollapsed) {
    // 文字列が選択されていない場合、カーソルがあるノードの文字列全体を選択して使用
    selectedElement = selection.anchorNode
    selectedText = getText(selectedElement)
    selectionType = 'node'
  } else {
    // 文字列が選択されている場合、選択部分をそのまま利用
    selectedElement = selection.anchorNode
    selectedText = selection.getRangeAt(0).toString()
    selectedPosition = selection.getRangeAt(0).getBoundingClientRect()
    selectionType = 'text'
  }
}

/* 指定された要素の中身を選択状態にしてハイライト */
function setSelection(element) {
  const selection = window.getSelection()
  const range = new Range()
  range.setStart(element, 0)
  range.setEndAfter(element)
  selection.removeAllRanges()
  selection.addRange(range)
  selectedPosition = selection.getRangeAt(0).getBoundingClientRect()
}

/* 選択された要素の文字列を取得 */
function getText(element, valueOnly=false) {
  const texts = []
  // formのvalueがあれば優先的に取得
  if (element.children) {
    for (let i = 0; i < element.children.length; i++) {
      const txt = getText(element.children[i], true)
      if (txt) texts.push(txt)
    }
  }
  if (texts.length) return texts.join('\n')
  if ((element.value) || (valueOnly)) return element.value

  // formの値がなければinnerText, innerTextがなければnodeValueを返す
  const txt = (selectedElement.innerText) ? selectedElement.innerText : selectedElement.nodeValue
  return txt
}


chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request == "getSelectedText") {
    // 保存しておいた文字列をservice workerに送り返す
    if (selectionType == 'node') setSelection(selectedElement)
    sendResponse({value: selectedText})
    return true
  }

  if (request == "openCorrectionModal") {  // モーダルを開いて初期化
    if (correctionModalManager == null) correctionModalManager = new CorrectionModalManager()
    chrome.storage.local.get(['modalLocation']).then(config => {
      if (config.modalLocation == null) config.modalLocation = ''
      correctionModalManager.open(config.modalLocation)
    })
  } else if (request.startsWith('startProcessing:')) {  // モーダルを処理中にする
    const numRows = parseInt(request.slice('startProcessing:'.length, request.length))
    correctionModalManager.startProcessing(numRows)
  } else if (request.startsWith('correctionResult:')) {  // 処理結果をモーダルに追加
    const correctionResult = JSON.parse(request.slice('correctionResult:'.length, request.length))
    correctionModalManager.addResult(correctionResult)
  } else if (request == 'finishedProcessing') {  // モーダルを処理完了にする
    correctionModalManager.endProcessing()
  } else if (request.startsWith('error:')) {  // エラー内容を表示
    correctionModalManager.addError(request.slice('error:'.length, request.length))
  }
  sendResponse({})
  return true
})


window.addEventListener('mouseup', event => getSelectedText())
window.addEventListener('keyup', event => getSelectedText())
