import type { AvatarAppearance } from '../customization/appearance.js';
import { worldRegistry } from './registry.js';

/**
 * Pushes a saved avatar configuration to everyone in the user's current room.
 * No-op when the user has no live world connection.
 */
export function broadcastAvatarAppearance(
  organizationId: string,
  userId: string,
  appearance: AvatarAppearance,
): void {
  const participant = worldRegistry.forUser(userId, organizationId);
  if (!participant) return;
  worldRegistry.sendToRoom(participant.workspaceId, participant.roomId, {
    type: 'avatar_updated',
    userId,
    appearance,
  });
}
