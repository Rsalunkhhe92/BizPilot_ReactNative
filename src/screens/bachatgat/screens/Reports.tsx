import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { ReportColumn, cellText, fyStartIso, isoToday, reportHtml } from '../format';
import {
  Btn, BtnRow, Card, ErrorBox, Form, Gate, KV, ListItem, Notice, Screen, SectionTitle, SelectInput, errorText, useLoad, useShg,
} from '../ui';
import { GroupPicker } from './Members';
import { ShgKey } from '../i18n';

const CATEGORY_KEYS: Record<string, ShgKey> = {
  'Financial reports': 'rep_cat_financial', 'Member reports': 'rep_cat_member', 'Loan reports': 'rep_cat_loan',
  'Business reports': 'rep_cat_business', 'Audit reports': 'rep_cat_audit',
};

export function ReportsScreen() {
  const { api, t, push } = useShg();
  const { data, loading, error, reload } = useLoad(() => api.get('/reports'), []);
  const reports = (data as any)?.reports || [];
  const byCat: Record<string, any[]> = {};
  reports.forEach((r: any) => { (byCat[r.category] = byCat[r.category] || []).push(r); });
  return (
    <Screen title={t('nav_reports')} onRefresh={reload}>
      <Notice tone="blue" text={t('rep_hint')} />
      <Gate loading={loading} error={error} onRetry={reload}>
        {Object.entries(byCat).map(([cat, items]) => (
          <View key={cat}>
            <SectionTitle>{CATEGORY_KEYS[cat] ? t(CATEGORY_KEYS[cat]) : cat}</SectionTitle>
            {items.map((r: any) => (
              <ListItem key={r.key} title={t(`rep_${r.key}` as any) || r.title} subtitle={r.needsMember ? t('rep_needsMember') : undefined}
                onPress={() => push('reportView', { key: r.key, needsMember: r.needsMember, needsGroup: r.needsGroup })} />
            ))}
          </View>
        ))}
      </Gate>
    </Screen>
  );
}

const STATUS_FILTERS: Record<string, string[]> = {
  members: ['', 'Pending', 'Active', 'Suspended', 'Exited'],
  loan_applications: ['', 'Draft', 'Submitted', 'Under Review', 'Approved', 'Rejected', 'Active', 'Overdue', 'Closed', 'Written Off'],
};

export function ReportViewScreen({ params }: { params: { key: string; memberId?: number; needsMember?: boolean; needsGroup?: boolean } }) {
  const { api, t, groupId, c } = useShg();
  const [from, setFrom] = useState(fyStartIso());
  const [to, setTo] = useState(isoToday());
  const [memberId, setMemberId] = useState<string>(params.memberId ? String(params.memberId) : '');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const needsGroup = params.needsGroup !== false;
  const members = useLoad(() => groupId ? api.get('/members', { groupId, pageSize: 100 }) : Promise.resolve(null), [groupId]);
  const memberOptions = ((members.data as any)?.members || []).map((m: any) => ({ value: String(m.id), label: `#${m.memberNumber} ${m.fullName}` }));
  const ready = (!needsGroup || !!groupId) && (!params.needsMember || !!memberId);
  const query = { groupId: groupId || undefined, from, to, memberId: memberId || undefined, status: status || undefined };
  const { data, loading, error, reload } = useLoad(() => ready ? api.get(`/reports/${params.key}`, query) : Promise.resolve(null),
    [params.key, groupId, from, to, memberId, status, ready]);
  const r = data as any;
  const cols: ReportColumn[] = r?.columns || [];

  const exportPdf = async () => {
    setBusy('pdf'); setExportErr(null);
    try {
      const { uri } = await Print.printToFileAsync({ html: reportHtml(r.title, r.meta, cols, r.rows, r.totals) });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: r.title });
      else Alert.alert(t('common_error'), t('err_shareUnavailable'));
    } catch { setExportErr(t('err_pdf')); } finally { setBusy(null); }
  };
  const exportXlsx = async () => {
    setBusy('xlsx'); setExportErr(null);
    try {
      const res = await api.get(`/reports/${params.key}`, { ...query, format: 'xlsx' });
      const uri = `${FileSystem.cacheDirectory}${res.fileName}`;
      await FileSystem.writeAsStringAsync(uri, res.fileBase64, { encoding: FileSystem.EncodingType.Base64 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', UTI: 'org.openxmlformats.spreadsheetml.sheet' });
      } else Alert.alert(t('common_error'), t('err_shareUnavailable'));
    } catch (e) { setExportErr(errorText(t, e)); } finally { setBusy(null); }
  };

  const title = t(`rep_${params.key}` as any) || r?.title || '';
  const [titleCol, ...restCols] = cols;
  return (
    <Screen title={title} subtitle={r?.meta} onRefresh={reload}>
      {needsGroup && <GroupPicker />}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><Form fields={[{ key: 'f', label: t('common_from'), type: 'date' }]} values={{ f: from }} errors={{}} onChange={(_, v) => setFrom(v)} /></View>
        <View style={{ flex: 1 }}><Form fields={[{ key: 'x', label: t('common_to'), type: 'date' }]} values={{ x: to }} errors={{}} onChange={(_, v) => setTo(v)} /></View>
      </View>
      {(params.needsMember || ['repayments'].includes(params.key)) && (
        <View style={{ marginBottom: 10 }}>
          <SelectInput value={memberId} onChange={setMemberId} label={t('common_member')}
            options={[...(params.needsMember ? [] : [{ value: '', label: t('common_all') }]), ...memberOptions]} />
        </View>
      )}
      {STATUS_FILTERS[params.key] && (
        <View style={{ marginBottom: 10 }}>
          <SelectInput value={status} onChange={setStatus} label={t('common_status')}
            options={STATUS_FILTERS[params.key].map(s => ({ value: s, label: s || t('common_all') }))} />
        </View>
      )}
      {!ready ? <Notice text={params.needsMember ? t('rep_pickMember') : t('grp_pickFirst')} /> : (
        <Gate loading={loading} error={error} onRetry={reload}>
          {r && (
            <>
              <BtnRow>
                <Btn small icon="📄" title="PDF" onPress={exportPdf} busy={busy === 'pdf'} disabled={!r.rows.length} />
                <Btn small kind="secondary" icon="📊" title="Excel" onPress={exportXlsx} busy={busy === 'xlsx'} disabled={!r.rows.length} />
              </BtnRow>
              {!!exportErr && <ErrorBox message={exportErr} />}
              <Text style={{ color: c.muted, marginVertical: 6 }}>{t('rep_rows', { n: r.rows.length })}</Text>
              {Object.keys(r.totals || {}).length > 0 && (
                <Card style={{ backgroundColor: c.brandBg }}>
                  {cols.filter(col => r.totals[col.key] !== undefined).map(col => (
                    <KV key={col.key} label={`${t('common_total')} · ${col.label}`} value={cellText(col, r.totals[col.key])} strong />
                  ))}
                </Card>
              )}
              {!r.rows.length && <Notice text={t('common_noRecords')} />}
              {r.rows.slice(0, 500).map((row: any, i: number) => (
                <Card key={i}>
                  {titleCol && <Text style={{ color: c.text, fontWeight: '800', marginBottom: 4 }}>{cellText(titleCol, row[titleCol.key]) || '—'}</Text>}
                  {restCols.map(col => {
                    const v = cellText(col, row[col.key]);
                    return v ? <KV key={col.key} label={col.label} value={v} /> : null;
                  })}
                </Card>
              ))}
              {r.rows.length > 500 && <Notice text={t('rep_truncated')} />}
            </>
          )}
        </Gate>
      )}
    </Screen>
  );
}
