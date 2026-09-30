/**
 * CollectionAgentView.tsx
 * Dedicated Field Collection Management Screen for AutoLedger Mobile
 *
 * Designed for field collection agents (e.g. bank/finance/loan recovery agents)
 * who visit daily assigned customers (e.g. 50 customers per beat), collect money,
 * record payment modes (Cash/UPI/Bank), log visit outcomes (Not Available, Refused,
 * Rescheduled, Missed), issue receipts (REC-YYYYMMDD-XXXX), and complete end-of-day reconciliation.
 */

import React, { useEffect, useState, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

interface CustomerUser {
  id: number;
  fullName: string;
  email: string;
  userType: string;
  status: string;
  businessType: string;
  dob?: string;
  enabledFeatures?: string[];
}

interface ScheduleItem {
  id: number;
  customer_id: number;
  customer_name: string;
  account_number: string;
  phone: string;
  address: string;
  area_name: string;
  route_id?: number;
  route_name?: string;
  visit_sequence: number;
  expected_amount: number;
  collected_amount: number;
  status: 'PENDING' | 'COLLECTED' | 'NOT_AVAILABLE' | 'RESCHEDULED' | 'REFUSED' | 'MISSED' | 'PARTIAL_PAYMENT';
  payment_method?: string;
  receipt_number?: string;
  notes?: string;
  next_followup_date?: string;
  balance_amount?: number;
  updated_at?: string;
}

interface DailySummary {
  date: string;
  totalAssigned: number;
  totalCollected: number;
  totalPending: number;
  totalNotAvailable: number;
  totalRescheduled: number;
  totalRefused: number;
  totalMissed: number;
  totalExpected: number;
  totalCollectedAmount: number;
  totalPendingAmount: number;
  cashAmount: number;
  upiAmount: number;
  bankAmount: number;
  closingStatus: 'OPEN' | 'CLOSED';
  collectionRate: number;
  closingNotes?: string;
}

interface ReceiptData {
  receipt_number: string;
  created_at: string;
  customer_name: string;
  customer_account: string;
  phone?: string;
  area_name?: string;
  collector_name: string;
  amount_paid: number;
  payment_method: string;
  transaction_ref?: string;
  previous_balance: number;
  updated_balance: number;
  notes?: string;
}

interface Props {
  user: CustomerUser;
  apiFetch: (path: string, options?: RequestInit) => Promise<Response>;
  onLogout?: () => void;
}

export default function CollectionAgentView({ user, apiFetch }: Props) {
  const [selectedDate, setSelectedDate] = useState('2026-09-07');
  const [activeSubTab, setActiveSubTab] = useState<'visits' | 'missed' | 'closing'>('visits');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Data states
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Modal states
  const [collectItem, setCollectItem] = useState<ScheduleItem | null>(null);
  const [collectAmount, setCollectAmount] = useState('');
  const [collectMethod, setCollectMethod] = useState<'Cash' | 'UPI' | 'Bank Transfer'>('Cash');
  const [collectRef, setCollectRef] = useState('');
  const [collectNotes, setCollectNotes] = useState('');
  const [collecting, setCollecting] = useState(false);

  const [statusItem, setStatusItem] = useState<ScheduleItem | null>(null);
  const [statusChoice, setStatusChoice] = useState<'NOT_AVAILABLE' | 'RESCHEDULED' | 'REFUSED' | 'MISSED'>('NOT_AVAILABLE');
  const [statusReason, setStatusReason] = useState('');
  const [followupDate, setFollowupDate] = useState('2026-09-08');
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const [receiptModal, setReceiptModal] = useState<ReceiptData | null>(null);

  // End of Day Closing states
  const [physicalCashCount, setPhysicalCashCount] = useState('');
  const [closingRemarks, setClosingRemarks] = useState('');
  const [submittingClosing, setSubmittingClosing] = useState(false);

  useEffect(() => {
    loadData();
  }, [selectedDate]);

  async function loadData() {
    setLoading(true);
    try {
      const [sumRes, schedRes] = await Promise.all([
        apiFetch(`/api/collection/daily-summary?date=${selectedDate}&collector_id=${user.id}`),
        apiFetch(`/api/collection/today?date=${selectedDate}&collector_id=${user.id}`),
      ]);

      if (sumRes.ok) {
        const sumData = await sumRes.json();
        if (sumData.summary) setSummary(sumData.summary);
      }
      if (schedRes.ok) {
        const schedData = await schedRes.json();
        if (schedData.schedule) setSchedule(schedData.schedule);
      }
    } catch (err) {
      console.error('Error loading collection data:', err);
      Alert.alert('Connection Error', 'Could not load today\'s collection schedule from server.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  function onRefresh() {
    setRefreshing(true);
    loadData();
  }

  // Open Payment Modal
  function openCollectModal(item: ScheduleItem) {
    if (summary?.closingStatus === 'CLOSED') {
      Alert.alert('Day Closed', 'This collection day has been reconciled and closed. No new payments can be recorded.');
      return;
    }
    setCollectItem(item);
    setCollectAmount(String(item.expected_amount || 1000));
    setCollectMethod('Cash');
    setCollectRef('');
    setCollectNotes('');
  }

  // Submit Payment
  async function submitPayment() {
    if (!collectItem) return;
    const amt = parseFloat(collectAmount);
    if (isNaN(amt) || amt <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount greater than ₹0.');
      return;
    }
    if ((collectMethod === 'UPI' || collectMethod === 'Bank Transfer') && !collectRef.trim()) {
      Alert.alert('Reference Required', 'Transaction UTR / Reference ID is mandatory for UPI and Bank Transfer payments.');
      return;
    }

    setCollecting(true);
    try {
      const res = await apiFetch('/api/collection/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schedule_id: collectItem.id,
          amount: amt,
          payment_method: collectMethod,
          transaction_ref: collectRef.trim() || undefined,
          notes: collectNotes.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (res.ok && data.receipt) {
        setCollectItem(null);
        await loadData();
        setReceiptModal(data.receipt);
      } else {
        Alert.alert('Payment Failed', data.error || 'Could not record collection.');
      }
    } catch (err) {
      Alert.alert('Error', 'Network request failed.');
    } finally {
      setCollecting(false);
    }
  }

  // Open Status Modal
  function openStatusModal(item: ScheduleItem) {
    if (summary?.closingStatus === 'CLOSED') {
      Alert.alert('Day Closed', 'This collection day has been reconciled and closed.');
      return;
    }
    setStatusItem(item);
    setStatusChoice('NOT_AVAILABLE');
    setStatusReason('');
    setFollowupDate('2026-09-08');
  }

  // Submit Status
  async function submitStatus() {
    if (!statusItem) return;
    if (!statusReason.trim()) {
      Alert.alert('Reason Required', 'Please provide a reason or customer remarks.');
      return;
    }

    setUpdatingStatus(true);
    try {
      let res: Response;
      if (statusChoice === 'RESCHEDULED') {
        if (!followupDate) {
          Alert.alert('Date Required', 'Next follow-up date is required for rescheduling.');
          setUpdatingStatus(false);
          return;
        }
        res = await apiFetch('/api/collection/reschedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            schedule_id: statusItem.id,
            reschedule_date: followupDate,
            reason: statusReason.trim(),
          }),
        });
      } else {
        res = await apiFetch('/api/collection/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            schedule_id: statusItem.id,
            status: statusChoice,
            reason: statusReason.trim(),
            next_followup_date: followupDate || undefined,
          }),
        });
      }

      const data = await res.json();
      if (res.ok) {
        setStatusItem(null);
        await loadData();
        Alert.alert('Status Updated', `Customer #${statusItem.visit_sequence} marked as ${statusChoice.replace('_', ' ')}.`);
      } else {
        Alert.alert('Update Failed', data.error || 'Could not update status.');
      }
    } catch (err) {
      Alert.alert('Error', 'Network request failed.');
    } finally {
      setUpdatingStatus(false);
    }
  }

  // View Receipt
  async function viewReceipt(receiptNum: string) {
    try {
      const res = await apiFetch(`/api/collection/receipts/${receiptNum}`);
      const data = await res.json();
      if (res.ok && data.receipt) {
        setReceiptModal(data.receipt);
      } else {
        Alert.alert('Receipt Not Found', data.error || 'Could not fetch receipt details.');
      }
    } catch {
      Alert.alert('Error', 'Could not load receipt.');
    }
  }

  // Share Receipt
  async function shareReceipt(receipt: ReceiptData) {
    try {
      const msg = `*AutoLedger Collection Receipt*\n` +
        `Receipt #: ${receipt.receipt_number}\n` +
        `Date: ${new Date(receipt.created_at).toLocaleDateString()}\n` +
        `Customer: ${receipt.customer_name} (${receipt.customer_account})\n` +
        `Collector: ${receipt.collector_name}\n` +
        `--------------------------------\n` +
        `*Amount Paid: ₹${Number(receipt.amount_paid).toLocaleString('en-IN', { minimumFractionDigits: 2 })}*\n` +
        `Payment Mode: ${receipt.payment_method} ${receipt.transaction_ref ? `(${receipt.transaction_ref})` : ''}\n` +
        `Remaining Outstanding: ₹${Number(receipt.updated_balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}\n` +
        `--------------------------------\n` +
        `Thank you for your payment. AutoLedger Field Services.`;

      await Share.share({
        message: msg,
        title: `Payment Receipt ${receipt.receipt_number}`,
      });
    } catch (err) {
      console.error(err);
    }
  }

  // Submit End of Day Closing
  async function submitDailyClosing() {
    const cashVal = parseFloat(physicalCashCount);
    if (isNaN(cashVal) || cashVal < 0) {
      Alert.alert('Cash Count Required', 'Please enter the physical cash counted in your collection bag.');
      return;
    }

    Alert.alert(
      'Confirm End-of-Day Closing',
      `Are you sure you want to close today's collection beat (${selectedDate})?\n\n` +
      `System Cash Expected: ₹${(summary?.cashAmount || 0).toLocaleString()}\n` +
      `Physical Cash in Bag: ₹${cashVal.toLocaleString()}\n\n` +
      `Once submitted, all collection records will be locked.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm & Close Day',
          style: 'destructive',
          onPress: async () => {
            setSubmittingClosing(true);
            try {
              const res = await apiFetch('/api/collection/daily-closing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  date: selectedDate,
                  collector_id: user.id,
                  notes: closingRemarks.trim() || 'Field beat completed and reconciled',
                  physical_cash_count: cashVal,
                }),
              });
              const data = await res.json();
              if (res.ok) {
                Alert.alert('Day Closed Successfully', 'Your field collections are now reconciled and locked for the day.');
                await loadData();
              } else {
                Alert.alert('Closing Failed', data.error || 'Could not close day.');
              }
            } catch {
              Alert.alert('Error', 'Network error while closing collection day.');
            } finally {
              setSubmittingClosing(false);
            }
          },
        },
      ]
    );
  }

  // Filtered schedules for Visits tab
  const filteredSchedule = useMemo(() => {
    return schedule.filter((item) => {
      if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = item.customer_name?.toLowerCase().includes(q);
        const matchAcc = item.account_number?.toLowerCase().includes(q);
        const matchArea = item.area_name?.toLowerCase().includes(q);
        const matchPhone = item.phone?.toLowerCase().includes(q);
        if (!matchName && !matchAcc && !matchArea && !matchPhone) return false;
      }
      return true;
    });
  }, [schedule, statusFilter, searchQuery]);

  // Filtered missed customers
  const missedCustomers = useMemo(() => {
    return schedule.filter(
      (item) => item.status === 'NOT_AVAILABLE' || item.status === 'RESCHEDULED' || item.status === 'REFUSED' || item.status === 'MISSED'
    );
  }, [schedule]);

  const isClosed = summary?.closingStatus === 'CLOSED';
  const visitedCount = (summary?.totalCollected || 0) + (summary?.totalNotAvailable || 0) + (summary?.totalRescheduled || 0) + (summary?.totalRefused || 0) + (summary?.totalMissed || 0);
  const totalCount = summary?.totalAssigned || 50;
  const progressPercent = totalCount > 0 ? Math.round((visitedCount / totalCount) * 100) : 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      showsVerticalScrollIndicator={false}
    >
      {/* AGENT BADGE & STATUS HEADER */}
      <View style={styles.agentHeaderCard}>
        <View style={styles.agentHeaderTopRow}>
          <View>
            <View style={styles.agentTagRow}>
              <Text style={styles.agentRoleTag}>FIELD COLLECTION AGENT</Text>
              <View style={[styles.statusPill, isClosed ? styles.statusPillClosed : styles.statusPillOpen]}>
                <Text style={[styles.statusPillText, isClosed ? styles.statusPillTextClosed : styles.statusPillTextOpen]}>
                  {isClosed ? '🔒 BEAT CLOSED' : '● ACTIVE ROUTE'}
                </Text>
              </View>
            </View>
            <Text style={styles.agentName}>{user.fullName}</Text>
            <Text style={styles.beatInfoText}>📍 Market Yard & Swargate Beat • Date: {selectedDate}</Text>
          </View>
        </View>

        {isClosed && (
          <View style={styles.closedNoticeBanner}>
            <Text style={styles.closedNoticeText}>
              ✓ Today's beat is reconciled and locked. Contact branch admin to reopen if needed.
            </Text>
          </View>
        )}
      </View>

      {/* EXECUTIVE KPI HERO CARDS */}
      <View style={styles.kpiRow}>
        <View style={[styles.kpiCard, { borderColor: '#3b82f6' }]}>
          <Text style={styles.kpiLabel}>TARGET GOAL</Text>
          <Text style={styles.kpiValBlue}>
            ₹{(summary?.totalExpected || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}
          </Text>
          <Text style={styles.kpiSub}>{totalCount} Customers</Text>
        </View>

        <View style={[styles.kpiCard, { borderColor: '#10b981' }]}>
          <Text style={styles.kpiLabel}>COLLECTED</Text>
          <Text style={styles.kpiValGreen}>
            ₹{(summary?.totalCollectedAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}
          </Text>
          <Text style={styles.kpiSub}>{summary?.totalCollected || 0} Accounts Paid</Text>
        </View>

        <View style={[styles.kpiCard, { borderColor: '#f59e0b' }]}>
          <Text style={styles.kpiLabel}>REMAINING</Text>
          <Text style={styles.kpiValAmber}>
            ₹{(summary?.totalPendingAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}
          </Text>
          <Text style={styles.kpiSub}>{summary?.totalPending || 0} Pending</Text>
        </View>
      </View>

      {/* PROGRESS TRACKER */}
      <View style={styles.progressCard}>
        <View style={styles.progressHeader}>
          <Text style={styles.progressTitle}>Daily Route Progress</Text>
          <Text style={styles.progressPercentText}>{visitedCount} / {totalCount} Visited ({progressPercent}%)</Text>
        </View>
        <View style={styles.progressBarTrack}>
          <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
        </View>
        <View style={styles.progressDetailsRow}>
          <Text style={styles.progressMiniStat}>Paid: <Text style={{ color: '#059669', fontWeight: '800' }}>{summary?.totalCollected || 0}</Text></Text>
          <Text style={styles.progressMiniStat}>NA / Rescheduled: <Text style={{ color: '#2563eb', fontWeight: '800' }}>{(summary?.totalNotAvailable || 0) + (summary?.totalRescheduled || 0)}</Text></Text>
          <Text style={styles.progressMiniStat}>Refused: <Text style={{ color: '#dc2626', fontWeight: '800' }}>{summary?.totalRefused || 0}</Text></Text>
          <Text style={styles.progressMiniStat}>Pending: <Text style={{ color: '#d97706', fontWeight: '800' }}>{summary?.totalPending || 0}</Text></Text>
        </View>
      </View>

      {/* CASH & PAYMENT MODE TALLY */}
      <View style={styles.cashTallyCard}>
        <View style={styles.cashTallyItem}>
          <Text style={styles.cashTallyLabel}>💵 Cash in Bag</Text>
          <Text style={styles.cashTallyValueGreen}>
            ₹{(summary?.cashAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}
          </Text>
        </View>
        <View style={styles.cashTallyDivider} />
        <View style={styles.cashTallyItem}>
          <Text style={styles.cashTallyLabel}>📱 UPI Received</Text>
          <Text style={styles.cashTallyValueBlue}>
            ₹{(summary?.upiAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}
          </Text>
        </View>
        <View style={styles.cashTallyDivider} />
        <View style={styles.cashTallyItem}>
          <Text style={styles.cashTallyLabel}>🏦 Bank Transfer</Text>
          <Text style={styles.cashTallyValuePurple}>
            ₹{(summary?.bankAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}
          </Text>
        </View>
      </View>

      {/* SUB-TABS NAVIGATION */}
      <View style={styles.subTabRow}>
        <Pressable
          onPress={() => setActiveSubTab('visits')}
          style={[styles.subTabBtn, activeSubTab === 'visits' && styles.subTabBtnActive]}
        >
          <Text style={[styles.subTabBtnText, activeSubTab === 'visits' && styles.subTabBtnTextActive]}>
            🗺️ Assigned Visits ({schedule.length})
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setActiveSubTab('missed')}
          style={[styles.subTabBtn, activeSubTab === 'missed' && styles.subTabBtnActive]}
        >
          <Text style={[styles.subTabBtnText, activeSubTab === 'missed' && styles.subTabBtnTextActive]}>
            ⚠️ Follow-ups ({missedCustomers.length})
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setActiveSubTab('closing')}
          style={[styles.subTabBtn, activeSubTab === 'closing' && styles.subTabBtnActive]}
        >
          <Text style={[styles.subTabBtnText, activeSubTab === 'closing' && styles.subTabBtnTextActive]}>
            🏁 End of Day Closing
          </Text>
        </Pressable>
      </View>

      {/* TAB 1: VISITS LIST */}
      {activeSubTab === 'visits' && (
        <View>
          {/* SEARCH & FILTERS */}
          <TextInput
            placeholder="🔍 Search customer, account, area..."
            placeholderTextColor="#94a3b8"
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScrollView}>
            {[
              { label: 'All', value: 'ALL', count: schedule.length },
              { label: 'Pending', value: 'PENDING', count: summary?.totalPending || 0 },
              { label: 'Paid', value: 'COLLECTED', count: summary?.totalCollected || 0 },
              { label: 'Not Available', value: 'NOT_AVAILABLE', count: summary?.totalNotAvailable || 0 },
              { label: 'Rescheduled', value: 'RESCHEDULED', count: summary?.totalRescheduled || 0 },
              { label: 'Refused', value: 'REFUSED', count: summary?.totalRefused || 0 },
            ].map((p) => (
              <Pressable
                key={p.value}
                onPress={() => setStatusFilter(p.value)}
                style={[styles.pillBtn, statusFilter === p.value && styles.pillBtnActive]}
              >
                <Text style={[styles.pillBtnText, statusFilter === p.value && styles.pillBtnTextActive]}>
                  {p.label} ({p.count})
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* CUSTOMER VISITS LIST */}
          {loading ? (
            <ActivityIndicator size="large" color="#2563eb" style={{ marginTop: 30 }} />
          ) : filteredSchedule.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No customers match your filter.</Text>
            </View>
          ) : (
            filteredSchedule.map((item) => (
              <View key={item.id} style={styles.customerCard}>
                <View style={styles.cardHeader}>
                  <View style={styles.seqBadge}>
                    <Text style={styles.seqBadgeText}>#{item.visit_sequence}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.custCardName}>{item.customer_name}</Text>
                    <Text style={styles.custCardAcc}>{item.account_number}</Text>
                  </View>
                  <View style={[styles.badgePill, getBadgeStyle(item.status)]}>
                    <Text style={styles.badgePillText}>{item.status.replace('_', ' ')}</Text>
                  </View>
                </View>

                <View style={styles.cardDetailsRow}>
                  <Text style={styles.areaText}>📍 {item.area_name || item.address}</Text>
                  <Pressable
                    onPress={() => Linking.openURL(`tel:${item.phone}`)}
                    style={styles.callButton}
                  >
                    <Text style={styles.callButtonText}>📞 Call {item.phone}</Text>
                  </Pressable>
                </View>

                <View style={styles.amountBox}>
                  <View>
                    <Text style={styles.amountLabel}>Today's Target</Text>
                    <Text style={styles.amountTargetVal}>
                      ₹{Number(item.expected_amount).toLocaleString('en-IN')}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.amountLabel}>
                      {item.collected_amount > 0 ? 'Amount Paid' : 'Total Due'}
                    </Text>
                    <Text style={item.collected_amount > 0 ? styles.amountCollectedVal : styles.amountDueVal}>
                      ₹{Number(item.collected_amount > 0 ? item.collected_amount : (item.balance_amount || 4000)).toLocaleString('en-IN')}
                    </Text>
                  </View>
                </View>

                {item.receipt_number && (
                  <View style={styles.receiptNotice}>
                    <Text style={styles.receiptNoticeText}>
                      ✓ Receipt #{item.receipt_number} ({item.payment_method})
                    </Text>
                  </View>
                )}

                {item.notes && (
                  <Text style={styles.notesText}>Note: "{item.notes}"</Text>
                )}

                {item.next_followup_date && (
                  <Text style={styles.followupDateText}>📅 Next Follow-up: {item.next_followup_date}</Text>
                )}

                {/* ACTION BUTTONS */}
                <View style={styles.cardActionRow}>
                  {item.receipt_number ? (
                    <Pressable
                      onPress={() => viewReceipt(item.receipt_number!)}
                      style={[styles.actionBtn, styles.receiptBtn]}
                    >
                      <Text style={styles.receiptBtnText}>🧾 View Receipt Voucher</Text>
                    </Pressable>
                  ) : !isClosed ? (
                    <>
                      <Pressable
                        onPress={() => openCollectModal(item)}
                        style={[styles.actionBtn, styles.collectBtn]}
                      >
                        <Text style={styles.collectBtnText}>💵 Collect Money</Text>
                      </Pressable>

                      <Pressable
                        onPress={() => openStatusModal(item)}
                        style={[styles.actionBtn, styles.statusBtn]}
                      >
                        <Text style={styles.statusBtnText}>⚠️ Record Status</Text>
                      </Pressable>
                    </>
                  ) : (
                    <Text style={styles.dayClosedItemText}>🔒 Day Locked</Text>
                  )}
                </View>
              </View>
            ))
          )}
        </View>
      )}

      {/* TAB 2: MISSED & FOLLOW-UPS */}
      {activeSubTab === 'missed' && (
        <View>
          <View style={styles.infoBanner}>
            <Text style={styles.infoBannerTitle}>Action Required: Follow-up Visits ({missedCustomers.length})</Text>
            <Text style={styles.infoBannerDesc}>
              Customers who were not available, requested a reschedule, or refused payment. Follow up before returning to the branch.
            </Text>
          </View>

          {missedCustomers.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>Great job! No missed or pending follow-ups today.</Text>
            </View>
          ) : (
            missedCustomers.map((item) => (
              <View key={item.id} style={styles.customerCard}>
                <View style={styles.cardHeader}>
                  <Text style={styles.custCardName}>{item.customer_name}</Text>
                  <View style={[styles.badgePill, getBadgeStyle(item.status)]}>
                    <Text style={styles.badgePillText}>{item.status.replace('_', ' ')}</Text>
                  </View>
                </View>

                <Text style={styles.areaText}>📍 {item.area_name || item.address}</Text>

                <View style={styles.reasonBox}>
                  <Text style={styles.reasonHeading}>Logged Reason:</Text>
                  <Text style={styles.reasonContent}>{item.notes || 'No reason specified'}</Text>
                  {item.next_followup_date && (
                    <Text style={styles.followupDateBadge}>Follow-up Set: {item.next_followup_date}</Text>
                  )}
                </View>

                <View style={styles.cardActionRow}>
                  <Pressable
                    onPress={() => Linking.openURL(`tel:${item.phone}`)}
                    style={[styles.actionBtn, styles.callActionBtn]}
                  >
                    <Text style={styles.callActionBtnText}>📞 Call {item.phone}</Text>
                  </Pressable>

                  {!isClosed && (
                    <Pressable
                      onPress={() => openCollectModal(item)}
                      style={[styles.actionBtn, styles.collectBtn]}
                    >
                      <Text style={styles.collectBtnText}>💵 Collect Now</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            ))
          )}
        </View>
      )}

      {/* TAB 3: END OF DAY CLOSING & RECONCILIATION */}
      {activeSubTab === 'closing' && (
        <View style={styles.closingCard}>
          <Text style={styles.closingTitle}>End of Day Cash & Beat Reconciliation</Text>
          <Text style={styles.closingSubtitle}>
            Reconcile physical cash collected in your bag against system receipts before handing over to the branch cashier.
          </Text>

          <View style={styles.closingSummaryBox}>
            <View style={styles.closingRow}>
              <Text style={styles.closingLabel}>Operation Date:</Text>
              <Text style={styles.closingVal}>{selectedDate}</Text>
            </View>
            <View style={styles.closingRow}>
              <Text style={styles.closingLabel}>Field Collector:</Text>
              <Text style={styles.closingVal}>{user.fullName}</Text>
            </View>
            <View style={styles.closingRow}>
              <Text style={styles.closingLabel}>Total Visits Completed:</Text>
              <Text style={styles.closingVal}>{visitedCount} of {totalCount}</Text>
            </View>
            <View style={styles.closingRow}>
              <Text style={styles.closingLabel}>Accounts Paid:</Text>
              <Text style={[styles.closingVal, { color: '#059669' }]}>{summary?.totalCollected || 0}</Text>
            </View>
            <View style={styles.closingDivider} />
            <View style={styles.closingRow}>
              <Text style={styles.closingLabelBold}>💵 Physical Cash Expected:</Text>
              <Text style={styles.closingValBoldGreen}>
                ₹{(summary?.cashAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </Text>
            </View>
            <View style={styles.closingRow}>
              <Text style={styles.closingLabel}>📱 Digital UPI / Bank:</Text>
              <Text style={styles.closingVal}>
                ₹{((summary?.upiAmount || 0) + (summary?.bankAmount || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </Text>
            </View>
            <View style={styles.closingRow}>
              <Text style={styles.closingLabelBold}>Total Beat Collection:</Text>
              <Text style={styles.closingValBoldBlue}>
                ₹{(summary?.totalCollectedAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </Text>
            </View>
          </View>

          {isClosed ? (
            <View style={styles.closedSuccessBox}>
              <Text style={styles.closedSuccessTitle}>🔒 Collection Day Reconciled & Closed</Text>
              <Text style={styles.closedSuccessDesc}>
                All {totalCount} records and cash totals have been submitted to the branch. No further edits can be made.
              </Text>
              {summary?.closingNotes && (
                <Text style={styles.closingRemarksLogged}>Remarks: "{summary.closingNotes}"</Text>
              )}
            </View>
          ) : (
            <View style={styles.closingFormBox}>
              <Text style={styles.inputLabel}>Physical Cash Count in Hand (₹) *</Text>
              <TextInput
                keyboardType="numeric"
                placeholder={`e.g. ${summary?.cashAmount || 0}`}
                placeholderTextColor="#94a3b8"
                style={styles.modalTextInput}
                value={physicalCashCount}
                onChangeText={setPhysicalCashCount}
              />

              <Text style={styles.inputLabel}>Handover / Day Closing Notes</Text>
              <TextInput
                placeholder="e.g. All 50 customers visited, 2 requested reschedule..."
                placeholderTextColor="#94a3b8"
                style={styles.modalTextInput}
                value={closingRemarks}
                onChangeText={setClosingRemarks}
              />

              <Pressable
                onPress={submitDailyClosing}
                disabled={submittingClosing}
                style={[styles.primaryActionBtn, submittingClosing && { opacity: 0.6 }]}
              >
                {submittingClosing ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryActionBtnText}>🔒 Close Today's Collection Beat</Text>
                )}
              </Pressable>
            </View>
          )}
        </View>
      )}

      {/* MODAL 1: RECORD PAYMENT */}
      <Modal visible={!!collectItem} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>💵 Record Payment Collection</Text>
              <Pressable onPress={() => setCollectItem(null)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </Pressable>
            </View>

            {collectItem && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.modalCustBrief}>
                  <Text style={styles.modalCustName}>{collectItem.customer_name}</Text>
                  <Text style={styles.modalCustAcc}>Account: {collectItem.account_number} • {collectItem.area_name}</Text>
                  <Text style={styles.modalCustTarget}>Expected Instalment: ₹{Number(collectItem.expected_amount).toLocaleString('en-IN')}</Text>
                </View>

                <Text style={styles.inputLabel}>Amount Collected (₹) *</Text>
                <TextInput
                  keyboardType="numeric"
                  placeholder="e.g. 1000"
                  placeholderTextColor="#94a3b8"
                  style={styles.modalTextInput}
                  value={collectAmount}
                  onChangeText={setCollectAmount}
                />

                <Text style={styles.inputLabel}>Payment Method *</Text>
                <View style={styles.methodChoiceRow}>
                  {(['Cash', 'UPI', 'Bank Transfer'] as const).map((m) => (
                    <Pressable
                      key={m}
                      onPress={() => setCollectMethod(m)}
                      style={[styles.methodChoiceBtn, collectMethod === m && styles.methodChoiceBtnActive]}
                    >
                      <Text style={[styles.methodChoiceBtnText, collectMethod === m && styles.methodChoiceBtnTextActive]}>
                        {m === 'Cash' ? '💵 Cash' : m === 'UPI' ? '📱 UPI' : '🏦 Bank'}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {(collectMethod === 'UPI' || collectMethod === 'Bank Transfer') && (
                  <>
                    <Text style={styles.inputLabel}>Transaction Ref / UTR *</Text>
                    <TextInput
                      placeholder="e.g. UPI-9988771122"
                      placeholderTextColor="#94a3b8"
                      style={styles.modalTextInput}
                      value={collectRef}
                      onChangeText={setCollectRef}
                    />
                  </>
                )}

                <Text style={styles.inputLabel}>Collection Notes (Optional)</Text>
                <TextInput
                  placeholder="e.g. Paid in full, received by hand"
                  placeholderTextColor="#94a3b8"
                  style={styles.modalTextInput}
                  value={collectNotes}
                  onChangeText={setCollectNotes}
                />

                <Pressable
                  onPress={submitPayment}
                  disabled={collecting}
                  style={[styles.primaryActionBtn, collecting && { opacity: 0.6 }]}
                >
                  {collecting ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryActionBtnText}>Confirm & Issue Receipt</Text>
                  )}
                </Pressable>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* MODAL 2: UPDATE VISIT OUTCOME / STATUS */}
      <Modal visible={!!statusItem} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>⚠️ Record Visit Outcome</Text>
              <Pressable onPress={() => setStatusItem(null)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </Pressable>
            </View>

            {statusItem && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.modalCustBrief}>
                  <Text style={styles.modalCustName}>{statusItem.customer_name}</Text>
                  <Text style={styles.modalCustAcc}>Account: {statusItem.account_number}</Text>
                </View>

                <Text style={styles.inputLabel}>Select Outcome Status *</Text>
                <View style={styles.statusOptionsCol}>
                  {[
                    { key: 'NOT_AVAILABLE', label: '🏠 Customer Not Available / Shop Closed' },
                    { key: 'RESCHEDULED', label: '📅 Reschedule to Another Date' },
                    { key: 'REFUSED', label: '🚫 Customer Refused Payment' },
                    { key: 'MISSED', label: '⏱️ Ran Out of Time / Missed Beat' },
                  ].map((s) => (
                    <Pressable
                      key={s.key}
                      onPress={() => setStatusChoice(s.key as any)}
                      style={[styles.statusOptionBtn, statusChoice === s.key && styles.statusOptionBtnActive]}
                    >
                      <Text style={[styles.statusOptionBtnText, statusChoice === s.key && styles.statusOptionBtnTextActive]}>
                        {s.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.inputLabel}>Remarks / Reason *</Text>
                <TextInput
                  placeholder="e.g. Shop was locked, person out of station..."
                  placeholderTextColor="#94a3b8"
                  style={styles.modalTextInput}
                  value={statusReason}
                  onChangeText={setStatusReason}
                />

                {statusChoice === 'RESCHEDULED' && (
                  <>
                    <Text style={styles.inputLabel}>Next Follow-up Date *</Text>
                    <TextInput
                      placeholder="YYYY-MM-DD (e.g. 2026-09-08)"
                      placeholderTextColor="#94a3b8"
                      style={styles.modalTextInput}
                      value={followupDate}
                      onChangeText={setFollowupDate}
                    />
                  </>
                )}

                <Pressable
                  onPress={submitStatus}
                  disabled={updatingStatus}
                  style={[styles.primaryActionBtn, updatingStatus && { opacity: 0.6 }]}
                >
                  {updatingStatus ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryActionBtnText}>Save Visit Outcome</Text>
                  )}
                </Pressable>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* MODAL 3: RECEIPT VOUCHER */}
      <Modal visible={!!receiptModal} animationType="fade" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.receiptSheet}>
            <View style={styles.receiptHeader}>
              <Text style={styles.receiptBrandTitle}>AutoLedger Field Operations</Text>
              <Text style={styles.receiptBrandSubtitle}>Official Payment Receipt</Text>
              <View style={styles.paidBadge}>
                <Text style={styles.paidBadgeText}>PAID & VERIFIED</Text>
              </View>
            </View>

            {receiptModal && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.receiptMetaGrid}>
                  <View style={styles.receiptMetaCol}>
                    <Text style={styles.receiptMetaLabel}>RECEIPT NO</Text>
                    <Text style={styles.receiptMetaValCode}>{receiptModal.receipt_number}</Text>
                  </View>
                  <View style={styles.receiptMetaCol}>
                    <Text style={styles.receiptMetaLabel}>DATE & TIME</Text>
                    <Text style={styles.receiptMetaVal}>
                      {new Date(receiptModal.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                </View>

                <View style={styles.receiptMetaGrid}>
                  <View style={styles.receiptMetaCol}>
                    <Text style={styles.receiptMetaLabel}>CUSTOMER</Text>
                    <Text style={styles.receiptMetaVal}>{receiptModal.customer_name}</Text>
                    <Text style={styles.receiptMetaSub}>{receiptModal.customer_account}</Text>
                  </View>
                  <View style={styles.receiptMetaCol}>
                    <Text style={styles.receiptMetaLabel}>COLLECTOR</Text>
                    <Text style={styles.receiptMetaVal}>{receiptModal.collector_name}</Text>
                  </View>
                </View>

                <View style={styles.receiptBigAmountCard}>
                  <Text style={styles.receiptBigAmountLabel}>AMOUNT RECEIVED</Text>
                  <Text style={styles.receiptBigAmountVal}>
                    ₹{Number(receiptModal.amount_paid).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </Text>
                  <Text style={styles.receiptModeText}>
                    Mode: {receiptModal.payment_method} {receiptModal.transaction_ref ? `(${receiptModal.transaction_ref})` : ''}
                  </Text>
                </View>

                <View style={styles.receiptLedgerBox}>
                  <View style={styles.receiptLedgerRow}>
                    <Text style={styles.receiptLedgerLabel}>Previous Balance Due:</Text>
                    <Text style={styles.receiptLedgerVal}>₹{Number(receiptModal.previous_balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</Text>
                  </View>
                  <View style={styles.receiptLedgerRow}>
                    <Text style={styles.receiptLedgerLabelGreen}>Payment Collected:</Text>
                    <Text style={styles.receiptLedgerValGreen}>- ₹{Number(receiptModal.amount_paid).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</Text>
                  </View>
                  <View style={styles.receiptLedgerDivider} />
                  <View style={styles.receiptLedgerRow}>
                    <Text style={styles.receiptLedgerLabelBold}>Updated Outstanding:</Text>
                    <Text style={styles.receiptLedgerValBold}>₹{Number(receiptModal.updated_balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</Text>
                  </View>
                </View>

                <View style={styles.receiptBtnRow}>
                  <Pressable
                    onPress={() => shareReceipt(receiptModal)}
                    style={[styles.receiptActionBtn, styles.shareBtn]}
                  >
                    <Text style={styles.shareBtnText}>📤 Share via WhatsApp / SMS</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setReceiptModal(null)}
                    style={[styles.receiptActionBtn, styles.doneBtn]}
                  >
                    <Text style={styles.doneBtnText}>Done</Text>
                  </Pressable>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function getBadgeStyle(status: string) {
  switch (status) {
    case 'COLLECTED': return styles.badgeCollected;
    case 'PENDING': return styles.badgePending;
    case 'NOT_AVAILABLE': return styles.badgeNotAvailable;
    case 'RESCHEDULED': return styles.badgeRescheduled;
    case 'REFUSED': return styles.badgeRefused;
    case 'MISSED': return styles.badgeMissed;
    default: return styles.badgePending;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },

  // AGENT HEADER CARD
  agentHeaderCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
  },
  agentHeaderTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  agentTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  agentRoleTag: {
    fontSize: 10,
    fontWeight: '800',
    color: '#2563EB',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    letterSpacing: 0.5,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  statusPillOpen: {
    backgroundColor: '#DCFCE7',
  },
  statusPillClosed: {
    backgroundColor: '#F1F5F9',
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  statusPillTextOpen: {
    color: '#15803D',
  },
  statusPillTextClosed: {
    color: '#64748B',
  },
  agentName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  beatInfoText: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 3,
  },
  closedNoticeBanner: {
    marginTop: 10,
    padding: 8,
    backgroundColor: '#F0FDF4',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  closedNoticeText: {
    fontSize: 11.5,
    color: '#15803D',
    fontWeight: '600',
  },

  // KPI ROW
  kpiRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderTopWidth: 3,
  },
  kpiLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.4,
  },
  kpiValBlue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#2563EB',
    marginTop: 4,
  },
  kpiValGreen: {
    fontSize: 18,
    fontWeight: '800',
    color: '#059669',
    marginTop: 4,
  },
  kpiValAmber: {
    fontSize: 18,
    fontWeight: '800',
    color: '#D97706',
    marginTop: 4,
  },
  kpiSub: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 2,
  },

  // PROGRESS CARD
  progressCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  progressTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  progressPercentText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563EB',
  },
  progressBarTrack: {
    height: 8,
    backgroundColor: '#E2E8F0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#2563EB',
    borderRadius: 4,
  },
  progressDetailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  progressMiniStat: {
    fontSize: 11,
    color: '#64748B',
  },

  // CASH TALLY CARD
  cashTallyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  cashTallyItem: {
    flex: 1,
    alignItems: 'center',
  },
  cashTallyDivider: {
    width: 1,
    backgroundColor: '#E2E8F0',
  },
  cashTallyLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  cashTallyValueGreen: {
    fontSize: 15,
    fontWeight: '800',
    color: '#059669',
    marginTop: 4,
  },
  cashTallyValueBlue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#2563EB',
    marginTop: 4,
  },
  cashTallyValuePurple: {
    fontSize: 15,
    fontWeight: '800',
    color: '#7C3AED',
    marginTop: 4,
  },

  // SUB-TABS NAVIGATION
  subTabRow: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 12,
    padding: 3,
    marginBottom: 14,
    gap: 4,
  },
  subTabBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 9,
  },
  subTabBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  subTabBtnText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#64748B',
  },
  subTabBtnTextActive: {
    color: '#0F172A',
    fontWeight: '800',
  },

  // SEARCH & FILTER PILLS
  searchInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: '#0F172A',
    marginBottom: 10,
  },
  filterScrollView: {
    marginBottom: 14,
  },
  pillBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginRight: 6,
  },
  pillBtnActive: {
    backgroundColor: '#1E293B',
    borderColor: '#1E293B',
  },
  pillBtnText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#64748B',
  },
  pillBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // CUSTOMER CARD
  customerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  seqBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  seqBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
  },
  custCardName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  custCardAcc: {
    fontSize: 11,
    color: '#64748B',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  badgePill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgePillText: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  badgeCollected: { backgroundColor: '#DCFCE7' },
  badgePending: { backgroundColor: '#FEF3C7' },
  badgeNotAvailable: { backgroundColor: '#FFEDD5' },
  badgeRescheduled: { backgroundColor: '#DBEAFE' },
  badgeRefused: { backgroundColor: '#FEE2E2' },
  badgeMissed: { backgroundColor: '#EDE9FE' },

  cardDetailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 4,
  },
  areaText: {
    fontSize: 12,
    color: '#475569',
    flex: 1,
  },
  callButton: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  callButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563EB',
  },

  amountBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    marginVertical: 8,
  },
  amountLabel: {
    fontSize: 10.5,
    color: '#64748B',
    fontWeight: '600',
  },
  amountTargetVal: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 2,
  },
  amountCollectedVal: {
    fontSize: 14,
    fontWeight: '800',
    color: '#059669',
    marginTop: 2,
  },
  amountDueVal: {
    fontSize: 14,
    fontWeight: '800',
    color: '#DC2626',
    marginTop: 2,
  },

  receiptNotice: {
    backgroundColor: '#F0FDF4',
    padding: 6,
    borderRadius: 6,
    marginBottom: 6,
  },
  receiptNoticeText: {
    fontSize: 11,
    color: '#15803D',
    fontWeight: '700',
  },
  notesText: {
    fontSize: 11.5,
    fontStyle: 'italic',
    color: '#64748B',
    marginBottom: 4,
  },
  followupDateText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#2563EB',
    marginBottom: 6,
  },

  cardActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collectBtn: {
    backgroundColor: '#2563EB',
  },
  collectBtnText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '700',
  },
  statusBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  statusBtnText: {
    color: '#334155',
    fontSize: 12.5,
    fontWeight: '600',
  },
  receiptBtn: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  receiptBtnText: {
    color: '#059669',
    fontSize: 12.5,
    fontWeight: '700',
  },
  dayClosedItemText: {
    fontSize: 11.5,
    color: '#94A3B8',
    fontStyle: 'italic',
    alignSelf: 'center',
    paddingVertical: 4,
  },

  // EMPTY STATE
  emptyState: {
    padding: 30,
    alignItems: 'center',
  },
  emptyStateText: {
    fontSize: 13,
    color: '#64748B',
  },

  // MISSED BANNER
  infoBanner: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  infoBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#B45309',
  },
  infoBannerDesc: {
    fontSize: 11.5,
    color: '#92400E',
    marginTop: 3,
  },
  reasonBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 10,
    marginVertical: 6,
  },
  reasonHeading: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#64748B',
  },
  reasonContent: {
    fontSize: 12,
    color: '#1E293B',
    marginTop: 2,
  },
  followupDateBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563EB',
    marginTop: 4,
  },
  callActionBtn: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  callActionBtnText: {
    color: '#1D4ED8',
    fontSize: 12,
    fontWeight: '700',
  },

  // CLOSING CARD
  closingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  closingTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  closingSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
    marginBottom: 16,
  },
  closingSummaryBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  closingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
  },
  closingDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 6,
  },
  closingLabel: {
    fontSize: 12.5,
    color: '#64748B',
  },
  closingVal: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#0F172A',
  },
  closingLabelBold: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  closingValBoldGreen: {
    fontSize: 15,
    fontWeight: '800',
    color: '#059669',
  },
  closingValBoldBlue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#2563EB',
  },
  closedSuccessBox: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 12,
    padding: 14,
  },
  closedSuccessTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#15803D',
  },
  closedSuccessDesc: {
    fontSize: 12,
    color: '#166534',
    marginTop: 4,
  },
  closingRemarksLogged: {
    fontSize: 11.5,
    color: '#166534',
    fontStyle: 'italic',
    marginTop: 6,
  },
  closingFormBox: {
    marginTop: 8,
  },

  // MODAL OVERLAYS
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '85%',
  },
  receiptSheet: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    margin: 16,
    padding: 20,
    maxHeight: '90%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalCloseText: {
    fontSize: 18,
    color: '#64748B',
    padding: 4,
  },
  modalCustBrief: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  modalCustName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalCustAcc: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  modalCustTarget: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#2563EB',
    marginTop: 4,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
    marginTop: 10,
  },
  modalTextInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
  },
  methodChoiceRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  methodChoiceBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
  },
  methodChoiceBtnActive: {
    backgroundColor: '#2563EB',
  },
  methodChoiceBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  methodChoiceBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  primaryActionBtn: {
    backgroundColor: '#2563EB',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 10,
  },
  primaryActionBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },

  // STATUS CHOICES
  statusOptionsCol: {
    gap: 6,
    marginBottom: 6,
  },
  statusOptionBtn: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statusOptionBtnActive: {
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  statusOptionBtnText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#334155',
  },
  statusOptionBtnTextActive: {
    color: '#1D4ED8',
    fontWeight: '700',
  },

  // RECEIPT VOUCHER STYLES
  receiptHeader: {
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingBottom: 12,
    marginBottom: 12,
  },
  receiptBrandTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1E3A8A',
  },
  receiptBrandSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  paidBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    marginTop: 6,
  },
  paidBadgeText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#15803D',
  },
  receiptMetaGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  receiptMetaCol: {
    flex: 1,
  },
  receiptMetaLabel: {
    fontSize: 9.5,
    color: '#64748B',
    fontWeight: '700',
  },
  receiptMetaValCode: {
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontWeight: '800',
    color: '#1E40AF',
    marginTop: 1,
  },
  receiptMetaVal: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 1,
  },
  receiptMetaSub: {
    fontSize: 11,
    color: '#64748B',
  },
  receiptBigAmountCard: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginVertical: 12,
  },
  receiptBigAmountLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#15803D',
  },
  receiptBigAmountVal: {
    fontSize: 24,
    fontWeight: '800',
    color: '#15803D',
    marginTop: 2,
  },
  receiptModeText: {
    fontSize: 11.5,
    color: '#166534',
    fontWeight: '600',
    marginTop: 3,
  },
  receiptLedgerBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  receiptLedgerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  receiptLedgerLabel: {
    fontSize: 11.5,
    color: '#64748B',
  },
  receiptLedgerVal: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#0F172A',
  },
  receiptLedgerLabelGreen: {
    fontSize: 11.5,
    color: '#059669',
    fontWeight: '600',
  },
  receiptLedgerValGreen: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#059669',
  },
  receiptLedgerDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 4,
  },
  receiptLedgerLabelBold: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
  },
  receiptLedgerValBold: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#DC2626',
  },
  receiptBtnRow: {
    gap: 8,
    marginTop: 4,
  },
  receiptActionBtn: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  shareBtn: {
    backgroundColor: '#059669',
  },
  shareBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  doneBtn: {
    backgroundColor: '#F1F5F9',
  },
  doneBtnText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '700',
  },
});
