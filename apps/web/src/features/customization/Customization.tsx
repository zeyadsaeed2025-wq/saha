import { Info, LayoutTemplate, Palette, Sparkles } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import {
  Badge, Button, Card, CardHead, EmptyState, Field, Input, PageHead, Select, Skeleton, useAsync,
} from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.js';
import { useI18n } from '../../lib/i18n.js';
import { can } from '../../lib/permissions.js';
import { useToast } from '../../lib/toast.js';
import type { AvatarConfig, Room, Workspace, WorkspaceTemplate } from '../../types.js';

interface Branding {
  name: string; initials: string; primaryColor: string; accentColor: string; timezone: string;
}

const SAMPLE_LAYOUT = JSON.stringify({
  rooms: [{
    name: 'Focus room',
    kind: 'focus',
    privacy: 'public',
    bounds: { x: 0, y: 0, w: 400, h: 300 },
    color: '#0e7c7b',
    capacity: 8,
    allowedRoles: ['student', 'mentor', 'org_admin'],
  }],
}, null, 2);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const ROLES = ['super_admin', 'org_admin', 'mentor', 'student', 'guest'];

function validateLayout(text: string): string | null {
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch (error) { return error instanceof Error ? error.message : 'Invalid JSON'; }
  if (!isRecord(parsed) || !Array.isArray(parsed.rooms) || !parsed.rooms.length) {
    return 'Layout must contain a non-empty "rooms" array.';
  }
  for (const [index, room] of parsed.rooms.entries()) {
    if (!isRecord(room)) return `Room ${index + 1} must be an object.`;
    if (typeof room.name !== 'string' || !room.name.trim()) return `Room ${index + 1} needs a name.`;
    if (typeof room.kind !== 'string' || !room.kind.trim()) return `Room ${index + 1} needs a kind.`;
    const bounds = room.bounds;
    if (!isRecord(bounds) || ['x', 'y', 'w', 'h'].some((key) =>
      typeof bounds[key] !== 'number' || (bounds[key] as number) <= 0)) {
      return `Room ${index + 1} needs positive bounds { x, y, w, h }.`;
    }
    if (typeof room.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(room.color)) {
      return `Room ${index + 1} needs a #RRGGBB color.`;
    }
    if (typeof room.capacity !== 'number' || !Number.isInteger(room.capacity) || room.capacity < 1) {
      return `Room ${index + 1} needs a positive integer capacity.`;
    }
    if (!Array.isArray(room.allowedRoles) || room.allowedRoles.some((role) =>
      typeof role !== 'string' || !ROLES.includes(role))) {
      return `Room ${index + 1} needs allowedRoles from: ${ROLES.join(', ')}.`;
    }
  }
  return null;
}

export function Customization() {
  const { t } = useI18n();
  const { me } = useAuth();
  const { notify } = useToast();
  const orgId = me?.activeOrgId ?? '';
  const manageable = can(me?.role, 'customization:manage');

  const [avatar, setAvatar] = useState({ character: 'standard', outfitColor: '#0e7c7b', accessory: '' });
  const [templateName, setTemplateName] = useState('');
  const [layoutText, setLayoutText] = useState(SAMPLE_LAYOUT);
  const [layoutError, setLayoutError] = useState('');
  const [applyTargets, setApplyTargets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const { data, loading, error, setData } = useAsync(async () => {
    const [avatarResult, templates, branding, workspaces] = await Promise.all([
      api<{ config: AvatarConfig }>(`/orgs/${orgId}/customization/avatar`),
      api<{ templates: WorkspaceTemplate[] }>(`/orgs/${orgId}/customization/templates`),
      api<{ branding: Branding }>(`/orgs/${orgId}/customization/branding`),
      api<{ workspaces: Workspace[] }>(`/orgs/${orgId}/workspaces`),
    ]);
    return { config: avatarResult.config, templates: templates.templates,
      branding: branding.branding, workspaces: workspaces.workspaces };
  }, [orgId]);

  useEffect(() => {
    if (!data?.config) return;
    setAvatar({
      character: data.config.character,
      outfitColor: data.config.outfitColor,
      accessory: data.config.accessory ?? '',
    });
  }, [data?.config]);

  const saveAvatar = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ config: AvatarConfig }>(`/orgs/${orgId}/customization/avatar`, {
        method: 'PATCH',
        body: { character: avatar.character, outfitColor: avatar.outfitColor, accessory: avatar.accessory || null },
      });
      setData((current) => current ? { ...current, config: result.config } : current);
      notify(t('avatarSaved'), 'success');
    } catch (err) { notify(err instanceof Error ? err.message : t('errorGeneric'), 'error'); }
    finally { setBusy(false); }
  };

  const createTemplate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const problem = validateLayout(layoutText);
    if (problem) { setLayoutError(problem); return; }
    if (templateName.trim().length < 2) { setLayoutError('Template name must be at least 2 characters.'); return; }
    setLayoutError('');
    setBusy(true);
    try {
      const result = await api<{ template: WorkspaceTemplate }>(`/orgs/${orgId}/customization/templates`, {
        method: 'POST',
        body: { name: templateName.trim(), layout: JSON.parse(layoutText) as WorkspaceTemplate['layout'] },
      });
      setData((current) => current ? { ...current, templates: [result.template, ...current.templates] } : current);
      setTemplateName('');
      notify(t('saved'), 'success');
    } catch (err) { notify(err instanceof Error ? err.message : t('errorGeneric'), 'error'); }
    finally { setBusy(false); }
  };

  const applyTemplate = async (template: WorkspaceTemplate) => {
    const workspaceId = applyTargets[template.id];
    if (!workspaceId) { notify(t('errorGeneric'), 'error'); return; }
    setBusy(true);
    try {
      const result = await api<{ rooms: Room[]; template: WorkspaceTemplate }>(
        `/orgs/${orgId}/customization/templates/${template.id}/apply`, {
          method: 'POST', body: { workspaceId },
        });
      notify(`${t('templateApplied')}: ${result.rooms.length} ${t('rooms').toLowerCase()}`, 'success');
    } catch (err) { notify(err instanceof Error ? err.message : t('errorGeneric'), 'error'); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="stack"><Skeleton height={90} />{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={140} />)}</div>;
  if (error || !data) return <div className="error-banner">{error ?? t('loading')}</div>;

  return (
    <div className="rise">
      <PageHead title={t('customization')} subtitle={t('customizationSub')} />

      <div className="grid grid-2" style={{ marginBottom: 20 }}>
        <Card>
          <CardHead title={t('avatar')} subtitle={data.config.updatedAt
            ? new Date(data.config.updatedAt).toLocaleString() : t('noData')} icon={<Sparkles size={16} />} />
          <form className="card-body form-grid" onSubmit={saveAvatar}>
            <Field label={t('character')} className="full" hint={data.config.character}>
              <Input value={avatar.character} maxLength={40} required disabled={!manageable}
                onChange={(event) => setAvatar((current) => ({ ...current, character: event.target.value }))} />
            </Field>
            <Field label={t('outfitColor')}>
              <div className="row" style={{ gap: 8 }}>
                <Input type="color" value={avatar.outfitColor} disabled={!manageable}
                  onChange={(event) => setAvatar((current) => ({ ...current, outfitColor: event.target.value }))} />
                <Badge tone="muted" plain>{avatar.outfitColor}</Badge>
              </div>
            </Field>
            <Field label={t('accessory')}>
              <Input value={avatar.accessory} maxLength={120} disabled={!manageable}
                placeholder="—"
                onChange={(event) => setAvatar((current) => ({ ...current, accessory: event.target.value }))} />
            </Field>
            {manageable && <div className="full"><Button variant="primary" type="submit" loading={busy}>
              {t('saveAvatar')}
            </Button></div>}
          </form>
        </Card>

        <Card>
          <CardHead title={t('branding')} subtitle={data.branding.name} icon={<Palette size={16} />} />
          <div className="card-body stack" style={{ gap: 14 }}>
            <div className="row" style={{ gap: 12 }}>
              <span className="avatar lg" style={{ background: data.branding.primaryColor }}>
                {data.branding.initials}
              </span>
              <div><div className="strong">{data.branding.name}</div>
                <div className="small muted">{data.branding.timezone}</div></div>
            </div>
            <div className="divider" />
            {([['primaryColor', data.branding.primaryColor], ['accentColor', data.branding.accentColor]] as const)
              .map(([label, color]) => <div key={label} className="row" style={{ justifyContent: 'space-between' }}>
                <span className="small strong">{label}</span>
                <span className="row" style={{ gap: 8 }}>
                  <span className="mono small">{color}</span>
                  <span style={{ width: 24, height: 24, borderRadius: 6, background: color }} />
                </span>
              </div>)}
            <div className="info-banner"><Info size={16} />
              {t('verifiedOnly')}
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHead title={t('templates')} subtitle={`${data.templates.length} ${t('all').toLowerCase()}`}
          icon={<LayoutTemplate size={16} />} />
        <div className="card-body stack" style={{ gap: 10 }}>
          {data.templates.map((template) => (
            <div key={template.id} className="presence-item panel" style={{ alignItems: 'flex-start' }}>
              <span className="avatar sm"><LayoutTemplate size={14} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="strong">{template.name}</div>
                <div className="small muted">{template.layout.rooms?.length ?? 0} {t('rooms').toLowerCase()} · {template.id.slice(0, 8)}</div>
                <div className="small mono muted">{new Date(template.createdAt).toLocaleString()}</div>
              </div>
              {manageable && <div className="row row-wrap" style={{ gap: 6 }}>
                <Select aria-label={`${t('workspaceForTemplate')} · ${template.name}`}
                  value={applyTargets[template.id] ?? ''}
                  onChange={(event) => setApplyTargets((current) => ({ ...current, [template.id]: event.target.value }))}>
                  <option value="">{t('workspaceForTemplate')}</option>
                  {data.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
                </Select>
                <Button size="sm" disabled={!applyTargets[template.id]} loading={busy}
                  onClick={() => applyTemplate(template)}>{t('applyTemplate')}</Button>
              </div>}
            </div>
          ))}
          {!data.templates.length && <EmptyState icon={<LayoutTemplate size={22} />} title={t('noTemplates')}
            description={t('noDataHint')} />}
        </div>
        {manageable && <>
          <div className="divider" />
          <form className="card-body form-grid" onSubmit={createTemplate}>
            <Field label={t('templateName')} className="full">
              <Input value={templateName} minLength={2} maxLength={60}
                onChange={(event) => setTemplateName(event.target.value)} required />
            </Field>
            <Field label={t('templateRooms')} className="full" error={layoutError}
              hint={`JSON · { "rooms": [ ... ] }`}>
              <textarea className="input mono" rows={10} value={layoutText} spellCheck={false}
                dir="ltr" onChange={(event) => { setLayoutText(event.target.value); setLayoutError(''); }}
                aria-label={t('templateRooms')} />
            </Field>
            <div className="full"><Button variant="primary" type="submit" loading={busy}>
              {t('newTemplate')}
            </Button></div>
          </form>
        </>}
      </Card>
    </div>
  );
}
