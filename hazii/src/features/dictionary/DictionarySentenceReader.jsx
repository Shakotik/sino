import { useEffect, useRef, useState } from 'react'
import { analyseSentence } from './dictionaryApi.js'
import './dictionary-sentence.css'

const EXAMPLE_SENTENCE = '我喜欢学习中文。今天我想去北京。'
const MAX_LENGTH = 1000

export function SentenceTokens({ tokens, selectedStart, onSelect }) {
  const words = tokens.filter((token) => token.kind === 'word')
  const wordIndexes = new Map(words.map((word, index) => [word.start, index]))
  return (
    <div className="sentence-tokens" aria-label="Слова предложения" lang="zh">
      {tokens.map((token) => token.kind === 'word' ? (
        <button key={token.start} type="button"
          className={`sentence-word ${token.entryId ? '' : 'is-unknown'}`}
          aria-pressed={selectedStart === token.start}
          aria-label={`${token.text}: ${token.entryId ? 'открыть значение' : 'нет точной статьи в БКРС'}`}
          onClick={() => onSelect(words, wordIndexes.get(token.start))}>
          {token.text}
        </button>
      ) : <span key={token.start} className="sentence-punctuation">{token.text}</span>)}
    </div>
  )
}

export function DictionarySentenceReader({ onSelect, onReset, selectedStart, initialText = '' }) {
  const [text, setText] = useState(initialText)
  const [tokens, setTokens] = useState([])
  const [requestState, setRequestState] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const requestRef = useRef(null)

  useEffect(() => () => requestRef.current?.abort(), [])

  function editText(value) {
    requestRef.current?.abort()
    setText(value)
    setTokens([])
    setRequestState('idle')
    setErrorMessage('')
    onReset()
  }

  async function submitSentence(value = text) {
    requestRef.current?.abort()
    onReset()
    const controller = new AbortController()
    requestRef.current = controller
    setTokens([])
    setRequestState('loading')
    setErrorMessage('')
    try {
      const result = await analyseSentence(value, controller.signal)
      if (controller.signal.aborted) return
      setTokens(result)
      setRequestState('ready')
    } catch (error) {
      if (controller.signal.aborted) return
      setRequestState('error')
      setErrorMessage(error instanceof TypeError || error instanceof SyntaxError
        ? 'Сервер словаря недоступен. Попробуйте разобрать предложение ещё раз.' : error.message)
    }
  }

  const words = tokens.filter((token) => token.kind === 'word')
  const missingCount = words.filter((token) => !token.entryId).length

  return (
    <section className="sentence-reader" aria-label="Разбор китайского предложения">
      <form onSubmit={(event) => { event.preventDefault(); void submitSentence() }}>
        <label htmlFor="dictionary-sentence">Вставьте предложение на китайском</label>
        <textarea id="dictionary-sentence" lang="zh" rows={3} maxLength={MAX_LENGTH}
          value={text} onChange={(event) => editText(event.target.value)}
          placeholder={EXAMPLE_SENTENCE} aria-describedby="sentence-length" />
        <div className="sentence-actions">
          <button className="sentence-submit" type="submit" disabled={!text.trim() || requestState === 'loading'}>
            {requestState === 'loading' ? 'Разбираем…' : 'Разобрать предложение'}
          </button>
          <button type="button" className="sentence-example" onClick={() => {
            editText(EXAMPLE_SENTENCE)
            void submitSentence(EXAMPLE_SENTENCE)
          }}>Попробовать пример</button>
          {text && <button type="button" className="sentence-example" onClick={() => editText('')}>Очистить</button>}
          <span id="sentence-length" className="sentence-length">{text.length} / {MAX_LENGTH}</span>
        </div>
      </form>
      <div role="status" aria-live="polite">
        {requestState === 'loading' && <p className="sentence-note">Выделяем слова и ищем их в БКРС…</p>}
        {requestState === 'error' && <p className="dictionary-error">{errorMessage}</p>}
        {requestState === 'ready' && <p className="sentence-note">Выберите слово, чтобы открыть значение.{missingCount > 0 && ` Без точной статьи: ${missingCount} (пунктир).`}</p>}
      </div>
      {requestState === 'ready' && <>
        <SentenceTokens tokens={tokens} selectedStart={selectedStart} onSelect={(words, index) => onSelect(words, index, text)} />
        <p className="sentence-note">Автоматическое деление на слова может быть неоднозначным. Показаны словарные значения, а не перевод предложения.</p>
      </>}
    </section>
  )
}
