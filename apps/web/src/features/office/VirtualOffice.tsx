import {
  Application, Container, Graphics, Rectangle, Text, type FederatedPointerEvent,
} from 'pixi.js';
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Crosshair, Info, Maximize2, Minus,
  MousePointer2, Plus, RotateCcw, Users, Wifi, WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge, Button, Card, CardHead, EmptyState, IconButton, PageHead, Skeleton, useAsync,
} from '../../components/ui.js';
import { api, getCookie, wsUrl } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.js';
import { useI18n } from '../../lib/i18n.js';
import { useToast } from '../../lib/toast.js';
import type { OfficeLayout, OfficeRect, Room, Workspace } from '../../types.js';

import { appearanceKey, DEFAULT_APPEARANCE, readAppearance, type AvatarAppearanceView } from '../../lib/appearance.js';

interface Peer {
  userId: string;
  name: string;
  x: number;
  y: number;
  color: string;
  roomId: string;
  appearance: AvatarAppearanceView;
}

interface NearbyPeer extends Peer { distance: number }

interface Waypoint {
  x: number;
  y: number;
  roomId: string;
  tolerance: number;
}

interface AvatarView {
  view: Container;
  ring: Graphics;
  body: Graphics;
  targetX: number;
  targetY: number;
  appearanceKey: string;
}

interface Position {
  x: number;
  y: number;
  roomId: string;
}

interface CameraView {
  scale: number;
  x: number;
  y: number;
  follow: boolean;
  adjusted: boolean;
}

interface Scope { workspaceId?: string; roomId?: string }

interface OfficeData {
  workspaces: Workspace[];
  workspace: Workspace;
  rooms: Room[];
  layout: OfficeLayout;
}

const SCOPE_KEY = 'saha_office_scope';
const PROXIMITY_RADIUS = 140;
const MOVE_SPEED = 185;
const AVATAR_MARGIN = 14;

function readScope(): Scope {
  try {
    const raw = sessionStorage.getItem(SCOPE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Scope;
    return {
      workspaceId: typeof parsed.workspaceId === 'string' ? parsed.workspaceId : undefined,
      roomId: typeof parsed.roomId === 'string' ? parsed.roomId : undefined,
    };
  } catch {
    return {};
  }
}

function toHex(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const raw = value.trim().replace(/^#/, '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const parsed = Number.parseInt(full, 16);
  return Number.isFinite(parsed) && full.length === 6 ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function pointInRect(x: number, y: number, rect: OfficeRect): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function blocked(obstacles: OfficeRect[], x: number, y: number, radius = 10): boolean {
  return obstacles.some((rect) => (
    x + radius > rect.x && x - radius < rect.x + rect.w
    && y + radius > rect.y && y - radius < rect.y + rect.h
  ));
}

async function obtainWsToken(): Promise<string> {
  try {
    const ticket = await api<{ ticket: string }>('/auth/ws-ticket', { method: 'POST' });
    if (ticket.ticket) return ticket.ticket;
  } catch {
    // Backward-compatible fallback for deployments without the ticket endpoint.
  }
  return getCookie('saha_csrf');
}

export function VirtualOffice() {
  const { t } = useI18n();
  const { me } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const tRef = useRef(t);
  const notifyRef = useRef(notify);
  tRef.current = t;
  notifyRef.current = notify;

  const orgId = me?.activeOrgId ?? '';
  const role = me?.role ?? 'student';
  const isGuest = Boolean(me?.isGuest);
  const scope = useMemo(() => (isGuest ? readScope() : {}), [isGuest]);
  const [workspaceChoice, setWorkspaceChoice] = useState(() => (isGuest ? readScope().workspaceId ?? '' : ''));

  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const spritesRef = useRef<Map<string, AvatarView>>(new Map());
  const socketRef = useRef<WebSocket | null>(null);
  const roomsRef = useRef<Room[]>([]);
  const layoutRef = useRef<OfficeLayout | null>(null);
  const scopeRef = useRef(scope);
  const canEnterRef = useRef<(room: Room) => boolean>(() => true);
  const rebuildSceneRef = useRef<(layout: OfficeLayout) => void>(() => undefined);
  const fitViewRef = useRef<() => void>(() => undefined);
  const zoomRef = useRef<(factor: number) => void>(() => undefined);
  const followToggleRef = useRef<() => void>(() => undefined);
  const routeToRef = useRef<(x: number, y: number, roomId: string) => void>(() => undefined);
  const reconnectRef = useRef<() => void>(() => undefined);
  const confirmedRef = useRef<Position>({ x: 0, y: 0, roomId: '' });
  const predictedRef = useRef<Position>({ x: 0, y: 0, roomId: '' });
  const renderRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const routeRef = useRef<Waypoint[]>([]);
  const heldRef = useRef<Set<string>>(new Set());
  const nearbyRef = useRef<NearbyPeer[]>([]);
  const lastRejectRef = useRef({ at: 0, reason: '' });
  const cameraRef = useRef<CameraView>({ scale: 1, x: 0, y: 0, follow: true, adjusted: false });
  const screenRef = useRef({ w: 900, h: 560 });
  const cleanupHolder = useRef<() => void>(() => undefined);

  const [status, setStatus] = useState<'connecting' | 'online' | 'reconnecting' | 'offline'>('connecting');
  const [fatal, setFatal] = useState<string | null>(null);
  const [rendererError, setRendererError] = useState<string | null>(null);
  const [online, setOnlineState] = useState<Peer[]>([]);
  const onlineRef = useRef<Peer[]>([]);
  const setOnline = useCallback((value: Peer[] | ((current: Peer[]) => Peer[])) => {
    setOnlineState((current) => {
      const next = typeof value === 'function' ? value(current) : value;
      onlineRef.current = next;
      return next;
    });
  }, []);
  const [nearby, setNearby] = useState<NearbyPeer[]>([]);
  const [occupancy, setOccupancy] = useState<Record<string, number>>({});
  const [activeRoomId, setActiveRoomId] = useState<string>('');
  const [follow, setFollow] = useState(true);
  const [mini, setMini] = useState({ x: 0, y: 0, scale: 0.5, w: 900, h: 560, selfX: 0, selfY: 0 });

  scopeRef.current = scope;

  const canEnterRoom = useCallback((room: Room) => {
    if (scopeRef.current.roomId && room.id !== scopeRef.current.roomId) return false;
    if (role === 'super_admin') return true;
    return room.allowedRoles.includes(role);
  }, [role]);
  canEnterRef.current = canEnterRoom;

  useEffect(() => {
    if (isGuest && scope.workspaceId && !workspaceChoice) setWorkspaceChoice(scope.workspaceId);
  }, [isGuest, scope.workspaceId, workspaceChoice]);

  const { data, loading, error, reload } = useAsync<OfficeData | null>(async () => {
    if (!orgId) return null;
    const list = await api<{ workspaces: Workspace[] }>(`/orgs/${orgId}/workspaces`);
    if (!list.workspaces.length) throw new Error(tRef.current('noWorkspace'));
    const workspace = list.workspaces.find((item) => !workspaceChoice || item.id === workspaceChoice)
      ?? list.workspaces[0];
    const query = `?workspaceId=${encodeURIComponent(workspace.id)}`;
    const [detail, layout] = await Promise.all([
      api<{ workspace: Workspace; rooms: Room[] }>(`/orgs/${orgId}/workspaces/${workspace.id}`),
      api<OfficeLayout>(`/orgs/${orgId}/world/layout${query}`),
    ]);
    return { workspaces: list.workspaces, workspace: detail.workspace, rooms: detail.rooms, layout };
  }, [orgId, workspaceChoice]);

  useEffect(() => {
    if (!data || !hostRef.current || !me) return;
    const host = hostRef.current;
    const { workspace, rooms } = data;
    roomsRef.current = rooms;
    layoutRef.current = data.layout;
    let disposed = false;
    let innerCleanup: (() => void) | undefined;
    let intentionalClose = false;
    let reconnectTimer: number | undefined;
    let reconnectAttempt = 0;
    setRendererError(null);
    setFatal(null);

    const debug = {
      messages: [] as Array<Record<string, unknown>>,
      sent: [] as Array<Record<string, unknown>>,
      route: [] as Waypoint[],
      predicted: { x: 0, y: 0, roomId: '' },
      confirmed: { x: 0, y: 0, roomId: '' },
    };
    if (import.meta.env.DEV) {
      (window as Window & { __sahaOfficeDebug?: typeof debug }).__sahaOfficeDebug = debug;
    }

    const app = new Application();
    appRef.current = app;

    const world = new Container();
    const staticLayer = new Container();
    const doorLayer = new Container();
    const proximityLayer = new Graphics();
    const avatarLayer = new Container();
    world.addChild(staticLayer, doorLayer, proximityLayer, avatarLayer);

    const findRoom = (id: string) => rooms.find((room) => room.id === id);
    const findRoomAt = (x: number, y: number) => rooms.find((room) => pointInRect(x, y, room.bounds));
    const clampToRoom = (x: number, y: number, room: Room) => ({
      x: clamp(x, room.bounds.x + AVATAR_MARGIN, room.bounds.x + room.bounds.w - AVATAR_MARGIN),
      y: clamp(y, room.bounds.y + AVATAR_MARGIN, room.bounds.y + room.bounds.h - AVATAR_MARGIN),
    });

    /** Grid A* within one room, so click-to-move never walks through server-known furniture. */
    const localPath = (room: Room, from: { x: number; y: number }, to: { x: number; y: number }): Waypoint[] => {
      const obstacles = layoutRef.current?.obstacles ?? [];
      const cell = 16;
      const minX = room.bounds.x + 14;
      const minY = room.bounds.y + 14;
      const maxX = room.bounds.x + room.bounds.w - 14;
      const maxY = room.bounds.y + room.bounds.h - 14;
      const cols = Math.max(1, Math.floor((maxX - minX) / cell));
      const rows = Math.max(1, Math.floor((maxY - minY) / cell));
      const pointAt = (c: number, r: number) => ({ x: minX + c * cell, y: minY + r * cell });
      const cellAt = (point: { x: number; y: number }) => ({
        c: clamp(Math.round((point.x - minX) / cell), 0, cols),
        r: clamp(Math.round((point.y - minY) / cell), 0, rows),
      });
      const key = (c: number, r: number) => `${c},${r}`;
      const start = cellAt(from);
      const goal = cellAt(to);
      const free = (c: number, r: number) => {
        if (c < 0 || c > cols || r < 0 || r > rows) return false;
        const p = pointAt(c, r);
        return !blocked(obstacles, p.x, p.y, 12);
      };
      const open: Array<{ c: number; r: number; f: number }> = [{ ...start, f: 0 }];
      const came = new Map<string, string>();
      const gScore = new Map<string, number>([[key(start.c, start.r), 0]]);
      const visited = new Set<string>();
      const heuristic = (c: number, r: number) => Math.hypot(goal.c - c, goal.r - r);

      while (open.length) {
        open.sort((a, b) => a.f - b.f);
        const current = open.shift()!;
        const currentKey = key(current.c, current.r);
        if (current.c === goal.c && current.r === goal.r) {
          const cells: Array<{ c: number; r: number }> = [];
          let cursor: string | undefined = currentKey;
          while (cursor) {
            const [c, r] = cursor.split(',').map(Number);
            cells.unshift({ c, r });
            cursor = came.get(cursor);
          }
          const points = cells.map((cellPoint) => pointAt(cellPoint.c, cellPoint.r));
          points[0] = { ...from };
          points[points.length - 1] = { ...to };
          return points.map((p, index) => ({
            ...p, roomId: room.id, tolerance: index === points.length - 1 ? 8 : 10,
          }));
        }
        if (visited.has(currentKey)) continue;
        visited.add(currentKey);
        for (let dc = -1; dc <= 1; dc += 1) {
          for (let dr = -1; dr <= 1; dr += 1) {
            if (!dc && !dr) continue;
            const nc = current.c + dc;
            const nr = current.r + dr;
            if (!free(nc, nr)) continue;
            if (dc && dr && (!free(current.c + dc, current.r) || !free(current.c, current.r + dr))) continue;
            const nextKey = key(nc, nr);
            const tentative = (gScore.get(currentKey) ?? Number.POSITIVE_INFINITY) + Math.hypot(dc, dr);
            if (tentative >= (gScore.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
            came.set(nextKey, currentKey);
            gScore.set(nextKey, tentative);
            open.push({ c: nc, r: nr, f: tentative + heuristic(nc, nr) });
          }
        }
      }
      return [{ ...to, roomId: room.id, tolerance: 10 }];
    };

    const hex = (value: string | undefined, fallback: number) => toHex(value, fallback);
    const pix = (g: Graphics, rect: OfficeRect, fill: number, stroke?: number, alpha = 1) => {
      g.rect(rect.x, rect.y, rect.w, rect.h).fill({ color: fill, alpha });
      if (stroke !== undefined) g.rect(rect.x, rect.y, rect.w, rect.h).stroke({ color: stroke, width: 2 });
    };

    const drawDecor = (layer: Container, item: OfficeLayout['decor'][number]) => {
      const g = new Graphics();
      const { x, y, w, h } = item;
      switch (item.kind) {
        case 'rug':
          g.roundRect(x, y, w, h, Math.min(18, h / 3)).fill({ color: hex(item.color, 0xd9e8df), alpha: 0.62 })
            .stroke({ color: 0xffffff, width: 3, alpha: 0.8 });
          break;
        case 'desk':
          g.rect(x + 3, y + 5, w, h).fill({ color: 0x10242b, alpha: 0.13 });
          g.roundRect(x, y, w, h, 4).fill(hex(item.color, 0x2f4f63)).stroke({ color: 0x1d3b4a, width: 2 });
          g.rect(x + 8, y + h - 8, w - 16, 3).fill({ color: 0xffffff, alpha: 0.2 });
          g.rect(x + w * 0.28, y + h * 0.45, w * 0.44, 7).fill(0xd7e0e2).stroke({ color: 0x8da3a8, width: 1 });
          break;
        case 'monitor':
          g.rect(x + 2, y + 3, w, h).fill({ color: 0x122b35, alpha: 0.18 });
          g.roundRect(x, y, w, h, 3).fill(0x244e5d).stroke({ color: 0x10242b, width: 2 });
          g.rect(x + 3, y + 3, w - 6, h - 6).fill(hex(item.color, 0x66c7bd));
          g.rect(x + w / 2 - 3, y + h, 6, 5).fill(0x244e5d);
          break;
        case 'chair':
          g.ellipse(x + w / 2, y + h + 3, w * 0.42, 4).fill({ color: 0x10242b, alpha: 0.16 });
          g.roundRect(x, y, w, h, 6).fill(hex(item.color, 0xef9b78)).stroke({ color: 0x8a5445, width: 1.5 });
          g.rect(x + 4, y + 4, w - 8, 3).fill({ color: 0xffffff, alpha: 0.22 });
          break;
        case 'plant':
          g.ellipse(x + w / 2, y + h - 2, w * 0.48, 5).fill({ color: 0x10242b, alpha: 0.18 });
          g.rect(x + 6, y + h - 14, w - 12, 13).fill(0xb97856).stroke({ color: 0x7e4f3a, width: 1.5 });
          g.circle(x + w * 0.34, y + 12, 10).fill(hex(item.color, 0x2e9e6b));
          g.circle(x + w * 0.68, y + 16, 9).fill(0x53b986);
          g.circle(x + w * 0.50, y + 6, 8).fill(0x79cfa4);
          break;
        case 'sofa':
          g.rect(x + 4, y + 6, w, h).fill({ color: 0x10242b, alpha: 0.14 });
          g.roundRect(x, y, w, h, 9).fill(hex(item.color, 0xef9b78)).stroke({ color: 0x9d5d48, width: 2 });
          g.roundRect(x + 8, y + 7, w / 2 - 12, h - 16, 5).fill({ color: 0xffffff, alpha: 0.17 });
          g.roundRect(x + w / 2 + 4, y + 7, w / 2 - 12, h - 16, 5).fill({ color: 0x10242b, alpha: 0.09 });
          break;
        case 'table':
          g.rect(x + 4, y + 6, w, h).fill({ color: 0x10242b, alpha: 0.16 });
          g.roundRect(x, y, w, h, 7).fill(hex(item.color, 0xb6815a)).stroke({ color: 0x7a563d, width: 2 });
          g.rect(x + 7, y + 5, w - 14, 3).fill({ color: 0xffffff, alpha: 0.18 });
          break;
        case 'bookshelf':
          g.rect(x + 3, y + 4, w, h).fill({ color: 0x10242b, alpha: 0.18 });
          g.rect(x, y, w, h).fill(0x8a6b53).stroke({ color: 0x5d4736, width: 2 });
          for (let sy = y + 8; sy < y + h - 4; sy += 18) {
            g.rect(x + 4, sy, w - 8, 3).fill(0xd7b892);
            const colors = [0x0e7c7b, 0xf0795a, 0x6d5bd0, 0xd99a2b];
            for (let bx = x + 6, i = 0; bx < x + w - 8; bx += 7, i += 1) {
              g.rect(bx, sy - 9, 5, 8).fill(colors[i % colors.length]);
            }
          }
          break;
        case 'whiteboard':
          g.rect(x + 3, y + 4, w, h).fill({ color: 0x10242b, alpha: 0.14 });
          g.rect(x, y, w, h).fill(0xf7fbf9).stroke({ color: 0x7e9c99, width: 3 });
          g.moveTo(x + 12, y + h - 7).lineTo(x + w - 12, y + h - 7).stroke({ color: 0x0e7c7b, width: 2 });
          break;
        case 'counter':
          pix(g, { x: x + 4, y: y + 5, w, h }, 0x10242b, undefined, 0.14);
          pix(g, { x, y, w, h }, hex(item.color, 0x244f56), 0x10242b);
          g.rect(x + 6, y + 6, w - 12, 3).fill({ color: 0xffffff, alpha: 0.22 });
          break;
        case 'partition':
          g.rect(x, y, w, h).fill(hex(item.color, 0xcbdad7)).stroke({ color: 0x8aa6a2, width: 2 });
          break;
        case 'lamp':
          g.circle(x + w / 2, y + h / 2, Math.max(7, w / 2)).fill({ color: hex(item.color, 0xf2c66d), alpha: 0.92 });
          g.circle(x + w / 2, y + h / 2, Math.max(12, w)).fill({ color: 0xf2c66d, alpha: 0.13 });
          break;
        case 'door':
          g.rect(x, y, w, h).fill(0xf6e2b8).stroke({ color: 0x9c7743, width: 2 });
          g.rect(x + w / 2 - 2, y + 2, 4, h - 4).fill({ color: 0x9c7743, alpha: 0.55 });
          break;
        case 'screen':
          g.rect(x, y, w, h).fill(hex(item.color, 0x8bd3c7)).stroke({ color: 0x214a52, width: 2 });
          g.rect(x + 3, y + 3, w - 6, 3).fill({ color: 0xffffff, alpha: 0.45 });
          break;
        case 'mug':
          g.circle(x + w / 2, y + h / 2, Math.max(3, w / 2)).fill(hex(item.color, 0xf2c66d));
          break;
        case 'cushion':
          g.roundRect(x, y, w, h, 5).fill(hex(item.color, 0xf2c66d)).stroke({ color: 0xb78a34, width: 1 });
          break;
        case 'window':
          g.rect(x, y, w, h).fill(0xbfe4ee).stroke({ color: 0x7aa6b3, width: 2 });
          break;
        default:
          break;
      }
      layer.addChild(g);
      if (item.label) {
        const label = new Text({
          text: item.label,
          style: { fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 9, fontWeight: '700', fill: 0x21434d, letterSpacing: 1 },
        });
        label.anchor.set(0.5);
        label.position.set(x + w / 2, y + h / 2);
        layer.addChild(label);
      }
    };

    const rebuildScene = (layout: OfficeLayout) => {
      layoutRef.current = layout;
      staticLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
      doorLayer.removeChildren().forEach((child) => child.destroy({ children: true }));

      const floor = new Graphics();
      floor.roundRect(-14, -14, workspace.width + 28, workspace.height + 28, 22)
        .fill({ color: 0x17353d, alpha: 0.14 });
      floor.rect(0, 0, workspace.width, workspace.height).fill(0xf6f1e7).stroke({ color: 0xcbd8d4, width: 3 });
      staticLayer.addChild(floor);

      for (const room of rooms) {
        const { x, y, w, h } = room.bounds;
        const base = hex(room.color, 0xe8efed);
        const roomFloor = new Graphics();
        roomFloor.rect(x, y, w, h).fill(base).stroke({ color: 0xffffff, width: 4 });
        for (let tx = x + 32; tx < x + w; tx += 32) {
          roomFloor.moveTo(tx, y).lineTo(tx, y + h).stroke({ color: 0x10242b, width: 1, alpha: 0.045 });
        }
        for (let ty = y + 32; ty < y + h; ty += 32) {
          roomFloor.moveTo(x, ty).lineTo(x + w, ty).stroke({ color: 0x10242b, width: 1, alpha: 0.045 });
        }
        roomFloor.rect(x, y, w, 8).fill({ color: 0x10242b, alpha: 0.06 });
        staticLayer.addChild(roomFloor);

        const plaque = new Graphics();
        plaque.roundRect(x + 12, y + 12, Math.min(190, w - 24), 24, 7)
          .fill({ color: 0x102b33, alpha: 0.86 });
        staticLayer.addChild(plaque);
        const title = new Text({
          text: room.name.toUpperCase(),
          style: { fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 10, fontWeight: '800', fill: 0xffffff, letterSpacing: 1.1 },
        });
        title.position.set(x + 22, y + 18);
        staticLayer.addChild(title);
      }

      const walls = new Graphics();
      for (const room of rooms) {
        const { x, y, w, h } = room.bounds;
        walls.rect(x - 5, y - 5, w + 10, h + 10).stroke({ color: 0x6f8b89, width: 5 });
        walls.rect(x - 2, y - 2, w + 4, h + 4).stroke({ color: 0xffffff, width: 2, alpha: 0.9 });
      }
      staticLayer.addChild(walls);

      for (const item of layout.decor) {
        if (item.kind === 'door') drawDecor(doorLayer, item);
        else drawDecor(staticLayer, item);
      }

      for (const portal of layout.portals) {
        const marker = new Graphics();
        marker.circle(portal.from.x, portal.from.y, 9).fill({ color: 0xf2c66d, alpha: 0.2 })
          .stroke({ color: 0xd39a35, width: 1.5, alpha: 0.8 });
        doorLayer.addChild(marker);
      }
    };
    rebuildSceneRef.current = rebuildScene;

    const createAvatar = (peer: Peer, self: boolean): AvatarView => {
      const view = new Container();
      const ring = new Graphics().circle(0, -7, 24).stroke({ color: 0x34d399, width: 3, alpha: 0.95 });
      ring.visible = false;
      const shadow = new Graphics().ellipse(0, 15, 14, 5).fill({ color: 0x10242b, alpha: 0.2 });
      const body = new Graphics();
      const appearance = peer.appearance ?? DEFAULT_APPEARANCE;
      const color = hex(appearance.outfitColor ?? peer.color, 0x0e7c7b);
      const character = appearance.character.toLowerCase();
      const variant = character.includes('round') ? 'round'
        : character.includes('tall') ? 'tall'
          : character.includes('slim') ? 'slim'
            : character === 'standard' ? 'standard'
              : (['standard', 'round', 'tall', 'slim'][[...character].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 4]!);
      const headY = variant === 'tall' ? -24 : -20;
      if (variant === 'round') body.circle(0, 0, 14).fill(color).stroke({ color: 0x10242b, width: self ? 3 : 2 });
      else if (variant === 'tall') body.roundRect(-11, -18, 22, 34, 8).fill(color).stroke({ color: 0x10242b, width: self ? 3 : 2 });
      else if (variant === 'slim') body.roundRect(-9, -14, 18, 28, 8).fill(color).stroke({ color: 0x10242b, width: self ? 3 : 2 });
      else body.roundRect(-12, -14, 24, 28, 9).fill(color).stroke({ color: 0x10242b, width: self ? 3 : 2 });
      body.rect(-8, 8, 5, 5).fill(0x10242b);
      body.rect(3, 8, 5, 5).fill(0x10242b);
      const head = new Graphics().circle(0, headY, 9).fill(0xf2c8a8).stroke({ color: 0x10242b, width: 1.5 });
      const hair = new Graphics().roundRect(-9, headY - 9, 18, 8, 4).fill(0x263b42);
      const accessoryValue = (appearance.accessory ?? '').trim();
      const accessory = new Graphics();
      if (accessoryValue) {
        const lower = accessoryValue.toLowerCase();
        if (lower.includes('glass') || lower.includes('نظارة')) {
          accessory.circle(-4, headY, 2.6).stroke({ color: 0x10242b, width: 1.4 });
          accessory.circle(4, headY, 2.6).stroke({ color: 0x10242b, width: 1.4 });
          accessory.rect(-1.4, headY, 2.8, 1).fill(0x10242b);
        } else if (lower.includes('hat') || lower.includes('cap') || lower.includes('قبعة')) {
          accessory.roundRect(-10, headY - 13, 20, 5, 2).fill(0x243a45);
          accessory.roundRect(-12, headY - 9, 24, 2, 1).fill(0x243a45);
        } else {
          accessory.roundRect(-10, 2, 20, 4, 2).fill(0xf2c66d).stroke({ color: 0x10242b, width: 1 });
        }
      }
      const initial = new Text({
        text: peer.name.trim().slice(0, 1).toUpperCase() || '?',
        style: { fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 9, fontWeight: '800', fill: 0x10242b },
      });
      initial.anchor.set(0.5);
      initial.position.set(0, headY);
      const badge = new Graphics().roundRect(-36, 18, 72, 17, 8).fill({ color: 0x102b33, alpha: 0.88 });
      const label = new Text({
        text: self ? `${peer.name} · ${tRef.current('you')}` : peer.name,
        style: { fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 10, fontWeight: '700', fill: 0xffffff },
      });
      label.anchor.set(0.5, 0);
      label.position.set(0, 22);
      label.scale.set(Math.min(1, 72 / Math.max(28, label.width)));
      view.addChild(ring, shadow, body, head, hair, accessory, initial, badge, label);
      return { view, ring, body, targetX: peer.x, targetY: peer.y, appearanceKey: appearanceKey(appearance) };
    };

    const setAvatar = (peer: Peer, self: boolean) => {
      const existing = spritesRef.current.get(peer.userId);
      if (existing) {
        if (existing.appearanceKey !== appearanceKey(peer.appearance)) {
          // Appearance is baked into the Pixi display objects, so a saved
          // change requires rebuilding the avatar rather than moving it.
          removeAvatar(peer.userId);
        } else {
          existing.targetX = peer.x;
          existing.targetY = peer.y;
          return existing;
        }
      }
      const avatar = createAvatar(peer, self);
      avatar.view.position.set(peer.x, peer.y);
      avatarLayer.addChild(avatar.view);
      spritesRef.current.set(peer.userId, avatar);
      return avatar;
    };

    const removeAvatar = (userId: string) => {
      const avatar = spritesRef.current.get(userId);
      if (!avatar) return;
      avatar.view.destroy({ children: true });
      spritesRef.current.delete(userId);
    };

    const applyCamera = () => {
      const cam = cameraRef.current;
      cam.scale = clamp(cam.scale, 0.2, 2.4);
      world.scale.set(cam.scale);
      const scaledW = workspace.width * cam.scale;
      const scaledH = workspace.height * cam.scale;
      const { w, h } = screenRef.current;
      if (cam.follow) {
        const self = confirmedRef.current;
        cam.x = w / 2 - self.x * cam.scale;
        cam.y = h / 2 - self.y * cam.scale;
      }
      cam.x = scaledW <= w ? (w - scaledW) / 2 : clamp(cam.x, w - scaledW, 0);
      cam.y = scaledH <= h ? (h - scaledH) / 2 : clamp(cam.y, h - scaledH, 0);
      world.position.set(cam.x, cam.y);
    };

    const fitView = () => {
      const { w, h } = screenRef.current;
      cameraRef.current.scale = Math.min((w - 36) / workspace.width, (h - 36) / workspace.height);
      cameraRef.current.follow = false;
      cameraRef.current.adjusted = false;
      setFollow(false);
      applyCamera();
    };
    fitViewRef.current = fitView;

    const zoom = (factor: number) => {
      const cam = cameraRef.current;
      const { w, h } = screenRef.current;
      const before = cam.scale;
      const after = clamp(before * factor, 0.2, 2.4);
      if (before === after) return;
      const worldX = (w / 2 - cam.x) / before;
      const worldY = (h / 2 - cam.y) / before;
      cam.scale = after;
      cam.follow = false;
      cam.adjusted = true;
      setFollow(false);
      cam.x = w / 2 - worldX * after;
      cam.y = h / 2 - worldY * after;
      applyCamera();
    };
    zoomRef.current = zoom;

    const toggleFollow = () => {
      cameraRef.current.follow = !cameraRef.current.follow;
      cameraRef.current.adjusted = true;
      setFollow(cameraRef.current.follow);
      applyCamera();
    };
    followToggleRef.current = toggleFollow;

    const reasonLabel = (reason: string) => {
      const map: Record<string, string> = {
        ROOM_FORBIDDEN: 'privateRoom', NO_DOOR: 'useDoor', USE_DOOR: 'useDoor',
        OBSTACLE: 'blockedByFurniture', INVALID_COORDINATES: 'invalidMove',
        OUT_OF_BOUNDS: 'invalidMove', UNKNOWN_ROOM: 'invalidMove',
        QUOTA_EXCEEDED: 'quotaExceeded',
      };
      return tRef.current(map[reason] ?? 'moveRejected');
    };

    const sendMove = (x: number, y: number, roomId: string) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      predictedRef.current = { x, y, roomId };
      if (debug.sent.length > 60) debug.sent.shift();
      debug.sent.push({ x, y, roomId, at: Date.now() });
      socket.send(JSON.stringify({ type: 'move', x, y, roomId }));
    };

    const pathBetween = (from: string, to: string): string[] => {
      if (from === to) return [from];
      const layout = layoutRef.current;
      if (!layout) return [];
      const neighbours = new Map<string, string[]>();
      for (const room of rooms) neighbours.set(room.id, []);
      for (const portal of layout.portals) {
        const fromRoom = findRoom(portal.fromRoomId);
        const toRoom = findRoom(portal.toRoomId);
        if (!fromRoom || !toRoom || !canEnterRef.current(fromRoom) || !canEnterRef.current(toRoom)) continue;
        neighbours.get(portal.fromRoomId)?.push(portal.toRoomId);
        neighbours.get(portal.toRoomId)?.push(portal.fromRoomId);
      }
      const queue = [from];
      const previous = new Map<string, string | null>([[from, null]]);
      while (queue.length) {
        const current = queue.shift()!;
        for (const next of neighbours.get(current) ?? []) {
          if (previous.has(next)) continue;
          previous.set(next, current);
          if (next === to) {
            const path = [to];
            let cursor: string | null | undefined = current;
            while (cursor) { path.unshift(cursor); cursor = previous.get(cursor); }
            return path;
          }
          queue.push(next);
        }
      }
      return [];
    };

    const routeTo = (x: number, y: number, targetRoomId: string) => {
      const layout = layoutRef.current;
      const targetRoom = findRoom(targetRoomId);
      const fromRoom = findRoom(predictedRef.current.roomId);
      if (!layout || !targetRoom || !fromRoom) return;
      if (!canEnterRef.current(targetRoom)) {
        notifyRef.current(tRef.current('privateRoom'), 'error');
        return;
      }
      const destination = clampToRoom(x, y, targetRoom);
      const path = pathBetween(fromRoom.id, targetRoom.id);
      if (!path.length) {
        notifyRef.current(tRef.current('useDoor'), 'error');
        return;
      }
      const waypoints: Waypoint[] = [];
      let cursorRoom = fromRoom.id;
      let cursorPoint = { x: predictedRef.current.x, y: predictedRef.current.y };
      for (const nextRoomId of path.slice(1)) {
        const nextRoom = findRoom(nextRoomId);
        const portal = layout.portals.find((p) => (
          (p.fromRoomId === cursorRoom && p.toRoomId === nextRoomId)
          || (p.toRoomId === cursorRoom && p.fromRoomId === nextRoomId)
        ));
        if (!nextRoom || !portal) continue;
        const forward = portal.fromRoomId === cursorRoom;
        const exit = forward ? portal.from : portal.to;
        const entry = forward ? portal.to : portal.from;
        waypoints.push(...localPath(findRoom(cursorRoom)!, cursorPoint, exit));
        waypoints.push({ x: entry.x, y: entry.y, roomId: nextRoom.id, tolerance: 14 });
        cursorRoom = nextRoom.id;
        cursorPoint = { x: entry.x, y: entry.y };
      }
      waypoints.push(...localPath(targetRoom, cursorPoint, destination));
      routeRef.current = waypoints;
      if (cameraRef.current.follow) setFollow(true);
    };

    const stepDirection = (dx: number, dy: number, dt: number) => {
      const room = findRoom(predictedRef.current.roomId);
      if (!room || !canEnterRef.current(room)) return;
      const length = Math.hypot(dx, dy) || 1;
      const step = Math.min(14, (MOVE_SPEED * dt) / 1000);
      const candidate = clampToRoom(
        predictedRef.current.x + (dx / length) * step,
        predictedRef.current.y + (dy / length) * step,
        room,
      );
      if (blocked(layoutRef.current?.obstacles ?? [], candidate.x, candidate.y)) return;
      routeRef.current = [];
      sendMove(candidate.x, candidate.y, room.id);
    };

    const processRoute = (dt: number) => {
      const route = routeRef.current;
      if (!route.length) return;
      const target = route[0];
      const dx = target.x - predictedRef.current.x;
      const dy = target.y - predictedRef.current.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= target.tolerance) {
        route.shift();
        return;
      }
      const room = findRoom(target.roomId);
      if (!room || !canEnterRef.current(room)) {
        routeRef.current = [];
        return;
      }
      const step = Math.min(14, (MOVE_SPEED * dt) / 1000, distance);
      const candidate = clampToRoom(
        predictedRef.current.x + (dx / distance) * step,
        predictedRef.current.y + (dy / distance) * step,
        room,
      );
      if (blocked(layoutRef.current?.obstacles ?? [], candidate.x, candidate.y, 9)) {
        routeRef.current = [];
        notifyRef.current(tRef.current('blockedByFurniture'), 'error');
        return;
      }
      sendMove(candidate.x, candidate.y, target.roomId);
    };

    const updateProximityVisuals = (ids: Set<string>) => {
      const self = spritesRef.current.get(me.user.id);
      if (self) self.ring.visible = ids.size > 0;
      spritesRef.current.forEach((avatar, userId) => {
        if (userId !== me.user.id) avatar.ring.visible = ids.has(userId);
      });
    };

    const drawLinks = () => {
      proximityLayer.clear();
      const self = predictedRef.current;
      for (const peer of nearbyRef.current) {
        const avatar = spritesRef.current.get(peer.userId);
        if (!avatar) continue;
        proximityLayer
          .moveTo(self.x, self.y)
          .lineTo(avatar.targetX, avatar.targetY)
          .stroke({ color: 0x10b981, width: 2, alpha: 0.28 });
      }
    };

    const tick = (ticker: { deltaMS: number }) => {
      const dt = Math.min(ticker.deltaMS, 80);
      const held = heldRef.current;
      if (!routeRef.current.length && held.size) {
        let dx = 0;
        let dy = 0;
        if (held.has('left')) dx -= 1;
        if (held.has('right')) dx += 1;
        if (held.has('up')) dy -= 1;
        if (held.has('down')) dy += 1;
        if (dx || dy) stepDirection(dx, dy, dt);
      }
      processRoute(dt);
      debug.route = routeRef.current.map((point) => ({ ...point }));
      debug.predicted = { ...predictedRef.current };
      debug.confirmed = { ...confirmedRef.current };
      spritesRef.current.forEach((avatar) => {
        avatar.view.position.x += (avatar.targetX - avatar.view.position.x) * 0.24;
        avatar.view.position.y += (avatar.targetY - avatar.view.position.y) * 0.24;
      });
      const selfAvatar = spritesRef.current.get(me.user.id);
      if (selfAvatar) {
        renderRef.current.x = selfAvatar.view.position.x;
        renderRef.current.y = selfAvatar.view.position.y;
      }
      applyCamera();
      drawLinks();
      miniClock += dt;
      if (miniClock > 240) {
        miniClock = 0;
        setMini({
          x: cameraRef.current.x,
          y: cameraRef.current.y,
          scale: cameraRef.current.scale,
          w: screenRef.current.w,
          h: screenRef.current.h,
          selfX: predictedRef.current.x,
          selfY: predictedRef.current.y,
        });
      }
    };
    let miniClock = 0;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, button, [contenteditable="true"], [role="dialog"]')) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      const mapped = key === 'arrowleft' ? 'left' : key === 'arrowright' ? 'right'
        : key === 'arrowup' ? 'up' : key === 'arrowdown' ? 'down'
          : key === 'a' ? 'left' : key === 'd' ? 'right' : key === 'w' ? 'up' : key === 's' ? 'down' : '';
      if (!mapped) return;
      event.preventDefault();
      heldRef.current.add(mapped);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      heldRef.current.delete(key === 'arrowleft' ? 'left' : key === 'arrowright' ? 'right'
        : key === 'arrowup' ? 'up' : key === 'arrowdown' ? 'down'
          : key === 'a' ? 'left' : key === 'd' ? 'right' : key === 'w' ? 'up' : key === 's' ? 'down' : key);
    };
    const clearHeld = () => heldRef.current.clear();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearHeld);

    routeToRef.current = routeTo;

    const initialise = async () => {
      try {
        await app.init({
          background: 0xe9f0ee,
          antialias: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
          autoDensity: true,
          width: Math.max(1, host.clientWidth),
          height: Math.max(1, host.clientHeight),
        });
      } catch (err) {
        setRendererError(err instanceof Error ? err.message : tRef.current('officeRenderError'));
        return;
      }
      if (disposed) { app.destroy(true, { children: true }); return; }
      host.appendChild(app.canvas);
      app.canvas.style.width = '100%';
      app.canvas.style.height = '100%';
      app.canvas.style.display = 'block';
      app.canvas.style.touchAction = 'none';

      app.stage.addChild(world);
      app.stage.eventMode = 'static';

      screenRef.current = { w: app.screen.width, h: app.screen.height };
      app.stage.hitArea = new Rectangle(0, 0, app.screen.width, app.screen.height);
      rebuildScene(data.layout);
      fitView();

      const drag = { active: false, dragged: false, x: 0, y: 0, camX: 0, camY: 0 };
      const onPointerDown = (event: FederatedPointerEvent) => {
        if (event.button !== 0) return;
        drag.active = true;
        drag.dragged = false;
        drag.x = event.global.x;
        drag.y = event.global.y;
        drag.camX = cameraRef.current.x;
        drag.camY = cameraRef.current.y;
      };
      const onPointerMove = (event: FederatedPointerEvent) => {
        if (!drag.active) return;
        const dx = event.global.x - drag.x;
        const dy = event.global.y - drag.y;
        if (!drag.dragged && Math.hypot(dx, dy) < 7) return;
        drag.dragged = true;
        cameraRef.current.follow = false;
        cameraRef.current.adjusted = true;
        setFollow(false);
        cameraRef.current.x = drag.camX + dx;
        cameraRef.current.y = drag.camY + dy;
        applyCamera();
      };
      const onPointerUp = (event: FederatedPointerEvent) => {
        if (!drag.active) return;
        drag.active = false;
        if (drag.dragged) return;
        const worldX = (event.global.x - cameraRef.current.x) / cameraRef.current.scale;
        const worldY = (event.global.y - cameraRef.current.y) / cameraRef.current.scale;
        const room = findRoomAt(worldX, worldY);
        if (!room) return;
        if (!canEnterRef.current(room)) {
          notifyRef.current(tRef.current('privateRoom'), 'error');
          return;
        }
        routeTo(worldX, worldY, room.id);
      };
      const onPointerUpOutside = () => { drag.active = false; };
      app.stage.on('pointerdown', onPointerDown);
      app.stage.on('pointermove', onPointerMove);
      app.stage.on('pointerup', onPointerUp);
      app.stage.on('pointerupoutside', onPointerUpOutside);

      const observer = new ResizeObserver(() => {
        const w = Math.max(1, host.clientWidth);
        const h = Math.max(1, host.clientHeight);
        app.renderer.resize(w, h);
        screenRef.current = { w, h };
        app.stage.hitArea = new Rectangle(0, 0, w, h);
        if (!cameraRef.current.adjusted) fitView();
        else applyCamera();
      });
      observer.observe(host);
      app.ticker.add(tick);

      const connect = async () => {
        if (disposed || intentionalClose) return;
        if (reconnectTimer) window.clearTimeout(reconnectTimer);
        setStatus(reconnectAttempt === 0 ? 'connecting' : 'reconnecting');
        try {
          const token = await obtainWsToken();
          if (disposed || intentionalClose) return;
          if (!token) throw new Error('missing ticket');
          const socket = new WebSocket(wsUrl(token, orgId, workspace.id));
          socketRef.current = socket;
          socket.onopen = () => {
            reconnectAttempt = 0;
            setFatal(null);
            setStatus('online');
            socket.send(JSON.stringify({ type: 'heartbeat' }));
          };
          socket.onmessage = (event) => {
            let message: Record<string, any>;
            try { message = JSON.parse(event.data); } catch { return; }
            debug.messages.push({ ...message, at: Date.now() });
            if (debug.messages.length > 60) debug.messages.shift();

            if (message.type === 'welcome') {
              const pos: Position = {
                x: Number(message.participant?.x) || 0,
                y: Number(message.participant?.y) || 0,
                roomId: String(message.participant?.roomId ?? ''),
              };
              confirmedRef.current = pos;
              predictedRef.current = { ...pos };
              renderRef.current = { x: pos.x, y: pos.y };
              routeRef.current = [];
              setAvatar({
                userId: me.user.id, name: me.user.name, color: '#0e7c7b',
                appearance: readAppearance(message.participant?.appearance),
                roomId: pos.roomId, x: pos.x, y: pos.y,
              }, true);
              setActiveRoomId(pos.roomId);
              applyCamera();
              return;
            }
            if (message.type === 'layout') {
              const next: OfficeLayout = {
                roomId: String(message.roomId ?? ''),
                decor: Array.isArray(message.decor) ? message.decor : [],
                obstacles: Array.isArray(message.obstacles) ? message.obstacles : [],
                portals: Array.isArray(message.portals) ? message.portals : [],
              };
              rebuildScene(next);
              return;
            }
            if (message.type === 'ack') {
              const pos: Position = {
                x: Number(message.x), y: Number(message.y), roomId: String(message.roomId),
              };
              if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;
              confirmedRef.current = pos;
              predictedRef.current = { ...pos };
              const avatar = spritesRef.current.get(me.user.id);
              if (avatar) { avatar.targetX = pos.x; avatar.targetY = pos.y; }
              setActiveRoomId(pos.roomId);
              return;
            }
            if (message.type === 'rejected') {
              const reason = String(message.reason ?? 'moveRejected');
              predictedRef.current = { ...confirmedRef.current };
              routeRef.current = [];
              const now = Date.now();
              if (now - lastRejectRef.current.at > 900 || lastRejectRef.current.reason !== reason) {
                notifyRef.current(reasonLabel(reason), 'error');
                lastRejectRef.current = { at: now, reason };
              }
              return;
            }
            if (message.type === 'snapshot') {
              const participants: Peer[] = Array.isArray(message.participants)
                ? message.participants.map((peer: Peer) => ({ ...peer, appearance: readAppearance(peer.appearance) }))
                : [];
              const incoming = new Set(participants.map((p) => p.userId));
              spritesRef.current.forEach((_avatar, userId) => {
                if (userId !== me.user.id && !incoming.has(userId)) removeAvatar(userId);
              });
              const peers = participants.filter((p) => p.userId !== me.user.id);
              peers.forEach((peer) => setAvatar(peer, false));
              setOnline(peers);
              return;
            }
            if (message.type === 'moved') {
              const userId = String(message.userId ?? '');
              if (userId === me.user.id) return;
              const avatar = spritesRef.current.get(userId);
              if (avatar) {
                avatar.targetX = Number(message.x) || avatar.targetX;
                avatar.targetY = Number(message.y) || avatar.targetY;
              }
              setOnline((current) => current.map((peer) => peer.userId === userId
                ? { ...peer, x: Number(message.x) || peer.x, y: Number(message.y) || peer.y, roomId: String(message.roomId ?? peer.roomId) }
                : peer));
              return;
            }
            if (message.type === 'presence') {
              if (message.joined && message.joined.userId !== me.user.id) {
                const peer: Peer = {
                  userId: String(message.joined.userId), name: String(message.joined.name ?? 'Guest'),
                  color: String(message.joined.color ?? '#6d5bd0'),
                  appearance: readAppearance(message.joined.appearance),
                  roomId: String(message.joined.roomId ?? ''),
                  x: Number(message.joined.x) || 0, y: Number(message.joined.y) || 0,
                };
                setAvatar(peer, false);
                setOnline((current) => current.some((p) => p.userId === peer.userId) ? current : [...current, peer]);
              }
              if (message.left) {
                const userId = String(message.left.userId);
                removeAvatar(userId);
                setOnline((current) => current.filter((p) => p.userId !== userId));
                setNearby((current) => current.filter((p) => p.userId !== userId));
                nearbyRef.current = nearbyRef.current.filter((p) => p.userId !== userId);
              }
              return;
            }
            if (message.type === 'avatar_updated') {
              const userId = String(message.userId ?? '');
              if (!userId) return;
              const appearance = readAppearance(message.appearance);
              const sprite = spritesRef.current.get(userId);
              const position = onlineRef.current.find((peer) => peer.userId === userId) ?? {
                userId, name: userId === me.user.id ? me.user.name : 'Guest',
                color: appearance.outfitColor, roomId: '',
                x: sprite?.targetX ?? 0, y: sprite?.targetY ?? 0, appearance,
              };
              setAvatar({ ...position, appearance }, userId === me.user.id);
              setOnline((list) => list.map((peer) => peer.userId === userId ? { ...peer, appearance } : peer));
              setNearby((list) => list.map((peer) => peer.userId === userId ? { ...peer, appearance } : peer));
              nearbyRef.current = nearbyRef.current.map((peer) => peer.userId === userId ? { ...peer, appearance } : peer);
              return;
            }
            if (message.type === 'occupancy') {
              if (message.rooms && typeof message.rooms === 'object') setOccupancy(message.rooms);
              return;
            }
            if (message.type === 'proximity') {
              const peers: NearbyPeer[] = Array.isArray(message.peers) ? message.peers.map((peer: NearbyPeer) => ({
                userId: String(peer.userId), name: String(peer.name ?? 'Guest'), color: String(peer.color ?? '#6d5bd0'),
                appearance: readAppearance(peer.appearance),
                roomId: String(peer.roomId ?? ''), x: Number(peer.x) || 0, y: Number(peer.y) || 0,
                distance: Number(peer.distance) || 0,
              })) : [];
              nearbyRef.current = peers;
              setNearby(peers);
              updateProximityVisuals(new Set(peers.map((peer) => peer.userId)));
            }
          };
          socket.onclose = (event) => {
            if (socketRef.current === socket) socketRef.current = null;
            if (disposed || intentionalClose) return;
            if ([4001, 4003, 4004, 4029].includes(event.code)) {
              setFatal(event.code === 4029 ? 'quotaExceeded'
                : event.reason || (event.code === 4001 ? 'unauthorized' : 'wrongWorkspace'));
              setStatus('offline');
              return;
            }
            reconnectAttempt += 1;
            if (reconnectAttempt > 6) {
              setStatus('offline');
              return;
            }
            setStatus('reconnecting');
            reconnectTimer = window.setTimeout(() => { void connect(); }, Math.min(8000, 500 * 2 ** reconnectAttempt));
          };
          socket.onerror = () => { /* onclose drives the reconnect state */ };
        } catch {
          setStatus('offline');
          setFatal('wsTicketFailed');
        }
      };
      reconnectRef.current = () => { reconnectAttempt = 0; void connect(); };
      void connect();

      const heartbeatSeconds = Number(me.organization?.settings?.heartbeatSeconds) || 30;
      const heartbeatTimer = window.setInterval(() => {
        const socket = socketRef.current;
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'heartbeat' }));
      }, Math.max(10_000, heartbeatSeconds * 1000));

      let cleaned = false;
      innerCleanup = () => {
        // Leaving the office calls cleanup explicitly and React calls the
        // effect cleanup again on unmount. Destroying Pixi twice crashed the
        // whole app, so teardown must be idempotent and tolerate a destroyed
        // renderer (e.g. WebGL initialisation failure).
        if (cleaned) return;
        cleaned = true;
        observer.disconnect();
        if (app.ticker) app.ticker.remove(tick);
        window.clearInterval(heartbeatTimer);
        if (reconnectTimer) window.clearTimeout(reconnectTimer);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', clearHeld);
        if (app.stage) {
          app.stage.off('pointerdown', onPointerDown);
          app.stage.off('pointermove', onPointerMove);
          app.stage.off('pointerup', onPointerUp);
          app.stage.off('pointerupoutside', onPointerUpOutside);
        }
        socketRef.current = null;
        spritesRef.current.clear();
        try { app.destroy(true, { children: true }); } catch { /* already destroyed */ }
        if (appRef.current === app) appRef.current = null;
      };
      if (disposed) innerCleanup();
    };
    void initialise();

    cleanupHolder.current = () => {
      disposed = true;
      intentionalClose = true;
      socketRef.current?.close(1000, 'LEFT');
      innerCleanup?.();
    };
    return () => cleanupHolder.current();
  }, [data, me, orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleRooms = useMemo(
    () => (data?.rooms ?? []).filter(canEnterRoom).sort((a, b) => a.bounds.y - b.bounds.y),
    [data, canEnterRoom],
  );
  const activeRoom = data?.rooms.find((room) => room.id === activeRoomId);
  const fatalMessage = fatal ? t(fatal) : null;
  const mapAspect = data ? data.workspace.height / data.workspace.width : 0.65;

  const leave = () => {
    socketRef.current?.close(1000, 'LEFT');
    cleanupHolder.current();
    navigate('/app');
  };

  if (loading || !me) return <div className="stack"><Skeleton height={120} /><Skeleton height={540} /></div>;
  if (error || !data) {
    return (
      <div className="stack">
        <div className="error-banner">{error ?? t('officeError')}</div>
        <Button onClick={() => { void reload(); }}>{t('retry')}</Button>
      </div>
    );
  }
  if (!data.workspaces.length) {
    return <EmptyState icon={<Info size={24} />} title={t('noWorkspace')} description={t('noWorkspaceHint')} />;
  }

  return (
    <div className="rise">
      <PageHead title={t('officeTitle')} subtitle={t('officeSub')} actions={
        <>
          <Badge tone={status === 'online' ? 'success' : status === 'offline' ? 'danger' : 'warning'}>
            {status === 'online' ? <Wifi size={12} /> : <WifiOff size={12} />}
            {status === 'online' ? t('online') : status === 'reconnecting' ? t('reconnecting') : t('disconnected')}
          </Badge>
          {status !== 'online' && <Button size="sm" icon={<RotateCcw size={14} />} onClick={() => reconnectRef.current()}>
            {t('retry')}
          </Button>}
          <Button variant="danger" size="sm" onClick={leave}>{t('leaveOffice')}</Button>
        </>
      } />

      {fatalMessage && <div className="error-banner" role="alert">{fatalMessage}</div>}

      <div className="office-layout">
        <div className="office-stage">
          <div className="office-canvas-host" ref={hostRef} aria-label={t('officeTitle')} role="img" />
          <div className="office-stage__bar" aria-live="polite">
            <span className="office-glass"><Users size={13} style={{ verticalAlign: -2 }} /> {online.length + 1} {t('online').toLowerCase()}</span>
            <span className="office-glass"><MousePointer2 size={13} style={{ verticalAlign: -2 }} /> {activeRoom?.name ?? t('connecting')}</span>
            {!isGuest && data.workspaces.length > 1 && (
              <select className="office-workspace-select" value={data.workspace.id}
                onChange={(event) => setWorkspaceChoice(event.target.value)} aria-label={t('workspace')}>
                {data.workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            )}
          </div>

          <div className="office-controls" aria-label={t('cameraControls')}>
            <IconButton label={t('zoomIn')} onClick={() => zoomRef.current(1.18)}><Plus size={15} /></IconButton>
            <IconButton label={t('zoomOut')} onClick={() => zoomRef.current(0.85)}><Minus size={15} /></IconButton>
            <IconButton label={t('fitView')} onClick={() => fitViewRef.current()}><Maximize2 size={15} /></IconButton>
            <IconButton label={follow ? t('stopFollowing') : t('followMe')} onClick={() => followToggleRef.current()}>
              <Crosshair size={15} />
            </IconButton>
          </div>

          <div className="office-minimap" aria-hidden="true">
            <div className="office-minimap__title">{t('minimap')}</div>
            <div className="office-minimap__map" style={{ aspectRatio: String(1 / mapAspect) }}>
              {visibleRooms.map((room) => (
                <span key={room.id} className={`office-minimap__room ${room.id === activeRoomId ? 'active' : ''}`}
                  style={{
                    insetInlineStart: `${(room.bounds.x / data.workspace.width) * 100}%`,
                    insetBlockStart: `${(room.bounds.y / data.workspace.height) * 100}%`,
                    width: `${(room.bounds.w / data.workspace.width) * 100}%`,
                    height: `${(room.bounds.h / data.workspace.height) * 100}%`,
                    background: room.color,
                  }} />
              ))}
              <span className="office-minimap__viewport" style={{
                insetInlineStart: `${clamp((-mini.x / mini.scale / data.workspace.width) * 100, 0, 100)}%`,
                insetBlockStart: `${clamp((-mini.y / mini.scale / data.workspace.height) * 100, 0, 100)}%`,
                width: `${clamp((mini.w / mini.scale / data.workspace.width) * 100, 2, 100)}%`,
                height: `${clamp((mini.h / mini.scale / data.workspace.height) * 100, 2, 100)}%`,
              }} />
              <span className="office-minimap__self" style={{
                insetInlineStart: `${(mini.selfX / data.workspace.width) * 100}%`,
                insetBlockStart: `${(mini.selfY / data.workspace.height) * 100}%`,
              }} />
            </div>
          </div>

          {nearby.length > 0 && (
            <div className="office-proximity office-glass">
              <strong>{t('nearby')}</strong>
              {nearby.slice(0, 4).map((peer) => (
                <span key={peer.userId}>{peer.name} · {peer.distance}m</span>
              ))}
            </div>
          )}

          <div className="office-stage__hint office-glass"><Info size={13} style={{ verticalAlign: -2 }} /> {t('movementHint')}</div>

          <div className="office-dpad" aria-label={t('mobileControls')}>
            <button className="office-dpad__btn up" aria-label={t('moveUp')}
              onPointerDown={() => heldRef.current.add('up')} onPointerUp={() => heldRef.current.delete('up')}
              onPointerLeave={() => heldRef.current.delete('up')}><ArrowUp size={16} /></button>
            <button className="office-dpad__btn left" aria-label={t('moveLeft')}
              onPointerDown={() => heldRef.current.add('left')} onPointerUp={() => heldRef.current.delete('left')}
              onPointerLeave={() => heldRef.current.delete('left')}><ArrowLeft size={16} /></button>
            <button className="office-dpad__btn down" aria-label={t('moveDown')}
              onPointerDown={() => heldRef.current.add('down')} onPointerUp={() => heldRef.current.delete('down')}
              onPointerLeave={() => heldRef.current.delete('down')}><ArrowDown size={16} /></button>
            <button className="office-dpad__btn right" aria-label={t('moveRight')}
              onPointerDown={() => heldRef.current.add('right')} onPointerUp={() => heldRef.current.delete('right')}
              onPointerLeave={() => heldRef.current.delete('right')}><ArrowRight size={16} /></button>
          </div>

          {rendererError && (
            <div className="office-overlay-error">
              <strong>{t('officeRenderError')}</strong>
              <p>{rendererError}</p>
              <Button size="sm" onClick={() => window.location.reload()}>{t('retry')}</Button>
            </div>
          )}
        </div>

        <div className="office-side">
          <Card>
            <CardHead title={t('membersOnline')} action={<Badge tone="success">{online.length + 1}</Badge>} />
            <div className="card-body" style={{ paddingTop: 8 }}>
              <div className="presence-item">
                <span className="avatar sm" style={{ background: '#0e7c7b' }}>{me.user.name[0]}</span>
                <div><div className="presence-item__name">{me.user.name} <span className="small muted">({t('you')})</span></div>
                  <div className="presence-item__room">{activeRoom?.name ?? t('connecting')}</div></div>
              </div>
              {online.map((peer) => (
                <div key={peer.userId} className="presence-item">
                  <span className="avatar sm" style={{ background: peer.color }}>{peer.name[0]}</span>
                  <div><div className="presence-item__name">{peer.name}</div>
                    <div className="presence-item__room">{data.rooms.find((r) => r.id === peer.roomId)?.name ?? ''}</div></div>
                </div>
              ))}
              {!online.length && <div className="small muted" style={{ padding: 10 }}>{t('noActivity')}</div>}
            </div>
          </Card>

          <Card>
            <CardHead title={t('rooms')} subtitle={t('occupancy')} />
            <div className="card-body" style={{ paddingTop: 8 }}>
              <div className="room-list">
                {visibleRooms.map((room) => (
                  <button key={room.id} className={`room-item ${activeRoomId === room.id ? 'active' : ''}`}
                    onClick={(event) => {
                      // Return focus to the page so WASD/arrow movement keeps working
                      // immediately after using a room shortcut.
                      event.currentTarget.blur();
                      routeToRef.current(
                        room.bounds.x + room.bounds.w / 2,
                        room.bounds.y + room.bounds.h / 2,
                        room.id,
                      );
                    }}>
                    <span className="room-item__dot" style={{ background: room.color }} />
                    <span style={{ flex: 1 }}>
                      <span className="room-item__name">{room.name}</span>
                      <span className="small muted" style={{ display: 'block' }}>
                        {room.privacy === 'private' ? t('privateRoom') : room.kind}
                      </span>
                    </span>
                    <Badge tone="primary" plain>{occupancy[room.id] ?? 0}/{room.capacity}</Badge>
                  </button>
                ))}
              </div>
            </div>
          </Card>

          <div className="deferred-note"><Info size={15} style={{ flex: '0 0 auto' }} /><span>{t('mediaDeferred')}</span></div>
        </div>
      </div>
    </div>
  );
}
