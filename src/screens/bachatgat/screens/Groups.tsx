import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { fmtDate, inr, isoToday } from '../format';
import {
  Badge, Btn, BtnRow, Card, Chips, ErrorBox, FieldSpec, Form, FormSheet, Gate, KV, ListItem, Notice, Screen, SearchBar,
  SectionTitle, Stat, StatGrid, LoadMore, useDebounced, useLoad, usePaged, useShg, useSubmit, validate,
} from '../ui';
import { DocumentsPanel } from './Documents';
import { OnlinePaymentsCard } from './Online';

const STATUSES = ['', 'Draft', 'Pending Approval', 'Active', 'Suspended', 'Closed'];

export function GroupsScreen({ params }: { params?: any }) {
  const { api, t, st, push, setGroupId, groupId, has } = useShg();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>(params?.status || '');
  const dq = useDebounced(q);
  const list = usePaged(async p => {
    const r = await api.get('/groups', { q: dq, status, page: p, pageSize: 30 });
    return { items: r.groups, hasMore: r.total > p * r.pageSize };
  }, [dq, status]);
  return (
    <Screen title={t('nav_groups')} noBack={!params?.status} onRefresh={list.reload} refreshing={list.refreshing}
      right={has('shg_groups') ? <Btn small title={`+ ${t('grp_new')}`} onPress={() => push('groupForm')} /> : undefined}>
      <SearchBar value={q} onChange={setQ} placeholder={t('grp_search')} />
      <Chips value={status} onChange={setStatus} options={STATUSES.map(x => ({ value: x, label: x ? st(x) : t('common_all') }))} />
      <View style={{ height: 8 }} />
      <Gate loading={list.loading} error={list.error} onRetry={list.reload} empty={!list.items.length} emptyText={t('grp_none')}>
        {list.items.map((g: any) => (
          <ListItem
            key={g.id}
            title={`${g.id === groupId ? '★ ' : ''}${g.nameEn}`}
            subtitle={[g.nameMr, g.village, g.taluka].filter(Boolean).join(' · ')}
            meta={`${g.groupCode} · ${t('grp_members', { n: g.activeMembers })}${g.pendingMembers ? ` (+${g.pendingMembers})` : ''} · ${t('dash_savingsLiability')} ${inr(g.savingsBalance)}`}
            badge={g.status}
            onPress={() => { setGroupId(g.id); push('groupDetail', { id: g.id }); }}
          />
        ))}
        <LoadMore list={list} />
      </Gate>
    </Screen>
  );
}

export function groupFields(t: any, editing = false): FieldSpec[] {
  const freq = [{ value: 'MONTHLY', label: t('freq_MONTHLY') }, { value: 'FORTNIGHTLY', label: t('freq_FORTNIGHTLY') }, { value: 'WEEKLY', label: t('freq_WEEKLY') }];
  return [
    { key: 'nameEn', label: t('grp_nameEn'), required: true, maxLength: 150 },
    { key: 'nameMr', label: t('grp_nameMr'), maxLength: 150 },
    { key: 'groupCode', label: t('grp_code'), help: t('grp_codeHelp'), maxLength: 30, hidden: editing },
    { key: 'formationDate', label: t('grp_formationDate'), type: 'date', required: true },
    { key: 'category', label: t('grp_category'), type: 'select', options: ['General', 'SC', 'ST', 'OBC', 'Minority', 'Mixed', 'Other'].map(x => ({ value: x, label: x })) },
    { key: 'livelihoodActivity', label: t('grp_livelihood') },
    { key: 'meetingFrequency', label: t('grp_meetingFrequency'), type: 'select', options: freq },
    { key: 'registrationNumber', label: t('grp_regNo') },
    { key: 'registrationAuthority', label: t('grp_regAuthority') },
    { key: 'state', label: t('grp_state') },
    { key: 'district', label: t('grp_district') },
    { key: 'taluka', label: t('grp_taluka') },
    { key: 'village', label: t('grp_village') },
    { key: 'gramPanchayat', label: t('grp_gramPanchayat') },
    { key: 'address', label: t('grp_address'), type: 'multiline' },
  ];
}

export function GroupFormScreen({ params }: { params?: any }) {
  const { api, t, replace, reloadGroups, setGroupId, bump } = useShg();
  const editing = params?.group;
  const fields = groupFields(t, !!editing);
  const bankFields: FieldSpec[] = editing ? [] : [
    { key: 'bankName', label: t('bank_name') },
    { key: 'branch', label: t('bank_branch') },
    { key: 'accountNumber', label: t('bank_accountNumber'), type: 'number', maxLength: 20 },
    { key: 'ifsc', label: t('bank_ifsc'), maxLength: 11 },
  ];
  const policyFields: FieldSpec[] = editing ? [] : [
    { key: 'savingsAmount', label: t('pol_savingsAmount'), type: 'money', required: true },
    { key: 'savingsFrequency', label: t('pol_savingsFrequency'), type: 'select', options: [
      { value: 'MONTHLY', label: t('freq_MONTHLY') }, { value: 'FORTNIGHTLY', label: t('freq_FORTNIGHTLY') }, { value: 'WEEKLY', label: t('freq_WEEKLY') }] },
    { key: 'minMembers', label: t('pol_minMembers'), type: 'number', min: 1, max: 100 },
  ];
  const [values, setValues] = useState<Record<string, any>>(editing ? { ...editing } : {
    formationDate: isoToday(), category: 'General', meetingFrequency: 'MONTHLY', savingsAmount: '100', savingsFrequency: 'MONTHLY', minMembers: '10',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { submit, busy, error } = useSubmit();
  const all = [...fields, ...bankFields, ...policyFields];
  const save = async () => {
    const errs = validate(all, values, t);
    if (values.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(values.ifsc)) errs.ifsc = t('val_ifsc');
    if (values.accountNumber && !values.bankName) errs.bankName = t('val_required');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const payload: any = { ...values, ifsc: values.ifsc?.toUpperCase() };
    if (!editing) payload.policy = { savingsAmount: values.savingsAmount, savingsFrequency: values.savingsFrequency, minMembers: values.minMembers };
    const res = await submit(() => editing ? api.put(`/groups/${editing.id}`, payload) : api.post('/groups', payload));
    if (res) {
      await reloadGroups();
      bump();
      setGroupId(res.group.id);
      replace('groupDetail', { id: res.group.id });
    }
  };
  const set = (k: string, v: any) => setValues(p => ({ ...p, [k]: v }));
  return (
    <Screen title={editing ? t('grp_edit') : t('grp_new')}>
      {!editing && <Notice tone="blue" text={t('grp_workflowHint')} />}
      <SectionTitle>{t('grp_details')}</SectionTitle>
      <Form fields={fields} values={values} onChange={set} errors={errors} />
      {!editing && <>
        <SectionTitle>{t('grp_bank')}</SectionTitle>
        <Form fields={bankFields} values={values} onChange={set} errors={errors} />
        <SectionTitle>{t('grp_savingsPolicy')}</SectionTitle>
        <Form fields={policyFields} values={values} onChange={set} errors={errors} />
      </>}
      {!!error && <ErrorBox message={error} />}
      <Btn title={t('common_save')} onPress={save} busy={busy} />
    </Screen>
  );
}

type GroupTab = 'overview' | 'members' | 'documents' | 'officers' | 'history';

export function GroupDetailScreen({ params }: { params: { id: number } }) {
  const { api, t, st, push, bump, reloadGroups, setGroupId } = useShg();
  const [tab, setTab] = useState<GroupTab>('overview');
  const { data, loading, error, reload, refreshing } = useLoad(() => api.get(`/groups/${params.id}`), [params.id]);
  const [action, setAction] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'officer' | 'bank' | null>(null);
  const d = data as any;
  const g = d?.group;
  const officerOptions = (d?.officers || []).filter((o: any) => o.active && o.designation !== 'Auditor')
    .map((o: any) => ({ value: String(o.id), label: `${o.fullName} (${o.designation})` }));

  const actions: { key: string; label: string; kind?: 'primary' | 'danger' | 'secondary' }[] = [];
  if (g?.status === 'Draft') actions.push({ key: 'submit', label: t('grp_submit') });
  if (g?.status === 'Pending Approval') actions.push({ key: 'approve', label: t('grp_approve') }, { key: 'reject', label: t('grp_reject'), kind: 'danger' });
  if (g?.status === 'Active') actions.push({ key: 'suspend', label: t('grp_suspend'), kind: 'danger' });
  if (g?.status === 'Suspended') actions.push({ key: 'reactivate', label: t('grp_reactivate') });
  if (g && g.status !== 'Closed') actions.push({ key: 'close', label: t('grp_close'), kind: 'danger' });

  const actionFields = (key: string): FieldSpec[] => {
    const f: FieldSpec[] = [];
    if (key === 'approve' || key === 'reject') f.push({ key: 'officerId', label: t('grp_reviewer'), type: 'select', required: true, options: officerOptions,
      help: officerOptions.length ? undefined : t('grp_needOfficer') });
    f.push({ key: 'remarks', label: t('common_remarks'), type: 'multiline', required: ['reject', 'suspend', 'close'].includes(key) });
    return f;
  };

  return (
    <Screen title={g?.nameEn || t('nav_groups')} subtitle={g ? `${g.groupCode} · ${st(g.status)}` : undefined} onRefresh={reload} refreshing={refreshing}
      right={g && g.status !== 'Closed' ? <Btn small kind="ghost" title={t('common_edit')} onPress={() => push('groupForm', { group: g })} /> : undefined}>
      <Gate loading={loading && !d} error={error} onRetry={reload}>
        {d && (
          <>
            <Chips<GroupTab> value={tab} onChange={setTab} options={[
              { value: 'overview', label: t('tab_overview') }, { value: 'members', label: t('nav_members') },
              { value: 'documents', label: t('doc_title') }, { value: 'officers', label: t('tab_officersBank') }, { value: 'history', label: t('tab_history') },
            ]} />
            <View style={{ height: 10 }} />
            {tab === 'overview' && (
              <>
                <StatGrid>
                  <Stat label={t('mem_activeCount')} value={String(d.summary.members.Active || 0)} tone="blue" />
                  <Stat label={t('mem_pendingCount')} value={String(d.summary.members.Pending || 0)} tone="amber" />
                  <Stat label={t('dash_savingsLiability')} value={inr(d.summary.savingsBalance)} tone="green" />
                  <Stat label={t('dash_loanOutstanding')} value={inr(d.summary.loanOutstanding)} />
                  <Stat label={t('dash_cash')} value={inr(d.summary.cashBalance)} tone="blue" />
                  <Stat label={t('dash_bank')} value={inr(d.summary.bankBalance)} tone="blue" />
                </StatGrid>
                <Card>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
                    <Badge value={g.status} /><Badge value={g.verificationStatus} />
                  </View>
                  {!!g.nameMr && <KV label={t('grp_nameMr')} value={g.nameMr} />}
                  <KV label={t('grp_formationDate')} value={fmtDate(g.formationDate)} />
                  <KV label={t('grp_regNo')} value={[g.registrationNumber, g.registrationAuthority].filter(Boolean).join(' · ') || '-'} />
                  <KV label={t('grp_address')} value={[g.village, g.gramPanchayat, g.taluka, g.district, g.state].filter(Boolean).join(', ') || '-'} />
                  <KV label={t('grp_category')} value={g.category} />
                  <KV label={t('grp_livelihood')} value={g.livelihoodActivity || '-'} />
                  <KV label={t('grp_meetingFrequency')} value={t(`freq_${g.meetingFrequency}` as any)} />
                  {['President', 'Secretary', 'Treasurer'].map(r => (
                    <KV key={r} label={t(`role_${r}` as any)} value={d.officeBearers[r]?.name || t('grp_notAssigned')} color={d.officeBearers[r] ? undefined : '#B45309'} />
                  ))}
                  {!!g.reviewRemarks && <KV label={t('common_remarks')} value={g.reviewRemarks} />}
                </Card>
                {g.status === 'Draft' && <Notice text={t('grp_draftHint', { n: d.policy.minMembers })} />}
                <SectionTitle>{t('grp_workflow')}</SectionTitle>
                <BtnRow>
                  {actions.map(a => <Btn key={a.key} small kind={a.kind || 'primary'} title={a.label} onPress={() => setAction(a.key)} />)}
                </BtnRow>
                <BtnRow>
                  <Btn small kind="secondary" title={t('qa_addMember')} onPress={() => { setGroupId(g.id); push('memberForm', { groupId: g.id }); }} />
                  <Btn small kind="secondary" title={t('nav_settings')} onPress={() => { setGroupId(g.id); push('policy', { groupId: g.id }); }} />
                  <Btn small kind="secondary" title={t('nav_accounts')} onPress={() => { setGroupId(g.id); push('accounts'); }} />
                </BtnRow>
              </>
            )}
            {tab === 'members' && <GroupMembers groupId={g.id} />}
            {tab === 'documents' && <DocumentsPanel entityType="GROUP" entityId={g.id} canUpload={g.status !== 'Closed'} />}
            {tab === 'officers' && (
              <>
                <SectionTitle right={<Btn small kind="ghost" title={`+ ${t('off_add')}`} onPress={() => setSheet('officer')} />}>{t('off_title')}</SectionTitle>
                {d.officers.length ? d.officers.map((o: any) => (
                  <ListItem key={o.id} title={o.fullName} subtitle={`${o.designation}${o.mobile ? ` · ${o.mobile}` : ''}`} badge={o.active ? 'Active' : 'Closed'}
                    onPress={() => api.put(`/officers/${o.id}`, { active: !o.active }).then(reload)} />
                )) : <Text style={{ color: '#64748B' }}>{t('off_none')}</Text>}
                <SectionTitle right={<Btn small kind="ghost" title={`+ ${t('bank_add')}`} onPress={() => setSheet('bank')} />}>{t('grp_bank')}</SectionTitle>
                {d.bankAccounts.map((b: any) => (
                  <ListItem key={b.id} title={`${b.bankName}${b.isPrimary ? ' ★' : ''}`} subtitle={`${b.accountNumberMasked} · ${b.ifsc || ''} · ${b.branch || ''}`}
                    badge={b.active ? 'Active' : 'Closed'} />
                ))}
                <OnlinePaymentsCard groupId={g.id} />
              </>
            )}
            {tab === 'history' && <GroupHistory groupId={g.id} />}
          </>
        )}
      </Gate>
      <FormSheet
        visible={!!action}
        title={actions.find(a => a.key === action)?.label || ''}
        fields={action ? actionFields(action) : []}
        onClose={() => setAction(null)}
        onSubmit={async v => {
          const res = await api.post(`/groups/${params.id}/workflow`, { action, ...v, officerId: v.officerId ? Number(v.officerId) : undefined });
          reload(); bump(); reloadGroups();
          return res;
        }}
      />
      <FormSheet
        visible={sheet === 'officer'}
        title={t('off_add')}
        fields={[
          { key: 'fullName', label: t('common_name'), required: true },
          { key: 'designation', label: t('off_designation'), type: 'select', required: true,
            options: ['Group Manager', 'Field Officer', 'Auditor'].map(x => ({ value: x, label: x })) },
          { key: 'mobile', label: t('common_mobile'), type: 'phone' },
        ]}
        onClose={() => setSheet(null)}
        onSubmit={async v => { const r = await api.post(`/groups/${params.id}/officers`, v); reload(); return r; }}
      />
      <FormSheet
        visible={sheet === 'bank'}
        title={t('bank_add')}
        fields={[
          { key: 'bankName', label: t('bank_name'), required: true },
          { key: 'branch', label: t('bank_branch') },
          { key: 'accountNumber', label: t('bank_accountNumber'), type: 'number', required: true, maxLength: 20 },
          { key: 'ifsc', label: t('bank_ifsc'), maxLength: 11 },
        ]}
        onClose={() => setSheet(null)}
        onSubmit={async v => { const r = await api.post(`/groups/${params.id}/bank-accounts`, { ...v, ifsc: v.ifsc?.toUpperCase() }); reload(); return r; }}
      />
    </Screen>
  );
}

function GroupMembers({ groupId }: { groupId: number }) {
  const { api, t, push } = useShg();
  const { data, loading, error, reload } = useLoad(() => api.get('/members', { groupId, pageSize: 100 }), [groupId]);
  const list = (data as any)?.members || [];
  return (
    <Gate loading={loading} error={error} onRetry={reload} empty={!list.length} emptyText={t('mem_none')}>
      {list.map((m: any) => (
        <ListItem key={m.id} title={`#${m.memberNumber} ${m.fullName}`} subtitle={`${t(`role_${m.role}` as any)} · ${m.mobile}`}
          right={inr(m.savingsBalance)} badge={m.status} onPress={() => push('memberDetail', { id: m.id })} />
      ))}
    </Gate>
  );
}

export function GroupHistory({ groupId }: { groupId: number }) {
  const { api, t } = useShg();
  const { data, loading, error, reload } = useLoad(() => api.get(`/groups/${groupId}/history`), [groupId]);
  const list = (data as any)?.events || [];
  return (
    <Gate loading={loading} error={error} onRetry={reload} empty={!list.length} emptyText={t('common_noRecords')}>
      {list.map((e: any) => (
        <ListItem key={e.id} title={`${e.entityType} · ${e.action.replace(/_/g, ' ')}`}
          subtitle={e.fromStatus || e.toStatus ? `${e.fromStatus || '—'} → ${e.toStatus || '—'}` : undefined}
          meta={`${fmtDate(e.createdAt)} ${String(e.createdAt).slice(11, 16)}${e.details?.remarks ? ` · ${e.details.remarks}` : ''}`} />
      ))}
    </Gate>
  );
}
