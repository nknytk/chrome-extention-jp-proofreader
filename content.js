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
    this.modalDiv.classList.add('jp-corrector-modal-hidden')
    this.modalTitle = document.createElement('h4')
    this.modalTitle.innerText = '校正提案'
    this.modalTitle.classList.add('jp-corrector-modal-title')
    this.modalDiv.appendChild(this.modalTitle)
    this.modalContent = document.createElement('div')
    this.modalContent.classList.add('jp-corrector-modal-text')
    this.modalDiv.appendChild(this.modalContent)
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

    // 本文をLoadingにしてモーダルを可視化
    for (let c of this.modalContent.children) c.remove()
    this.modalContent.innerText = 'Loading...'
    this.modalDiv.classList.remove('jp-corrector-modal-hidden')
    this.modalDiv.classList.add('jp-corrector-modal-visible')
  }

  set(correctionResults) {
    const corrected = []
    for (let i = 0; i < correctionResults.length; i++) {
      for (let diff of correctionResults[i].diff) {
        if (diff.op) {
          corrected.push({index: i, diffs: correctionResults[i].diff})
          break
        }
      }
    }

    if (corrected.length == 0) {
      this.modalContent.innerText = '校正提案はありません'
      return
    }

    this.modalContent.innerText = ''
    let currentIdx = 0
    for (let correction of corrected) {
      if (correction.index > currentIdx + 1) {
        const skippedRow = document.createElement('div')
        skippedRow.innerText = '...'
        this.modalContent.appendChild(skippedRow)
      }

      const row = document.createElement('div')
      for (let part of correction.diffs) {
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
      currentIdx = correction.index
    }
  }

  close() {
    const modal = document.getElementById('jp-corrector-modal')
    modal.classList.remove('jp-corrector-modal-visible')
    modal.classList.add('jp-corrector-modal-hidden')
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
  if (request == "openCorrectionModal") {
    // 訂正結果モーダルを準備してLoading Spinnerを表示する
    if (correctionModalManager == null) correctionModalManager = new CorrectionModalManager()
    chrome.storage.local.get(['modalLocation']).then(config => {
      if (config.modalLocation == null) config.modalLocation = ''
      correctionModalManager.open(config.modalLocation)
      sendResponse({})
    })
  } else if (request == "getSelectedText") {
    // 保存しておいた文字列をservice workerに送り返す
    if (selectionType == 'node') setSelection(selectedElement)
    sendResponse({value: selectedText})
  } else if (request.startsWith('correctionResult:')) {
    // 訂正結果モーダルに処理結果を表示
    const correctionResult = JSON.parse(request.slice('correctionResult:'.length, request.length))
    correctionModalManager.set(correctionResult)
    sendResponse({})
  }
  return true
})


window.addEventListener('mouseup', event => getSelectedText())
window.addEventListener('keyup', event => getSelectedText())
