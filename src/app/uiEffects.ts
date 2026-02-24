import { dialogConfirm, dialogPrompt } from '../ui/dialog'
import { showToast } from '../ui/toast'

export const uiEffects = {
  toast: showToast,
  confirm: dialogConfirm,
  prompt: dialogPrompt,
}
