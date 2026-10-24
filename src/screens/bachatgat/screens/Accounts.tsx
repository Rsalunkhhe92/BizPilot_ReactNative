import React, { useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { fmtDate, fyStartIso, inr, isoToday } from '../format';
import {
  Badge, Btn, BtnRow, Card, ErrorBox, FieldSpec, Form, FormSheet, Gate, KV, ListItem, Notice, Screen, SectionTitle, SelectInput,
  Stat, StatGrid, confirm, useLoad, useShg, useSubmit, validate,
} from '../ui';
import { GroupPicker, NeedGroup } from './Members';
import { paymentFields, useBankOptions, useResolutionOptions } from './Savings';
import { useTxnLabel } from './Dashboard';

const ACCOUNT_KEYS = ['CASH', 'BANK', 'LOAN_RECEIVABLE', 'MEMBER_SAVINGS', 'BANK_LOAN', 'GRANT_FUND', 'OPENING_EQUITY', 'ACCUMULATED_SURPLUS',
  'INTEREST_INCOME', 'PENALTY_INCOME', 'OTHER_INCOME', 'BANK_INTEREST', 'BUSINESS_INCOME', 'OPERATING_EXPENSE', 'BANK_CHARGES',
  'BANK_LOAN_INTEREST', 'LOAN_WRITE_OFF', 'BUSINESS_EXPENSE'];

export function useAccountLabel() {
  const { t } = useShg();
  return (code: string) => (ACCOUNT_KEYS.includes(code) ? t(`acc_${code}` as any) : code);
}

function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const { t } = useShg();
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <View style={{ flex: 1 }}>
        <Form fields={[{ key: 'from', label: t('common_from'), type: 'date' }]} values={{ from }} errors={{}} onChange={(_, v) => onChange(v, to)} />
      </View>
      <View style={{ flex: 1 }}>
        <Form fields={[{ key: 'to', label: t('common_to'), type: 'date' }]} values={{ to }} errors={{}} onChange={(_, v) => onChange(from, v)} />
      </View>
    </View>
  );
}

export function AccountsScreen() {
  const { api, t, push, groupId } = useShg();
  const acc = useAccountLabel();
  const [from, setFrom] = useState(fyStartIso());
  const [to, setTo] = useState(isoToday());
  const { data, loading, error, reload, refreshing } = useLoad(
    () => groupId ? api.get('/accounts/summary', { groupId, from, to }) : Promise.resolve(null), [groupId, from, to]);
  const d = data as any;
  return (
    <Screen title={t('nav_accounts')} onRefresh={reload} refreshing={refreshing}>
      <GroupPicker />
      <NeedGroup>
        <DateRange from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); }} />
        <Gate loading={loading && !d} error={error} onRetry={reload}>
          {d && (
            <>
              <StatGrid>
                <Stat label={t('dash_cash')} value={inr(d.cash)} tone="blue" onPress={() => push('cashbook')} />
                {d.banks.map((b: any) => (
                  <Stat key={b.id} label={`${b.bankName} ${b.accountNumberMasked}`} value={inr(b.balance)} tone="blue" onPress={() => push('bankbook', { bankAccountId: b.id })} />
                ))}
                <Stat label={t('ie_groupSurplus')} value={inr(d.incomeExpenditure.groupSurplus)} tone={d.incomeExpenditure.groupSurplus >= 0 ? 'green' : 'red'} />
                <Stat label={t('ie_businessSurplus')} value={inr(d.incomeExpenditure.business.surplus)} tone={d.incomeExpenditure.business.surplus >= 0 ? 'green' : 'red'} />
              </StatGrid>
              <SectionTitle>{t('acc_actions')}</SectionTitle>
              <BtnRow>
                <Btn small title={t('qa_addExpense')} onPress={() => push('txnForm', { txnType: 'OPERATING_EXPENSE' })} />
                <Btn small kind="secondary" title={t('txn_OTHER_INCOME')} onPress={() => push('txnForm', { txnType: 'OTHER_INCOME' })} />
                <Btn small kind="secondary" title={t('txn_BANK_DEPOSIT')} onPress={() => push('txnForm', { txnType: 'BANK_DEPOSIT' })} />
                <Btn small kind="secondary" title={t('txn_BANK_WITHDRAWAL')} onPress={() => push('txnForm', { txnType: 'BANK_WITHDRAWAL' })} />
                <Btn small kind="secondary" title={t('txn_BANK_CHARGES')} onPress={() => push('txnForm', { txnType: 'BANK_CHARGES' })} />
                <Btn small kind="secondary" title={t('txn_BANK_INTEREST')} onPress={() => push('txnForm', { txnType: 'BANK_INTEREST' })} />
                <Btn small kind="ghost" title={t('txn_OPENING_BALANCE')} onPress={() => push('txnForm', { txnType: 'OPENING_BALANCE' })} />
              </BtnRow>
              <ListItem title={`📒  ${t('acc_cashbook')}`} onPress={() => push('cashbook')} />
              <ListItem title={`🏦  ${t('acc_bankbook')}`} onPress={() => push('bankbook')} />
              <ListItem title={`🔁  ${t('nav_transactions')}`} onPress={() => push('transactions')} />
              <ListItem title={`✅  ${t('acc_reconciliation')}`} onPress={() => push('reconciliation')} />
              <ListItem title={`🔒  ${t('acc_periodClose')}`} onPress={() => push('periodClose')} />

              <SectionTitle>{t('acc_incomeExpenditure')}</SectionTitle>
              <Card>
                {d.incomeExpenditure.income.filter((x: any) => x.amount).map((x: any) => <KV key={x.account} label={acc(x.account)} value={inr(x.amount)} color="#047857" />)}
                <KV label={t('ie_totalIncome')} value={inr(d.incomeExpenditure.totalIncome)} strong />
                {d.incomeExpenditure.expenditure.filter((x: any) => x.amount).map((x: any) => <KV key={x.account} label={acc(x.account)} value={inr(x.amount)} color="#B91C1C" />)}
                <KV label={t('ie_totalExpenditure')} value={inr(d.incomeExpenditure.totalExpenditure)} strong />
                <KV label={t('ie_groupSurplus')} value={inr(d.incomeExpenditure.groupSurplus)} strong />
                <KV label={t('acc_BUSINESS_INCOME')} value={inr(d.incomeExpenditure.business.income)} />
                <KV label={t('acc_BUSINESS_EXPENSE')} value={inr(d.incomeExpenditure.business.expenditure)} />
                <KV label={t('ie_consolidated')} value={inr(d.incomeExpenditure.consolidatedSurplus)} strong />
              </Card>

              <SectionTitle right={<Badge value={d.financialPosition.balanced ? 'Passed' : 'Failed'} label={d.financialPosition.balanced ? t('fp_balanced') : t('fp_unbalanced')} />}>
                {t('acc_financialPosition')}
              </SectionTitle>
              <Card>
                <Text style={{ fontWeight: '800', marginBottom: 4 }}>{t('fp_assets')}</Text>
                {d.financialPosition.assets.map((x: any) => <KV key={x.account} label={acc(x.account)} value={inr(x.amount)} />)}
                <KV label={t('fp_totalAssets')} value={inr(d.financialPosition.totalAssets)} strong />
                <Text style={{ fontWeight: '800', marginVertical: 4 }}>{t('fp_liabilities')}</Text>
                {[...d.financialPosition.liabilities, ...d.financialPosition.funds].map((x: any) => <KV key={x.account} label={acc(x.account)} value={inr(x.amount)} />)}
                <KV label={t('fp_totalClaims')} value={inr(d.financialPosition.totalLiabilitiesAndFunds)} strong />
              </Card>
              <SectionTitle>{t('acc_trialBalance')}</SectionTitle>
              <Card>
                {d.trialBalance.map((r: any) => <KV key={r.account} label={acc(r.account)} value={Number(r.debit) ? `Dr ${inr(r.debit)}` : `Cr ${inr(r.credit)}`} />)}
              </Card>
            </>
          )}
        </Gate>
      </NeedGroup>
    </Screen>
  );
}

export function BookScreen({ params, kind }: { params?: any; kind: 'cash' | 'bank' }) {
  const { api, t, push, groupId } = useShg();
  const label = useTxnLabel();
  const banks = useBankOptions();
  const [bankId, setBankId] = useState<string>(params?.bankAccountId ? String(params.bankAccountId) : '');
  const [from, setFrom] = useState(params?.from || fyStartIso());
  const [to, setTo] = useState(isoToday());
  const { data, loading, error, reload, refreshing } = useLoad(() => {
    if (!groupId) return Promise.resolve(null);
    return kind === 'cash' ? api.get('/accounts/cashbook', { groupId, from, to })
      : api.get('/accounts/bankbook', { groupId, from, to, bankAccountId: bankId || undefined });
  }, [groupId, from, to, bankId, kind]);
  const book = (data as any)?.[kind === 'cash' ? 'cashbook' : 'bankbook'];
  return (
    <Screen title={kind === 'cash' ? t('acc_cashbook') : t('acc_bankbook')} onRefresh={reload} refreshing={refreshing}>
      <GroupPicker />
      <NeedGroup>
        {kind === 'bank' && banks.length > 1 && (
          <SelectInput value={bankId} onChange={setBankId} options={banks} label={t('bank_account')} />
        )}
        <DateRange from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); }} />
        <Gate loading={loading && !book} error={error} onRetry={reload}>
          {book && (
            <>
              <StatGrid>
                <Stat label={t('book_opening')} value={inr(book.opening)} />
                <Stat label={t('book_closing')} value={inr(book.closing)} tone="blue" />
                <Stat label={t('book_receipts')} value={inr(book.totalReceipts)} tone="green" />
                <Stat label={t('book_payments')} value={inr(book.totalPayments)} tone="red" />
              </StatGrid>
              {!book.rows.length && <Notice text={t('common_noRecords')} />}
              {book.rows.slice().reverse().map((r: any, i: number) => (
                <ListItem key={`${r.txnId}-${i}`} title={`${label(r.txnType)}${r.memberName ? ` · ${r.memberName}` : ''}`}
                  subtitle={`${fmtDate(r.txnDate)} · ${r.receiptNumber || r.txnNumber}${r.narration ? ` · ${r.narration}` : ''}`}
                  right={Number(r.receipt) ? `+${inr(r.receipt)}` : `−${inr(r.payment)}`}
                  meta={`${t('common_balance')} ${inr(r.balance)}${kind === 'bank' && r.bankClearedOn ? ` · ✔ ${fmtDate(r.bankClearedOn)}` : ''}`}
                  onPress={() => push('receipt', { id: r.txnId })} />
              ))}
            </>
          )}
        </Gate>
      </NeedGroup>
    </Screen>
  );
}

const TYPE_HINTS: Record<string, string> = {
  OPERATING_EXPENSE: 'txnHint_expense', OTHER_INCOME: 'txnHint_income', BANK_DEPOSIT: 'txnHint_deposit', BANK_WITHDRAWAL: 'txnHint_withdrawal',
  BANK_CHARGES: 'txnHint_bankCharges', BANK_INTEREST: 'txnHint_bankInterest', OPENING_BALANCE: 'txnHint_opening', BANK_LOAN_REPAYMENT: 'txnHint_bankLoanRepay',
  BUSINESS_EXPENSE: 'txnHint_expense', BUSINESS_INCOME: 'txnHint_income',
};

export function TxnFormScreen({ params }: { params?: any }) {
  const { api, t, groupId, replace, bump } = useShg();
  const label = useTxnLabel();
  const banks = useBankOptions();
  const type: string = params?.txnType || 'OPERATING_EXPENSE';
  const resolutions = useResolutionOptions('EXPENSE_APPROVAL');
  const policy = useLoad(() => groupId ? api.get(`/policies/${groupId}`) : Promise.resolve(null), [groupId]);
  const limit = Number((policy.data as any)?.policy?.expenseApprovalLimit || 0);
  const schemes = useLoad(() => groupId && type === 'BANK_LOAN_REPAYMENT' ? api.get('/schemes', { groupId, kind: 'BANK_LOAN' }) : Promise.resolve(null), [groupId, type]);
  const bankOnly = ['BANK_CHARGES', 'BANK_INTEREST', 'BANK_DEPOSIT', 'BANK_WITHDRAWAL'].includes(type);
  const [values, setValues] = useState<Record<string, any>>({ paymentMethod: bankOnly ? 'Bank Transfer' : 'Cash', txnDate: isoToday() });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { submit, busy, error, pending } = useSubmit();
  const isExpense = type === 'OPERATING_EXPENSE' || type === 'BUSINESS_EXPENSE';
  const needsRes = isExpense && limit > 0 && Number(values.amount || 0) > limit;
  const payFields = bankOnly
    ? [{ key: 'bankAccountId', label: t('bank_account'), type: 'select' as const, options: banks, required: banks.length > 1 },
      { key: 'referenceNumber', label: t('common_reference') }, { key: 'txnDate', label: t('common_date'), type: 'date' as const, required: true }]
    : paymentFields(t, values, banks);
  const fields: FieldSpec[] = [
    { key: 'amount', label: t('common_amount'), type: 'money', required: true, min: 1 },
    { key: 'interestAmount', label: t('txn_interestPart'), type: 'money', hidden: type !== 'BANK_LOAN_REPAYMENT' },
    { key: 'schemeId', label: t('txn_bankLoan'), type: 'select', required: type === 'BANK_LOAN_REPAYMENT', hidden: type !== 'BANK_LOAN_REPAYMENT',
      options: ((schemes.data as any)?.schemes || []).map((s: any) => ({ value: String(s.id), label: s.schemeName })) },
    { key: 'narration', label: t('common_description'), required: isExpense || type === 'OTHER_INCOME', type: 'multiline' },
    ...payFields,
    { key: 'resolutionId', label: t('res_authorizing'), type: 'select', required: needsRes, hidden: !isExpense, options: resolutions,
      help: needsRes ? t('txn_needsResolution', { limit: inr(limit) }) : t('res_optional') },
  ];
  const save = () => {
    const errs = validate(fields, values, t);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    confirm(label(type), `${inr(values.amount)} · ${values.narration || ''}`, t('common_confirm'), t('common_cancel'), async () => {
      const res = await submit(key => api.post('/transactions', {
        ...values, groupId, txnType: type,
        bankAccountId: values.bankAccountId ? Number(values.bankAccountId) : undefined,
        resolutionId: values.resolutionId ? Number(values.resolutionId) : undefined,
        schemeId: values.schemeId ? Number(values.schemeId) : undefined,
        activityId: params?.activityId,
      }, key));
      if (res) { bump(); replace('receipt', { id: res.transaction.id }); }
    });
  };
  return (
    <Screen title={label(type)}>
      <GroupPicker />
      <NeedGroup>
        {TYPE_HINTS[type] && <Notice tone="blue" text={t(TYPE_HINTS[type] as any)} />}
        <Form fields={fields} values={values} onChange={(k, v) => setValues(p => ({ ...p, [k]: v }))} errors={errors} />
        {!!error && <ErrorBox message={error} />}
        <Btn title={pending ? t('common_retrySame') : t('common_save')} onPress={save} busy={busy} />
      </NeedGroup>
    </Screen>
  );
}

export function ReconciliationScreen() {
  const { api, t, groupId, c, bump } = useShg();
  const label = useTxnLabel();
  const banks = useBankOptions();
  const [bankId, setBankId] = useState('');
  const [date, setDate] = useState(isoToday());
  const { data, loading, error, reload } = useLoad(() => groupId
    ? api.get('/accounts/reconciliation', { groupId, bankAccountId: bankId || undefined, statementDate: date }) : Promise.resolve(null), [groupId, bankId, date]);
  const d = data as any;
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [saveOpen, setSaveOpen] = useState(false);
  const clear = useSubmit();
  const doClear = async () => {
    const ids = Object.entries(selected).filter(([, v]) => v).map(([k]) => Number(k));
    if (!ids.length) return;
    const r = await clear.submit(() => api.post('/accounts/reconciliation/clear', { txnIds: ids, clearedOn: date }));
    if (r) { setSelected({}); reload(); }
  };
  return (
    <Screen title={t('acc_reconciliation')} onRefresh={reload}>
      <GroupPicker />
      <NeedGroup>
        {banks.length > 1 && <SelectInput value={bankId} onChange={setBankId} options={banks} label={t('bank_account')} />}
        <Form fields={[{ key: 'd', label: t('rec_statementDate'), type: 'date' }]} values={{ d: date }} errors={{}} onChange={(_, v) => setDate(v)} />
        <Gate loading={loading && !d} error={error} onRetry={reload}>
          {d && (
            <>
              <Card>
                <KV label={t('rec_bookBalance')} value={inr(d.bookBalance)} />
                <KV label={t('rec_uncleared')} value={inr(d.netUncleared)} />
                <KV label={t('rec_expected')} value={inr(d.expectedStatementBalance)} strong />
              </Card>
              <Notice tone="blue" text={t('rec_hint')} />
              <SectionTitle>{t('rec_unclearedList')}</SectionTitle>
              {d.uncleared.map((u: any) => (
                <Pressable key={u.txnId} onPress={() => setSelected(p => ({ ...p, [u.txnId]: !p[u.txnId] }))} accessibilityRole="checkbox"
                  accessibilityState={{ checked: !!selected[u.txnId] }}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border, minHeight: 52 }}>
                  <Switch value={!!selected[u.txnId]} onValueChange={v => setSelected(p => ({ ...p, [u.txnId]: v }))} />
                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <Text style={{ color: c.text, fontWeight: '600' }}>{label(u.txnType)} · {u.txnNumber}</Text>
                    <Text style={{ color: c.muted, fontSize: 12 }}>{fmtDate(u.txnDate)} {u.referenceNumber || ''}</Text>
                  </View>
                  <Text style={{ color: c.text, fontWeight: '700' }}>{Number(u.deposit) ? `+${inr(u.deposit)}` : `−${inr(u.withdrawal)}`}</Text>
                </Pressable>
              ))}
              {!d.uncleared.length && <Notice tone="green" text={t('rec_allCleared')} />}
              {!!clear.error && <ErrorBox message={clear.error} />}
              <BtnRow>
                <Btn small title={t('rec_markCleared')} onPress={doClear} busy={clear.busy} disabled={!Object.values(selected).some(Boolean)} />
                <Btn small kind="secondary" title={t('rec_save')} onPress={() => setSaveOpen(true)} />
              </BtnRow>
              <SectionTitle>{t('rec_history')}</SectionTitle>
              {d.history.map((h: any) => (
                <ListItem key={h.id} title={fmtDate(h.statementDate)} subtitle={`${t('rec_statement')} ${inr(h.statementBalance)} · ${t('rec_bookBalance')} ${inr(h.bookBalance)}`}
                  right={inr(h.difference)} badge={Number(h.difference) === 0 ? 'Passed' : 'Failed'} />
              ))}
            </>
          )}
        </Gate>
      </NeedGroup>
      <FormSheet visible={saveOpen} title={t('rec_save')} onClose={() => setSaveOpen(false)} initial={{ statementDate: date }}
        fields={[
          { key: 'statementDate', label: t('rec_statementDate'), type: 'date', required: true },
          { key: 'statementBalance', label: t('rec_statementBalance'), type: 'decimal', required: true },
          { key: 'notes', label: t('common_notes'), type: 'multiline' },
        ]}
        onSubmit={async v => { const r = await api.post('/accounts/reconciliation', { ...v, groupId, bankAccountId: d.bankAccountId }); reload(); bump(); return r; }} />
    </Screen>
  );
}

export function PeriodCloseScreen() {
  const { api, t, groupId } = useShg();
  const { data, loading, error, reload } = useLoad(() => groupId ? api.get('/accounts/period-closes', { groupId }) : Promise.resolve(null), [groupId]);
  const [open, setOpen] = useState(false);
  const list = (data as any)?.closes || [];
  return (
    <Screen title={t('acc_periodClose')} onRefresh={reload}>
      <GroupPicker />
      <NeedGroup>
        <Notice text={t('pc_hint')} />
        <Btn title={t('pc_close')} onPress={() => setOpen(true)} />
        <Gate loading={loading} error={error} onRetry={reload} empty={!list.length} emptyText={t('pc_none')}>
          {list.map((p: any) => (
            <ListItem key={p.id} title={`${t('pc_upTo')} ${fmtDate(p.periodEnd)}`} subtitle={`${t('dash_cash')} ${inr(p.cashBalance)} · ${t('dash_bank')} ${inr(p.bankBalance)}`}
              meta={`${fmtDate(p.closedAt)}${p.notes ? ` · ${p.notes}` : ''}`} />
          ))}
        </Gate>
      </NeedGroup>
      <FormSheet visible={open} title={t('pc_close')} onClose={() => setOpen(false)} notice={t('pc_warning')}
        fields={[{ key: 'periodEnd', label: t('pc_periodEnd'), type: 'date', required: true }, { key: 'notes', label: t('common_notes'), type: 'multiline' }]}
        onSubmit={async v => { const r = await api.post('/accounts/period-close', { ...v, groupId }); reload(); return r; }} />
    </Screen>
  );
}

