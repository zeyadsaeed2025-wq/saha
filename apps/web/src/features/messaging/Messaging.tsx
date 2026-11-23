import { Info, MessageCircle, Plus, Send } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Badge, Button, Card, CardHead, EmptyState, Field, Input, Modal, PageHead, Select, Skeleton, useAsync,
} from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.js';
import { useI18n } from '../../lib/i18n.js';
import { can } from '../../lib/permissions.js';
import { useToast } from '../../lib/toast.js';
import type { Channel, ChatMessage, Member, Room, Workspace } from '../../types.js';

interface WorkspaceDetail { workspace: Workspace; rooms: Room[] }

export function Messaging() {
  const { t } = useI18n();
  const { me } = useAuth();
  const { notify } = useToast();
  const orgId = me?.activeOrgId ?? '';
  const myId = me?.user.id ?? '';
  const channelAdmin = can(me?.role, 'workspace:manage');

  const [tab, setTab] = useState<'channels' | 'direct'>('channels');
  const [selectedChannel, setSelectedChannel] = useState('');
  const [selectedUser, setSelectedUser] = useState('');
  const [channelOpen, setChannelOpen] = useState(false);
  const [channelName, setChannelName] = useState('');
  const [channelScope, setChannelScope] = useState<Channel['scope']>('organization');
  const [scopeId, setScopeId] = useState('');
  const [busy, setBusy] = useState(false);
  const markedRead = useRef<Set<string>>(new Set());

  const { data, loading, error, reload } = useAsync(async () => {
    const [channels, members, workspaces] = await Promise.all([
      api<{ channels: Channel[] }>(`/orgs/${orgId}/messaging/channels`),
      api<{ members: Member[] }>(`/orgs/${orgId}/members`),
      api<{ workspaces: Workspace[] }>(`/orgs/${orgId}/workspaces`),
    ]);
    const details = await Promise.all(workspaces.workspaces.map((workspace) =>
      api<WorkspaceDetail>(`/orgs/${orgId}/workspaces/${workspace.id}`)));
    return { channels: channels.channels, members: members.members, details };
  }, [orgId]);

  useEffect(() => {
    if (!data) return;
    if (tab === 'channels' && !selectedChannel && data.channels[0]) setSelectedChannel(data.channels[0].id);
    if (tab === 'direct' && !selectedUser) {
      const first = data.members.find((member) => member.userId !== myId);
      if (first) setSelectedUser(first.userId);
    }
  }, [data, tab, selectedChannel, selectedUser, myId]);

  const thread = useAsync(async () => {
    if (tab === 'channels') {
      if (!selectedChannel) return { messages: [] as ChatMessage[] };
      return api<{ messages: ChatMessage[] }>(`/orgs/${orgId}/messaging/channels/${selectedChannel}/messages`);
    }
    if (!selectedUser) return { messages: [] as ChatMessage[] };
    return api<{ messages: ChatMessage[] }>(`/orgs/${orgId}/messaging/direct/${selectedUser}`);
  }, [orgId, tab, selectedChannel, selectedUser]);

  useEffect(() => {
    const messages = thread.data?.messages;
    if (!messages || !myId) return;
    const unread = messages.filter((message) =>
      message.senderUserId !== myId && !message.readBy.includes(myId) && !markedRead.current.has(message.id));
    if (!unread.length) return;
    unread.forEach((message) => markedRead.current.add(message.id));
    void (async () => {
      const results = await Promise.allSettled(unread.map((message) =>
        api<{ message: ChatMessage }>(`/orgs/${orgId}/messaging/messages/${message.id}/read`, { method: 'POST' })));
      const readIds = new Set(results.flatMap((result, index) =>
        result.status === 'fulfilled' ? [unread[index]!.id] : []));
      results.forEach((result, index) => { if (result.status === 'rejected') markedRead.current.delete(unread[index]!.id); });
      if (readIds.size) thread.setData((current) => current ? {
        ...current,
        messages: current.messages.map((message) => readIds.has(message.id) && !message.readBy.includes(myId)
          ? { ...message, readBy: [...message.readBy, myId] } : message),
      } : current);
      if (readIds.size !== results.length) notify(t('errorGeneric'), 'error');
    })();
  }, [thread.data?.messages, myId, orgId, t, notify, thread.setData]);

  const senderName = (senderUserId: string) => {
    if (senderUserId === myId) return t('you');
    return data?.members.find((member) => member.userId === senderUserId)?.name
      ?? data?.members.find((member) => member.id === senderUserId)?.name
      ?? senderUserId.slice(0, 8);
  };

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = String(new FormData(form).get('body') ?? '').trim();
    if (!body || !myId) return;
    const path = tab === 'channels'
      ? `/orgs/${orgId}/messaging/channels/${selectedChannel}/messages`
      : `/orgs/${orgId}/messaging/direct/${selectedUser}`;
    setBusy(true);
    try {
      const result = await api<{ message: ChatMessage }>(path, { method: 'POST', body: { body } });
      thread.setData((current) => current
        ? { ...current, messages: [...current.messages, result.message] }
        : { messages: [result.message] });
      form.reset();
      markedRead.current.add(result.message.id);
    } catch (err) { notify(err instanceof Error ? err.message : t('errorGeneric'), 'error'); }
    finally { setBusy(false); }
  };

  const createChannel = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api<{ channel: Channel }>(`/orgs/${orgId}/messaging/channels`, {
        method: 'POST',
        body: {
          name: channelName.trim(),
          scope: channelScope,
          ...(channelScope === 'organization' ? {} : { scopeId }),
        },
      });
      notify(t('saved'), 'success');
      setChannelOpen(false);
      setChannelName('');
      setScopeId('');
      await reload();
    } catch (err) { notify(err instanceof Error ? err.message : t('errorGeneric'), 'error'); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="stack"><Skeleton height={90} /><Skeleton height={320} /></div>;
  if (error || !data) return <div className="error-banner">{error ?? t('loading')}</div>;

  const teams = [...new Set(data.members.map((member) => member.team).filter(Boolean))];
  const rooms = data.details.flatMap((detail) => detail.rooms ?? []);
  const recipients = data.members.filter((member) => member.userId !== myId);
  const activeName = tab === 'channels'
    ? data.channels.find((channel) => channel.id === selectedChannel)?.name ?? ''
    : data.members.find((member) => member.userId === selectedUser)?.name ?? '';
  const activeReady = tab === 'channels' ? Boolean(selectedChannel) : Boolean(selectedUser);

  return (
    <div className="rise">
      <PageHead title={t('messages')} subtitle={t('messagesSub')} />
      <div className="info-banner" style={{ marginBottom: 20 }}><Info size={16} />{t('messagesNote')}</div>
      <div className="tabs" style={{ marginBottom: 16 }}>
        <button className={`tab ${tab === 'channels' ? 'active' : ''}`} onClick={() => setTab('channels')}>
          {t('channels')} ({data.channels.length})
        </button>
        <button className={`tab ${tab === 'direct' ? 'active' : ''}`} onClick={() => setTab('direct')}>
          {t('directMessages')} ({recipients.length})
        </button>
      </div>

      <div className="grid grid-32">
        <Card>
          <CardHead title={tab === 'channels' ? t('channels') : t('members')}
            action={tab === 'channels' && channelAdmin &&
              <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setChannelOpen(true)}>
                {t('newChannel')}
              </Button>} />
          <div className="card-body stack" style={{ gap: 4 }}>
            {tab === 'channels' ? data.channels.map((channel) => (
              <button key={channel.id}
                className={`presence-item ${selectedChannel === channel.id ? 'panel' : ''}`}
                style={{ textAlign: 'start', width: '100%' }}
                onClick={() => setSelectedChannel(channel.id)}>
                <span className="avatar sm"><MessageCircle size={14} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="presence-item__name">{channel.name}</div>
                  <div className="presence-item__room mono">{channel.scope}{channel.scopeId ? ` · ${channel.scopeId.slice(0, 8)}` : ''}</div>
                </div>
              </button>
            )) : recipients.map((member) => (
              <button key={member.userId}
                className={`presence-item ${selectedUser === member.userId ? 'panel' : ''}`}
                style={{ textAlign: 'start', width: '100%' }}
                onClick={() => setSelectedUser(member.userId)}>
                <span className="avatar sm">{member.name.slice(0, 1).toUpperCase()}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="presence-item__name">{member.name}</div>
                  <div className="presence-item__room">{member.team} · {member.role}</div>
                </div>
              </button>
            ))}
            {tab === 'channels' && !data.channels.length && <EmptyState icon={<MessageCircle size={22} />}
              title={t('noChannels')} description={t('noDataHint')}
              action={channelAdmin && <Button size="sm" variant="primary" onClick={() => setChannelOpen(true)}>{t('newChannel')}</Button>} />}
            {tab === 'direct' && !recipients.length && <EmptyState icon={<MessageCircle size={22} />}
              title={t('noMembers')} description={t('noMembersHint')} />}
          </div>
        </Card>

        <Card>
          <CardHead title={activeName || t('messages')}
            subtitle={tab === 'channels' ? t('channels') : t('directMessages')} />
          {!activeReady && <div className="card-body"><EmptyState icon={<MessageCircle size={22} />}
            title={tab === 'channels' ? t('noChannels') : t('newMessage')} description={t('noDataHint')} /></div>}
          {activeReady && thread.loading && <div className="card-body stack"><Skeleton height={54} /><Skeleton height={54} /><Skeleton height={54} /></div>}
          {activeReady && thread.error && <div className="card-body"><div className="error-banner">{thread.error}</div></div>}
          {activeReady && !thread.loading && !thread.error && <>
            <div className="card-body stack" style={{ gap: 10, minHeight: 220 }}>
              {(thread.data?.messages ?? []).map((message) => {
                const mine = message.senderUserId === myId;
                const unread = !mine && !message.readBy.includes(myId);
                return <div key={message.id}
                  style={{
                    alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '85%',
                    padding: '10px 12px', borderRadius: 12,
                    background: mine ? 'var(--primary-soft)' : 'var(--surface-2)',
                  }}>
                  <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
                    <span className="small strong">{senderName(message.senderUserId)}</span>
                    <span className="small mono muted">{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message.body}</div>
                  {unread && <Badge tone="info" plain>{t('unread')}</Badge>}
                </div>;
              })}
              {!thread.data?.messages.length && <EmptyState icon={<MessageCircle size={22} />}
                title={t('noMessages')} description={t('noDataHint')} />}
            </div>
            <form className="card-body row" style={{ borderTop: '1px solid var(--border)', gap: 10 }}
              onSubmit={send}>
              <Input name="body" placeholder={t('typeMessage')} maxLength={4000} required
                aria-label={t('typeMessage')} />
              <Button variant="primary" type="submit" loading={busy} icon={<Send size={15} />}>{t('send')}</Button>
            </form>
          </>}
        </Card>
      </div>

      {channelOpen && <Modal title={t('newChannel')} onClose={() => setChannelOpen(false)} footer={
        <><Button onClick={() => setChannelOpen(false)}>{t('cancel')}</Button>
          <Button variant="primary" type="submit" form="channel-form" loading={busy}>{t('create')}</Button></>
      }>
        <form id="channel-form" className="form-grid" onSubmit={createChannel}>
          <Field label={t('channelName')} className="full">
            <Input value={channelName} onChange={(event) => setChannelName(event.target.value)}
              minLength={2} maxLength={60} required />
          </Field>
          <Field label={t('channelScope')} className="full">
            <Select value={channelScope}
              onChange={(event) => { setChannelScope(event.target.value as Channel['scope']); setScopeId(''); }}>
              <option value="organization">{t('organizationScope')}</option>
              <option value="team">{t('teamScope')}</option>
              <option value="room">{t('roomScope')}</option>
            </Select>
          </Field>
          {channelScope === 'team' && <Field label={t('team')} className="full">
            <Select value={scopeId} onChange={(event) => setScopeId(event.target.value)} required>
              <option value="" disabled>—</option>
              {teams.map((team) => <option key={team} value={team}>{team}</option>)}
            </Select>
          </Field>}
          {channelScope === 'room' && <Field label={t('room')} className="full">
            <Select value={scopeId} onChange={(event) => setScopeId(event.target.value)} required>
              <option value="" disabled>—</option>
              {rooms.map((room) => <option key={room.id} value={room.id}>
                {data.details.find((detail) => detail.rooms?.some((item) => item.id === room.id))?.workspace.name} · {room.name}
              </option>)}
            </Select>
          </Field>}
        </form>
      </Modal>}
    </div>
  );
}
