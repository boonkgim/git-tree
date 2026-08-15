import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root')

// Without the preload bridge there is no way to reach git at all. Saying so is
// far better than the blank window an unhandled failure would leave behind.
if (typeof window.gitTree === 'undefined') {
  container.innerHTML =
    '<div class="welcome"><div class="welcome-card">' +
    '<h1>git-tree could not start</h1>' +
    '<p>The preload bridge did not load, so the window has no way to reach Git. ' +
    'This is a packaging problem rather than something wrong with your repository.</p>' +
    '</div></div>'
} else {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
