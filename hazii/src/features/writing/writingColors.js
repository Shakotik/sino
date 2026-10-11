// CSS minification can turn rgba() into #RRGGBBAA. HanziWriter accepts rgba()
// but not alpha-hex, so keep the conversion at this library boundary.
export function normalizeWritingColor(value) {
  const color = value.trim()
  if (!/^#(?:[\da-f]{4}|[\da-f]{8})$/iu.test(color)) return color
  const hex = color.length === 5 ? [...color.slice(1)].map((digit) => digit + digit).join('') : color.slice(1)
  const channels = [0, 2, 4, 6].map((start) => Number.parseInt(hex.slice(start, start + 2), 16))
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${channels[3] / 255})`
}
