import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import {
  Btn, Card, ErrorBox, FieldSpec, Form, Gate, KV, Notice, Screen, SectionTitle, useLoad, useShg, useSubmit, validate,
} from '../ui';
import { GroupPicker, NeedGroup } from './Members';

const FEATURE_KEYS = ['shg_groups', 'shg_members', 'shg_savings', 'shg_loans', 'shg_meetings', 'shg_accounts', 'shg_business',
  'shg_schemes', 'shg_reports', 'shg_settings'];

export function SettingsScreen() {
  const { t, push, groupId, features, c } = useShg();
  return (
    <Screen title={t('nav_settings')}>
      <GroupPicker />
      <NeedGroup>
        <Btn title={t('set_policies')} onPress={() => push('policy', { groupId })} />
      </NeedGroup>
      <SectionTitle>{t('set_permissions')}</SectionTitle>
      <Card>
        <Text style={{ color: c.sub, marginBottom: 8 }}>{t('set_permissionsHint')}</Text>
        {FEATURE_KEYS.map(f => <KV key={f} label={t(`feat_${f}` as any)} value={features.includes(f) ? '✔' : '—'} />)}
      </Card>
      <SectionTitle>{t('set_roles')}</SectionTitle>
      <Notice tone="blue" text={t('set_rolesHint')} />
    </Screen>
  );
}

export function PolicyScreen({ params }: { params?: any }) {
  const { api, t, groupId } = useShg();
  const gid = params?.groupId || groupId;
  const { data, loading, error, reload } = useLoad(() => gid ? api.get(`/policies/${gid}`) : Promise.resolve(null), [gid]);
  const [values, setValues] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const { submit, busy, error: err } = useSubmit();
  useEffect(() => {
    const p = (data as any)?.policy;
    if (p) setValues(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === 'number' ? String(v) : v])));
  }, [data]);
  const freq = ['MONTHLY', 'FORTNIGHTLY', 'WEEKLY'].map(f => ({ value: f, label: t(`freq_${f}` as any) }));
  const savings: FieldSpec[] = [
    { key: 'savingsFrequency', label: t('pol_savingsFrequency'), type: 'select', options: freq },
    { key: 'savingsAmount', label: t('pol_savingsAmount'), type: 'money', required: true },
    { key: 'savingsDueDay', label: t('pol_dueDay'), type: 'number', min: 1, max: 28, help: t('pol_dueDayHelp') },
    { key: 'allowSavingsWithdrawal', label: t('pol_allowWithdrawal'), type: 'switch', help: t('pol_allowWithdrawalHelp') },
  ];
  const loans: FieldSpec[] = [
    { key: 'defaultInterestMethod', label: t('loan_method'), type: 'select', options: [{ value: 'FLAT', label: t('loan_FLAT') }, { value: 'REDUCING', label: t('loan_REDUCING') }] },
    { key: 'defaultInterestRate', label: t('loan_rate'), type: 'decimal', min: 0, max: 60 },
    { key: 'defaultFrequency', label: t('loan_frequency'), type: 'select', options: freq },
    { key: 'maxInstallments', label: t('pol_maxInstallments'), type: 'number', min: 1, max: 520 },
    { key: 'maxLoanAmount', label: t('pol_maxLoan'), type: 'money', help: t('pol_zeroNoLimit') },
    { key: 'savingsMultiple', label: t('pol_savingsMultiple'), type: 'decimal', help: t('pol_savingsMultipleHelp') },
    { key: 'minMembershipMonths', label: t('pol_minMonths'), type: 'number', min: 0, max: 120 },
    { key: 'allowMultipleLoans', label: t('pol_multipleLoans'), type: 'switch' },
    { key: 'penaltyType', label: t('pol_penaltyType'), type: 'select', options: [
      { value: 'NONE', label: t('pol_penaltyNone') }, { value: 'FLAT', label: t('pol_penaltyFlat') }, { value: 'PERCENT_PER_MONTH', label: t('pol_penaltyPercent') }] },
    { key: 'penaltyValue', label: t('pol_penaltyValue'), type: 'decimal', hidden: values.penaltyType === 'NONE' },
    { key: 'graceDays', label: t('pol_graceDays'), type: 'number', min: 0, max: 90 },
    { key: 'roundToRupee', label: t('pol_roundRupee'), type: 'switch', help: t('pol_roundRupeeHelp') },
  ];
  const approvals: FieldSpec[] = [
    { key: 'minMembers', label: t('pol_minMembers'), type: 'number', min: 1, max: 100 },
    { key: 'quorumPercent', label: t('pol_quorum'), type: 'number', min: 1, max: 100 },
    { key: 'loanApprovalLimit', label: t('pol_loanApprovalLimit'), type: 'money', help: t('pol_loanApprovalLimitHelp') },
    { key: 'expenseApprovalLimit', label: t('pol_expenseLimit'), type: 'money', help: t('pol_expenseLimitHelp') },
  ];
  const all = [...savings, ...loans, ...approvals];
  const save = async () => {
    const errs = validate(all, values, t);
    setErrors(errs);
    setSaved(false);
    if (Object.keys(errs).length) return;
    const payload = Object.fromEntries(all.filter(f => !f.hidden).map(f => [f.key, values[f.key]]));
    const r = await submit(() => api.put(`/policies/${gid}`, payload));
    if (r) { setSaved(true); reload(); }
  };
  const set = (k: string, v: any) => setValues(p => ({ ...p, [k]: v }));
  return (
    <Screen title={t('set_policies')}>
      {!params?.groupId && <GroupPicker />}
      <NeedGroup>
        <Gate loading={loading} error={error} onRetry={reload}>
          <Notice tone="blue" text={t('pol_hint')} />
          <SectionTitle>{t('set_savingsConfig')}</SectionTitle>
          <Form fields={savings} values={values} onChange={set} errors={errors} />
          <SectionTitle>{t('set_loanConfig')}</SectionTitle>
          <Form fields={loans} values={values} onChange={set} errors={errors} />
          <SectionTitle>{t('set_approvalSettings')}</SectionTitle>
          <Form fields={approvals} values={values} onChange={set} errors={errors} />
          {!!err && <ErrorBox message={err} />}
          {saved && <Notice tone="green" text={t('common_saved')} />}
          <Btn title={t('common_save')} onPress={save} busy={busy} />
        </Gate>
      </NeedGroup>
    </Screen>
  );
}
