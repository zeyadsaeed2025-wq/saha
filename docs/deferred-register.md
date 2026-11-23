# Deferred register

This is the authoritative list of capabilities **intentionally not included** in the MVP. It follows the user directive resolving SRS scope: media/Drive were deferred instead of integrated. Environment variables in `.env.example` for these items are placeholders; no code reads them except the SMS *presence* check that decides whether to show a local dev code.

> No fake controls: the UI uses badges and explanatory notes, never enabled buttons that imply a deferred feature works. Existing UI notes must be updated together with this register. (The template comment in `.env.example` says `docs/deferred-features.md`; that name is a legacy reference — this file is the register. A short alias exists at [deferred-features.md](deferred-features.md).)

| Deferred feature | Why deferred | UI labeling today | Future work |
| --- | --- | --- | --- |
| **LiveKit audio/video** | Media infrastructure and scoped media tokens were out of MVP scope; no provider configured. | Settings "Not in MVP" card; office note: voice/video planned for a later release. Landing footer lists LiveKit. | Add LiveKit service, short-lived permission-scoped tokens, room joins tied to workspace roles. |
| **Proximity audio** | Depends on media transport plus spatial position rules and load testing. | Covered by the media deferred note; no proximity UI. | Define attenuation radius per room, gate on presence + role, load-test world/media. |
| **Meetings** | SRS treats meetings as media rooms; no meeting lifecycle/permissions implemented. | No meeting buttons. Room kinds include `meeting` only as a map label/private room. | Meeting creation, scheduling, join/leave state, host controls and audit. |
| **Screen sharing** | Requires media service and browser permission handling. | Included in media deferred note in office and Settings. | Add track negotiation, host permission, abuse controls. |
| **Recording** | Requires media service, storage policy, retention and consent. | Covered by media/Drive deferred copy. | Consent flow, storage lifecycle, metadata and access control. |
| **Google Drive OAuth / upload** | OAuth consent, quota and retry/queue logic are beyond MVP; no credentials. | Settings Drive card: "Not in MVP"; landing footer lists Google Drive. | OAuth per org, folder selection, upload queue with retries, recording history, consent/audit. |
| **SMS provider** | No provider/account available; OTP delivery would be fake. | Forgot-password screen shows an explicit local-dev notice and code only when no provider is configured and not in production. | Integrate provider, remove `devCode` response in production, add delivery logs and rate limits. |
| **Direct messaging / channels** | P1 scope in SRS; needs moderation, retention and notification model. | No DM UI or nav item. | Org-scoped messaging with retention, moderation and unread state. |
| **Billing / plans / usage metering** | Commercial layer is later scope; no payment provider. | No billing UI. | Plans, limits, checkout portal, metered usage and admin visibility. |
| **Custom avatars & furniture** | Editor and asset pipeline are later scope; seeded map is sufficient for MVP. | Avatars are generated initials/colors; no customization control. | Avatar picker, floor-plan editor, asset validation and per-workspace layout. |
| **External calendar integration** | Sync/import requires OAuth and conflict rules. | The Schedules **Calendar** tab is a read-only month view of generated sessions, not a connection to Google Calendar or another provider. | Calendar OAuth, two-way sync, conflict resolution and per-org settings. |
| **AI summaries / transcripts** | P2 scope; needs media recordings and a provider. | No UI. | opt-in transcription, summaries, retention and review controls. |

## Rules for future implementation

1. Remove the item from this register only when the feature is functional end-to-end and covered by tests.
2. Update UI copy/translation keys (`en` and `ar`) in the same change.
3. Add security review for new tokens/OAuth scopes, tenant scoping and audit events.
4. Never leave a placeholder control that accepts input but performs no action.
