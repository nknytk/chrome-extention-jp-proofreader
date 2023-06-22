import * as ortjs from './ort.min.js'
import TinySegmenter from './TinySegmenter.js'


class Tokenizer {
  constructor() {
    this.word2id = {}
    this.id2word = []
    this.segmenter = null
  }

  static async create(vocabFileName) {
    const tokenizer = new Tokenizer()
    const vocabContent = await fetch(chrome.runtime.getURL(vocabFileName))
    const vocab = await vocabContent.json()
    for (let i = 0; i < vocab.length; i++) {
      tokenizer.word2id[vocab[i]] = i
      tokenizer.id2word.push(vocab[i].replace('##', ''))
    }
    tokenizer.segmenter = new TinySegmenter()
    return tokenizer
  }

  tokenize(str) {
    const tokens = []
    for (const token of this.segmenter.segment(str)) {
      for (const subToken of this.subTokenize(token)) {
        tokens.push(subToken)
      }
    }
    return tokens
  }

  subTokenize(token) {
    /* wordpieceによりwordをsubwordに分割 */
    const originalToken = token
    const subTokens = []
    let needPrefix = false
    let subTokenStart = 0
    let subTokenEnd = token.length
    while (subTokenStart < subTokenEnd) {
      let subToken = token.slice(subTokenStart, subTokenEnd)
      if (needPrefix) subToken = '##' + subToken
      if (this.word2id[subToken] == null) {
        subTokenEnd--
        continue
      }
      subTokens.push(subToken)
      if (subTokenEnd == token.length) return subTokens
      subTokenStart = subTokenEnd
      subTokenEnd = token.length
      needPrefix = true
    }
    // 
    return ['[UNK]']
  }
}


/* 日本語校正APIを使用する校正器 https://github.com/nknytk/jp-proofreading-memo */
export class RemoteCorrector {
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


/* ブラウザ内で校正モデルを実行する校正器 */
export class LocalCorrector {
  constructor() {
    // workaround to avoid `TypeError: URL.createObjectURL is not a function`
    // https://github.com/microsoft/onnxruntime/issues/14445
    ort.env.wasm.numThreads = 1
    this.ortSession = null
    this.tokenizer = null
    this.resultCache = {}
    this.inputNames = ['input.1', 'onnx::Unsqueeze_1', 'input.3']
    this.outputName = '1028'
    this.vectorLength = 160
    this.maxLength = 190
    this.minLength = 6
    this.tokenTypeIds = new ort.Tensor('int64', BigInt64Array.from(new Array(this.vectorLength).fill(BigInt(0))), [1, this.vectorLength])
  }

  /* サーバで学習済みのONNXモデルファイルと語彙ファイルを読み込んで初期化 */
  static async create(modelFileName, vocabFileName) {
    const jpCorrector = new LocalCorrector();
    jpCorrector.ortSession = await ort.InferenceSession.create(chrome.runtime.getURL(modelFileName))
    jpCorrector.tokenizer = await Tokenizer.create(vocabFileName)
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
    const origTokens = this.tokenizer.tokenize(normalized)
    const [idVec, attentionMask] = this.encode(origTokens)
    const modelInput = {[this.inputNames[0]]: idVec, [this.inputNames[1]]: attentionMask, [this.inputNames[2]]: this.tokenTypeIds}
    const rawOutput = await this.ortSession.run(modelInput)
    const [output, diff] = this.decode([origTokens.map(e => e.replace('##', ''))], rawOutput[this.outputName])[0]
    const result = {original: row, normalized: normalized, output: output, diff: diff}
    this.resultCache[normalized] = result
    return result
  }

  /* 文字列をID列に変換する */
  encode(origTokens) {
    const vec = [BigInt(this.tokenizer.word2id['[CLS]'])]
    const attentionMask = [BigInt(1)]
    for (const token of origTokens) {
      if (this.tokenizer.word2id[token] != null) {
        vec.push(BigInt(this.tokenizer.word2id[token]))
      } else {
        vec.push(BigInt(this.tokenizer.word2id['[UNK]']))
      }
      attentionMask.push(BigInt(1))
    }

    for (let i = vec.length; i < this.vectorLength; i++) {
      vec.push(BigInt(this.tokenizer.word2id['[PAD]']))
      attentionMask.push(BigInt(0))
    }
    const attentionVec = new ort.Tensor('int64', BigInt64Array.from(attentionMask), [1, this.vectorLength])
    const idVec = new ort.Tensor('int64', BigInt64Array.from(vec), [1, this.vectorLength])
    return [idVec, attentionVec]
  }

  /* 修正前文字列と修正結果のID列から修正後文字列を作成する */
  decode(origTokens, outputTensor) {
    const decodeResult = []
    const [batchSize, tokenLength] = outputTensor.dims
    for (let batchIdx = 0; batchIdx < batchSize; batchIdx++) {
      const tokens = []
      for (let tokenIdx = 1; tokenIdx < tokenLength; tokenIdx++) {
        const tokenId = outputTensor.data[batchIdx * tokenLength + tokenIdx]
        const origToken = origTokens[batchIdx][tokenIdx - 1]
        if (tokenId == this.tokenizer.word2id['[PAD]']) {
          continue
        } else if (tokenId == this.tokenizer.word2id['[MASK]']) {
          tokens.push('')
        } else if ((tokenId == this.tokenizer.word2id['[UNK]']) || (origToken == ' ') || (origToken == '## ')) {
          console.log(origToken, this.tokenizer.id2word[tokenId])
          tokens.push(origToken)
        } else {
          tokens.push(this.tokenizer.id2word[tokenId])
        }
      }
      const diff = this.tokenDiff(Array.from(origTokens[batchIdx]), tokens)
      decodeResult.push([tokens.join(''), diff])
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
