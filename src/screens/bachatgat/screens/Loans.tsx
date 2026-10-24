import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { fmtDate, inr, isoToday, reportHtml } from '../format';
import {
  Badge, Btn, BtnRow, Card, Chips, ErrorBox, FieldSpec, Form, FormSheet, Gate, KV, ListItem, LoadMore, Notice, Screen, SearchBar,
  SectionTitle, Stat, StatGrid, confirm, useDebounced, useLoad, usePaged, useShg, useSubmit, validate,
} from '../ui';
import { GroupPicker, NeedGroup } from './Members';
import { MemberChooser, paymentFields, useBankOptions, useResolutionOptions } from './Savings';
import { TxnItem } from './Dashboard';
import { DocumentsPanel } from './Documents';

const LOAN_FILTERS = ['', 'pending', 'Approved', 'open', 'Overdue', 'Draft', 'Closed', 'Rejected', 'Written Off'];

export function LoansScreen({ params }: { params?: any }) {
  const { api, t, st, push, groupId, has } = useShg();
  const [status, setStatus] = useState<string>(params?.status || '');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const list = usePaged(async p => {
    const r = await api.get('/loans', { groupId: groupId || undefined, status, q: dq, page: p });
    return { items: r.loans, hasMore: r.total > p * r.pageSize };
  }, [groupId, status, dq]);
  const label = (f: string) => f === '' ? t('common_all') : f === 'pending' ? t('loan_filterPending') : f === 'open' ? t('loan_filterOpen') : st(f);
  return (
    <Screen title={t('nav_loans')} onRefresh={list.reload} refreshing={list.refreshing}
      right={has('shg_loans') ? <Btn small title={`+ ${t('qa_applyLoan')}`} onPress={() => push('loanForm')} /> : undefined}>
      <GroupPicker allowAll />
      <SearchBar value={q} onChange={setQ} placeholder={t('loan_search')} />
      <Chips value={status} onChange={setStatus} options={LOAN_FILTERS.map(f => ({ value: f, label: label(f) }))} />
      <View style={{ height: 8 }} />
      <Gate loading={list.loading} error={list.error} onRetry={list.reload} empty={!list.items.length} emptyText={t('loan_none')}>
        {list.items.map((l: any) => (
          <ListItem key={l.id} title={`${l.memberName} · ${inr(l.approvedAmount || l.requestedAmount)}`}
            subtitle={`${l.applicationNumber} · ${l.purpose}`}
            meta={['Active', 'Overdue'].includes(l.status) ? `${t('loan_outstanding')} ${inr(l.principalOutstanding)}` : fmtDate(l.applicationDate)}
            badge={l.status} onPress={() => push('loanDetail', { id: l.id })} />
        ))}
        <LoadMore list={list} />
      </Gate>
    </Screen>
  );
}

export function ScheduleTable({ rows }: { rows: any[] }) {
  const { t, c } = useShg();
  return (
    <Card>
      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: c.border, paddingBottom: 6 }}>
        {[t('loan_instNo'), t('common_date'), t('loan_principal'), t('loan_interest'), t('common_total')].map((h, i) => (
          <Text key={h} style={{ flex: i === 1 ? 1.4 : 1, color: c.muted, fontSize: 11, fontWeight: '700', textAlign: i < 2 ? 'left' : 'right' }}>{h}</Text>
        ))}
      </View>
      {rows.map((r: any) => (
        <View key={r.number} style={{ flexDirection: 'row', paddingVertical: 5 }} accessible accessibilityLabel={`${r.number}, ${fmtDate(r.dueDate)}, ${inr(r.total)}`}>
          <Text style={{ flex: 1, color: c.text, fontSize: 12 }}>{r.number}</Text>
          <Text style={{ flex: 1.4, color: c.text, fontSize: 12 }}>{fmtDate(r.dueDate)}</Text>
          <Text style={{ flex: 1, color: c.text, fontSize: 12, textAlign: 'right' }}>{inr(r.principal)}</Text>
          <Text style={{ flex: 1, color: c.text, fontSize: 12, textAlign: 'right' }}>{inr(r.interest)}</Text>
          <Text style={{ flex: 1, color: c.text, fontSize: 12, textAlign: 'right', fontWeight: '700' }}>{inr(r.total)}</Text>
        </View>
      ))}
    </Card>
  );
}

export function LoanFormScreen({ params }: { params?: any }) {
  const { api, t, groupId, replace, bump } = useShg();
  const [member, setMember] = useState<any>(null);
  const memberLoad = useLoad(() => params?.memberId ? api.get(`/members/${params.memberId}`) : Promise.resolve(null), [params?.memberId]);
  const pickedMember = member || (memberLoad.data as any)?.member;
  const policy = useLoad(() => {
    const gid = pickedMember?.groupId || groupId;
    return gid ? api.get(`/policies/${gid}`) : Promise.resolve(null);
  }, [pickedMember?.groupId, groupId]);
  const p = (policy.data as any)?.policy;
  const [values, setValues] = useState<Record<string, any>>({ applicationDate: isoToday() });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<any>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const { submit, busy, error } = useSubmit();
  React.useEffect(() => {
    if (p) setValues(v => ({ interestMethod: p.defaultInterestMethod, interestRate: String(p.defaultInterestRate), frequency: p.defaultFrequency,
      installments: String(Math.min(12, p.maxInstallments)), ...v }));
  }, [p]);
  const fields: FieldSpec[] = [
    { key: 'requestedAmount', label: t('loan_requested'), type: 'money', required: true, min: 1,
      help: p && Number(p.maxLoanAmount) > 0 ? t('loan_maxHint', { amount: inr(p.maxLoanAmount) }) : undefined },
    { key: 'purpose', label: t('loan_purpose'), required: true },
    { key: 'interestMethod', label: t('loan_method'), type: 'select', required: true,
      options: [{ value: 'FLAT', label: t('loan_FLAT') }, { value: 'REDUCING', label: t('loan_REDUCING') }] },
    { key: 'interestRate', label: t('loan_rate'), type: 'decimal', required: true, min: 0, max: 60 },
    { key: 'installments', label: t('loan_installments'), type: 'number', required: true, min: 1, max: p?.maxInstallments || 520 },
    { key: 'frequency', label: t('loan_frequency'), type: 'select', required: true,
      options: ['MONTHLY', 'FORTNIGHTLY', 'WEEKLY'].map(f => ({ value: f, label: t(`freq_${f}` as any) })) },
    { key: 'applicationDate', label: t('loan_applicationDate'), type: 'date', required: true },
    { key: 'remarks', label: t('common_remarks'), type: 'multiline' },
  ];
  const doPreview = async () => {
    setPreviewErr(null);
    const errs = validate(fields, values, t);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      setPreview(await api.post('/loans/preview-schedule', { groupId: pickedMember.groupId, amount: values.requestedAmount, ...values }));
    } catch (e: any) {
      setPreviewErr(e.message);
    }
  };
  const save = async (andSubmit: boolean) => {
    const errs = validate(fields, values, t);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const res = await submit(async () => {
      const created = await api.post('/loans', { ...values, memberId: pickedMember.id });
      if (andSubmit) {
        try { await api.post(`/loans/${created.loan.id}/workflow`, { action: 'submit' }); } catch { /* shown on the detail screen */ }
      }
      return created;
    });
    if (res) { bump(); replace('loanDetail', { id: res.loan.id }); }
  };
  return (
    <Screen title={t('qa_applyLoan')}>
      {!pickedMember ? (
        <><GroupPicker /><NeedGroup><SectionTitle>{t('sav_pickMember')}</SectionTitle><MemberChooser onPick={setMember} /></NeedGroup></>
      ) : (
        <>
          <Card>
            <KV label={t('common_member')} value={`${pickedMember.fullName} #${pickedMember.memberNumber}`} strong />
            <KV label={t('mem_savingsBalance')} value={inr(pickedMember.savingsBalance ?? (memberLoad.data as any)?.summary?.savingsBalance)} />
            {p && Number(p.savingsMultiple) > 0 && <KV label={t('loan_savingsLimit')} value={`${p.savingsMultiple}×`} />}
            {!params?.memberId && <Btn small kind="ghost" title={t('sav_changeMember')} onPress={() => setMember(null)} />}
          </Card>
          <Form fields={fields} values={values} onChange={(k, v) => { setValues(x => ({ ...x, [k]: v })); setPreview(null); }} errors={errors} />
          <Btn kind="secondary" title={t('loan_previewSchedule')} onPress={doPreview} />
          {!!previewErr && <ErrorBox message={previewErr} />}
          {preview && (
            <>
              <StatGrid>
                <Stat label={t('loan_totalInterest')} value={inr(preview.totals.interest)} tone="amber" />
                <Stat label={t('loan_totalPayable')} value={inr(preview.totals.total)} />
              </StatGrid>
              <ScheduleTable rows={preview.schedule} />
            </>
          )}
          {!!error && <ErrorBox message={error} />}
          <Btn title={t('loan_saveSubmit')} onPress={() => save(true)} busy={busy} />
          <Btn kind="ghost" title={t('loan_saveDraft')} onPress={() => save(false)} busy={busy} />
        </>
      )}
    </Screen>
  );
}

type LoanTab = 'summary' | 'schedule' | 'history' | 'payments' | 'documents';

export function LoanDetailScreen({ params }: { params: { id: number } }) {
  const { api, t, st, push, bump } = useShg();
  const [tab, setTab] = useState<LoanTab>('summary');
  const { data, loading, error, reload, refreshing } = useLoad(() => api.get(`/loans/${params.id}`), [params.id]);
  const [sheet, setSheet] = useState<string | null>(null);
  const d = data as any;
  const l = d?.loan;
  const approvals = useResolutionOptions('LOAN_APPROVAL', params.id);
  const rejections = useResolutionOptions('LOAN_REJECTION', params.id);
  const reschedules = useResolutionOptions('LOAN_RESCHEDULE', params.id);
  const waivers = useResolutionOptions('LOAN_WAIVER', params.id);
  const writeOffs = useResolutionOptions('LOAN_WRITE_OFF', params.id);
  const banks = useBankOptions();
  const bearers = useLoad(() => l ? api.get('/members', { groupId: l.groupId, status: 'Active', pageSize: 100 }) : Promise.resolve(null), [l?.groupId]);
  const authorizers = ((bearers.data as any)?.members || []).filter((m: any) => ['President', 'Treasurer'].includes(m.role) && m.id !== l?.memberId)
    .map((m: any) => ({ value: String(m.id), label: `${m.fullName} (${t(`role_${m.role}` as any)})` }));

  const shareStatement = async () => {
    try {
      const st2 = await api.get(`/loans/${params.id}/statement`);
      const cols = [
        { key: 'number', label: '#', type: 'number' as const }, { key: 'dueDate', label: t('common_date'), type: 'date' as const },
        { key: 'principalDue', label: t('loan_principal'), type: 'money' as const }, { key: 'interestDue', label: t('loan_interest'), type: 'money' as const },
        { key: 'principalPaid', label: t('loan_principalPaid'), type: 'money' as const }, { key: 'interestPaid', label: t('loan_interestPaid'), type: 'money' as const },
        { key: 'outstandingTotal', label: t('loan_outstanding'), type: 'money' as const }, { key: 'status', label: t('common_status'), type: 'text' as const },
      ];
      const tot = st2.totals;
      const meta = `${st2.loan.memberName} · ${st2.loan.applicationNumber} · ${st2.loan.groupName} · ${t('loan_disbursed')} ${inr(tot.disbursed)} · ${t('loan_principalPaid')} ${inr(tot.principalPaid)} · ${t('loan_interestPaid')} ${inr(tot.interestPaid)} · ${t('loan_outstanding')} ${inr(tot.principalOutstanding)}`;
      const html = reportHtml(`${t('loan_statement')} - ${st(st2.loan.status)}`, meta, cols, st2.schedule, {});
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
    } catch {
      Alert.alert(t('common_error'), t('err_pdf'));
    }
  };

  const workflow = (action: string, extra: Record<string, any> = {}) => api.post(`/loans/${params.id}/workflow`, { action, version: l.version, ...extra })
    .then(r => { reload(); bump(); return r; });

  return (
    <Screen title={l ? `${l.memberName}` : t('nav_loans')} subtitle={l ? `${l.applicationNumber} · ${st(l.status)}` : undefined} onRefresh={reload} refreshing={refreshing}>
      <Gate loading={loading && !d} error={error} onRetry={reload}>
        {l && (
          <>
            <Chips<LoanTab> value={tab} onChange={setTab} options={[
              { value: 'summary', label: t('tab_overview') }, { value: 'schedule', label: t('loan_schedule') },
              { value: 'payments', label: t('tab_repayments') }, { value: 'history', label: t('tab_history') }, { value: 'documents', label: t('doc_title') },
            ]} />
            <View style={{ height: 10 }} />
            {tab === 'summary' && (
              <>
                <StatGrid>
                  <Stat label={t('loan_requested')} value={inr(l.requestedAmount)} />
                  <Stat label={t('loan_approved')} value={l.approvedAmount ? inr(l.approvedAmount) : '-'} tone="green" />
                  <Stat label={t('loan_outstanding')} value={inr(l.principalOutstanding)} tone={l.status === 'Overdue' ? 'red' : 'brand'} />
                  {d.quote && <Stat label={t('loan_dueNow')} value={inr(d.quote.dueNow)} tone={Number(d.quote.dueNow) > 0 ? 'amber' : 'green'} />}
                </StatGrid>
                <Card>
                  <View style={{ marginBottom: 6 }}><Badge value={l.status} /></View>
                  <KV label={t('loan_purpose')} value={l.purpose} />
                  <KV label={t('loan_method')} value={`${t(`loan_${l.interestMethod}` as any)} · ${l.interestRate}% · ${l.installments} × ${t(`freq_${l.frequency}` as any)}`} />
                  <KV label={t('loan_applicationDate')} value={fmtDate(l.applicationDate)} />
                  {l.disbursedOn && <KV label={t('loan_disbursedOn')} value={fmtDate(l.disbursedOn)} />}
                  {d.quote?.nextInstallment && <KV label={t('loan_nextInstallment')} value={`${fmtDate(d.quote.nextInstallment.dueDate)} · ${inr(d.quote.nextInstallment.amount)}`} />}
                  {!!l.reviewRemarks && <KV label={t('loan_reviewRemarks')} value={l.reviewRemarks} />}
                  {!!l.rejectionReason && <KV label={t('loan_rejectionReason')} value={l.rejectionReason} />}
                  {!!l.remarks && <KV label={t('common_remarks')} value={l.remarks} />}
                </Card>
                {!!d.eligibilityProblems?.length && <Notice tone="red" text={`${t('loan_notEligible')}\n• ${d.eligibilityProblems.join('\n• ')}`} />}
                {l.status === 'Under Review' && !approvals.length && <Notice text={t('loan_needResolution')} />}
                <SectionTitle>{t('grp_workflow')}</SectionTitle>
                <BtnRow>
                  {l.status === 'Draft' && <Btn small title={t('loan_submit')} onPress={() => workflow('submit').catch(e => Alert.alert(t('common_error'), e.details ? `${e.message}\n• ${e.details.join('\n• ')}` : e.message))} />}
                  {l.status === 'Submitted' && <Btn small title={t('loan_review')} onPress={() => setSheet('review')} />}
                  {l.status === 'Under Review' && <Btn small title={t('loan_approve')} onPress={() => setSheet('approve')} />}
                  {['Submitted', 'Under Review'].includes(l.status) && <Btn small kind="danger" title={t('loan_reject')} onPress={() => setSheet('reject')} />}
                  {['Draft', 'Submitted', 'Under Review', 'Approved'].includes(l.status) && <Btn small kind="ghost" title={t('loan_withdraw')} onPress={() => setSheet('withdraw')} />}
                  {l.status === 'Approved' && <Btn small title={t('qa_disburseLoan')} onPress={() => setSheet('disburse')} />}
                  {['Active', 'Overdue'].includes(l.status) && <Btn small title={t('qa_collectRepayment')} onPress={() => push('repay', { loanId: l.id })} />}
                  {['Active', 'Overdue'].includes(l.status) && <Btn small kind="secondary" title={t('loan_reschedule')} onPress={() => setSheet('reschedule')} />}
                  {['Active', 'Overdue'].includes(l.status) && <Btn small kind="secondary" title={t('loan_waive')} onPress={() => setSheet('waive')} />}
                  {['Active', 'Overdue'].includes(l.status) && <Btn small kind="danger" title={t('loan_writeOff')} onPress={() => setSheet('writeoff')} />}
                </BtnRow>
                <Btn kind="secondary" icon="📄" title={t('loan_statement')} onPress={shareStatement} />
                {d.proposedSchedule && (
                  <>
                    <SectionTitle>{t('loan_proposedSchedule')}</SectionTitle>
                    <KV label={t('loan_totalInterest')} value={inr(d.proposedSchedule.totals.interest)} />
                    <ScheduleTable rows={d.proposedSchedule.schedule} />
                  </>
                )}
              </>
            )}
            {tab === 'schedule' && (
              d.schedule.length ? d.schedule.map((i: any) => (
                <ListItem key={i.id} title={`#${i.number} · ${fmtDate(i.dueDate)}`}
                  subtitle={`${t('loan_principal')} ${inr(i.principalDue)} · ${t('loan_interest')} ${inr(i.interestDue)}${Number(i.penaltyDue) ? ` · ${t('loan_penalty')} ${inr(i.penaltyDue)}` : ''}`}
                  meta={`${t('common_paid')} ${inr(Number(i.principalPaid) + Number(i.interestPaid) + Number(i.penaltyPaid))}${Number(i.interestWaived) + Number(i.penaltyWaived) ? ` · ${t('loan_waived')} ${inr(Number(i.interestWaived) + Number(i.penaltyWaived))}` : ''}`}
                  right={inr(i.outstandingTotal)} badge={i.isOverdue ? 'Overdue' : i.status} />
              )) : <Notice text={t('loan_noSchedule')} />
            )}
            {tab === 'payments' && (d.transactions.length ? d.transactions.map((x: any) => <TxnItem key={x.id} txn={x} onPress={() => push('receipt', { id: x.id })} />)
              : <Notice text={t('common_noRecords')} />)}
            {tab === 'history' && (
              <>
                {d.events.map((e: any) => (
                  <ListItem key={e.id} title={e.action.replace(/_/g, ' ')} subtitle={e.fromStatus || e.toStatus ? `${e.fromStatus || '—'} → ${e.toStatus || '—'}` : undefined}
                    meta={`${fmtDate(e.createdAt)} ${String(e.createdAt).slice(11, 16)}${e.details?.remarks ? ` · ${e.details.remarks}` : ''}`} />
                ))}
                <SectionTitle>{t('mtg_resolutions')}</SectionTitle>
                {d.resolutions.map((r: any) => (
                  <ListItem key={r.id} title={`${t(`res_${r.resolutionType}` as any)} · ${r.subject}`}
                    subtitle={`${t('mtg_meeting')} #${r.meetingNumber} · ${fmtDate(r.meetingDate)} · ${r.votesFor}/${r.votesAgainst}/${r.votesAbstain}`}
                    badge={r.result} onPress={() => push('meetingDetail', { id: r.meetingId })} />
                ))}
              </>
            )}
            {tab === 'documents' && <DocumentsPanel entityType="LOAN" entityId={l.id} />}
          </>
        )}
      </Gate>

      <FormSheet visible={sheet === 'review'} title={t('loan_review')} onClose={() => setSheet(null)}
        fields={[{ key: 'remarks', label: t('loan_reviewRemarks'), type: 'multiline', required: true }]}
        onSubmit={v => workflow('review', v)} />
      <FormSheet visible={sheet === 'approve'} title={t('loan_approve')} onClose={() => setSheet(null)} notice={t('loan_approveHint')}
        initial={{ approvedAmount: l ? String(l.requestedAmount) : '' }}
        fields={[
          { key: 'resolutionId', label: t('res_authorizing'), type: 'select', required: true, options: approvals, help: approvals.length ? undefined : t('res_noneUsable') },
          { key: 'approvedAmount', label: t('loan_approved'), type: 'money', required: true, max: l ? Number(l.requestedAmount) : undefined },
        ]}
        onSubmit={v => workflow('approve', { ...v, resolutionId: Number(v.resolutionId) })} />
      <FormSheet visible={sheet === 'reject' || sheet === 'withdraw'} title={sheet === 'withdraw' ? t('loan_withdraw') : t('loan_reject')} onClose={() => setSheet(null)}
        fields={[
          { key: 'remarks', label: t('loan_rejectionReason'), type: 'multiline', required: true },
          { key: 'resolutionId', label: t('res_optional'), type: 'select', options: rejections, hidden: sheet === 'withdraw' },
        ]}
        onSubmit={v => workflow(sheet!, { ...v, resolutionId: v.resolutionId ? Number(v.resolutionId) : undefined })} />
      <FormSheet visible={sheet === 'disburse'} title={t('qa_disburseLoan')} onClose={() => setSheet(null)} notice={t('loan_disburseHint')}
        initial={{ paymentMethod: 'Cash', disbursedOn: isoToday() }}
        fields={[
          { key: 'authorizedByMemberId', label: t('loan_authorizedBy'), type: 'select', required: true, options: authorizers },
          { key: 'paymentMethod', label: t('common_paymentMethod'), type: 'select', required: true, options: ['Cash', 'Bank Transfer', 'UPI', 'Cheque'].map(x => ({ value: x, label: x })) },
          { key: 'bankAccountId', label: t('bank_account'), type: 'select', options: banks },
          { key: 'referenceNumber', label: t('common_reference') },
          { key: 'disbursedOn', label: t('loan_disbursedOn'), type: 'date', required: true },
          { key: 'firstDueDate', label: t('loan_firstDue'), type: 'date', help: t('loan_firstDueHelp') },
        ]}
        onSubmit={async (v, key) => {
          const r = await api.post(`/loans/${params.id}/disburse`, { ...v, authorizedByMemberId: Number(v.authorizedByMemberId),
            bankAccountId: v.bankAccountId ? Number(v.bankAccountId) : undefined }, key);
          reload(); bump();
          return r;
        }} />
      <FormSheet visible={sheet === 'reschedule'} title={t('loan_reschedule')} onClose={() => setSheet(null)} notice={t('loan_rescheduleHint')}
        initial={l ? { installments: String(l.installments), interestRate: String(l.interestRate), frequency: l.frequency } : {}}
        fields={[
          { key: 'resolutionId', label: t('res_authorizing'), type: 'select', required: true, options: reschedules, help: reschedules.length ? undefined : t('res_noneUsable') },
          { key: 'installments', label: t('loan_installments'), type: 'number', required: true, min: 1 },
          { key: 'interestRate', label: t('loan_rate'), type: 'decimal', required: true, min: 0, max: 60 },
          { key: 'frequency', label: t('loan_frequency'), type: 'select', required: true, options: ['MONTHLY', 'FORTNIGHTLY', 'WEEKLY'].map(f => ({ value: f, label: t(`freq_${f}` as any) })) },
          { key: 'firstDueDate', label: t('loan_firstDue'), type: 'date', required: true },
        ]}
        onSubmit={async v => { const r = await api.post(`/loans/${params.id}/reschedule`, { ...v, resolutionId: Number(v.resolutionId) }); reload(); bump(); return r; }} />
      <FormSheet visible={sheet === 'waive'} title={t('loan_waive')} onClose={() => setSheet(null)} notice={t('loan_waiveHint')}
        initial={{ heads: 'penalty' }}
        fields={[
          { key: 'resolutionId', label: t('res_authorizing'), type: 'select', required: true, options: waivers, help: waivers.length ? undefined : t('res_noneUsable') },
          { key: 'heads', label: t('loan_waiveWhat'), type: 'select', required: true, options: [
            { value: 'penalty', label: t('loan_penalty') }, { value: 'interest', label: t('loan_interest') }, { value: 'both', label: t('loan_waiveBoth') }] },
        ]}
        onSubmit={async v => {
          const heads = v.heads === 'both' ? ['interest', 'penalty'] : [v.heads];
          const r = await api.post(`/loans/${params.id}/waive`, { resolutionId: Number(v.resolutionId), heads }); reload(); bump(); return r;
        }} />
      <FormSheet visible={sheet === 'writeoff'} title={t('loan_writeOff')} onClose={() => setSheet(null)} notice={t('loan_writeOffHint')}
        fields={[
          { key: 'resolutionId', label: t('res_authorizing'), type: 'select', required: true, options: writeOffs, help: writeOffs.length ? undefined : t('res_noneUsable') },
          { key: 'reason', label: t('common_reason'), type: 'multiline', required: true },
        ]}
        onSubmit={async (v, key) => { const r = await api.post(`/loans/${params.id}/write-off`, { ...v, resolutionId: Number(v.resolutionId) }, key); reload(); bump(); return r; }} />
    </Screen>
  );
}

export function CollectRepaymentScreen() {
  const { api, t, push, groupId } = useShg();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const list = usePaged(async p => {
    if (!groupId) return { items: [], hasMore: false };
    const r = await api.get('/loans', { groupId, status: 'open', q: dq, page: p });
    return { items: r.loans, hasMore: r.total > p * r.pageSize };
  }, [groupId, dq]);
  return (
    <Screen title={t('qa_collectRepayment')} onRefresh={list.reload} refreshing={list.refreshing}>
      <GroupPicker />
      <NeedGroup>
        <SearchBar value={q} onChange={setQ} placeholder={t('loan_search')} />
        <Gate loading={list.loading} error={list.error} onRetry={list.reload} empty={!list.items.length} emptyText={t('loan_noneOpen')}>
          {list.items.map((l: any) => (
            <ListItem key={l.id} title={`${l.memberName}`} subtitle={l.applicationNumber} right={inr(l.principalOutstanding)} badge={l.status}
              onPress={() => push('repay', { loanId: l.id })} />
          ))}
          <LoadMore list={list} />
        </Gate>
      </NeedGroup>
    </Screen>
  );
}

export function RepayScreen({ params }: { params: { loanId: number } }) {
  const { api, t, replace, bump, setGroupId, groupId } = useShg();
  const { data, loading, error, reload } = useLoad(() => api.get(`/loans/${params.loanId}`), [params.loanId]);
  const d = data as any;
  React.useEffect(() => { if (d?.loan && d.loan.groupId !== groupId) setGroupId(d.loan.groupId); }, [d?.loan?.groupId]); // eslint-disable-line react-hooks/exhaustive-deps
  const banks = useBankOptions();
  const [values, setValues] = useState<Record<string, any>>({ paymentMethod: 'Cash', txnDate: isoToday(), foreclose: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { submit, busy, error: err, pending } = useSubmit();
  const q = d?.quote;
  React.useEffect(() => {
    if (q) setValues(v => ({ ...v, amount: v.amount || String(Number(q.dueNow) > 0 ? q.dueNow : q.nextInstallment?.amount || '') }));
  }, [q]);
  const fields: FieldSpec[] = [
    { key: 'foreclose', label: t('loan_foreclose'), type: 'switch', help: q ? t('loan_forecloseHelp', { amount: inr(q.total), waived: inr(q.waivedInterest) }) : undefined },
    { key: 'amount', label: t('common_amount'), type: 'money', required: true, min: 1, max: q ? Number(q.total) : undefined },
    ...paymentFields(t, values, banks),
    { key: 'notes', label: t('common_notes') },
  ];
  const onChange = (k: string, v: any) => setValues(p => ({ ...p, [k]: v, ...(k === 'foreclose' && v && q ? { amount: String(q.total) } : {}) }));
  const save = () => {
    const errs = validate(fields, values, t);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    confirm(t('loan_confirmRepay'), t('loan_confirmRepayMsg', { amount: inr(values.amount), name: d.loan.memberName }), t('common_confirm'), t('common_cancel'), async () => {
      const res = await submit(key => api.post(`/loans/${params.loanId}/repay`, {
        ...values, bankAccountId: values.bankAccountId ? Number(values.bankAccountId) : undefined,
      }, key));
      if (res) { bump(); replace('receipt', { id: res.transaction.id }); }
    });
  };
  const dueRows = (d?.schedule || []).filter((i: any) => Number(i.outstandingTotal) > 0).slice(0, 3);
  return (
    <Screen title={t('qa_collectRepayment')}>
      <Gate loading={loading} error={error} onRetry={reload}>
        {d && (
          !q ? <Notice tone="red" text={t('loan_notOpen')} /> : (
            <>
              <Card>
                <Text style={{ fontWeight: '800', fontSize: 16 }}>{d.loan.memberName} · {d.loan.applicationNumber}</Text>
                <KV label={t('loan_dueNow')} value={inr(q.dueNow)} strong color={Number(q.dueNow) > 0 ? '#B45309' : undefined} />
                {q.nextInstallment && <KV label={t('loan_nextInstallment')} value={`${fmtDate(q.nextInstallment.dueDate)} · ${inr(q.nextInstallment.amount)}`} />}
                <KV label={t('loan_outstandingPrincipal')} value={inr(q.principal)} />
                <KV label={t('loan_interestDue')} value={inr(q.interest)} />
                {Number(q.penalty) > 0 && <KV label={t('loan_penalty')} value={inr(q.penalty)} color="#B91C1C" />}
                <KV label={t('loan_payoff')} value={inr(q.total)} />
              </Card>
              {dueRows.map((i: any) => (
                <KV key={i.id} label={`#${i.number} ${fmtDate(i.dueDate)}`} value={`${t('loan_principal')} ${inr(i.outstandingPrincipal)} · ${t('loan_interest')} ${inr(i.outstandingInterest)}${Number(i.outstandingPenalty) ? ` · ${t('loan_penalty')} ${inr(i.outstandingPenalty)}` : ''}`} />
              ))}
              <Notice tone="blue" text={t('loan_allocHint')} />
              <Form fields={fields} values={values} onChange={onChange} errors={errors} />
              {!!err && <ErrorBox message={err} />}
              <Btn title={pending ? t('common_retrySame') : t('sav_saveReceipt')} onPress={save} busy={busy} />
            </>
          )
        )}
      </Gate>
    </Screen>
  );
}

export function InstallmentsScreen({ params }: { params?: any }) {
  const { api, t, push, groupId } = useShg();
  const [overdue, setOverdue] = useState<boolean>(!!params?.overdue);
  const { data, loading, error, reload, refreshing } = useLoad(() => api.get('/installments/upcoming', {
    groupId: groupId || undefined, days: 30, overdue: overdue ? 1 : undefined }), [groupId, overdue]);
  const rows = (data as any)?.installments || [];
  return (
    <Screen title={overdue ? t('loan_overdue') : t('loan_upcoming')} onRefresh={reload} refreshing={refreshing}>
      <GroupPicker allowAll />
      <Chips value={overdue ? 'o' : 'u'} onChange={v => setOverdue(v === 'o')} options={[{ value: 'u', label: t('loan_upcoming') }, { value: 'o', label: t('loan_overdue') }]} />
      <Gate loading={loading} error={error} onRetry={reload} empty={!rows.length} emptyText={t('common_noRecords')}>
        {rows.map((i: any) => {
          const total = Number(i.principalOutstanding) + Number(i.interestOutstanding) + Number(i.penaltyOutstanding);
          return (
            <ListItem key={i.id} title={`${i.memberName} · #${i.installmentNumber}`} subtitle={`${i.applicationNumber} · ${i.groupName}`}
              meta={`${fmtDate(i.dueDate)}${i.daysOverdue ? ` · ${t('loan_daysLate', { n: i.daysOverdue })}` : ''}`}
              right={inr(total)} badge={i.daysOverdue ? 'Overdue' : i.status} onPress={() => push('repay', { loanId: i.loanId })} />
          );
        })}
      </Gate>
    </Screen>
  );
}

