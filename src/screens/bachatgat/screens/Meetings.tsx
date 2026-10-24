import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Switch, Text, View } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { escapeHtml, fmtDate, inr, isoToday } from '../format';
import {
  Badge, Btn, BtnRow, Card, Chips, ErrorBox, FieldSpec, Form, FormSheet, Gate, KV, ListItem, LoadMore, Notice, Screen, SectionTitle,
  Sheet, confirm, errorText, useLoad, usePaged, useShg, useSubmit, validate,
} from '../ui';
import { GroupPicker, NeedGroup } from './Members';
import { useTxnLabel } from './Dashboard';
import { DocumentsPanel } from './Documents';

export function MeetingsScreen() {
  const { api, t, push, groupId, has } = useShg();
  const [view, setView] = useState<'upcoming' | 'past'>('upcoming');
  const list = usePaged(async p => {
    const r = await api.get('/meetings', { groupId: groupId || undefined, upcoming: view === 'upcoming' ? 1 : undefined,
      to: view === 'past' ? isoToday() : undefined, page: p });
    return { items: r.meetings, hasMore: r.meetings.length === 30 };
  }, [groupId, view]);
  // Group by month for a calendar-style list
  const byMonth: Record<string, any[]> = {};
  list.items.forEach((m: any) => { const k = String(m.meetingDate).slice(0, 7); (byMonth[k] = byMonth[k] || []).push(m); });
  return (
    <Screen title={t('nav_meetings')} onRefresh={list.reload} refreshing={list.refreshing}
      right={has('shg_meetings') ? <Btn small title={`+ ${t('qa_scheduleMeeting')}`} onPress={() => push('meetingForm')} /> : undefined}>
      <GroupPicker allowAll />
      <Chips value={view} onChange={setView} options={[{ value: 'upcoming', label: t('mtg_upcoming') }, { value: 'past', label: t('mtg_past') }]} />
      <Gate loading={list.loading} error={list.error} onRetry={list.reload} empty={!list.items.length} emptyText={t('dash_noMeetings')}>
        {Object.entries(byMonth).map(([month, items]) => (
          <View key={month}>
            <SectionTitle>{fmtDate(`${month}-01`).replace(/^1 /, '')}</SectionTitle>
            {items.map((m: any) => (
              <ListItem key={m.id} title={`#${m.meetingNumber} · ${m.groupName}`}
                subtitle={[fmtDate(m.meetingDate), m.meetingTime, m.location].filter(Boolean).join(' · ')}
                meta={m.markedCount ? t('mtg_presentCount', { n: m.presentCount, total: m.markedCount }) : undefined}
                badge={m.status} onPress={() => push('meetingDetail', { id: m.id })} />
            ))}
          </View>
        ))}
        <LoadMore list={list} />
      </Gate>
    </Screen>
  );
}

export function MeetingFormScreen() {
  const { api, t, groupId, replace, bump } = useShg();
  const [values, setValues] = useState<Record<string, any>>({ meetingDate: isoToday() });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { submit, busy, error } = useSubmit();
  const fields: FieldSpec[] = [
    { key: 'meetingDate', label: t('common_date'), type: 'date', required: true },
    { key: 'meetingTime', label: t('mtg_time'), placeholder: '10:30', maxLength: 10 },
    { key: 'location', label: t('mtg_location') },
    { key: 'agenda', label: t('mtg_agenda'), type: 'multiline', placeholder: t('mtg_agendaPlaceholder') },
  ];
  const save = async () => {
    const errs = validate(fields, values, t);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const res = await submit(() => api.post('/meetings', { ...values, groupId }));
    if (res) { bump(); replace('meetingDetail', { id: res.meeting.id }); }
  };
  return (
    <Screen title={t('qa_scheduleMeeting')}>
      <GroupPicker />
      <NeedGroup>
        <Form fields={fields} values={values} onChange={(k, v) => setValues(p => ({ ...p, [k]: v }))} errors={errors} />
        <Notice tone="blue" text={t('mtg_notifyHint')} />
        {!!error && <ErrorBox message={error} />}
        <Btn title={t('common_save')} onPress={save} busy={busy} />
      </NeedGroup>
    </Screen>
  );
}

type MtgTab = 'attendance' | 'minutes' | 'resolutions' | 'summary' | 'documents';

const RES_TYPES = ['LOAN_APPROVAL', 'LOAN_REJECTION', 'LOAN_RESCHEDULE', 'LOAN_WAIVER', 'LOAN_WRITE_OFF', 'EXPENSE_APPROVAL',
  'SAVINGS_WITHDRAWAL', 'BUSINESS_DECISION', 'GENERAL'];
const LOAN_RES = RES_TYPES.slice(0, 5);
const AMOUNT_RES = ['LOAN_APPROVAL', 'LOAN_WAIVER', 'LOAN_WRITE_OFF', 'EXPENSE_APPROVAL', 'SAVINGS_WITHDRAWAL'];

export function MeetingDetailScreen({ params }: { params: { id: number } }) {
  const { api, t, st, push, bump, c } = useShg();
  const txnLabel = useTxnLabel();
  const [tab, setTab] = useState<MtgTab>('attendance');
  const { data, loading, error, reload, refreshing } = useLoad(() => api.get(`/meetings/${params.id}`), [params.id]);
  const d = data as any;
  const mt = d?.meeting;
  const locked = mt && ['Minutes Approved', 'Cancelled'].includes(mt.status);
  const [present, setPresent] = useState<Record<number, boolean>>({});
  const [minutes, setMinutes] = useState<Record<string, any>>({});
  const [resOpen, setResOpen] = useState(false);
  const [resType, setResType] = useState('GENERAL');
  const [cancelOpen, setCancelOpen] = useState(false);
  const att = useSubmit();
  const mins = useSubmit();
  const loansOpen = useLoad(() => mt ? api.get('/loans', { groupId: mt.groupId, status: 'open', pageSize: 100 }) : Promise.resolve(null), [mt?.groupId]);

  useEffect(() => {
    if (!d) return;
    const p: Record<number, boolean> = {};
    d.attendance.forEach((a: any) => { p[a.memberId] = a.present === null || a.present === undefined ? false : !!a.present; });
    setPresent(p);
    setMinutes({ agenda: mt.agenda || '', discussions: mt.discussions || '', minutes: mt.minutes || '', decisions: mt.decisions || '',
      nextMeetingDate: mt.nextMeetingDate || '' });
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveAttendance = async () => {
    const entries = d.attendance.map((a: any) => ({ memberId: a.memberId, present: !!present[a.memberId] }));
    const r = await att.submit(() => api.post(`/meetings/${params.id}/attendance`, { entries }));
    if (r) { reload(); bump(); }
  };
  const saveMinutes = async () => {
    const r = await mins.submit(() => api.put(`/meetings/${params.id}`, { ...minutes, nextMeetingDate: minutes.nextMeetingDate || null }));
    if (r) reload();
  };
  const confirmBy = (by: 'President' | 'Secretary') => confirm(t('mtg_confirmBy', { role: t(`role_${by}` as any) }), t('mtg_confirmMsg'), t('common_confirm'), t('common_cancel'),
    async () => { try { await api.post(`/meetings/${params.id}/confirm`, { by }); reload(); } catch (e) { Alert.alert(t('common_error'), errorText(t, e)); } });

  const shareMinutes = async () => {
    const presentNames = d.attendance.filter((a: any) => a.present).map((a: any) => a.fullName);
    const absentNames = d.attendance.filter((a: any) => a.present === false).map((a: any) => a.fullName);
    const res = d.resolutions.map((r: any) => `<li><b>${escapeHtml(`#${r.resolutionNumber} ${r.subject}`)}</b> (${escapeHtml(t(`res_${r.resolutionType}` as any))}${r.amount ? `, ${escapeHtml(inr(r.amount))}` : ''}) — ${escapeHtml(`${r.votesFor}/${r.votesAgainst}/${r.votesAbstain}`)} — <b>${escapeHtml(st(r.result))}</b>${r.resolutionText ? `<br/>${escapeHtml(r.resolutionText)}` : ''}</li>`).join('');
    const sec = (h: string, body: string) => body ? `<h3>${escapeHtml(h)}</h3><div style="white-space:pre-wrap">${escapeHtml(body)}</div>` : '';
    const html = `<html><head><meta charset="utf-8"/></head><body style="font-family:Helvetica,Arial;padding:20px;color:#0f172a">
      <h2>${escapeHtml(mt.groupName)} — ${escapeHtml(t('mtg_minutesTitle'))} #${mt.meetingNumber}</h2>
      <div>${escapeHtml(fmtDate(mt.meetingDate))} ${escapeHtml(mt.meetingTime || '')} · ${escapeHtml(mt.location || '')} · ${escapeHtml(st(mt.status))}</div>
      <p><b>${escapeHtml(t('mtg_present'))} (${presentNames.length}):</b> ${escapeHtml(presentNames.join(', '))}<br/>
      <b>${escapeHtml(t('mtg_absent'))} (${absentNames.length}):</b> ${escapeHtml(absentNames.join(', '))}</p>
      ${sec(t('mtg_agenda'), mt.agenda)}${sec(t('mtg_discussions'), mt.discussions)}${sec(t('mtg_minutes'), mt.minutes)}${sec(t('mtg_decisions'), mt.decisions)}
      ${res ? `<h3>${escapeHtml(t('mtg_resolutions'))}</h3><ol>${res}</ol>` : ''}
      ${mt.nextMeetingDate ? `<p><b>${escapeHtml(t('mtg_nextDate'))}:</b> ${escapeHtml(fmtDate(mt.nextMeetingDate))}</p>` : ''}
      <p style="margin-top:40px">${escapeHtml(t('role_President'))}: ${mt.presidentConfirmedAt ? '✔ ' + escapeHtml(fmtDate(mt.presidentConfirmedAt)) : '__________'}
      &nbsp;&nbsp;&nbsp; ${escapeHtml(t('role_Secretary'))}: ${mt.secretaryConfirmedAt ? '✔ ' + escapeHtml(fmtDate(mt.secretaryConfirmedAt)) : '__________'}</p>
      </body></html>`;
    try {
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
    } catch { Alert.alert(t('common_error'), t('err_pdf')); }
  };

  const loanOptions = [...(d?.pendingLoans || []), ...(((loansOpen.data as any)?.loans) || [])]
    .map((l: any) => ({ value: String(l.id), label: `${l.applicationNumber} · ${l.memberName} · ${inr(l.requestedAmount || l.approvedAmount)}` }));
  const presentCount = Object.values(present).filter(Boolean).length;

  return (
    <Screen title={mt ? `${t('mtg_meeting')} #${mt.meetingNumber}` : t('nav_meetings')} subtitle={mt ? `${mt.groupName} · ${fmtDate(mt.meetingDate)}` : undefined}
      onRefresh={reload} refreshing={refreshing} right={mt ? <Btn small kind="ghost" title="PDF" onPress={shareMinutes} /> : undefined}>
      <Gate loading={loading && !d} error={error} onRetry={reload}>
        {mt && (
          <>
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Badge value={mt.status} />
                <Text style={{ color: d.quorum.met ? c.green : c.amber, fontWeight: '700' }}>
                  {t('mtg_quorum', { present: d.quorum.present, required: d.quorum.required })}
                </Text>
              </View>
              <KV label={t('mtg_time')} value={[mt.meetingTime, mt.location].filter(Boolean).join(' · ') || '-'} />
              <KV label={t('role_President')} value={mt.presidentConfirmedAt ? `✔ ${fmtDate(mt.presidentConfirmedAt)}` : t('mtg_notConfirmed')} />
              <KV label={t('role_Secretary')} value={mt.secretaryConfirmedAt ? `✔ ${fmtDate(mt.secretaryConfirmedAt)}` : t('mtg_notConfirmed')} />
            </Card>
            <Chips<MtgTab> value={tab} onChange={setTab} options={[
              { value: 'attendance', label: t('tab_attendance') }, { value: 'minutes', label: t('mtg_minutesTab') },
              { value: 'resolutions', label: t('mtg_resolutions') }, { value: 'summary', label: t('mtg_summary') }, { value: 'documents', label: t('doc_title') },
            ]} />
            <View style={{ height: 10 }} />

            {tab === 'attendance' && (
              <>
                {mt.meetingDate > isoToday() && <Notice text={t('mtg_futureAttendance')} />}
                <Text style={{ color: c.muted, marginBottom: 6 }}>{t('mtg_presentCount', { n: presentCount, total: d.attendance.length })}</Text>
                {d.attendance.map((a: any) => (
                  <Pressable key={a.memberId} disabled={locked} onPress={() => setPresent(p => ({ ...p, [a.memberId]: !p[a.memberId] }))}
                    accessibilityRole="switch" accessibilityState={{ checked: !!present[a.memberId] }} accessibilityLabel={a.fullName}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border, minHeight: 52 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.text, fontWeight: '600' }}>#{a.memberNumber} {a.fullName}</Text>
                      <Text style={{ color: c.muted, fontSize: 12 }}>{t(`role_${a.role}` as any)}</Text>
                    </View>
                    <Switch value={!!present[a.memberId]} disabled={locked} onValueChange={v => setPresent(p => ({ ...p, [a.memberId]: v }))}
                      trackColor={{ true: c.green, false: c.border }} />
                  </Pressable>
                ))}
                {!locked && (
                  <>
                    <BtnRow>
                      <Btn small kind="ghost" title={t('mtg_allPresent')} onPress={() => setPresent(Object.fromEntries(d.attendance.map((a: any) => [a.memberId, true])))} />
                    </BtnRow>
                    {!!att.error && <ErrorBox message={att.error} />}
                    <Btn title={t('mtg_saveAttendance')} onPress={saveAttendance} busy={att.busy} disabled={mt.meetingDate > isoToday()} />
                  </>
                )}
                {mt.status === 'Scheduled' && <Btn kind="ghost" title={t('mtg_cancel')} onPress={() => setCancelOpen(true)} />}
              </>
            )}

            {tab === 'minutes' && (
              <>
                <Form
                  fields={[
                    { key: 'agenda', label: t('mtg_agenda'), type: 'multiline' },
                    { key: 'discussions', label: t('mtg_discussions'), type: 'multiline' },
                    { key: 'minutes', label: t('mtg_minutes'), type: 'multiline' },
                    { key: 'decisions', label: t('mtg_decisions'), type: 'multiline' },
                    { key: 'nextMeetingDate', label: t('mtg_nextDate'), type: 'date' },
                  ]}
                  values={minutes} onChange={(k, v) => setMinutes(p => ({ ...p, [k]: v }))} errors={{}} />
                {!locked && <>
                  {!!mins.error && <ErrorBox message={mins.error} />}
                  <Btn title={t('common_save')} onPress={saveMinutes} busy={mins.busy} />
                </>}
                {mt.status === 'Held' && (
                  <>
                    <Notice tone="blue" text={t('mtg_approveHint')} />
                    <BtnRow>
                      {!mt.presidentConfirmedAt && <Btn small kind="secondary" title={t('mtg_confirmBy', { role: t('role_President') })} onPress={() => confirmBy('President')} />}
                      {!mt.secretaryConfirmedAt && <Btn small kind="secondary" title={t('mtg_confirmBy', { role: t('role_Secretary') })} onPress={() => confirmBy('Secretary')} />}
                    </BtnRow>
                  </>
                )}
              </>
            )}

            {tab === 'resolutions' && (
              <>
                {mt.status === 'Held' && (d.quorum.met
                  ? <Btn title={`+ ${t('res_add')}`} onPress={() => setResOpen(true)} />
                  : <Notice tone="red" text={t('mtg_noQuorum')} />)}
                {mt.status === 'Scheduled' && <Notice text={t('res_markFirst')} />}
                {d.resolutions.length ? d.resolutions.map((r: any) => (
                  <Card key={r.id} onPress={r.loanId ? () => push('loanDetail', { id: r.loanId }) : undefined}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: c.text, fontWeight: '800', flex: 1 }}>#{r.resolutionNumber} {r.subject}</Text>
                      <Badge value={r.result} />
                    </View>
                    <KV label={t('common_type')} value={t(`res_${r.resolutionType}` as any)} />
                    {!!r.applicationNumber && <KV label={t('common_loan')} value={`${r.applicationNumber} · ${r.loanMemberName}`} />}
                    {!!r.amount && <KV label={t('common_amount')} value={inr(r.amount)} />}
                    <KV label={t('res_votes')} value={`${r.votesFor} / ${r.votesAgainst} / ${r.votesAbstain}`} />
                    {!!r.resolutionText && <Text style={{ color: c.sub, marginTop: 4 }}>{r.resolutionText}</Text>}
                    {r.consumedByType && <Text style={{ color: c.muted, fontSize: 12, marginTop: 4 }}>{t('res_used')}</Text>}
                  </Card>
                )) : <Notice text={t('res_none')} />}
                {!!d.pendingLoans.length && (
                  <>
                    <SectionTitle>{t('mtg_loansToDiscuss')}</SectionTitle>
                    {d.pendingLoans.map((l: any) => (
                      <ListItem key={l.id} title={`${l.memberName} · ${inr(l.requestedAmount)}`} subtitle={l.applicationNumber} badge={l.status}
                        onPress={() => push('loanDetail', { id: l.id })} />
                    ))}
                  </>
                )}
              </>
            )}

            {tab === 'summary' && (
              <Card>
                <KV label={t('mtg_present')} value={String(d.quorum.present)} />
                <KV label={t('mem_activeCount')} value={String(d.quorum.activeMembers)} />
                {d.collectionSummary.length ? d.collectionSummary.map((s: any) => (
                  <KV key={s.txnType} label={`${txnLabel(s.txnType)} (${s.count})`} value={inr(s.amount)} />
                )) : <Text style={{ color: c.muted }}>{t('mtg_noCollections')}</Text>}
                <KV label={t('mtg_resolutions')} value={String(d.resolutions.length)} />
              </Card>
            )}
            {tab === 'documents' && <DocumentsPanel entityType="MEETING" entityId={mt.id} />}
          </>
        )}
      </Gate>
      <ResolutionSheet visible={resOpen} onClose={() => setResOpen(false)} meetingId={params.id} loanOptions={loanOptions}
        type={resType} setType={setResType} presentCount={d?.quorum?.present || 0} onSaved={() => { reload(); bump(); }} />
      <FormSheet visible={cancelOpen} title={t('mtg_cancel')} onClose={() => setCancelOpen(false)}
        fields={[{ key: 'reason', label: t('common_reason'), type: 'multiline', required: true }]}
        onSubmit={async v => { const r = await api.post(`/meetings/${params.id}/cancel`, v); reload(); return r; }} />
    </Screen>
  );
}

function ResolutionSheet({ visible, onClose, meetingId, loanOptions, type, setType, presentCount, onSaved }: {
  visible: boolean; onClose: () => void; meetingId: number; loanOptions: { value: string; label: string }[]; type: string;
  setType: (v: string) => void; presentCount: number; onSaved: () => void;
}) {
  const { api, t } = useShg();
  const fields: FieldSpec[] = [
    { key: 'resolutionType', label: t('common_type'), type: 'select', required: true, options: RES_TYPES.map(r => ({ value: r, label: t(`res_${r}` as any) })) },
    { key: 'loanId', label: t('common_loan'), type: 'select', required: LOAN_RES.includes(type), hidden: !LOAN_RES.includes(type), options: loanOptions },
    { key: 'subject', label: t('res_subject'), required: true },
    { key: 'resolutionText', label: t('res_text'), type: 'multiline' },
    { key: 'amount', label: t('common_amount'), type: 'money', required: AMOUNT_RES.includes(type), hidden: !AMOUNT_RES.includes(type) },
    { key: 'votesFor', label: t('res_for'), type: 'number', required: true, min: 0, max: presentCount },
    { key: 'votesAgainst', label: t('res_against'), type: 'number', min: 0, max: presentCount },
    { key: 'votesAbstain', label: t('res_abstain'), type: 'number', min: 0, max: presentCount },
  ];
  const [values, setValues] = useState<Record<string, any>>({ resolutionType: type, votesAgainst: '0', votesAbstain: '0' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { submit, busy, error } = useSubmit();
  useEffect(() => { if (visible) { setValues({ resolutionType: type, votesAgainst: '0', votesAbstain: '0', votesFor: String(presentCount) }); setErrors({}); } }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => {
    const errs = validate(fields, values, t);
    const total = ['votesFor', 'votesAgainst', 'votesAbstain'].reduce((s, k) => s + Number(values[k] || 0), 0);
    if (total > presentCount) errs.votesFor = t('res_votesExceed', { n: presentCount });
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const r = await submit(() => api.post(`/meetings/${meetingId}/resolutions`, { ...values, loanId: values.loanId ? Number(values.loanId) : undefined }));
    if (r) { onSaved(); onClose(); }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={t('res_add')}>
      <Notice tone="blue" text={t('res_hint')} />
      <Form fields={fields} values={values} errors={errors} onChange={(k, v) => { setValues(p => ({ ...p, [k]: v })); if (k === 'resolutionType') setType(v); }} />
      {!!error && <ErrorBox message={error} />}
      <Btn title={t('common_save')} onPress={go} busy={busy} />
    </Sheet>
  );
}

