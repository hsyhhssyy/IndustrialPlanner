import { useEffect, useMemo } from 'react'
import type { DeviceInstance, Rotation } from '../../domain/types'
import type { BlueprintSnapshot } from './useBlueprintDomain'

type UseBlueprintOrchestrationDomainParams = {
  blueprints: BlueprintSnapshot[]
  selectedBlueprintId: string | null
  setSelectedBlueprintId: (id: string | null) => void
  armedBlueprintId: string | null
  setArmedBlueprintId: (id: string | null) => void
  activePlacementBlueprint: BlueprintSnapshot | null
  simIsRunning: boolean
  hoverCell: { x: number; y: number } | null
  blueprintPlacementRotation: Rotation
  buildBlueprintPlacementPreview: (
    snapshot: BlueprintSnapshot | null,
    anchorCell: { x: number; y: number },
    placementRotation: Rotation,
  ) => { devices: DeviceInstance[]; isValid: boolean; invalidMessageKey: string | null } | null
}

export function useBlueprintOrchestrationDomain({
  blueprints,
  selectedBlueprintId,
  setSelectedBlueprintId,
  armedBlueprintId,
  setArmedBlueprintId,
  activePlacementBlueprint,
  simIsRunning,
  hoverCell,
  blueprintPlacementRotation,
  buildBlueprintPlacementPreview,
}: UseBlueprintOrchestrationDomainParams) {
  useEffect(() => {
    if (blueprints.length === 0) {
      setSelectedBlueprintId(null)
      setArmedBlueprintId(null)
      return
    }
    if (!selectedBlueprintId) return
    if (blueprints.some((blueprint) => blueprint.id === selectedBlueprintId)) return
    setSelectedBlueprintId(null)
  }, [blueprints, selectedBlueprintId, setArmedBlueprintId, setSelectedBlueprintId])

  useEffect(() => {
    if (!armedBlueprintId) return
    if (blueprints.some((blueprint) => blueprint.id === armedBlueprintId)) return
    setArmedBlueprintId(null)
  }, [armedBlueprintId, blueprints, setArmedBlueprintId])

  const blueprintPlacementPreview = useMemo(() => {
    if (!activePlacementBlueprint || simIsRunning || !hoverCell) return null
    return buildBlueprintPlacementPreview(activePlacementBlueprint, hoverCell, blueprintPlacementRotation)
  }, [activePlacementBlueprint, blueprintPlacementRotation, buildBlueprintPlacementPreview, hoverCell, simIsRunning])

  return {
    blueprintPlacementPreview,
  }
}