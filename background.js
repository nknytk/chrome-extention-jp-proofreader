import * as module from './ort.min.js'

const modelFileUrl = chrome.runtime.getURL('models/model.onnx')
const charMappingFileUrl = chrome.runtime.getURL('models/char_mapping.json')
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
        if (localCorrector == null) localCorrector = await LocalCorrector.create(modelFileUrl, charMappingFileUrl)
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


/* 日本語校正器 */
class RemoteCorrector {
  constructor(serverUrl, apiKey) {
    this.serverUrl = serverUrl
    this.apiKey = apiKey
    this.minLength = 6
    this.maxLength = 150
    this.resultCache = {}
  }

  async process(row) {
    // 短すぎる文字列は訂正対象外として、受け取った文字列をそのまま返す
    if (row.length < this.minLength) {
      return {original: row, normalized: null, output: row, diff: [{'from': row, 'to': row, 'op': null}]}
    }
    // キャッシュがある場合はキャッシュから結果を返す
    if (this.resultCache[row] != null) {
      return this.resultCache[row]
    }

    // 処理結果をAPIから取得し、キャッシュして返す
    let url = `${this.serverUrl}?text=${encodeURIComponent(row)}&apikey=${encodeURIComponent(this.apiKey)}`
    const response = await (await fetch(url)).json()
    const result = {original: row, normalized: response.input, output: response.output, diff: response.tokens}
    this.resultCache[row] = result
    return result
  }
}


class LocalCorrector {
  constructor() {
    // workaround to avoid `TypeError: URL.createObjectURL is not a function`
    // https://github.com/microsoft/onnxruntime/issues/14445
    ort.env.wasm.numThreads = 1
    this.ortSession = null
    this.charMapping = null
    this.resultCache = {}
    this.inputNames = ['input.1', 'onnx::Unsqueeze_1', 'input.3']
    this.outputName = '1404'
    this.vectorLength = 210
    this.maxLength = 205
    this.minLength = 6
    this.tokenTypeIds = new ort.Tensor('int64', BigInt64Array.from(new Array(this.vectorLength).fill(BigInt(0))), [1, this.vectorLength])
  }

  /* サーバで学習済みのONNXモデルファイルと、文字と文字IDの相互変換表を読み込んで初期化 */
  static async create(modelFileName, charMappingFileName) {
    const jpCorrector = new LocalCorrector();
    jpCorrector.ortSession = await ort.InferenceSession.create(modelFileName)
    const charMappingContent = await fetch(charMappingFileName)
    jpCorrector.charMapping = await charMappingContent.json()
    return jpCorrector
  }

  /* 日本語校正処理本体 */
  async process(row) {
    // 短すぎる文字列は訂正対象外として、受け取った文字列をそのまま返す
    if (row.length < this.minLength) {
      return {original: row, normalized: null, output: row, diff: [{'from': row, 'to': row, 'op': null}]}
    }

    // キャッシュがある場合はキャッシュから結果を返す
    const normalized = this.normalize(row)
    if (this.resultCache[normalized] != null) {
      const result = this.resultCache[normalized]
      result['original'] = row
      return result
    }

    // キャッシュがない場合は処理を行い、結果をキャッシュに登録して返す
    const [idVec, attentionMask] = this.encode(normalized)
    const modelInput = {[this.inputNames[0]]: idVec, [this.inputNames[1]]: attentionMask, [this.inputNames[2]]: this.tokenTypeIds}
    const rawOutput = await this.ortSession.run(modelInput)
    const [output, diff] = this.decode([normalized], rawOutput[this.outputName])[0]
    const result = {original: row, normalized: normalized, output: output, diff: diff}
    this.resultCache[normalized] = result
    return result
  }

  /* 文字列をID列に変換する */
  encode(normText) {
    let vec = [BigInt(this.charMapping.special_tokens.CLS)]
    let attentionMask = [BigInt(1)]
    for (let chr of normText) {
      if (this.charMapping.encode[chr] != null) {
        vec.push(BigInt(this.charMapping.encode[chr]))
      } else {
        vec.push(BigInt(this.charMapping.special_tokens.UNK))
      }
      attentionMask.push(BigInt(1))
    }

    for (let i = vec.length; i < this.vectorLength; i++) {
      vec.push(BigInt(this.charMapping.special_tokens.PAD))
      attentionMask.push(BigInt(0))
    }
    const attentionVec = new ort.Tensor('int64', BigInt64Array.from(attentionMask), [1, this.vectorLength])
    const idVec = new ort.Tensor('int64', BigInt64Array.from(vec), [1, this.vectorLength])
    return [idVec, attentionVec]
  }

  /* 修正前文字列と修正結果のID列から修正後文字列を作成する */
  decode(origText, outputTensor) {
    const decodeResult = []
    const [batchSize, charLength, charVectorLength] = outputTensor.dims
    for (let batchIdx = 0; batchIdx < batchSize; batchIdx++) {
      const chars = []
      for (let charIdx = 1; charIdx < charLength; charIdx++) {
        const charStartsAt = batchIdx * charLength * charVectorLength + charIdx * charVectorLength
        const charEndsAt = charStartsAt + charVectorLength
        const scores = outputTensor.data.slice(charStartsAt, charEndsAt)
        const charId = argsort(scores, false)[0]
        if (charId == this.charMapping.special_tokens.PAD) {
          continue
	} else if (charId == this.charMapping.special_tokens.MASK) {
          chars.push('')
        } else if (charId == this.charMapping.special_tokens.UNK) {
          chars.push(origText[batchIdx][charIdx])
        } else if (this.charMapping.decode[charId] != null) {
          chars.push(this.charMapping.decode[charId])
        }
      }
      const diff = this.tokenDiff(Array.from(origText[batchIdx]), chars)
      decodeResult.push([chars.join(''), diff])
    }
    return decodeResult
  }

  /* 文字列を正規化する */
  normalize(text) {
    return text.normalize('NFKC').replaceAll(/[\s　]+/ig, ' ').trim()
  }

  /*
  tokens1とtokens2が同じ長さのarrayであることを前提に、
  tokens1をtokens2に修正するための変更点を計算する
  ToDo: 長さが違っても計算できるようにする
  */
  tokenDiff(tokens1, tokens2) {
    const diffs = []
    let _from = ''
    let _to = ''
    let hasDiff = false
    for (let i = 0; i < tokens1.length; i++) {
      if (tokens1[i] == tokens2[i]) {
        if (hasDiff) {
          if (_to == '') {
            diffs.push({'from': _from, 'to': _to, 'op': 'delete'})
          } else {
            diffs.push({'from': _from, 'to': _to, 'op': 'replace'})
          }
          _from = tokens1[i]
          _to = tokens2[i]
          hasDiff = false
	} else {
	  _from += tokens1[i]
	  _to += tokens2[i]
	}
      } else {
        if (hasDiff) {
	  _from += tokens1[i]
	  _to += tokens2[i]
	} else {
          diffs.push({'from': _from, 'to': _to, 'op': null})
          _from = tokens1[i]
          _to = tokens2[i]
          hasDiff = true
	}
      }
    }

    if ((_from != '') || (_to != '')) {
      let _op = null
      if (hasDiff) {
        _op = (_to == '') ? 'delete' : 'replace'
      }
      diffs.push({'from': _from, 'to': _to, 'op': _op})
    }

    return diffs
  }
}


function argsort(arr, ascending=true) {
  const iIsLarger = ascending ? 1 : -1
  const iIsLess = ascending ? -1 : 1
  const indexArray = arr.map((val, idx) => idx)
  indexArray.sort((i, j) => {
    if (arr[i] > arr[j]) return iIsLarger
    if (arr[j] > arr[i]) return iIsLess
    return 0
  })
  return indexArray
}

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
