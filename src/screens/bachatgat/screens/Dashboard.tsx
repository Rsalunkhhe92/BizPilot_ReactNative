import React, { useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { fmtDate, inr, isoToday, monthStartIso, fyStartIso, receiptHtml } from '../format';
import {
  Badge, Btn, BtnRow, Card, Chips, Empty, Gate, KV, ListItem, Notice, Screen, SectionTitle, Stat, StatGrid, s, useLoad, useShg,
  useSubmit, confirm, ErrorBox,
} from '../ui';
import { ShgKey } from '../i18n';
import { useGatewaySync } from './Online';

export const TXN_LABEL: Record<string, ShgKey> = {
  SAVINGS_DEPOSIT: 'txn_SAVINGS_DEPOSIT', SAVINGS_WITHDRAWAL: 'txn_SAVINGS_WITHDRAWAL', SAVINGS_LOAN_OFFSET: 'txn_SAVINGS_LOAN_OFFSET',
  LOAN_DISBURSEMENT: 'txn_LOAN_DISBURSEMENT', LOAN_REPAYMENT: 'txn_LOAN_REPAYMENT', LOAN_WRITE_OFF: 'txn_LOAN_WRITE_OFF',
  OPERATING_EXPENSE: 'txn_OPERATING_EXPENSE', OTHER_INCOME: 'txn_OTHER_INCOME', BUSINESS_INCOME: 'txn_BUSINESS_INCOME',
  BUSINESS_EXPENSE: 'txn_BUSINESS_EXPENSE', BANK_CHARGES: 'txn_BANK_CHARGES', BANK_INTEREST: 'txn_BANK_INTEREST',
  GRANT_RECEIVED: 'txn_GRANT_RECEIVED', BANK_LOAN_RECEIVED: 'txn_BANK_LOAN_RECEIVED', BANK_LOAN_REPAYMENT: 'txn_BANK_LOAN_REPAYMENT',
  BANK_DEPOSIT: 'txn_BANK_DEPOSIT', BANK_WITHDRAWAL: 'txn_BANK_WITHDRAWAL', OPENING_BALANCE: 'txn_OPENING_BALANCE', REVERSAL: 'txn_REVERSAL',
};

export function useTxnLabel() {
  const { t } = useShg();
  return (type?: string) => (type && TXN_LABEL[type] ? t(TXN_LABEL[type]) : type || '');
}

const INFLOW = new Set(['SAVINGS_DEPOSIT', 'LOAN_REPAYMENT', 'OTHER_INCOME', 'BUSINESS_INCOME', 'BANK_INTEREST', 'GRANT_RECEIVED',
  'BANK_LOAN_RECEIVED', 'OPENING_BALANCE']);

export function TxnItem({ txn, onPress }: { txn: any; onPress?: () => void }) {
  const label = useTxnLabel();
  const sign = INFLOW.has(txn.txnType) ? '+' : txn.txnType === 'REVERSAL' || txn.txnType.startsWith('BANK_DEP') || txn.txnType.startsWith('BANK_WITH') ? '' : '−';
  return (
    <ListItem
      title={label(txn.txnType)}
      subtitle={[txn.memberName, txn.applicationNumber, txn.narration].filter(Boolean).join(' · ') || txn.groupName}
      meta={`${fmtDate(txn.txnDate)} · ${txn.receiptNumber || txn.txnNumber} · ${txn.paymentMethod}`}
      right={`${sign}${inr(txn.amount)}`}
      badge={txn.postingStatus === 'Reversed' ? 'Reversed' : null}
      onPress={onPress}
    />
  );
}

type Period = 'today' | 'month' | 'fy';

export function DashboardScreen() {
  const { api, t, push, groupId, groups, has, ownerName } = useShg();
  useGatewaySync(groupId);
  const [period, setPeriod] = useState<Period>('month');
  const [scope, setScope] = useState<'all' | 'group'>('all');
  const from = period === 'today' ? isoToday() : period === 'month' ? monthStartIso() : fyStartIso();
  const { data, loading, error, reload, refreshing } = useLoad(
    () => api.get('/dashboard', { from, to: isoToday(), groupId: scope === 'group' ? groupId : undefined }),
    [from, scope, groupId],
  );
  const currentGroup = groups.find(g => g.id === groupId);
  const actions: { icon: string; label: ShgKey; route: string; params?: any; feature: string }[] = [
    { icon: '🏘️', label: 'qa_createGroup', route: 'groupForm', feature: 'shg_groups' },
    { icon: '👩', label: 'qa_addMember', route: 'memberForm', feature: 'shg_members' },
    { icon: '💰', label: 'qa_collectSavings', route: 'collectSavings', feature: 'shg_savings' },
    { icon: '📝', label: 'qa_applyLoan', route: 'loanForm', feature: 'shg_loans' },
    { icon: '✅', label: 'qa_approveLoan', route: 'loans', params: { status: 'pending' }, feature: 'shg_loans' },
    { icon: '💸', label: 'qa_disburseLoan', route: 'loans', params: { status: 'Approved' }, feature: 'shg_loans' },
    { icon: '🧾', label: 'qa_collectRepayment', route: 'collectRepayment', feature: 'shg_loans' },
    { icon: '📅', label: 'qa_scheduleMeeting', route: 'meetingForm', feature: 'shg_meetings' },
    { icon: '🙋', label: 'qa_markAttendance', route: 'meetings', feature: 'shg_meetings' },
    { icon: '➖', label: 'qa_addExpense', route: 'txnForm', params: { txnType: 'OPERATING_EXPENSE' }, feature: 'shg_accounts' },
    { icon: '🛍️', label: 'qa_recordSale', route: 'business', feature: 'shg_business' },
    { icon: '📊', label: 'qa_reports', route: 'reports', feature: 'shg_reports' },
  ];
  const d = data as any;
  return (
    <Screen
      title={t('mod_title')}
      subtitle={ownerName}
      noBack
      onRefresh={reload}
      refreshing={refreshing}
      right={
        <Pressable onPress={() => push('notifications')} accessibilityRole="button" accessibilityLabel={t('nav_notifications')} hitSlop={10} style={{ padding: 6 }}>
          <Text style={{ fontSize: 22 }}>🔔</Text>
          {!!d?.unreadNotifications && (
            <View style={{ position: 'absolute', right: 0, top: 0, backgroundColor: '#DC2626', borderRadius: 9, minWidth: 18, paddingHorizontal: 4 }}>
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800', textAlign: 'center' }}>{d.unreadNotifications}</Text>
            </View>
          )}
        </Pressable>
      }>
      <Chips<Period> value={period} onChange={setPeriod} options={[
        { value: 'today', label: t('period_today') }, { value: 'month', label: t('period_month') }, { value: 'fy', label: t('period_fy') },
      ]} />
      {!!currentGroup && (
        <Chips<'all' | 'group'> value={scope} onChange={setScope} options={[
          { value: 'all', label: t('dash_allGroups') }, { value: 'group', label: currentGroup.nameEn },
        ]} />
      )}
      <View style={{ height: 8 }} />
      <Gate loading={loading && !d} error={error} onRetry={reload}>
        {d && (
          <>
            {d.groups.total === 0 && (
              <Card>
                <Text style={{ fontSize: 16, fontWeight: '800', marginBottom: 6 }}>{t('dash_welcome')}</Text>
                <Text style={{ marginBottom: 10 }}>{t('dash_welcomeHint')}</Text>
                {has('shg_groups') && <Btn title={t('qa_createGroup')} onPress={() => push('groupForm')} />}
              </Card>
            )}
            <StatGrid>
              <Stat label={t('dash_groups')} value={`${d.groups.active}/${d.groups.total}`} onPress={() => push('groups')} />
              <Stat label={t('dash_activeMembers')} value={String(d.members.active)} tone="blue" onPress={() => push('members')} />
              <Stat label={t('dash_savingsCollected')} value={inr(d.savingsCollected)} tone="green" />
              <Stat label={t('dash_savingsLiability')} value={inr(d.savingsLiability)} tone="green" />
              <Stat label={t('dash_loanOutstanding')} value={inr(d.loanOutstanding)} tone="brand" onPress={() => push('loans', { status: 'open' })} />
              <Stat label={t('dash_repayments')} value={inr(d.repaymentsCollected)} tone="green" />
              <Stat label={t('dash_overdue')} value={`${d.overdue.installments} · ${inr(d.overdue.amount)}`} tone={d.overdue.installments ? 'red' : 'green'}
                onPress={() => push('installments', { overdue: true })} />
              <Stat label={t('dash_pendingApprovals')} value={String(d.pendingApprovals.total)} tone={d.pendingApprovals.total ? 'amber' : 'green'}
                onPress={() => push('approvals', { counts: d.pendingApprovals })} />
              <Stat label={t('dash_cash')} value={inr(d.cashBalance)} tone="blue" />
              <Stat label={t('dash_bank')} value={inr(d.bankBalance)} tone="blue" />
              {has('shg_business') && <Stat label={t('dash_businessIncome')} value={inr(d.business.income)} tone="green" />}
              {has('shg_business') && <Stat label={t('dash_businessExpense')} value={inr(d.business.expense)} tone="amber" />}
            </StatGrid>

            <SectionTitle>{t('dash_quickActions')}</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginBottom: 8 }}>
              {actions.filter(a => has(a.feature)).map(a => (
                <Pressable
                  key={a.label}
                  onPress={() => push(a.route, a.params)}
                  accessibilityRole="button"
                  accessibilityLabel={t(a.label)}
                  style={({ pressed }) => [{ width: '33.33%', padding: 4 }, pressed && { opacity: 0.7 }]}>
                  <QuickTile icon={a.icon} label={t(a.label)} />
                </Pressable>
              ))}
            </View>

            {has('shg_meetings') && (
              <>
                <SectionTitle right={<Btn small kind="ghost" title={t('common_viewAll')} onPress={() => push('meetings')} />}>{t('dash_upcomingMeetings')}</SectionTitle>
                {d.upcomingMeetings.length ? d.upcomingMeetings.map((m: any) => (
                  <ListItem key={m.id} title={`#${m.meetingNumber} · ${m.groupName}`} subtitle={[fmtDate(m.meetingDate), m.meetingTime, m.location].filter(Boolean).join(' · ')}
                    onPress={() => push('meetingDetail', { id: m.id })} badge="Scheduled" />
                )) : <Empty text={t('dash_noMeetings')} />}
              </>
            )}

            <SectionTitle right={has('shg_accounts') ? <Btn small kind="ghost" title={t('common_viewAll')} onPress={() => push('transactions')} /> : undefined}>
              {t('dash_recentTxns')}
            </SectionTitle>
            {d.recentTransactions.length ? d.recentTransactions.map((x: any) => (
              <TxnItem key={x.id} txn={x} onPress={() => push('receipt', { id: x.id })} />
            )) : <Empty text={t('dash_noTxns')} />}
          </>
        )}
      </Gate>
    </Screen>
  );
}

function QuickTile({ icon, label }: { icon: string; label: string }) {
  const { c } = useShg();
  return (
    <View style={{ backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center', minHeight: 84, padding: 8 }}>
      <Text style={{ fontSize: 24 }}>{icon}</Text>
      <Text style={{ color: c.text, fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 4 }} numberOfLines={2}>{label}</Text>
    </View>
  );
}

export function ApprovalsScreen({ params }: { params: any }) {
  const { t, push } = useShg();
  const counts = params?.counts || {};
  return (
    <Screen title={t('dash_pendingApprovals')}>
      <ListItem title={t('appr_groups')} right={String(counts.groups ?? 0)} onPress={() => push('groups', { status: 'Pending Approval' })} />
      <ListItem title={t('appr_members')} right={String(counts.members ?? 0)} onPress={() => push('members', { status: 'Pending' })} />
      <ListItem title={t('appr_loans')} right={String(counts.loans ?? 0)} onPress={() => push('loans', { status: 'pending' })} />
      <ListItem title={t('appr_disbursements')} right={String(counts.disbursements ?? 0)} onPress={() => push('loans', { status: 'Approved' })} />
      <ListItem title={t('appr_documents')} right={String(counts.documents ?? 0)} onPress={() => push('groups')} />
    </Screen>
  );
}

export function NotificationsScreen() {
  const { api, t, push } = useShg();
  const { data, loading, error, reload, refreshing } = useLoad(() => api.get('/notifications'), []);
  const open = async (n: any) => {
    if (!n.isRead) api.post(`/notifications/${n.id}/read`).catch(() => {});
    if (n.entityType === 'LOAN' && n.entityId) push('loanDetail', { id: n.entityId });
    else if (n.entityType === 'MEETING' && n.entityId) push('meetingDetail', { id: n.entityId });
    else if (n.entityType === 'MEMBER' && n.entityId) push('memberDetail', { id: n.entityId });
    else if (n.entityType === 'TRANSACTION' && n.entityId) push('receipt', { id: n.entityId });
    else if (n.entityType === 'SCHEME' && n.entityId) push('schemeDetail', { id: n.entityId });
    else if (n.groupId) push('groupDetail', { id: n.groupId });
  };
  const list = (data as any)?.notifications || [];
  return (
    <Screen title={t('nav_notifications')} onRefresh={reload} refreshing={refreshing}
      right={list.length ? <Btn small kind="ghost" title={t('notif_markAll')} onPress={() => api.post('/notifications/read-all').then(reload)} /> : undefined}>
      <Gate loading={loading} error={error} onRetry={reload} empty={!list.length} emptyText={t('notif_none')}>
        {list.map((n: any) => (
          <ListItem key={n.id} title={`${n.isRead ? '' : '● '}${n.title}`} subtitle={n.body} meta={`${n.groupName || ''} · ${fmtDate(n.createdAt)}`} onPress={() => open(n)} />
        ))}
      </Gate>
    </Screen>
  );
}

export function ReceiptScreen({ params }: { params: { id: number } }) {
  const { api, t, push, has, bump } = useShg();
  const label = useTxnLabel();
  const { data, loading, error, reload } = useLoad(() => api.get(`/transactions/${params.id}/receipt`), [params.id]);
  const reverse = useSubmit();
  const [reason, setReason] = useState('');
  const [showReverse, setShowReverse] = useState(false);
  const r = (data as any)?.receipt;
  const share = async () => {
    try {
      const html = receiptHtml(r, {
        title: t('rcpt_title'), receiptNo: t('rcpt_no'), date: t('common_date'), member: t('common_member'), type: t('common_type'),
        typeValue: label(r.txnType), loan: t('common_loan'), principal: t('loan_principal'), interest: t('loan_interest'),
        penalty: t('loan_penalty'), mode: t('common_paymentMethod'), amount: t('common_amount'), savingsBalance: t('mem_savingsBalance'),
        loanBalance: t('loan_outstanding'), status: t('common_status'), reversed: t('st_Reversed'), treasurer: t('role_Treasurer'),
        president: t('role_President'),
      });
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: t('rcpt_title') });
      else Alert.alert(t('common_error'), t('err_shareUnavailable'));
    } catch {
      Alert.alert(t('common_error'), t('err_pdf'));
    }
  };
  const doReverse = async () => {
    if (reason.trim().length < 3) return reverse.setError(t('txn_reasonNeeded'));
    const res = await reverse.submit(key => api.post(`/transactions/${params.id}/reverse`, { reason }, key));
    if (res) { setShowReverse(false); bump(); reload(); }
  };
  return (
    <Screen title={t('rcpt_title')}>
      <Gate loading={loading} error={error} onRetry={reload}>
        {r && (
          <>
            <Card>
              <Text style={{ fontSize: 13, textAlign: 'center', fontWeight: '700' }}>{r.groupNameMr || ''}</Text>
              <Text style={{ fontSize: 16, textAlign: 'center', fontWeight: '800', marginBottom: 8 }}>{r.groupNameEn}</Text>
              <KV label={t('rcpt_no')} value={r.receiptNumber || r.txnNumber} />
              <KV label={t('common_date')} value={fmtDate(r.txnDate)} />
              <KV label={t('common_type')} value={label(r.txnType)} />
              {!!r.memberName && <KV label={t('common_member')} value={`${r.memberName} (#${r.memberNumber})`} />}
              {!!r.applicationNumber && <KV label={t('common_loan')} value={r.applicationNumber} />}
              {!!Number(r.principalAmount) && <KV label={t('loan_principal')} value={inr(r.principalAmount)} />}
              {!!Number(r.interestAmount) && <KV label={t('loan_interest')} value={inr(r.interestAmount)} />}
              {!!Number(r.penaltyAmount) && <KV label={t('loan_penalty')} value={inr(r.penaltyAmount)} />}
              <KV label={t('common_paymentMethod')} value={`${r.paymentMethod}${r.bankLast4 ? ` · ••${r.bankLast4}` : ''}`} />
              {!!r.referenceNumber && <KV label={t('common_reference')} value={r.referenceNumber} />}
              {!!r.narration && <KV label={t('common_notes')} value={r.narration} />}
              <KV label={t('common_amount')} value={inr(r.amount)} strong />
              {r.savingsBalance !== undefined && <KV label={t('mem_savingsBalance')} value={inr(r.savingsBalance)} />}
              {r.loanPrincipalOutstanding !== undefined && <KV label={t('loan_outstanding')} value={inr(r.loanPrincipalOutstanding)} />}
              <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 8 }}><Badge value={r.postingStatus} /></View>
              {!!r.reversalReason && <Notice text={`${t('txn_reversalReason')}: ${r.reversalReason}`} tone="red" />}
            </Card>
            <Btn title={t('rcpt_sharePdf')} icon="📄" onPress={share} />
            {r.memberId && <Btn kind="secondary" title={t('mem_openProfile')} onPress={() => push('memberDetail', { id: r.memberId })} />}
            {r.loanId && <Btn kind="secondary" title={t('loan_open')} onPress={() => push('loanDetail', { id: r.loanId })} />}
            {has('shg_accounts') && r.postingStatus === 'Posted' && r.txnType !== 'REVERSAL' && r.txnType !== 'LOAN_WRITE_OFF' && (
              showReverse ? (
                <Card>
                  <Text style={[s.label]}>{t('txn_reversalReason')} *</Text>
                  <SimpleInput value={reason} onChange={setReason} label={t('txn_reversalReason')} />
                  {!!reverse.error && <ErrorBox message={reverse.error} />}
                  <BtnRow>
                    <Btn kind="danger" title={reverse.pending ? t('common_retrySame') : t('txn_reverse')} busy={reverse.busy}
                      onPress={() => confirm(t('txn_reverse'), t('txn_reverseConfirm'), t('txn_reverse'), t('common_cancel'), doReverse, true)} />
                    <Btn kind="ghost" title={t('common_cancel')} onPress={() => setShowReverse(false)} />
                  </BtnRow>
                </Card>
              ) : <Btn kind="ghost" title={t('txn_reverse')} onPress={() => setShowReverse(true)} />
            )}
          </>
        )}
      </Gate>
    </Screen>
  );
}

export function SimpleInput({ value, onChange, label, multiline }: { value: string; onChange: (v: string) => void; label: string; multiline?: boolean }) {
  const { c } = useShg();
  return (
    <View style={[s.inputWrap, { backgroundColor: c.input, borderColor: c.border, marginBottom: 8 }]}>
      <TextInput value={value} onChangeText={onChange} accessibilityLabel={label} placeholder={label} placeholderTextColor={c.muted}
        multiline={multiline} style={[s.input, { color: c.text }, multiline && { minHeight: 80, textAlignVertical: 'top' }]} />
    </View>
  );
}

export function MoreScreen() {
  const { t, push, has } = useShg();
  const items: { icon: string; label: ShgKey; route: string; feature?: string }[] = [
    { icon: '📅', label: 'nav_meetings', route: 'meetings', feature: 'shg_meetings' },
    { icon: '📒', label: 'nav_accounts', route: 'accounts', feature: 'shg_accounts' },
    { icon: '🧵', label: 'nav_business', route: 'business', feature: 'shg_business' },
    { icon: '🏦', label: 'nav_schemes', route: 'schemes', feature: 'shg_schemes' },
    { icon: '📊', label: 'nav_reports', route: 'reports', feature: 'shg_reports' },
    { icon: '⚙️', label: 'nav_settings', route: 'settings', feature: 'shg_settings' },
    { icon: '🔔', label: 'nav_notifications', route: 'notifications' },
  ];
  return (
    <Screen title={t('nav_more')} noBack>
      {items.filter(i => !i.feature || has(i.feature)).map(i => (
        <ListItem key={i.route} title={`${i.icon}  ${t(i.label)}`} onPress={() => push(i.route)} />
      ))}
    </Screen>
  );
}
