import { PANEL_LABELS, type PanelKey } from '@shared/types'
import type { AppApi } from '../state/store'

/**
 * The × in a panel's header.
 *
 * Hiding is one click, where the panel is, because that is where the user
 * notices it is in the way. Coming back is the titlebar toggles or the View
 * menu, which are always there whatever is hidden.
 */
export function HidePanel({ api, panel }: { api: AppApi; panel: PanelKey }): JSX.Element {
  const label = `Hide the ${PANEL_LABELS[panel]} panel`
  return (
    <button
      type="button"
      className="link dim icon-button hide-panel"
      onClick={() => api.setPanelVisible(panel, false)}
      title={label}
      aria-label={label}
    >
      ×
    </button>
  )
}
