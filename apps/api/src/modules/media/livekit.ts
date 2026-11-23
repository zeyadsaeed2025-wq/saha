import { createHmac } from 'node:crypto';

export interface LiveKitTokenInput {
  apiKey: string;
  apiSecret: string;
  identity: string;
  roomName: string;
  name?: string;
  metadata?: Record<string, unknown>;
  ttlSeconds?: number;
}

export interface LiveKitTokenResult {
  token: string;
  expiresAt: string;
}

export interface LiveKitConfig {
  configured: boolean;
  url: string | null;
  message: string;
}

const base64url = (value: string): string => Buffer.from(value, 'utf8').toString('base64url');

/**
 * Signs a LiveKit access token with HS256 using only node:crypto. The secret is
 * used for the HMAC only and is never included in the returned token payload.
 */
export function createLiveKitToken(input: LiveKitTokenInput): LiveKitTokenResult {
  if (!input.apiKey || !input.apiSecret || !input.identity || !input.roomName) {
    throw new Error('LiveKit signing inputs are incomplete');
  }
  const ttl = input.ttlSeconds && input.ttlSeconds > 0 ? Math.floor(input.ttlSeconds) : 3600;
  const nbf = Math.floor(Date.now() / 1000);
  const exp = nbf + ttl;

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: input.apiKey,
    sub: input.identity,
    nbf,
    exp,
    name: input.name ?? input.identity,
    video: {
      room: input.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    },
    metadata: JSON.stringify(input.metadata ?? {}),
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', input.apiSecret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  return {
    token: `${encodedHeader}.${encodedPayload}.${signature}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

/** Reports whether all three LiveKit settings are present. Never returns secrets. */
export function liveKitConfig(): LiveKitConfig {
  const url = process.env.LIVEKIT_URL?.trim() || null;
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
  const configured = Boolean(url && apiKey && apiSecret);
  return {
    configured,
    url,
    message: configured
      ? 'LiveKit is configured for media sessions.'
      : 'LiveKit credentials are not configured; media tokens are unavailable locally.',
  };
}
