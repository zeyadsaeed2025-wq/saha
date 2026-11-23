import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { findInOrg, inOrg, store } from '../../common/store.js';
import {
  asyncRoute, getAuth, logAudit, requireFeature, requireOrg, requirePermission,
} from '../../common/middleware.js';
import { badRequest, notFound } from '../../common/errors.js';
import { getEntitlements } from '../billing/entitlements.js';
import { broadcastAvatarAppearance } from '../world/appearance.js';
import { DEFAULT_APPEARANCE } from './appearance.js';
import type {
  AvatarConfig, Room, WorkspaceTemplate,
} from '../../domain/types.js';

export const customizationRouter = Router({ mergeParams: true });

customizationRouter.use(requireOrg);
customizationRouter.use(requireFeature('customization'));

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #RRGGBB color');
const roleSchema = z.enum(['super_admin', 'org_admin', 'mentor', 'student', 'guest']);
const roomKindSchema = z.enum([
  'focus', 'meeting', 'social', 'reception', 'mentor', 'study',
  'lobby', 'open', 'private', 'collaboration',
]);

const avatarSchema = z.object({
  character: z.string().min(1).max(40),
  outfitColor: colorSchema,
  accessory: z.string().max(120).nullable().optional(),
});

const templateRoomSchema = z.object({
  name: z.string().min(1).max(40),
  kind: z.string().min(1).max(40),
  privacy: z.enum(['public', 'private']).optional(),
  bounds: z.object({
    x: z.number().gt(0), y: z.number().gt(0),
    w: z.number().gt(0), h: z.number().gt(0),
  }),
  color: colorSchema,
  capacity: z.number().int().min(1).max(100),
  allowedRoles: z.array(roleSchema),
});

const templateSchema = z.object({
  name: z.string().min(2).max(60),
  layout: z.object({ rooms: z.array(templateRoomSchema).min(1) }).passthrough(),
});

const applySchema = z.object({ workspaceId: z.string().uuid() });

type AvatarView = Omit<AvatarConfig, 'updatedAt'> & { updatedAt: string | null };

/** Stable synthesized config for a user who has never customized their avatar. */
function defaultAvatar(userId: string, organizationId: string): AvatarView {
  return {
    userId,
    organizationId,
    ...DEFAULT_APPEARANCE,
    updatedAt: null,
  };
}

function initialsFor(name: string): string {
  const initials = name.split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
  return initials || '?';
}

customizationRouter.get('/avatar', requirePermission('org:read'), (req, res) => {
  const auth = getAuth(req)!;
  const config = store.read<AvatarView>((state) => {
    const stored = state.avatarConfigs.find(
      (item) => item.userId === auth.user.id && item.organizationId === auth.orgId,
    );
    return stored ?? defaultAvatar(auth.user.id, auth.orgId);
  });
  res.json({ config });
});

customizationRouter.patch('/avatar', requirePermission('customization:manage'), asyncRoute(async (req, res) => {
  const parsed = avatarSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Invalid avatar configuration');
  const auth = getAuth(req)!;
  const config = await store.mutate((draft) => {
    let stored = draft.avatarConfigs.find(
      (item) => item.userId === auth.user.id && item.organizationId === auth.orgId,
    );
    if (!stored) {
      stored = {
        userId: auth.user.id,
        organizationId: auth.orgId,
        character: parsed.data.character,
        outfitColor: parsed.data.outfitColor,
        accessory: null,
        updatedAt: new Date().toISOString(),
      };
      draft.avatarConfigs.push(stored);
    } else {
      stored.character = parsed.data.character;
      stored.outfitColor = parsed.data.outfitColor;
      stored.updatedAt = new Date().toISOString();
    }
    if (parsed.data.accessory !== undefined) stored.accessory = parsed.data.accessory;
    logAudit(draft, auth, 'avatar.updated', auth.user.id, {
      character: stored.character, outfitColor: stored.outfitColor, accessory: stored.accessory,
    });
    return stored;
  });
  // A saved avatar must reach the live world immediately, not only on reconnect.
  broadcastAvatarAppearance(auth.orgId, auth.user.id, {
    character: config.character, outfitColor: config.outfitColor, accessory: config.accessory,
  });
  res.json({ config });
}));

customizationRouter.get('/templates', requirePermission('org:read'), (req, res) => {
  const auth = getAuth(req)!;
  const templates = store.read((state) => inOrg(state.workspaceTemplates, auth.orgId));
  res.json({ templates });
});

customizationRouter.post('/templates', requirePermission('customization:manage'), asyncRoute(async (req, res) => {
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('A template name and a valid rooms layout are required');
  const auth = getAuth(req)!;
  const created = await store.mutate((draft) => {
    const template: WorkspaceTemplate = {
      id: randomUUID(),
      organizationId: auth.orgId,
      name: parsed.data.name,
      layout: { ...parsed.data.layout } as Record<string, unknown>,
      createdAt: new Date().toISOString(),
    };
    draft.workspaceTemplates.push(template);
    logAudit(draft, auth, 'template.created', template.id, {
      name: template.name, rooms: parsed.data.layout.rooms.length,
    });
    return template;
  });
  res.status(201).json({ template: created });
}));

customizationRouter.post('/templates/:id/apply', requirePermission('customization:manage'), asyncRoute(async (req, res) => {
  const parsed = applySchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('A valid workspaceId is required');
  const auth = getAuth(req)!;
  const result = await store.mutate((draft) => {
    const template = findInOrg(draft.workspaceTemplates, auth.orgId, req.params.id);
    if (!template) throw notFound('Template not found');
    const workspace = findInOrg(draft.workspaces, auth.orgId, parsed.data.workspaceId);
    if (!workspace) throw notFound('Workspace not found');

    const layoutRooms = z.array(templateRoomSchema).safeParse(
      (template.layout as { rooms?: unknown }).rooms,
    );
    if (!layoutRooms.success) throw badRequest('The stored template layout is invalid', 'INVALID_TEMPLATE_LAYOUT');

    const rooms: Room[] = layoutRooms.data.map((room) => {
      const kind = roomKindSchema.safeParse(room.kind);
      return {
        id: randomUUID(),
        workspaceId: workspace.id,
        organizationId: auth.orgId,
        name: room.name,
        kind: kind.success ? kind.data : 'open',
        privacy: room.privacy ?? 'public',
        bounds: room.bounds,
        color: room.color,
        allowedRoles: room.allowedRoles,
        capacity: room.capacity,
      };
    });

    getEntitlements(draft, auth.orgId).assert('rooms', rooms.length);
    draft.rooms.push(...rooms);
    logAudit(draft, auth, 'template.applied', template.id, {
      workspaceId: workspace.id, roomIds: rooms.map((room) => room.id),
    });
    return { rooms, template };
  });
  res.json(result);
}));

customizationRouter.get('/branding', requirePermission('org:read'), (req, res) => {
  const auth = getAuth(req)!;
  const branding = store.read((state) => {
    const org = state.organizations.find((item) => item.id === auth.orgId);
    if (!org) throw notFound('Organization not found');
    return {
      name: org.name,
      initials: initialsFor(org.name),
      primaryColor: '#0e7c7b',
      accentColor: '#f0795a',
      timezone: org.timezone,
    };
  });
  res.json({ branding });
});

export type CustomizationTemplateRoom = z.infer<typeof templateRoomSchema>;
