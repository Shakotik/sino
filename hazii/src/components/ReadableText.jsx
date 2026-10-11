import { splitReadableText } from './typography.js'

export function ReadableText({ text }) {
  return splitReadableText(text).map((part, index) => part.chinese
    ? <span className="text-word" lang="zh" key={index}>{part.text}</span>
    : part.text)
}
