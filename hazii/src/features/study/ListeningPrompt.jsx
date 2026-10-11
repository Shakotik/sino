import { useEffect, useState } from 'react'

export function ListeningPrompt({ text, onPlayed }) {
  const [voices, setVoices] = useState([])
  const [speaking, setSpeaking] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!('speechSynthesis' in window)) return undefined
    // Exclude Cantonese voices: this course teaches Mandarin pronunciation.
    // Phones also report tags such as zh-Hans-CN, cmn-CN or zh_CN_#Hans.
    const refresh = () => setVoices(window.speechSynthesis.getVoices().filter((voice) => /^(?:zh|cmn)(?:[-_#]|$)/iu.test(voice.lang) && !/(?:^|[-_#])(?:HK|MO|yue)(?:[-_#]|$)/iu.test(voice.lang)))
    refresh()
    // iOS Safari may fill the voice list late without a voiceschanged event.
    const retries = [250, 1000, 3000].map((delay) => window.setTimeout(refresh, delay))
    window.speechSynthesis.addEventListener('voiceschanged', refresh)
    return () => { retries.forEach(window.clearTimeout); window.speechSynthesis.removeEventListener('voiceschanged', refresh); window.speechSynthesis.cancel() }
  }, [])
  function speak() {
    if (!voices.length) return
    window.speechSynthesis.cancel()
    const speech = new SpeechSynthesisUtterance(text)
    speech.voice = voices.find((voice) => /CN|Hans/iu.test(voice.lang)) || voices[0]
    speech.lang = speech.voice.lang
    speech.rate = .85
    let failed = false
    setSpeaking(true)
    speech.onstart = () => setSpeaking(true)
    speech.onend = () => { setSpeaking(false); if (!failed) onPlayed() }
    speech.onerror = () => { failed = true; setSpeaking(false); setError('Не получилось воспроизвести слово. Попробуйте ещё раз; для некоторых голосов нужен интернет.') }
    setError('')
    window.speechSynthesis.speak(speech)
  }
  return <div className="listening-prompt"><button className="study-primary-button" type="button" disabled={!voices.length || speaking} onClick={speak}>
    {speaking ? 'Слушаем…' : 'Прослушать слово'}</button>
    {!voices.length && <p role="status">Китайский голос пока недоступен в этом браузере. Установите голос китайского языка в настройках устройства или выберите другой режим занятия.</p>}
    {error && <p role="alert">{error}</p>}
    <small>Синтез речи устройства; не запись диктора.</small>
  </div>
}
