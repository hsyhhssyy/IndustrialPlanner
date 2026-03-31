import {
  useEffect,
  useEffectEvent,
  useRef,
  type MouseEvent,
} from "react";
import type { RenderEntitySprite, RenderSceneModel } from "@/renderer/scene/types";

export interface RendererHostProps {
  scene: RenderSceneModel;
  onEntitySelect?: (entityId: string) => void;
}

function getStatusStroke(status: RenderEntitySprite["status"]): string {
  switch (status) {
    case "running":
      return "#7fe0b0";
    case "blocked":
      return "#ffc86a";
    default:
      return "#8ea0b7";
  }
}

function drawScene(
  canvas: HTMLCanvasElement,
  scene: RenderSceneModel,
): void {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.floor(scene.worldWidth * scene.zoom);
  const height = Math.floor(scene.worldHeight * scene.zoom);

  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const context = canvas.getContext("2d");

  if (!context) {
    return;
  }

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.scale(dpr, dpr);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#0d1218";
  context.fillRect(0, 0, width, height);

  const scaledGrid = scene.gridSize * scene.zoom;

  context.strokeStyle = "rgba(255, 255, 255, 0.05)";
  context.lineWidth = 1;

  for (let x = 0; x <= width; x += scaledGrid) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }

  for (let y = 0; y <= height; y += scaledGrid) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  context.font = '12px "IBM Plex Sans", sans-serif';
  context.textBaseline = "top";

  for (const entity of scene.entities) {
    const x = entity.x * scene.zoom;
    const y = entity.y * scene.zoom;
    const entityWidth = entity.width * scene.zoom;
    const entityHeight = entity.height * scene.zoom;

    context.fillStyle = entity.fill;
    context.fillRect(x, y, entityWidth, entityHeight);

    context.lineWidth = entity.selected ? 3 : 1.5;
    context.strokeStyle = entity.selected ? "#7fe0b0" : getStatusStroke(entity.status);
    context.strokeRect(x, y, entityWidth, entityHeight);

    context.fillStyle = "#f3f6fb";
    context.fillText(entity.label, x + 12, y + 10);

    context.fillStyle = "rgba(243, 246, 251, 0.7)";
    context.fillText(entity.subtitle, x + 12, y + 28);

    context.fillStyle = "rgba(255, 255, 255, 0.12)";
    context.fillRect(x + 12, y + entityHeight - 18, entityWidth - 24, 6);
    context.fillStyle = "#7fe0b0";
    context.fillRect(
      x + 12,
      y + entityHeight - 18,
      Math.max(0, (entityWidth - 24) * entity.progress),
      6,
    );
  }
}

function hitTestEntity(
  scene: RenderSceneModel,
  x: number,
  y: number,
): string | null {
  const worldX = x / scene.zoom;
  const worldY = y / scene.zoom;

  for (let index = scene.entities.length - 1; index >= 0; index -= 1) {
    const entity = scene.entities[index];

    if (!entity) {
      continue;
    }

    if (
      worldX >= entity.x &&
      worldX <= entity.x + entity.width &&
      worldY >= entity.y &&
      worldY <= entity.y + entity.height
    ) {
      return entity.entityId;
    }
  }

  return null;
}

export function RendererHost({
  scene,
  onEntitySelect,
}: RendererHostProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const redraw = useEffectEvent(() => {
    if (canvasRef.current) {
      drawScene(canvasRef.current, scene);
    }
  });

  const handleCanvasClick = (event: MouseEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const entityId = hitTestEntity(scene, x, y);

    if (entityId) {
      onEntitySelect?.(entityId);
    }
  };

  useEffect(() => {
    redraw();
  }, [scene]);

  return (
    <div className="renderer-host">
      <canvas
        className="renderer-canvas"
        onClick={handleCanvasClick}
        ref={canvasRef}
      />
    </div>
  );
}
