import React, { useState } from 'react';
import { Text } from 'react-native';
import { fmtDate, inr, isoToday, toIso } from '../format';
import {
  Btn, Card, Chips, ErrorBox, FieldSpec, Form, Gate, KV, ListItem, LoadMore, Notice, Screen, SearchBar, SectionTitle,
  Stat, StatGrid, confirm, useDebounced, useLoad, usePaged, useShg, useSubmit, validate,
} from '../ui';
import { GroupPicker, NeedGroup } from './Members';
import { TxnItem } from './Dashboard';
import { useGatewaySync } from './Online';

export const METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Cheque'];

export function MoneyScreen() {
  const { t, push, has, groupId } = useShg();
  useGatewaySync(groupId);
  return (
    <Screen title={t('nav_money')} noBack>
      {has('shg_savings') && (
        <>
          <SectionTitle>{t('nav_savings')}</SectionTitle>
          <ListItem title={`💰  ${t('qa_collectSavings')}`} onPress={() => push('collectSavings')} />
          <ListItem title={`🗓️  ${t('sav_dues')}`} subtitle={t('sav_duesHint')} onPress={() => push('savingsDues')} />
          <ListItem title={`⏰  ${t('sav_pendingContrib')}`} onPress={() => push('savingsDues', { status: 'overdue' })} />
          <ListItem title={`📗  ${t('sav_ledger')}`} onPress={() => push('savingsLedger')} />
          <ListItem title={`🧾  ${t('sav_receipts')}`} onPress={() => push('transactions', { type: 'SAVINGS_DEPOSIT', title: t('sav_receipts') })} />
          <ListItem title={`↩️  ${t('sav_withdraw')}`} onPress={() => push('withdrawSavings')} />
        </>
      )}
      {has('shg_loans') && (
        <>
          <SectionTitle>{t('nav_loans')}</SectionTitle>
          <ListItem title={`📝  ${t('loan_applications')}`} onPress={() => push('loans')} />
          <ListItem title={`✅  ${t('loan_approvals')}`} onPress={() => push('loans', { status: 'pending' })} />
          <ListItem title={`💸  ${t('loan_disbursements')}`} onPress={() => push('loans', { status: 'Approved' })} />
          <ListItem title={`🧾  ${t('qa_collectRepayment')}`} onPress={() => push('collectRepayment')} />
          <ListItem title={`📆  ${t('loan_upcoming')}`} onPress={() => push('installments')} />
          <ListItem title={`🚨  ${t('loan_overdue')}`} onPress={() => push('installments', { overdue: true })} />
          <ListItem title={`🏁  ${t('loan_closed')}`} onPress={() => push('loans', { status: 'Closed' })} />
        </>
      )}
    </Screen>
  );
}

/** Member chooser for collection flows: search within the current group. */
export function MemberChooser({ onPick, status = 'Active' }: { onPick: (m: any) => void; status?: string }) {
  const { api, t, groupId } = useShg();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, loading, error, reload } = useLoad(
    () => groupId ? api.get('/members', { groupId, status, q: dq, pageSize: 100 }) : Promise.resolve({ members: [] }), [groupId, dq, status]);
  const list = (data as any)?.members || [];
  return (
    <>
      <SearchBar value={q} onChange={setQ} placeholder={t('mem_search')} />
      <Gate loading={loading} error={error} onRetry={reload} empty={!list.length} emptyText={t('mem_none')}>
        {list.map((m: any) => (
          <ListItem key={m.id} title={`#${m.memberNumber} ${m.fullName}`} subtitle={m.mobile}
            meta={Number(m.pendingDues) > 0 ? `${t('sav_pending')} ${inr(m.pendingDues)}` : undefined}
            right={inr(m.savingsBalance)} onPress={() => onPick(m)} />
        ))}
      </Gate>
    </>
  );
}

export function useBankOptions() {
  const { api, groupId } = useShg();
  const { data } = useLoad(() => groupId ? api.get(`/groups/${groupId}/bank-accounts`) : Promise.resolve({ bankAccounts: [] }), [groupId]);
  return ((data as any)?.bankAccounts || []).filter((b: any) => b.active)
    .map((b: any) => ({ value: String(b.id), label: `${b.bankName} ${b.accountNumberMasked}` }));
}

export function paymentFields(t: any, values: Record<string, any>, banks: { value: string; label: string }[], withDate = true): FieldSpec[] {
  return [
    { key: 'paymentMethod', label: t('common_paymentMethod'), type: 'select', required: true, options: METHODS.map(m => ({ value: m, label: m })) },
    { key: 'bankAccountId', label: t('bank_account'), type: 'select', options: banks, hidden: values.paymentMethod === 'Cash' || !values.paymentMethod,
      help: banks.length ? undefined : t('bank_noneHelp') },
    { key: 'referenceNumber', label: t('common_reference'), hidden: values.paymentMethod === 'Cash', help: t('common_referenceHelp') },
    { key: 'txnDate', label: t('common_date'), type: 'date', required: true, hidden: !withDate },
  ];
}

export function CollectSavingsScreen({ params }: { params?: any }) {
  const { api, t, push, replace, bump, groupId } = useShg();
  useGatewaySync(groupId);
  const [memberId, setMemberId] = useState<number | null>(params?.memberId || null);
  const due = useLoad(() => memberId ? api.get('/savings/member-due', { memberId }) : Promise.resolve(null), [memberId]);
  const banks = useBankOptions();
  const [values, setValues] = useState<Record<string, any>>({ paymentMethod: 'Cash', txnDate: isoToday() });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { submit, busy, pending, error } = useSubmit();
  const d = due.data as any;
  const fields: FieldSpec[] = [
    { key: 'amount', label: t('common_amount'), type: 'money', required: true, min: 1 },
    ...paymentFields(t, values, banks),
    { key: 'notes', label: t('common_notes') },
  ];
  React.useEffect(() => {
    if (d) setValues(v => ({ ...v, amount: v.amount || String(Number(d.dueNow) > 0 ? d.dueNow : d.standardAmount) }));
  }, [d]);
  const save = () => {
    const errs = validate(fields, values, t);
    if (Number(values.amount) <= 0) errs.amount = t('val_positive');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    confirm(t('sav_confirmTitle'), t('sav_confirmMsg', { amount: inr(values.amount), name: d.member.fullName, method: values.paymentMethod }),
      t('common_confirm'), t('common_cancel'), async () => {
        const res = await submit(key => api.post('/savings/collect', {
          ...values, memberId, bankAccountId: values.bankAccountId ? Number(values.bankAccountId) : undefined,
        }, key));
        if (res) { bump(); replace('receipt', { id: res.transaction.id }); }
      });
  };
  return (
    <Screen title={t('qa_collectSavings')}>
      {!memberId ? (
        <>
          <GroupPicker />
          <NeedGroup><SectionTitle>{t('sav_pickMember')}</SectionTitle><MemberChooser onPick={m => setMemberId(m.id)} /></NeedGroup>
        </>
      ) : (
        <Gate loading={due.loading} error={due.error} onRetry={due.reload}>
          {d && (
            <>
              <Card>
                <Text style={{ fontWeight: '800', fontSize: 16 }}>{d.member.fullName} · #{d.member.memberNumber}</Text>
                <KV label={t('mem_savingsBalance')} value={inr(d.savingsBalance)} />
                <KV label={t('sav_dueNow')} value={inr(d.dueNow)} strong color={Number(d.dueNow) > 0 ? '#B45309' : undefined} />
                <KV label={t('sav_standard')} value={inr(d.standardAmount)} />
                {d.openDues.filter((x: any) => x.dueDate <= isoToday()).slice(0, 4).map((x: any) => (
                  <KV key={x.id} label={fmtDate(x.periodStart)} value={inr(x.balance)} />
                ))}
                {!params?.memberId && <Btn small kind="ghost" title={t('sav_changeMember')} onPress={() => setMemberId(null)} />}
              </Card>
              {d.member.status !== 'Active' && <Notice tone="red" text={t('sav_memberNotActive')} />}
              <Form fields={fields} values={values} onChange={(k, v) => setValues(p => ({ ...p, [k]: v }))} errors={errors} />
              <Notice tone="blue" text={t('sav_allocHint')} />
              {!!error && <ErrorBox message={error} />}
              <Btn title={pending ? t('common_retrySame') : t('sav_saveReceipt')} onPress={save} busy={busy} disabled={d.member.status !== 'Active'} />
              <Btn kind="ghost" title={t('mem_openProfile')} onPress={() => push('memberDetail', { id: memberId })} />
            </>
          )}
        </Gate>
      )}
    </Screen>
  );
}

export function SavingsDuesScreen({ params }: { params?: any }) {
  const { api, t, st, groupId, push, bump } = useShg();
  useGatewaySync(groupId);
  const [status, setStatus] = useState<string>(params?.status || 'open');
  const totals = useLoad(() => groupId ? api.get('/savings/dues', { groupId, status, pageSize: 1 }) : Promise.resolve(null), [groupId, status]);
  const list = usePaged(async p => {
    if (!groupId) return { items: [], hasMore: false };
    const r = await api.get('/savings/dues', { groupId, status, page: p, pageSize: 50 });
    return { items: r.dues, hasMore: r.dues.length === 50 };
  }, [groupId, status]);
  const gen = useSubmit();
  const tt = (totals.data as any)?.totals;
  const [result, setResult] = useState<{ created: number; ahead: boolean } | null>(null);
  const nextMonthStart = (() => { const d = new Date(); return toIso(new Date(d.getFullYear(), d.getMonth() + 1, 1)); })();
  const generate = async (ahead: boolean) => {
    setResult(null);
    const res = await gen.submit(() => api.post('/savings/dues/generate', { groupId, upTo: ahead ? nextMonthStart : isoToday() }));
    if (res) { setResult({ created: res.created, ahead }); bump(); }
  };
  return (
    <Screen title={t('sav_dues')} onRefresh={list.reload} refreshing={list.refreshing}>
      <GroupPicker />
      <NeedGroup>
        <Btn kind="secondary" title={t('sav_generate')} onPress={() => generate(false)} busy={gen.busy} />
        {!!gen.error && <ErrorBox message={gen.error} />}
        {result && result.created > 0 && <Notice tone="green" text={t('sav_generated', { n: result.created })} />}
        {result && result.created === 0 && (
          <>
            <Notice text={result.ahead ? t('sav_noneAhead') : t('sav_noneYet')} />
            {!result.ahead && <Btn small kind="ghost" title={t('sav_generateAhead')} onPress={() => generate(true)} busy={gen.busy} />}
          </>
        )}
        <Chips value={status} onChange={setStatus} options={[
          { value: 'open', label: t('sav_open') }, { value: 'overdue', label: t('sav_overdue') }, { value: 'Paid', label: st('Paid') }, { value: '', label: t('common_all') },
        ]} />
        {tt && (
          <StatGrid>
            <Stat label={t('sav_totalDue')} value={inr(tt.due)} />
            <Stat label={t('sav_totalPaid')} value={inr(tt.paid)} tone="green" />
          </StatGrid>
        )}
        <Gate loading={list.loading} error={list.error} onRetry={list.reload} empty={!list.items.length} emptyText={t('sav_noDues')}>
          {(
            <>
              {list.items.map((x: any) => (
                <ListItem key={x.id} title={`#${x.memberNumber} ${x.memberName}`} subtitle={`${fmtDate(x.periodStart)} · ${t('sav_due')} ${fmtDate(x.dueDate)}`}
                  right={inr(x.balance)} badge={x.status} onPress={() => push('collectSavings', { memberId: x.memberId })} />
              ))}
              <LoadMore list={list} />
            </>
          )}
        </Gate>
      </NeedGroup>
    </Screen>
  );
}

export function SavingsLedgerScreen() {
  const { api, t, groupId } = useShg();
  const { data, loading, error, reload, refreshing } = useLoad(
    () => groupId ? api.get('/savings/ledger', { groupId }) : Promise.resolve(null), [groupId]);
  const rows = (data as any)?.ledger || [];
  return (
    <Screen title={t('sav_ledger')} onRefresh={reload} refreshing={refreshing}>
      <GroupPicker />
      <NeedGroup>
        <Gate loading={loading} error={error} onRetry={reload} empty={!rows.length} emptyText={t('common_noRecords')}>
          {rows.map((r: any, i: number) => (
            <ListItem key={i} title={`#${r.memberNumber} ${r.memberName}`} subtitle={`${fmtDate(r.txnDate)} · ${r.receiptNumber || r.txnNumber}`}
              right={Number(r.deposit) ? `+${inr(r.deposit)}` : `−${inr(r.withdrawal)}`} meta={`${t('common_balance')} ${inr(r.runningBalance)}`}
              badge={r.postingStatus === 'Reversed' ? 'Reversed' : null} />
          ))}
        </Gate>
      </NeedGroup>
    </Screen>
  );
}

export function useResolutionOptions(type: string, loanId?: number) {
  const { api, groupId } = useShg();
  const { data } = useLoad(() => groupId ? api.get('/resolutions', { groupId, type, loanId, usable: 1 }) : Promise.resolve({ resolutions: [] }),
    [groupId, type, loanId]);
  return ((data as any)?.resolutions || []).map((r: any) => ({
    value: String(r.id),
    label: `#${r.meetingNumber}/${r.resolutionNumber} · ${fmtDate(r.meetingDate)} · ${r.subject}${r.amount ? ` · ${inr(r.amount)}` : ''}`,
  }));
}

export function WithdrawSavingsScreen() {
  const { api, t, replace, bump, groupId } = useShg();
  const [member, setMember] = useState<any>(null);
  const banks = useBankOptions();
  const resolutions = useResolutionOptions('SAVINGS_WITHDRAWAL');
  const [values, setValues] = useState<Record<string, any>>({ paymentMethod: 'Cash', txnDate: isoToday() });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { submit, busy, error, pending } = useSubmit();
  const fields: FieldSpec[] = [
    { key: 'amount', label: t('common_amount'), type: 'money', required: true },
    { key: 'resolutionId', label: t('res_authorizing'), type: 'select', required: true, options: resolutions, help: resolutions.length ? undefined : t('res_noneUsable') },
    ...paymentFields(t, values, banks),
    { key: 'notes', label: t('common_notes') },
  ];
  const save = () => {
    const errs = validate(fields, values, t);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    confirm(t('sav_withdraw'), `${member.fullName}: ${inr(values.amount)}`, t('common_confirm'), t('common_cancel'), async () => {
      const res = await submit(key => api.post('/savings/withdraw', {
        ...values, memberId: member.id, resolutionId: Number(values.resolutionId),
        bankAccountId: values.bankAccountId ? Number(values.bankAccountId) : undefined,
      }, key));
      if (res) { bump(); replace('receipt', { id: res.transaction.id }); }
    });
  };
  return (
    <Screen title={t('sav_withdraw')}>
      <Notice tone="blue" text={t('sav_withdrawHint')} />
      {!member ? (
        <><GroupPicker /><NeedGroup><MemberChooser onPick={setMember} /></NeedGroup></>
      ) : (
        <>
          <Card><KV label={member.fullName} value={inr(member.savingsBalance)} strong /><Btn small kind="ghost" title={t('sav_changeMember')} onPress={() => setMember(null)} /></Card>
          <Form fields={fields} values={values} onChange={(k, v) => setValues(p => ({ ...p, [k]: v }))} errors={errors} />
          {!!error && <ErrorBox message={error} />}
          <Btn title={pending ? t('common_retrySame') : t('common_save')} onPress={save} busy={busy} disabled={!groupId} />
        </>
      )}
    </Screen>
  );
}

export function TransactionsScreen({ params }: { params?: any }) {
  const { api, t, push, groupId } = useShg();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [status, setStatus] = useState('');
  const list = usePaged(async p => {
    const r = await api.get('/transactions', { groupId: groupId || undefined, type: params?.type, q: dq, page: p, postingStatus: status || undefined });
    return { items: r.transactions, hasMore: r.transactions.length === r.pageSize };
  }, [groupId, params?.type, dq, status]);
  return (
    <Screen title={params?.title || t('nav_transactions')} onRefresh={list.reload} refreshing={list.refreshing}>
      <GroupPicker allowAll />
      <SearchBar value={q} onChange={setQ} placeholder={t('txn_search')} />
      <Chips value={status} onChange={setStatus} options={[{ value: '', label: t('common_all') }, { value: 'Posted', label: t('st_Posted') }, { value: 'Reversed', label: t('st_Reversed') }]} />
      <Gate loading={list.loading} error={list.error} onRetry={list.reload} empty={!list.items.length} emptyText={t('common_noRecords')}>
        {list.items.map((x: any) => <TxnItem key={x.id} txn={x} onPress={() => push('receipt', { id: x.id })} />)}
        <LoadMore list={list} />
      </Gate>
    </Screen>
  );
}

