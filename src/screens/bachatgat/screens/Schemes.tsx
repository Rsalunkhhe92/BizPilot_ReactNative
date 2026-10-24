import React, { useState } from 'react';
import { View } from 'react-native';
import { fmtDate, inr, isoToday } from '../format';
import {
  Badge, Btn, BtnRow, Card, Chips, ErrorBox, FieldSpec, Form, FormSheet, Gate, KV, ListItem, Notice, Screen, SectionTitle,
  Stat, StatGrid, useLoad, useShg, useSubmit, validate,
} from '../ui';
import { GroupPicker, NeedGroup } from './Members';
import { useBankOptions } from './Savings';
import { TxnItem } from './Dashboard';
import { DocumentsPanel } from './Documents';

const KINDS = ['BANK_LINKAGE', 'BANK_LOAN', 'GOVT_SCHEME'];
const NEXT: Record<string, string[]> = {
  Draft: ['Submitted'], Submitted: ['Under Verification', 'Rejected'], 'Under Verification': ['Approved', 'Rejected'],
  Approved: ['Closed'], Disbursed: ['Closed'], Rejected: [], Closed: [],
};

export function SchemesScreen() {
  const { api, t, push, groupId } = useShg();
  const [kind, setKind] = useState('');
  const { data, loading, error, reload, refreshing } = useLoad(() => groupId ? api.get('/schemes', { groupId, kind: kind || undefined }) : Promise.resolve(null), [groupId, kind]);
  const list = (data as any)?.schemes || [];
  return (
    <Screen title={t('nav_schemes')} onRefresh={reload} refreshing={refreshing}
      right={groupId ? <Btn small title={`+ ${t('sch_new')}`} onPress={() => push('schemeForm')} /> : undefined}>
      <GroupPicker />
      <NeedGroup>
        <Notice tone="blue" text={t('sch_disclaimer')} />
        <Chips value={kind} onChange={setKind} options={[{ value: '', label: t('common_all') }, ...KINDS.map(k => ({ value: k, label: t(`sch_${k}` as any) }))]} />
        <Gate loading={loading} error={error} onRetry={reload} empty={!list.length} emptyText={t('sch_none')}>
          {list.map((s: any) => (
            <ListItem key={s.id} title={s.schemeName} subtitle={`${t(`sch_${s.applicationKind}` as any)}${s.applicationNumber ? ` · ${s.applicationNumber}` : ''}`}
              meta={`${t('sch_received')} ${inr(s.amountReceived)} · ${t('sch_utilized')} ${inr(s.amountUtilized)}`}
              right={s.amountSanctioned ? inr(s.amountSanctioned) : s.amountRequested ? inr(s.amountRequested) : ''} badge={s.status}
              onPress={() => push('schemeDetail', { id: s.id })} />
          ))}
        </Gate>
      </NeedGroup>
    </Screen>
  );
}

function schemeFields(t: any, banks: any[], editing: boolean): FieldSpec[] {
  return [
    { key: 'applicationKind', label: t('common_type'), type: 'select', required: true, hidden: editing, options: KINDS.map(k => ({ value: k, label: t(`sch_${k}` as any) })) },
    { key: 'schemeName', label: t('sch_name'), required: true },
    { key: 'authority', label: t('sch_authority') },
    { key: 'bankAccountId', label: t('bank_account'), type: 'select', options: banks, hidden: editing },
    { key: 'applicationNumber', label: t('sch_applicationNo') },
    { key: 'referenceNumber', label: t('common_reference') },
    { key: 'appliedOn', label: t('sch_appliedOn'), type: 'date' },
    { key: 'amountRequested', label: t('sch_amountRequested'), type: 'money' },
    { key: 'requiredDocuments', label: t('sch_requiredDocs'), type: 'multiline' },
    { key: 'reportingRequirements', label: t('sch_reporting'), type: 'multiline' },
    { key: 'remarks', label: t('common_remarks'), type: 'multiline' },
  ];
}

export function SchemeFormScreen({ params }: { params?: any }) {
  const { api, t, groupId, replace, bump } = useShg();
  const banks = useBankOptions();
  const editing = params?.scheme;
  const fields = schemeFields(t, banks, !!editing);
  const [values, setValues] = useState<Record<string, any>>(editing ? { ...editing } : { applicationKind: 'GOVT_SCHEME', appliedOn: isoToday() });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { submit, busy, error } = useSubmit();
  const save = async () => {
    const errs = validate(fields, values, t);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const payload = { ...values, groupId, bankAccountId: values.bankAccountId ? Number(values.bankAccountId) : undefined };
    const r = await submit(() => editing ? api.put(`/schemes/${editing.id}`, payload) : api.post('/schemes', payload));
    if (r) { bump(); replace('schemeDetail', { id: r.scheme.id }); }
  };
  return (
    <Screen title={editing ? t('common_edit') : t('sch_new')}>
      {!editing && <GroupPicker />}
      <NeedGroup>
        <Form fields={fields} values={values} onChange={(k, v) => setValues(p => ({ ...p, [k]: v }))} errors={errors} />
        {!!error && <ErrorBox message={error} />}
        <Btn title={t('common_save')} onPress={save} busy={busy} />
      </NeedGroup>
    </Screen>
  );
}

export function SchemeDetailScreen({ params }: { params: { id: number } }) {
  const { api, t, st, push, bump } = useShg();
  const { data, loading, error, reload, refreshing } = useLoad(() => api.get(`/schemes/${params.id}`), [params.id]);
  const banks = useBankOptions();
  const [sheet, setSheet] = useState<string | null>(null);
  const [nextStatus, setNextStatus] = useState('');
  const d = data as any;
  const s = d?.scheme;
  const expenseTxns = useLoad(() => s ? api.get('/transactions', { groupId: s.groupId, type: 'OPERATING_EXPENSE', pageSize: 50 }) : Promise.resolve(null), [s?.groupId]);
  return (
    <Screen title={s?.schemeName || t('nav_schemes')} subtitle={s ? `${t(`sch_${s.applicationKind}` as any)} · ${st(s.status)}` : undefined} onRefresh={reload} refreshing={refreshing}
      right={s && !['Closed', 'Rejected'].includes(s.status) ? <Btn small kind="ghost" title={t('common_edit')} onPress={() => push('schemeForm', { scheme: s })} /> : undefined}>
      <Gate loading={loading && !d} error={error} onRetry={reload}>
        {s && (
          <>
            <StatGrid>
              <Stat label={t('sch_amountRequested')} value={s.amountRequested ? inr(s.amountRequested) : '-'} />
              <Stat label={t('sch_sanctioned')} value={s.amountSanctioned ? inr(s.amountSanctioned) : '-'} tone="green" />
              <Stat label={t('sch_received')} value={inr(s.amountReceived)} tone="blue" />
              <Stat label={t('sch_utilized')} value={inr(s.amountUtilized)} tone="amber" />
            </StatGrid>
            <Card>
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: 6 }}><Badge value={s.status} /><Badge value={s.verificationStatus} /></View>
              <KV label={t('sch_authority')} value={s.authority || '-'} />
              <KV label={t('sch_applicationNo')} value={s.applicationNumber || '-'} />
              <KV label={t('common_reference')} value={s.referenceNumber || '-'} />
              <KV label={t('sch_appliedOn')} value={fmtDate(s.appliedOn)} />
              {!!s.requiredDocuments && <KV label={t('sch_requiredDocs')} value={s.requiredDocuments} />}
              {!!s.reportingRequirements && <KV label={t('sch_reporting')} value={s.reportingRequirements} />}
              {!!s.remarks && <KV label={t('common_remarks')} value={s.remarks} />}
            </Card>
            <SectionTitle>{t('grp_workflow')}</SectionTitle>
            <BtnRow>
              {(NEXT[s.status] || []).map(n => (
                <Btn key={n} small kind={n === 'Rejected' ? 'danger' : 'primary'} title={st(n)} onPress={() => { setNextStatus(n); setSheet('status'); }} />
              ))}
              {['Approved', 'Disbursed'].includes(s.status) && <Btn small title={t('sch_recordFunds')} onPress={() => setSheet('funds')} />}
              {Number(s.amountReceived) > Number(s.amountUtilized) && <Btn small kind="secondary" title={t('sch_addUtilization')} onPress={() => setSheet('util')} />}
            </BtnRow>
            {s.applicationKind !== 'GOVT_SCHEME' && Number(s.amountReceived) > 0 && (
              <Btn small kind="ghost" title={t('txn_BANK_LOAN_REPAYMENT')} onPress={() => push('txnForm', { txnType: 'BANK_LOAN_REPAYMENT' })} />
            )}
            <SectionTitle>{t('sch_utilizations')}</SectionTitle>
            {d.utilizations.length ? d.utilizations.map((u: any) => (
              <ListItem key={u.id} title={u.purpose} subtitle={fmtDate(u.utilizationDate)} right={inr(u.amount)} />
            )) : <Notice text={t('common_noRecords')} />}
            <SectionTitle>{t('tab_transactions')}</SectionTitle>
            {d.transactions.map((x: any) => <TxnItem key={x.id} txn={x} onPress={() => push('receipt', { id: x.id })} />)}
            <DocumentsPanel entityType="SCHEME" entityId={s.id} canUpload={s.status !== 'Closed'} />
            <SectionTitle>{t('tab_history')}</SectionTitle>
            {d.history.map((h: any, i: number) => (
              <ListItem key={i} title={h.action.replace(/_/g, ' ')} subtitle={h.fromStatus || h.toStatus ? `${h.fromStatus || '—'} → ${h.toStatus || '—'}` : undefined}
                meta={`${fmtDate(h.createdAt)}${h.details?.remarks ? ` · ${h.details.remarks}` : ''}`} />
            ))}
          </>
        )}
      </Gate>
      <FormSheet visible={sheet === 'status'} title={st(nextStatus)} onClose={() => setSheet(null)}
        fields={[
          { key: 'amountSanctioned', label: t('sch_sanctioned'), type: 'money', hidden: nextStatus !== 'Approved' },
          { key: 'referenceNumber', label: t('common_reference') },
          { key: 'remarks', label: t('common_remarks'), type: 'multiline', required: nextStatus === 'Rejected' },
        ]}
        onSubmit={async v => { const r = await api.post(`/schemes/${params.id}/status`, { ...v, status: nextStatus }); reload(); bump(); return r; }} />
      <FormSheet visible={sheet === 'funds'} title={t('sch_recordFunds')} onClose={() => setSheet(null)} notice={t('sch_fundsHint')}
        initial={{ txnDate: isoToday(), paymentMethod: 'Bank Transfer' }}
        fields={[
          { key: 'amount', label: t('common_amount'), type: 'money', required: true },
          { key: 'paymentMethod', label: t('common_paymentMethod'), type: 'select', options: ['Bank Transfer', 'Cheque', 'Cash'].map(x => ({ value: x, label: x })) },
          { key: 'bankAccountId', label: t('bank_account'), type: 'select', options: banks },
          { key: 'referenceNumber', label: t('common_reference') },
          { key: 'txnDate', label: t('common_date'), type: 'date', required: true },
        ]}
        onSubmit={async (v, key) => { const r = await api.post(`/schemes/${params.id}/disbursements`, { ...v, bankAccountId: v.bankAccountId ? Number(v.bankAccountId) : undefined }, key); reload(); bump(); return r; }} />
      <FormSheet visible={sheet === 'util'} title={t('sch_addUtilization')} onClose={() => setSheet(null)} initial={{ utilizationDate: isoToday() }}
        fields={[
          { key: 'amount', label: t('common_amount'), type: 'money', required: true, max: s ? Number(s.amountReceived) - Number(s.amountUtilized) : undefined },
          { key: 'purpose', label: t('sch_purpose'), required: true },
          { key: 'utilizationDate', label: t('common_date'), type: 'date', required: true },
          { key: 'txnId', label: t('sch_linkExpense'), type: 'select',
            options: (((expenseTxns.data as any)?.transactions) || []).map((x: any) => ({ value: String(x.id), label: `${x.txnNumber} · ${inr(x.amount)} · ${x.narration || ''}` })) },
        ]}
        onSubmit={async v => { const r = await api.post(`/schemes/${params.id}/utilizations`, { ...v, txnId: v.txnId ? Number(v.txnId) : undefined }); reload(); return r; }} />
    </Screen>
  );
}
