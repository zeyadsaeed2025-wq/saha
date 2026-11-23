import type { Room, Workspace } from '../../domain/types.js';

export type DecorKind =
  | 'desk' | 'chair' | 'monitor' | 'plant' | 'sofa' | 'table' | 'bookshelf'
  | 'rug' | 'lamp' | 'whiteboard' | 'counter' | 'partition' | 'window'
  | 'door' | 'mug' | 'screen' | 'cushion';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DecorItem extends Rect {
  id: string;
  kind: DecorKind;
  color?: string;
  label?: string;
  roomId: string;
}

export interface Portal {
  id: string;
  fromRoomId: string;
  toRoomId: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  orientation: 'horizontal' | 'vertical';
}

export interface OfficeLayout {
  roomId: string;
  decor: DecorItem[];
  obstacles: Rect[];
  portals: Portal[];
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Deterministic, original office decoration derived from persisted room bounds.
 * The same generator is used by the HTTP layout endpoint and by server movement
 * validation, so clients can never draw furniture the server does not know about.
 */
export function buildOfficeLayout(workspace: Workspace, rooms: Room[]): OfficeLayout {
  const decor: DecorItem[] = [];
  const obstacles: Rect[] = [];
  const activeRooms = rooms.filter((room) => room.workspaceId === workspace.id && room.organizationId === workspace.organizationId);

  const add = (room: Room, kind: DecorKind, rect: Rect, color?: string, label?: string, solid = true) => {
    const item: DecorItem = {
      id: `${room.id}:${kind}:${decor.length + 1}`,
      roomId: room.id,
      kind,
      ...rect,
      color,
      label,
    };
    decor.push(item);
    if (solid) obstacles.push(rect);
  };

  for (const room of activeRooms) {
    const { x, y, w, h } = room.bounds;
    const accent = room.color;

    // Every room gets a rug and a couple of plants for continuity.
    add(room, 'rug', { x: x + w * 0.22, y: y + h * 0.30, w: w * 0.56, h: h * 0.46 }, '#d9e8df', undefined, false);
    add(room, 'plant', { x: x + 18, y: y + h - 48, w: 28, h: 30 }, '#2e9e6b', undefined, false);
    add(room, 'plant', { x: x + w - 46, y: y + 18, w: 28, h: 30 }, '#3aa77b', undefined, false);
    add(room, 'lamp', { x: x + w - 30, y: y + h - 34, w: 18, h: 18 }, '#f2c66d', undefined, false);

    if (room.kind === 'reception' || room.kind === 'lobby') {
      add(room, 'counter', { x: x + w * 0.18, y: y + 46, w: w * 0.64, h: 34 }, '#244f56', 'RECEPTION');
      add(room, 'screen', { x: x + w * 0.34, y: y + 54, w: w * 0.32, h: 18 }, '#8bd3c7', undefined, false);
      add(room, 'sofa', { x: x + 26, y: y + h - 94, w: 82, h: 34 }, '#ef9b78');
      add(room, 'table', { x: x + 116, y: y + h - 78, w: 38, h: 24 }, '#b6815a');
      add(room, 'cushion', { x: x + w - 100, y: y + h - 92, w: 54, h: 30 }, '#f2c66d', undefined, false);
    } else if (room.kind === 'focus' || room.kind === 'open') {
      const cols = w > 480 ? 3 : 2;
      const rows = h > 320 ? 2 : 1;
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const dw = clamp(w * 0.22, 74, 116);
          const dh = 38;
          const dx = x + 36 + col * ((w - 72 - dw) / Math.max(1, cols - 1));
          const dy = y + 70 + row * ((h - 150 - dh) / Math.max(1, rows - 1));
          add(room, 'desk', { x: dx, y: dy, w: dw, h: dh }, '#2f4f63');
          add(room, 'monitor', { x: dx + dw * 0.30, y: dy - 13, w: dw * 0.40, h: 14 }, '#66c7bd', undefined, false);
          add(room, 'chair', { x: dx + dw * 0.34, y: dy + dh + 4, w: 28, h: 18 }, '#ef9b78', undefined, false);
          add(room, 'mug', { x: dx + dw - 18, y: dy + 8, w: 8, h: 8 }, '#f2c66d', undefined, false);
        }
      }
      add(room, 'bookshelf', { x: x + w - 40, y: y + h * 0.36, w: 26, h: 92 }, '#8a6b53');
    } else if (room.kind === 'meeting') {
      add(room, 'whiteboard', { x: x + w * 0.25, y: y + 18, w: w * 0.50, h: 16 }, '#f7fbf9', 'IDEAS', false);
      add(room, 'table', { x: x + w * 0.20, y: y + h * 0.38, w: w * 0.60, h: h * 0.30 }, '#b6815a');
      const seats = 6;
      for (let i = 0; i < seats; i += 1) {
        const sx = x + w * 0.24 + (i % 3) * (w * 0.26);
        const sy = i < 3 ? y + h * 0.38 - 24 : y + h * 0.68 + 6;
        add(room, 'chair', { x: sx, y: sy, w: 28, h: 18 }, '#2f4f63', undefined, false);
      }
      add(room, 'screen', { x: x + w * 0.40, y: y + h * 0.46, w: w * 0.20, h: 14 }, '#66c7bd', undefined, false);
    } else if (room.kind === 'social' || room.kind === 'collaboration') {
      add(room, 'sofa', { x: x + 24, y: y + 58, w: 96, h: 38 }, '#e98566');
      add(room, 'sofa', { x: x + w - 120, y: y + h - 96, w: 96, h: 38 }, '#6f8fb0');
      add(room, 'table', { x: x + w * 0.42, y: y + h * 0.40, w: 62, h: 40 }, '#b6815a');
      add(room, 'counter', { x: x + w * 0.18, y: y + h - 42, w: w * 0.52, h: 24 }, '#244f56', 'COFFEE');
      add(room, 'plant', { x: x + w - 46, y: y + 58, w: 28, h: 30 }, '#2e9e6b', undefined, false);
    } else if (room.kind === 'study') {
      const rows = h > 380 ? 3 : 2;
      for (let row = 0; row < rows; row += 1) {
        const ty = y + 66 + row * ((h - 140) / rows);
        add(room, 'table', { x: x + 42, y: ty, w: w - 84, h: 28 }, '#b6815a');
        for (let i = 0; i < 4; i += 1) {
          add(room, 'chair', { x: x + 64 + i * ((w - 150) / 3), y: ty + 32, w: 24, h: 16 }, '#6f8fb0', undefined, false);
        }
      }
      add(room, 'bookshelf', { x: x + w - 38, y: y + 52, w: 24, h: Math.min(120, h - 100) }, '#8a6b53');
      add(room, 'partition', { x: x + 22, y: y + 52, w: 10, h: Math.min(110, h - 100) }, '#cbdad7', undefined, false);
    } else if (room.kind === 'mentor' || room.kind === 'private') {
      add(room, 'desk', { x: x + w * 0.20, y: y + 64, w: w * 0.60, h: 40 }, '#2f4f63');
      add(room, 'monitor', { x: x + w * 0.36, y: y + 50, w: w * 0.28, h: 15 }, '#66c7bd', undefined, false);
      add(room, 'chair', { x: x + w * 0.42, y: y + 108, w: 28, h: 18 }, '#ef9b78', undefined, false);
      add(room, 'whiteboard', { x: x + w * 0.24, y: y + h - 42, w: w * 0.52, h: 14 }, '#f7fbf9', '1:1', false);
      add(room, 'bookshelf', { x: x + 20, y: y + h * 0.34, w: 24, h: Math.min(100, h - 90) }, '#8a6b53');
    }
  }

  const portals: Portal[] = [];
  for (let i = 0; i < activeRooms.length; i += 1) {
    for (let j = i + 1; j < activeRooms.length; j += 1) {
      const a = activeRooms[i].bounds;
      const b = activeRooms[j].bounds;
      const xOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const yOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      const horizontalGap = a.x <= b.x ? b.x - (a.x + a.w) : a.x - (b.x + b.w);
      const verticalGap = a.y <= b.y ? b.y - (a.y + a.h) : a.y - (b.y + b.h);

      if (horizontalGap >= 0 && horizontalGap <= 70 && xOverlap <= 0 && yOverlap > 80) {
        const aFirst = a.x < b.x;
        const left = aFirst ? a : b;
        const right = aFirst ? b : a;
        const y = clamp((Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) / 2, 0, workspace.height);
        portals.push({
          id: `${activeRooms[i].id}-${activeRooms[j].id}`,
          fromRoomId: left === a ? activeRooms[i].id : activeRooms[j].id,
          toRoomId: left === a ? activeRooms[j].id : activeRooms[i].id,
          from: { x: left.x + left.w - 16, y },
          to: { x: right.x + 16, y },
          orientation: 'horizontal',
        });
      } else if (verticalGap >= 0 && verticalGap <= 70 && yOverlap <= 0 && xOverlap > 80) {
        const aFirst = a.y < b.y;
        const top = aFirst ? a : b;
        const bottom = aFirst ? b : a;
        const x = clamp((Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2, 0, workspace.width);
        portals.push({
          id: `${activeRooms[i].id}-${activeRooms[j].id}`,
          fromRoomId: top === a ? activeRooms[i].id : activeRooms[j].id,
          toRoomId: top === a ? activeRooms[j].id : activeRooms[i].id,
          from: { x, y: top.y + top.h - 16 },
          to: { x, y: bottom.y + 16 },
          orientation: 'vertical',
        });
      }
    }
  }

  // Include visible doors for every portal in the decor layer.
  for (const portal of portals) {
    const fromRoom = activeRooms.find((room) => room.id === portal.fromRoomId);
    if (!fromRoom) continue;
    decor.push({
      id: `${portal.id}:door`,
      roomId: portal.fromRoomId,
      kind: 'door',
      x: portal.from.x - 12,
      y: portal.from.y - 6,
      w: portal.orientation === 'horizontal' ? 24 : 12,
      h: portal.orientation === 'horizontal' ? 12 : 24,
      color: '#f2c66d',
      label: portal.toRoomId,
    });
  }

  return { roomId: activeRooms[0]?.id ?? '', decor, obstacles, portals };
}

export function obstacleAt(obstacles: Rect[], x: number, y: number, radius = 10): boolean {
  return obstacles.some((rect) => (
    x + radius > rect.x && x - radius < rect.x + rect.w
    && y + radius > rect.y && y - radius < rect.y + rect.h
  ));
}
