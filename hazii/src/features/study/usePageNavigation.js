import { useNavigate } from 'react-router-dom'

// Modern browsers can animate the old page into the new one natively.
// Other browsers still navigate normally and receive the CSS enter animation.
export function usePageNavigation() {
  const navigate = useNavigate()

  return function navigateWithTransition(destination) {
    const changePage = () => navigate(destination)

    if (typeof document.startViewTransition === 'function') {
      document.startViewTransition(changePage)
      return
    }

    changePage()
  }
}
