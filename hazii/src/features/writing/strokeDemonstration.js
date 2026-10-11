// A demonstration never calls the quiz completion callback. Restarting the
// quiz clears the demonstration ink; the learner must still write every stroke.
export async function demonstrateStrokeOrder(writer, { isActive, restartQuiz }) {
  writer.cancelQuiz()
  await writer.hideCharacter({ duration: 0 })
  if (!isActive()) return
  await writer.animateCharacter()
  if (isActive()) restartQuiz()
}
