/**
 * Downloads the public Gushi HSK 3.0 CSV files in byte ranges.
 *
 * Why ranges? The source server occasionally stops a long ordinary download
 * before it is complete. A range request asks for a small, verifiable part of
 * a file. We join the verified parts back together before saving anything.
 *
 * This script is for maintainers. The application itself never downloads
 * course data from Gushi in a learner's browser.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectDirectory = resolve(scriptDirectory, '..')
const sourceDirectory = resolve(projectDirectory, 'data', 'sources')
const levels = [2, 3, 4, 5, 6]
// Keep one request small enough to finish reliably even on a slow connection.
const chunkSize = 8 * 1024
const concurrency = 3

function sourceUrl(level) {
  return `https://gushi-chinese.online/hsk-3.0/downloads/hsk-3.0-words-${level}.csv`
}

async function getFileSize(url) {
  const response = await fetch(url, { headers: { Range: 'bytes=0-0' } })
  const contentRange = response.headers.get('content-range')

  if (!response.ok || !contentRange) {
    throw new Error(`Could not read file size for ${url}.`)
  }

  const totalSize = Number(contentRange.split('/').at(-1))

  if (!Number.isSafeInteger(totalSize) || totalSize <= 0) {
    throw new Error(`The source returned an invalid file size for ${url}.`)
  }

  return totalSize
}

async function downloadChunk(url, start, end) {
  const expectedLength = end - start + 1
  let lastError

  // The public file server can reset a connection; retrying only this small
  // byte range is safe and avoids accepting incomplete source files.
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Range: `bytes=${start}-${end}` },
      })

      if (response.status !== 206) {
        throw new Error(`Expected a partial response for bytes ${start}-${end} of ${url}.`)
      }

      const data = Buffer.from(await response.arrayBuffer())

      if (data.length !== expectedLength) {
        throw new Error(`Received ${data.length} bytes instead of ${expectedLength} from ${url}.`)
      }

      return data
    } catch (error) {
      lastError = error
      console.warn(`Retry ${attempt}/5 for bytes ${start}-${end}.`)
      await new Promise((resolveRetry) => setTimeout(resolveRetry, attempt * 1000))
    }
  }

  throw lastError
}

async function downloadFile(level) {
  const url = sourceUrl(level)
  const totalSize = await getFileSize(url)
  const chunks = []

  console.log(`Downloading HSK ${level} in verified parts…`)

  for (let start = 0; start < totalSize; start += chunkSize) {
    chunks.push({ start, end: Math.min(start + chunkSize - 1, totalSize - 1) })
  }

  const result = new Array(chunks.length)
  let nextChunkIndex = 0

  async function worker() {
    while (nextChunkIndex < chunks.length) {
      const chunkIndex = nextChunkIndex
      nextChunkIndex += 1
      const chunk = chunks[chunkIndex]
      result[chunkIndex] = await downloadChunk(url, chunk.start, chunk.end)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker))

  const outputPath = resolve(sourceDirectory, `gushi-hsk-3.0-words-${level}.complete.csv`)
  await writeFile(outputPath, Buffer.concat(result))
  console.log(`HSK ${level}: ${totalSize} bytes downloaded to ${outputPath}`)
}

await mkdir(sourceDirectory, { recursive: true })

for (const level of levels) {
  await downloadFile(level)
}
