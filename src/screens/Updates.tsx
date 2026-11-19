import React, { useState } from 'react';
import { Linking, View } from 'react-native';
import type { ScheduleUpdate } from '../types';
import { useApp } from '../state/AppProvider';
import { formatDate, formatTime } from '../lib/planner';
import { Action, Badge, Card, Chips, Empty, Notice, Row, Sheet, Txt, useDesign } from '../components/ui';
import { BellIcon, CheckCircleIcon, EnvelopeSimpleIcon } from '../components/icons';

function safeOutlookUrl(value: string | null) {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && ['outlook.office.com', 'outlook.office365.com', 'outlook.live.com'].includes(url.hostname) ? url.toString() : null; } catch { return null; }
}
export function Updates() {
  const { data, mode, busy, connection, markSeen, demoAlert, syncMailbox, report } = useApp();
  const { c, lang, t } = useDesign();
  const [tab, setTab] = useState('reminders');
  const [selected, setSelected] = useState<ScheduleUpdate | null>(null);
  const unseen = data.alerts.filter(alert => !alert.seen_at).length;
  return <View style={{ gap: 24 }}><View><Txt size={32} weight="bold" accessibilityRole="header">{t('updates')}</Txt><Txt color={c.muted} style={{ marginTop: 7 }}>{t('updatesBody')}</Txt></View><Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}><Chips value={tab} onChange={setTab} options={[{ value: 'reminders', label: `${t('reminders')}${unseen ? ` (${unseen})` : ''}` }, { value: 'changes', label: t('changes') }]} />{mode === 'demo' ? <Action label={t('demoAlert')} variant="secondary" compact onPress={() => void demoAlert().catch(report)} /> : connection.connected ? <Action label={t('syncNow')} variant="secondary" compact busy={busy} onPress={() => void syncMailbox().catch(report)} /> : null}</Row>
    {tab === 'reminders' ? <>{unseen ? <Action label={t('markAllSeen')} variant="ghost" style={{ alignSelf: 'flex-end' }} onPress={() => void markSeen().catch(report)} /> : null}{data.alerts.length ? [...data.alerts].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(alert => <Card key={alert.id} style={{ backgroundColor: alert.seen_at ? c.surface : c.tint, borderColor: alert.seen_at ? c.line : c.tint }}><Row style={{ alignItems: 'flex-start' }} gap={15}><View style={{ width: 41, height: 41, borderRadius: 12, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>{alert.seen_at ? <CheckCircleIcon size={23} weight="light" color={c.accent} /> : <BellIcon size={23} weight="light" color={c.accent} />}</View><View style={{ flex: 1, gap: 7 }}><Txt size={16} weight="medium">{alert.title}</Txt><Txt size={13} color={c.muted}>{alert.body}</Txt><Txt size={11} color={c.muted}>{formatDate(alert.created_at, lang, data.settings.timezone)} / {formatTime(alert.created_at, lang, data.settings.timezone)}</Txt><View style={{ marginTop: 5, alignItems: 'flex-start' }}>{alert.seen_at ? <Badge label={t('seen')} tone="accent" /> : <Action label={t('markSeen')} variant="secondary" compact onPress={() => void markSeen(alert.id).catch(report)} />}</View></View></Row></Card>) : <Empty icon={<BellIcon size={30} weight="light" color={c.accent} />} title={t('noAlerts')} body={t('noAlertsBody')} />}</> : <><Notice text={t('reviewHelp')} />{data.updates.length ? [...data.updates].sort((a, b) => b.received_at.localeCompare(a.received_at)).map(update => <Card key={update.id}><Row style={{ alignItems: 'flex-start' }} gap={15}><EnvelopeSimpleIcon size={26} weight="light" color={c.accent} /><View style={{ flex: 1, gap: 10 }}><Badge label={t(update.status === 'pending' ? 'review' : update.status)} tone={update.status === 'pending' ? 'warning' : update.status === 'applied' ? 'accent' : 'neutral'} /><Txt size={16} weight="medium">{update.subject}</Txt><Txt size={12} color={c.muted}>{update.sender}</Txt><Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}><Txt size={11} color={c.muted}>{formatDate(update.received_at, lang, data.settings.timezone)}</Txt><Action label={t('details')} variant="secondary" compact onPress={() => setSelected(update)} /></Row></View></Row></Card>) : <Empty title={t('noAlerts')} body={t('noAlertsBody')} />}</>}
    {selected ? <UpdateDetail update={data.updates.find(update => update.id === selected.id) || selected} onClose={() => setSelected(null)} /> : null}
  </View>;
}
function UpdateDetail({ update, onClose }: { update: ScheduleUpdate; onClose: () => void }) {
  const { data, mode, resolveUpdate } = useApp();
  const { c, lang, t } = useDesign();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const complete = Boolean((mode === 'demo' || update.actionable === true) && update.event_id && update.previous_start && update.previous_location !== null && (update.new_start || update.new_location !== null));
  const sourceUrl = safeOutlookUrl(update.source_url);
  const when = (value: string | null) => value ? `${formatDate(value, lang, data.settings.timezone)} / ${formatTime(value, lang, data.settings.timezone)}` : null;
  const resolve = async (action: 'apply' | 'dismiss' | 'revert') => { setBusy(true); setError(''); try { await resolveUpdate(update.id, action); onClose(); } catch (err) { setError(err instanceof Error ? err.message : t('savingFailed')); } finally { setBusy(false); } };
  return <Sheet visible title={t('changes')} onClose={() => { if (!busy) onClose(); }}><Badge label={t(update.status === 'pending' ? 'review' : update.status)} tone={update.status === 'pending' ? 'warning' : 'accent'} /><Txt size={19} weight="medium">{update.subject}</Txt><Txt size={12} color={c.muted}>{t('from')}: {update.sender}</Txt>
    {complete ? <><Card><Txt size={12} color={c.muted}>{t('before')}</Txt><Txt style={{ marginTop: 7 }}>{when(update.previous_start)}</Txt><Txt>{update.previous_location}</Txt></Card><Card style={{ backgroundColor: c.tint, borderColor: c.tint }}><Txt size={12} color={c.accent}>{t('after')}</Txt><Txt style={{ marginTop: 7 }}>{when(update.new_start || update.previous_start)}</Txt><Txt>{update.new_location ?? update.previous_location}</Txt></Card></> : <Notice text={t('incompleteChange')} />}
    <Txt size={13} color={c.muted}>{update.reason}</Txt><View style={{ gap: 10 }}><Txt size={15} weight="medium">{mode === 'demo' ? t('sourceSample') : t('originalMessage')}</Txt><Card style={{ backgroundColor: c.bg }}><Txt size={13} selectable>{update.excerpt}</Txt></Card></View>{sourceUrl ? <Action label={t('readMessage')} variant="secondary" onPress={() => void Linking.openURL(sourceUrl).catch(() => setError(t('error')))} /> : null}{error ? <Notice text={error} danger /> : null}
    {update.status === 'pending' ? <Row style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}><Action label={t('dismiss')} variant="secondary" busy={busy} onPress={() => void resolve('dismiss')} />{complete ? <Action label={t('approve')} busy={busy} onPress={() => void resolve('apply')} /> : null}</Row> : update.status === 'applied' && complete ? <Action label={t('undo')} variant="secondary" busy={busy} onPress={() => void resolve('revert')} /> : null}
  </Sheet>;
}
