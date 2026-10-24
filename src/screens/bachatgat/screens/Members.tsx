import React, { useState } from 'react';
import { Alert, Image, Text, View } from 'react-native';
import { fmtDate, inr, isoToday } from '../format';
import {
  Badge, Btn, BtnRow, Card, Chips, Empty, ErrorBox, FieldSpec, Form, FormSheet, Gate, KV, ListItem, Notice, Screen, SearchBar,
  SectionTitle, SelectInput, Stat, StatGrid, LoadMore, confirm, errorText, useDebounced, useLoad, usePaged, useShg, useSubmit, validate,
} from '../ui';
import { DocumentsPanel } from './Documents';
import { TxnItem } from './Dashboard';
import { MemberOnlineActions } from './Online';

/** Current-group switcher shown at the top of group-scoped screens. */
export function GroupPicker({ allowAll }: { allowAll?: boolean }) {
  const { groups, groupId, setGroupId, t, c } = useShg();
  const options = [
    ...(allowAll ? [{ value: '', label: t('dash_allGroups') }] : []),
    ...groups.map(g => ({ value: String(g.id), label: `${g.nameEn} (${g.groupCode})` })),
  ];
  if (!groups.length) return <Notice text={t('grp_noneYet')} />;
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ color: c.muted, fontSize: 12, fontWeight: '700', marginBottom: 4 }}>{t('common_group')}</Text>
      <SelectInput value={groupId ? String(groupId) : ''} onChange={v => setGroupId(v ? Number(v) : null)} options={options} label={t('common_group')} />
    </View>
  );
}

/** Renders children only once a group is selected. */
export function NeedGroup({ children }: { children: React.ReactNode }) {
  const { groupId, t } = useShg();
  return <>{groupId ? children : <Empty text={t('grp_pickFirst')} />}</>;
}

const MEMBER_STATUSES = ['', 'Pending', 'Active', 'Suspended', 'Exited', 'Rejected'];

export function MembersScreen({ params }: { params?: any }) {
  const { api, t, st, push, groupId, has } = useShg();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [status, setStatus] = useState<string>(params?.status || '');
  const list = usePaged(async p => {
    const r = await api.get('/members', { groupId: groupId || undefined, q: dq, status, page: p });
    return { items: r.members, hasMore: r.total > p * r.pageSize };
  }, [groupId, dq, status]);
  return (
    <Screen title={t('nav_members')} noBack={!params?.status} onRefresh={list.reload} refreshing={list.refreshing}
      right={has('shg_members') ? <Btn small title={`+ ${t('qa_addMember')}`} onPress={() => push('memberForm', { groupId })} /> : undefined}>
      <GroupPicker allowAll />
      <SearchBar value={q} onChange={setQ} placeholder={t('mem_search')} />
      <Chips value={status} onChange={setStatus} options={MEMBER_STATUSES.map(x => ({ value: x, label: x ? st(x) : t('common_all') }))} />
      <View style={{ height: 8 }} />
      <Gate loading={list.loading} error={list.error} onRetry={list.reload} empty={!list.items.length} emptyText={t('mem_none')}>
        {list.items.map((m: any) => (
          <ListItem key={m.id} title={`#${m.memberNumber} ${m.fullName}`}
            subtitle={`${t(`role_${m.role}` as any)} · ${m.groupName}`}
            meta={Number(m.pendingDues) > 0 ? `${t('sav_pending')} ${inr(m.pendingDues)}` : m.mobile}
            right={inr(m.savingsBalance)} badge={m.status} onPress={() => push('memberDetail', { id: m.id })} />
        ))}
        <LoadMore list={list} />
      </Gate>
    </Screen>
  );
}

function memberFields(t: any, groups: any[], editing: boolean): FieldSpec[] {
  return [
    { key: 'groupId', label: t('common_group'), type: 'select', required: true, hidden: editing,
      options: groups.filter(g => !['Closed', 'Suspended'].includes(g.status)).map(g => ({ value: String(g.id), label: `${g.nameEn} (${g.groupCode})` })) },
    { key: 'fullName', label: t('mem_fullName'), required: true, maxLength: 150 },
    { key: 'mobile', label: t('common_mobile'), type: 'phone', required: true },
    { key: 'dateOfBirth', label: t('mem_dob'), type: 'date' },
    { key: 'joiningDate', label: t('mem_joiningDate'), type: 'date', required: true },
    { key: 'address', label: t('grp_address'), type: 'multiline' },
    { key: 'occupation', label: t('mem_occupation') },
    { key: 'livelihoodActivity', label: t('grp_livelihood') },
    { key: 'nomineeName', label: t('mem_nomineeName') },
    { key: 'nomineeRelation', label: t('mem_nomineeRelation') },
    { key: 'nomineeMobile', label: t('mem_nomineeMobile'), type: 'phone' },
    { key: 'idProofType', label: t('mem_idProofType'), type: 'select',
      options: ['Aadhaar', 'Voter ID', 'PAN', 'Ration Card', 'Job Card', 'Other'].map(x => ({ value: x, label: x })) },
    { key: 'idProofNumber', label: t('mem_idProofNumber'), help: t('mem_idProofHelp'), maxLength: 20 },
  ];
}

export function MemberFormScreen({ params }: { params?: any }) {
  const { api, t, groups, replace, bump } = useShg();
  const editing = params?.member;
  const fields = memberFields(t, groups, !!editing);
  const [values, setValues] = useState<Record<string, any>>(editing ? { ...editing, idProofNumber: '' } : {
    groupId: params?.groupId ? String(params.groupId) : groups.length === 1 ? String(groups[0].id) : '', joiningDate: isoToday(),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { submit, busy, error } = useSubmit();
  const save = async () => {
    const errs = validate(fields, values, t);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const payload: Record<string, any> = { ...values, groupId: Number(values.groupId) };
    if (!payload.idProofNumber) delete payload.idProofNumber;
    const res = await submit(() => editing ? api.put(`/members/${editing.id}`, payload) : api.post('/members', payload));
    if (res) { bump(); replace('memberDetail', { id: res.member.id }); }
  };
  return (
    <Screen title={editing ? t('mem_edit') : t('qa_addMember')}>
      {!editing && <Notice tone="blue" text={t('mem_workflowHint')} />}
      <Form fields={fields} values={values} onChange={(k, v) => setValues(p => ({ ...p, [k]: v }))} errors={errors} />
      {!!error && <ErrorBox message={error} />}
      <Btn title={t('common_save')} onPress={save} busy={busy} />
    </Screen>
  );
}

type MemberTab = 'profile' | 'savings' | 'loans' | 'repayments' | 'attendance' | 'transactions' | 'documents';

export function MemberDetailScreen({ params }: { params: { id: number } }) {
  const { api, t, st, push, bump, c, has } = useShg();
  const [tab, setTab] = useState<MemberTab>('profile');
  const { data, loading, error, reload, refreshing } = useLoad(() => api.get(`/members/${params.id}`), [params.id]);
  const [action, setAction] = useState<string | null>(null);
  const [showRole, setShowRole] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const d = data as any;
  const m = d?.member;

  React.useEffect(() => {
    if (!m?.photoDocumentId) { setPhoto(null); return; }
    api.get(`/documents/${m.photoDocumentId}/content`).then(r => setPhoto(`data:${r.mimeType};base64,${r.fileBase64}`)).catch(() => setPhoto(null));
  }, [m?.photoDocumentId, api]);

  const acts: { key: string; label: string; kind?: 'danger' | 'secondary' }[] = [];
  if (m) {
    if (m.idVerificationStatus === 'Pending') acts.push({ key: 'verify', label: t('mem_verify') }, { key: 'waive_verification', label: t('mem_waiveVerification'), kind: 'secondary' },
      { key: 'reject_verification', label: t('mem_rejectVerification'), kind: 'danger' });
    if (m.status === 'Pending') acts.push({ key: 'approve', label: t('mem_approve') }, { key: 'reject', label: t('mem_reject'), kind: 'danger' });
    if (m.status === 'Active') acts.push({ key: 'suspend', label: t('mem_suspend'), kind: 'danger' });
    if (m.status === 'Suspended') acts.push({ key: 'reactivate', label: t('mem_reactivate') });
  }
  const needsRemarks = (k: string) => ['reject', 'suspend', 'reject_verification', 'waive_verification'].includes(k);

  return (
    <Screen title={m ? m.fullName : t('nav_members')} subtitle={m ? `#${m.memberNumber} · ${m.groupName}` : undefined} onRefresh={reload} refreshing={refreshing}
      right={m && !['Exited', 'Rejected'].includes(m.status) ? <Btn small kind="ghost" title={t('common_edit')} onPress={() => push('memberForm', { member: m })} /> : undefined}>
      <Gate loading={loading && !d} error={error} onRetry={reload}>
        {m && (
          <>
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {photo ? <Image source={{ uri: photo }} style={{ width: 64, height: 64, borderRadius: 32 }} accessibilityLabel={m.fullName} />
                : <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.brandBg, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 26, color: c.brandText, fontWeight: '800' }}>{m.fullName.charAt(0)}</Text></View>}
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontWeight: '800', fontSize: 16 }}>{m.fullName}</Text>
                <Text style={{ color: c.muted }}>{t(`role_${m.role}` as any)} · {m.mobile}</Text>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}><Badge value={m.status} /><Badge value={m.idVerificationStatus} label={`KYC: ${st(m.idVerificationStatus)}`} /></View>
              </View>
            </Card>
            <Chips<MemberTab> value={tab} onChange={setTab} options={[
              { value: 'profile', label: t('tab_profile') }, { value: 'savings', label: t('nav_savings') }, { value: 'loans', label: t('nav_loans') },
              { value: 'repayments', label: t('tab_repayments') }, { value: 'attendance', label: t('tab_attendance') },
              { value: 'transactions', label: t('tab_transactions') }, { value: 'documents', label: t('doc_title') },
            ]} />
            <View style={{ height: 10 }} />
            {tab === 'profile' && (
              <>
                <StatGrid>
                  <Stat label={t('mem_savingsBalance')} value={inr(d.summary.savingsBalance)} tone="green" />
                  <Stat label={t('sav_pending')} value={inr(d.summary.pendingDues)} tone={Number(d.summary.pendingDues) ? 'amber' : 'green'} />
                  <Stat label={t('loan_outstanding')} value={inr(d.summary.loanOutstanding)} />
                  <Stat label={t('tab_attendance')} value={`${d.summary.meetingsPresent}/${d.summary.meetingsTotal}`} tone="blue" />
                </StatGrid>
                <Card>
                  <KV label={t('mem_joiningDate')} value={fmtDate(m.joiningDate)} />
                  <KV label={t('mem_dob')} value={fmtDate(m.dateOfBirth)} />
                  <KV label={t('grp_address')} value={m.address || '-'} />
                  <KV label={t('mem_occupation')} value={[m.occupation, m.livelihoodActivity].filter(Boolean).join(' · ') || '-'} />
                  <KV label={t('mem_nominee')} value={m.nomineeName ? `${m.nomineeName} (${m.nomineeRelation || '-'}) ${m.nomineeMobile || ''}` : '-'} />
                  <KV label={t('mem_idProofType')} value={m.idProofType ? `${m.idProofType} ••${m.idProofLast4 || ''}` : '-'} />
                  {m.exitDate && <KV label={t('mem_exitDate')} value={`${fmtDate(m.exitDate)} · ${m.exitReason || ''}`} />}
                </Card>
                {m.status === 'Pending' && <Notice text={t('mem_pendingHint')} />}
                {m.idVerificationStatus === 'Pending' && !m.idProofType && <Notice text={t('mem_needIdProof')} />}
                <BtnRow>
                  {acts.map(a => <Btn key={a.key} small kind={a.kind || 'primary'} title={a.label}
                    onPress={() => a.key === 'verify' && !m.idProofType ? push('memberForm', { member: m })
                      : needsRemarks(a.key) ? setAction(a.key)
                      : confirm(a.label, m.fullName, a.label, t('common_cancel'), async () => {
                        try { await api.post(`/members/${m.id}/workflow`, { action: a.key }); reload(); bump(); } catch (e: any) { setAction(null); alertErr(e, t); }
                      })} />)}
                  {m.status === 'Active' && <Btn small kind="secondary" title={t('mem_assignRole')} onPress={() => setShowRole(true)} />}
                </BtnRow>
                {m.status === 'Active' && (
                  <BtnRow>
                    <Btn small kind="secondary" title={t('qa_collectSavings')} onPress={() => push('collectSavings', { memberId: m.id })} />
                    <Btn small kind="secondary" title={t('qa_applyLoan')} onPress={() => push('loanForm', { memberId: m.id })} />
                    <Btn small kind="ghost" title={t('mem_exit')} onPress={() => push('memberExit', { id: m.id })} />
                  </BtnRow>
                )}
                {m.status === 'Active' && has('shg_savings') && <MemberOnlineActions member={m} />}
                <SectionTitle>{t('tab_history')}</SectionTitle>
                {d.history.map((e: any) => (
                  <ListItem key={e.id} title={e.action.replace(/_/g, ' ')} subtitle={e.fromStatus || e.toStatus ? `${e.fromStatus || '—'} → ${e.toStatus || '—'}` : undefined}
                    meta={`${fmtDate(e.createdAt)}${e.details?.remarks ? ` · ${e.details.remarks}` : ''}`} />
                ))}
              </>
            )}
            {tab === 'savings' && <MemberSavings memberId={m.id} />}
            {tab === 'loans' && <MemberLoans memberId={m.id} />}
            {tab === 'repayments' && <MemberTxns memberId={m.id} kind="repayments" />}
            {tab === 'transactions' && <MemberTxns memberId={m.id} kind="all" />}
            {tab === 'attendance' && <MemberAttendance memberId={m.id} />}
            {tab === 'documents' && <DocumentsPanel entityType="MEMBER" entityId={m.id} canUpload={!['Exited', 'Rejected'].includes(m.status)} onPhoto={reload} />}
          </>
        )}
      </Gate>
      <FormSheet
        visible={!!action}
        title={acts.find(a => a.key === action)?.label || ''}
        fields={[{ key: 'remarks', label: t('common_remarks'), type: 'multiline', required: true }]}
        onClose={() => setAction(null)}
        onSubmit={async v => { const r = await api.post(`/members/${params.id}/workflow`, { action, ...v }); reload(); bump(); return r; }}
      />
      <FormSheet
        visible={showRole}
        title={t('mem_assignRole')}
        initial={{ role: m?.role }}
        notice={t('mem_roleHint')}
        fields={[{ key: 'role', label: t('mem_role'), type: 'select', required: true,
          options: ['President', 'Secretary', 'Treasurer', 'Member'].map(r => ({ value: r, label: t(`role_${r}` as any) })) }]}
        onClose={() => setShowRole(false)}
        onSubmit={async v => { const r = await api.post(`/members/${params.id}/role`, v); reload(); bump(); return r; }}
      />
    </Screen>
  );
}

function alertErr(e: unknown, t: any) { Alert.alert(t('common_error'), errorText(t, e)); }

function MemberSavings({ memberId }: { memberId: number }) {
  const { api, t, push } = useShg();
  const dues = useLoad(() => api.get('/savings/member-due', { memberId }), [memberId]);
  const ledger = useLoad(() => api.get('/savings/ledger', { memberId }), [memberId]);
  const dd = dues.data as any;
  return (
    <>
      <Gate loading={dues.loading} error={dues.error} onRetry={dues.reload}>
        {dd && (
          <Card>
            <KV label={t('mem_savingsBalance')} value={inr(dd.savingsBalance)} strong />
            <KV label={t('sav_dueNow')} value={inr(dd.dueNow)} />
            <KV label={t('sav_standard')} value={inr(dd.standardAmount)} />
            {dd.openDues.slice(0, 6).map((x: any) => (
              <KV key={x.id} label={`${fmtDate(x.periodStart)} (${t('sav_due')} ${fmtDate(x.dueDate)})`} value={`${inr(x.balance)} · ${x.status}`} />
            ))}
          </Card>
        )}
      </Gate>
      <SectionTitle>{t('sav_ledger')}</SectionTitle>
      <Gate loading={ledger.loading} error={ledger.error} onRetry={ledger.reload} empty={!(ledger.data as any)?.ledger?.length} emptyText={t('common_noRecords')}>
        {((ledger.data as any)?.ledger || []).map((r: any, i: number) => (
          <ListItem key={i} title={`${Number(r.deposit) ? '+' + inr(r.deposit) : '−' + inr(r.withdrawal)}`} subtitle={`${fmtDate(r.txnDate)} · ${r.receiptNumber || r.txnNumber}`}
            right={inr(r.runningBalance)} badge={r.postingStatus === 'Reversed' ? 'Reversed' : null} />
        ))}
      </Gate>
      <Btn kind="secondary" title={t('report_memberSavings')} onPress={() => push('reportView', { key: 'member_savings', memberId })} />
    </>
  );
}

function MemberLoans({ memberId }: { memberId: number }) {
  const { api, t, push } = useShg();
  const { data, loading, error, reload } = useLoad(() => api.get('/loans', { memberId, pageSize: 50 }), [memberId]);
  const list = (data as any)?.loans || [];
  return (
    <Gate loading={loading} error={error} onRetry={reload} empty={!list.length} emptyText={t('loan_none')}>
      {list.map((l: any) => (
        <ListItem key={l.id} title={l.applicationNumber} subtitle={`${l.purpose} · ${fmtDate(l.applicationDate)}`}
          meta={`${t('loan_outstanding')} ${inr(l.principalOutstanding)}`} right={inr(l.approvedAmount || l.requestedAmount)} badge={l.status}
          onPress={() => push('loanDetail', { id: l.id })} />
      ))}
    </Gate>
  );
}

function MemberTxns({ memberId, kind }: { memberId: number; kind: 'repayments' | 'all' }) {
  const { api, t, push } = useShg();
  const { data, loading, error, reload } = useLoad(() => api.get(`/members/${memberId}/transactions`, { kind }), [memberId, kind]);
  const list = (data as any)?.transactions || [];
  return (
    <Gate loading={loading} error={error} onRetry={reload} empty={!list.length} emptyText={t('common_noRecords')}>
      {list.map((x: any) => <TxnItem key={x.id} txn={x} onPress={() => push('receipt', { id: x.id })} />)}
    </Gate>
  );
}

function MemberAttendance({ memberId }: { memberId: number }) {
  const { api, t, push } = useShg();
  const { data, loading, error, reload } = useLoad(() => api.get(`/members/${memberId}/attendance`), [memberId]);
  const list = (data as any)?.attendance || [];
  return (
    <Gate loading={loading} error={error} onRetry={reload} empty={!list.length} emptyText={t('common_noRecords')}>
      {list.map((a: any) => (
        <ListItem key={a.meetingId} title={`${t('mtg_meeting')} #${a.meetingNumber}`} subtitle={fmtDate(a.meetingDate)}
          right={a.present ? t('mtg_present') : t('mtg_absent')} badge={a.present ? 'Passed' : 'Failed'}
          onPress={() => push('meetingDetail', { id: a.meetingId })} />
      ))}
    </Gate>
  );
}

export function MemberExitScreen({ params }: { params: { id: number } }) {
  const { api, t, back, bump } = useShg();
  const { data, loading, error, reload } = useLoad(() => api.get(`/members/${params.id}/settlement`), [params.id]);
  const [values, setValues] = useState<Record<string, any>>({ exitDate: isoToday(), paymentMethod: 'Cash' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { submit, busy, error: err, pending } = useSubmit();
  const q = (data as any)?.settlement;
  const fields: FieldSpec[] = [
    { key: 'reason', label: t('mem_exitReason'), type: 'multiline', required: true },
    { key: 'exitDate', label: t('mem_exitDate'), type: 'date', required: true },
    { key: 'paymentMethod', label: t('common_paymentMethod'), type: 'select', options: ['Cash', 'Bank Transfer', 'UPI', 'Cheque'].map(x => ({ value: x, label: x })) },
    { key: 'referenceNumber', label: t('common_reference') },
  ];
  const go = async () => {
    const errs = validate(fields, values, t);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    confirm(t('mem_exit'), t('mem_exitConfirm'), t('mem_exit'), t('common_cancel'), async () => {
      const res = await submit(key => api.post(`/members/${params.id}/exit`, values, key));
      if (res) { bump(); back(); }
    }, true);
  };
  return (
    <Screen title={t('mem_exit')}>
      <Gate loading={loading} error={error} onRetry={reload}>
        {q && (
          <>
            <Card>
              <KV label={t('mem_savingsBalance')} value={inr(q.savingsBalance)} />
              <KV label={t('mem_loanDues')} value={inr(q.loanDues)} />
              <KV label={t('mem_netRefund')} value={inr(q.netPayable)} strong />
              {q.loans.map((l: any) => <KV key={l.loanId} label={l.applicationNumber} value={l.pendingApplication ? l.status : inr(l.total)} />)}
            </Card>
            {!q.canSettleFromSavings && <Notice tone="red" text={t('mem_exitShortfall')} />}
            <Notice text={t('mem_exitHint')} />
            <Form fields={fields} values={values} onChange={(k, v) => setValues(p => ({ ...p, [k]: v }))} errors={errors} />
            {!!err && <ErrorBox message={err} />}
            <Btn kind="danger" title={pending ? t('common_retrySame') : t('mem_exitConfirmBtn')} onPress={go} busy={busy} disabled={!q.canSettleFromSavings} />
          </>
        )}
      </Gate>
    </Screen>
  );
}

