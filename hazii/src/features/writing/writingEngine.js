const MINIMUM_WRITING_LENGTH = 0.19
const MINIMUM_COVERED_CELLS = 2
const GRID_SIZE = 3

function distanceBetween(firstPoint, secondPoint) {
  return Math.hypot(secondPoint.x - firstPoint.x, secondPoint.y - firstPoint.y)
}

function isMeaningfulStroke(stroke) {
  return stroke.length > 1
}

export function drawWritingGuide(context, width, height, palette) {
  context.clearRect(0, 0, width, height)
  context.fillStyle = palette.background
  context.fillRect(0, 0, width, height)

  context.strokeStyle = palette.guide
  context.lineWidth = 1
  context.setLineDash([5, 6])
  context.beginPath()
  context.moveTo(width / 2, 0)
  context.lineTo(width / 2, height)
  context.moveTo(0, height / 2)
  context.lineTo(width, height / 2)
  context.moveTo(0, 0)
  context.lineTo(width, height)
  context.moveTo(width, 0)
  context.lineTo(0, height)
  context.stroke()
  context.setLineDash([])

  context.strokeStyle = palette.line
  context.strokeRect(0.5, 0.5, width - 1, height - 1)
}

function drawStroke(context, stroke, width, height, ink) {
  if (!stroke.length) return

  const firstPoint = stroke[0]
  context.fillStyle = ink
  context.beginPath()
  context.arc(firstPoint.x * width, firstPoint.y * height, 2.2, 0, Math.PI * 2)
  context.fill()

  if (stroke.length < 2) return

  context.strokeStyle = ink
  context.lineCap = 'round'
  context.lineJoin = 'round'

  for (let index = 1; index < stroke.length; index += 1) {
    const previousPoint = stroke[index - 1]
    const currentPoint = stroke[index]
    const pressure = currentPoint.pressure || 0.5

    context.lineWidth = 3.5 + pressure * 2.7
    context.beginPath()
    context.moveTo(previousPoint.x * width, previousPoint.y * height)
    context.lineTo(currentPoint.x * width, currentPoint.y * height)
    context.stroke()
  }
}

export function renderWritingAttempt(context, width, height, palette, strokes) {
  drawWritingGuide(context, width, height, palette)
  strokes.forEach((stroke) => drawStroke(context, stroke, width, height, palette.ink))
}

export function analyzeWritingAttempt(strokes) {
  const meaningfulStrokes = strokes.filter(isMeaningfulStroke)
  let totalLength = 0
  const coveredCells = new Set()

  meaningfulStrokes.forEach((stroke) => {
    stroke.forEach((point, index) => {
      const horizontalCell = Math.min(Math.floor(point.x * GRID_SIZE), GRID_SIZE - 1)
      const verticalCell = Math.min(Math.floor(point.y * GRID_SIZE), GRID_SIZE - 1)
      coveredCells.add(`${horizontalCell}-${verticalCell}`)

      if (index > 0) totalLength += distanceBetween(stroke[index - 1], point)
    })
  })

  const hasInk = meaningfulStrokes.length > 0
  const hasEnoughLength = totalLength >= MINIMUM_WRITING_LENGTH
  const hasEnoughCoverage = coveredCells.size >= MINIMUM_COVERED_CELLS
  const isReady = hasInk && hasEnoughLength && hasEnoughCoverage

  if (!hasInk) {
    return {
      hasInk: false,
      isReady: false,
      strokeCount: 0,
      totalLength: 0,
      coveredCells: 0,
      hint: 'Сделайте первый штрих — поле сохранит каждое движение.',
    }
  }

  if (!hasEnoughLength) {
    return {
      hasInk: true,
      isReady: false,
      strokeCount: meaningfulStrokes.length,
      totalLength,
      coveredCells: coveredCells.size,
      hint: 'Добавьте более длинные штрихи: пока это похоже на случайную точку.',
    }
  }

  if (!hasEnoughCoverage) {
    return {
      hasInk: true,
      isReady: false,
      strokeCount: meaningfulStrokes.length,
      totalLength,
      coveredCells: coveredCells.size,
      hint: 'Попробуйте использовать большую часть клетки, чтобы попытка была осмысленной.',
    }
  }

  return {
    hasInk: true,
    isReady,
    strokeCount: meaningfulStrokes.length,
    totalLength,
    coveredCells: coveredCells.size,
    hint: 'Попытка готова к сохранению. Иероглиф остаётся скрытым, как в настоящей проверке памяти.',
  }
}
