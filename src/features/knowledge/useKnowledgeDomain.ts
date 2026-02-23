import { useEffect, useState } from 'react'

export function useKnowledgeDomain() {
  const [isWikiOpen, setIsWikiOpen] = useState(false)
  const [isPlannerOpen, setIsPlannerOpen] = useState(false)

  useEffect(() => {
    if (!isWikiOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsWikiOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isWikiOpen])

  return {
    isWikiOpen,
    setIsWikiOpen,
    isPlannerOpen,
    setIsPlannerOpen,
  }
}
