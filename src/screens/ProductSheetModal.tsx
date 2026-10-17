/**
 * ProductSheetModal.tsx
 * Excel-style product sheet for product shops (fruit, vegetable, kirana, shoes, mobile, medical...).
 *
 * One sheet (tab) per kind of shop, pre-filled with common products by the backend and merged with
 * the owner's own catalog. The owner fills stock and prices and saves only the rows that changed.
 * The same sheets can be downloaded as an .xlsx file, filled in Excel, and uploaded back for review.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { TranslationKey } from '../../i18n';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// The bulk save accepts at most this many products per request.
const SAVE_CHUNK = 200;

type Values = { unit: string; stockQty: string; sellingPrice: string; costPrice: string };

type Row = Values & {
  key: string;
  name: string;
  /** Already in the owner's catalog: its name is fixed and `original` holds the saved values. */
  existing: boolean;
  original?: Values;
};

type Sheet = { name: string; rows: Row[] };

type ApiRow = {
  name: string;
  unit: string | null;
  stockQty: number | null;
  sellingPrice: number | null;
  costPrice: number | null;
  existing?: boolean;
};

interface Props {
  visible: boolean;
  onClose: () => void;
  ownerId: number;
  apiFetch: (path: string, options?: RequestInit) => Promise<Response>;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  units: readonly string[];
  unitLabel: (unit: string) => string;
  /** Called after products were saved, so the catalog can reload. */
  onSaved: () => void;
}

let rowSeq = 0;
const nextKey = () => `sheet-row-${++rowSeq}`;
const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
const numberText = (value: number | null | undefined) => (typeof value === 'number' ? String(value) : '');

function toRow(api: ApiRow): Row {
  const values: Values = {
    unit: api.unit || '',
    stockQty: numberText(api.stockQty),
    sellingPrice: numberText(api.sellingPrice),
    costPrice: numberText(api.costPrice),
  };
  return { key: nextKey(), name: api.name, existing: !!api.existing, original: api.existing ? values : undefined, ...values };
}

function blankRow(): Row {
  return { key: nextKey(), name: '', unit: '', stockQty: '', sellingPrice: '', costPrice: '', existing: false };
}

function isChanged(row: Row) {
  if (row.existing && row.original) {
    const o = row.original;
    return row.unit !== o.unit || row.stockQty !== o.stockQty || row.sellingPrice !== o.sellingPrice || row.costPrice !== o.costPrice;
  }
  // A new product needs a name and at least one number; untouched suggestions are skipped.
  return !!row.name.trim() && !!(row.stockQty.trim() || row.sellingPrice.trim() || row.costPrice.trim());
}

function numberOrNull(value: string) {
  const number = parseFloat(value);
  return value.trim() && !isNaN(number) && number >= 0 ? number : null;
}

export default function ProductSheetModal({ visible, onClose, ownerId, apiFetch, t, units, unitLabel, onSaved }: Props) {
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fileBusy, setFileBusy] = useState<'download' | 'upload' | null>(null);
  const [search, setSearch] = useState('');
  const [unitPickerRow, setUnitPickerRow] = useState<string | null>(null);
  const [showNewSheet, setShowNewSheet] = useState(false);
  const [newSheetName, setNewSheetName] = useState('');

  useEffect(() => {
    if (visible) loadSheets();
  }, [visible]);

  async function loadSheets() {
    setLoading(true);
    setSearch('');
    try {
      const res = await apiFetch(`/api/inventory/product-sheets?owner_id=${ownerId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.sheets)) {
        Alert.alert(t('common_error'), data.error || t('sheet_loadFailed'));
        return;
      }
      setSheets(data.sheets.map((sheet: { name: string; rows: ApiRow[] }) => ({ name: sheet.name, rows: sheet.rows.map(toRow) })));
      setActive(0);
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      setLoading(false);
    }
  }

  const changedCount = useMemo(() => sheets.reduce((sum, sheet) => sum + sheet.rows.filter(isChanged).length, 0), [sheets]);
  const sheet = sheets[active];
  const visibleRows = useMemo(() => {
    if (!sheet) return [];
    const query = nameKey(search);
    return query ? sheet.rows.filter(row => nameKey(row.name).includes(query)) : sheet.rows;
  }, [sheet, search]);

  function updateRow(key: string, changes: Partial<Row>) {
    setSheets(previous => previous.map((s, i) => (i !== active ? s : { ...s, rows: s.rows.map(row => (row.key === key ? { ...row, ...changes } : row)) })));
  }

  function addRow() {
    setSearch('');
    setSheets(previous => previous.map((s, i) => (i === active ? { ...s, rows: [...s.rows, blankRow()] } : s)));
  }

  function handleClose() {
    if (!changedCount) {
      onClose();
      return;
    }
    Alert.alert(t('sheet_discardTitle'), t('sheet_discardMsg'), [
      { text: t('common_cancel'), style: 'cancel' },
      { text: t('sheet_discard'), style: 'destructive', onPress: onClose },
    ]);
  }

  function handleCreateSheet() {
    const name = newSheetName.trim().replace(/\s+/g, ' ');
    if (!name) return;
    if (sheets.some(s => s.name.toLowerCase() === name.toLowerCase())) {
      Alert.alert(t('common_error'), t('sheet_exists'));
      return;
    }
    setSheets(previous => [...previous, { name, rows: [blankRow(), blankRow(), blankRow()] }]);
    setActive(sheets.length);
    setSearch('');
    setNewSheetName('');
    setShowNewSheet(false);
  }

  async function handleSave() {
    const products = sheets.flatMap(s =>
      s.rows.filter(isChanged).map(row => ({
        name: row.name.trim(),
        // The sheet is the category of a new product; an existing product keeps its own.
        category: s.name,
        unit: row.unit.trim() || null,
        stockQty: numberOrNull(row.stockQty),
        sellingPrice: numberOrNull(row.sellingPrice),
        costPrice: numberOrNull(row.costPrice),
      })),
    );
    if (!products.length) return;
    setSaving(true);
    let added = 0;
    let updated = 0;
    try {
      for (let start = 0; start < products.length; start += SAVE_CHUNK) {
        const res = await apiFetch('/api/inventory/products/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // The sheet shows the current stock, so the number typed is the new stock.
          body: JSON.stringify({ ownerId, stockMode: 'replace', products: products.slice(start, start + SAVE_CHUNK) }),
        });
        const data = await res.json().catch(() => ({ error: t('common_serverError', { status: res.status }) }));
        if (!res.ok) {
          Alert.alert(t('common_error'), data.error || t('inv_addFailed'));
          return;
        }
        added += data.added?.length ?? 0;
        updated += data.updated?.length ?? 0;
      }
      await loadSheets();
      Alert.alert(t('sheet_savedTitle'), t('sheet_savedMsg', { added, updated }));
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      // Products saved by an earlier chunk stay saved; reloading shows exactly what is stored.
      if (added || updated) onSaved();
      setSaving(false);
    }
  }

  async function handleDownload() {
    setFileBusy('download');
    try {
      const res = await apiFetch(`/api/inventory/product-sheets/xlsx?owner_id=${ownerId}`);
      const data = await res.json().catch(() => ({ error: t('common_serverError', { status: res.status }) }));
      if (!res.ok || !data.fileBase64) {
        Alert.alert(t('common_error'), data.error || t('sheet_loadFailed'));
        return;
      }
      const uri = `${FileSystem.cacheDirectory}${data.fileName || 'products.xlsx'}`;
      await FileSystem.writeAsStringAsync(uri, data.fileBase64, { encoding: FileSystem.EncodingType.Base64 });
      await Sharing.shareAsync(uri, { mimeType: XLSX_MIME, dialogTitle: t('sheet_title'), UTI: 'org.openxmlformats.spreadsheetml.sheet' });
    } catch (e) {
      console.error('Error downloading product sheet:', e);
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      setFileBusy(null);
    }
  }

  async function handleUpload() {
    // Loaded on demand: an app build made before this native module was added still runs everything else.
    let DocumentPicker: typeof import('expo-document-picker');
    try {
      DocumentPicker = require('expo-document-picker');
    } catch {
      Alert.alert(t('common_error'), t('sheet_uploadUnavailable'));
      return;
    }
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: [XLSX_MIME, 'application/vnd.ms-excel', 'application/octet-stream'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]?.uri) return;
      setFileBusy('upload');
      const fileBase64 = await FileSystem.readAsStringAsync(picked.assets[0].uri, { encoding: FileSystem.EncodingType.Base64 });
      const res = await apiFetch('/api/inventory/product-sheets/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId, fileBase64 }),
      });
      const data = await res.json().catch(() => ({ error: t('common_serverError', { status: res.status }) }));
      if (!res.ok || !Array.isArray(data.sheets)) {
        Alert.alert(t('common_error'), data.error || t('sheet_loadFailed'));
        return;
      }
      mergeUploaded(data.sheets);
    } catch (e) {
      console.error('Error uploading product sheet:', e);
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      setFileBusy(null);
    }
  }

  // Puts the file's values into the sheets: a product already shown anywhere is updated in place,
  // anything else is added to the sheet of the same name (created when missing). Nothing is saved yet.
  function mergeUploaded(uploaded: { name: string; rows: ApiRow[] }[]) {
    const next: Sheet[] = sheets.map(s => ({ ...s, rows: [...s.rows] }));
    let count = 0;
    let firstSheet = -1;
    for (const fileSheet of uploaded) {
      let target = next.findIndex(s => s.name.toLowerCase() === fileSheet.name.toLowerCase());
      if (target < 0) {
        next.push({ name: fileSheet.name, rows: [] });
        target = next.length - 1;
      }
      for (const fileRow of fileSheet.rows) {
        const values: Partial<Values> = {};
        if (fileRow.unit) values.unit = fileRow.unit;
        if (fileRow.stockQty !== null) values.stockQty = String(fileRow.stockQty);
        if (fileRow.sellingPrice !== null) values.sellingPrice = String(fileRow.sellingPrice);
        if (fileRow.costPrice !== null) values.costPrice = String(fileRow.costPrice);
        const key = nameKey(fileRow.name);
        let placed = false;
        for (const s of next) {
          const index = s.rows.findIndex(row => nameKey(row.name) === key);
          if (index >= 0) {
            s.rows[index] = { ...s.rows[index], ...values };
            placed = true;
            break;
          }
        }
        if (!placed) next[target].rows.push({ ...blankRow(), name: fileRow.name, ...values });
        count += 1;
        if (firstSheet < 0) firstSheet = target;
      }
    }
    setSheets(next);
    setSearch('');
    if (firstSheet >= 0) setActive(firstSheet);
    Alert.alert(t('sheet_uploadLoadedTitle'), t('sheet_uploadLoaded', { count }));
  }

  function renderRow({ item: row, index }: { item: Row; index: number }) {
    const changed = isChanged(row);
    const cellBg = changed ? '#FFF8D6' : index % 2 ? '#FAFBFC' : '#FFFFFF';
    const numberCell = (field: 'stockQty' | 'sellingPrice' | 'costPrice', width: number) => (
      <TextInput
        value={row[field]}
        onChangeText={value => updateRow(row.key, { [field]: value.replace(/[^0-9.]/g, '') })}
        keyboardType="decimal-pad"
        style={[styles.cell, styles.input, { width, backgroundColor: cellBg, textAlign: 'right' }]}
        accessibilityLabel={`${row.name || t('sheet_colProduct')} ${t(field === 'stockQty' ? 'sheet_colStock' : field === 'sellingPrice' ? 'sheet_colPrice' : 'sheet_colCost')}`}
      />
    );
    return (
      <View style={styles.row}>
        <View style={[styles.cell, styles.rowNumber]}>
          <Text style={styles.rowNumberText}>{index + 1}</Text>
        </View>
        {row.existing ? (
          <View style={[styles.cell, { width: COL.name, backgroundColor: cellBg, flexDirection: 'row', alignItems: 'center', gap: 5 }]}>
            <View style={styles.existingDot} />
            <Text style={styles.existingName} numberOfLines={2}>{row.name}</Text>
          </View>
        ) : (
          <TextInput
            value={row.name}
            onChangeText={value => updateRow(row.key, { name: value })}
            placeholder={t('sheet_colProduct')}
            placeholderTextColor={palette.muted}
            style={[styles.cell, styles.input, { width: COL.name, backgroundColor: cellBg }]}
          />
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${row.name} ${t('sheet_colUnit')}`}
          onPress={() => setUnitPickerRow(row.key)}
          style={[styles.cell, { width: COL.unit, backgroundColor: cellBg, flexDirection: 'row', alignItems: 'center' }]}>
          <Text style={{ flex: 1, fontSize: 12, color: row.unit ? palette.navy : palette.muted }} numberOfLines={1}>
            {unitLabel(row.unit || 'kg')}
          </Text>
          <Text style={{ fontSize: 9, color: palette.muted }}>▾</Text>
        </Pressable>
        {numberCell('stockQty', COL.stock)}
        {numberCell('sellingPrice', COL.price)}
        {numberCell('costPrice', COL.cost)}
      </View>
    );
  }

  const pickerRow = unitPickerRow ? sheet?.rows.find(row => row.key === unitPickerRow) : undefined;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{t('sheet_title')}</Text>
            <Text style={styles.subtitle} numberOfLines={2}>{t('sheet_hint')}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t('sheet_download')} onPress={handleDownload} disabled={!!fileBusy || loading} style={styles.headerBtn}>
            {fileBusy === 'download' ? <ActivityIndicator size="small" color={EXCEL_GREEN} /> : <Text style={styles.headerBtnIcon}>⬇️</Text>}
            <Text style={styles.headerBtnText}>{t('sheet_download')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t('sheet_upload')} onPress={handleUpload} disabled={!!fileBusy || loading} style={styles.headerBtn}>
            {fileBusy === 'upload' ? <ActivityIndicator size="small" color={EXCEL_GREEN} /> : <Text style={styles.headerBtnIcon}>⬆️</Text>}
            <Text style={styles.headerBtnText}>{t('sheet_upload')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common_cancel')} onPress={handleClose} hitSlop={8} style={{ paddingLeft: 6 }}>
            <Text style={{ fontSize: 20, color: '#FFFFFF', fontWeight: '700' }}>✕</Text>
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color={EXCEL_GREEN} style={{ marginTop: 40 }} />
        ) : (
          <>
            <View style={styles.searchWrap}>
              <Text style={{ color: palette.muted }}>⌕</Text>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder={t('sheet_search', { sheet: sheet?.name ?? '' })}
                placeholderTextColor={palette.muted}
                style={{ flex: 1, paddingVertical: 6, fontSize: 13, color: palette.navy }}
              />
              <View style={styles.existingDot} />
              <Text style={{ fontSize: 10, color: palette.muted }}>{t('sheet_existingLegend')}</Text>
            </View>

            <ScrollView horizontal keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
              <View style={{ flex: 1 }}>
                <View style={styles.row}>
                  <View style={[styles.cell, styles.rowNumber, styles.headCell]} />
                  {([
                    ['sheet_colProduct', COL.name],
                    ['sheet_colUnit', COL.unit],
                    ['sheet_colStock', COL.stock],
                    ['sheet_colPrice', COL.price],
                    ['sheet_colCost', COL.cost],
                  ] as const).map(([label, width]) => (
                    <View key={label} style={[styles.cell, styles.headCell, { width }]}>
                      <Text style={styles.headText} numberOfLines={1}>{t(label)}</Text>
                    </View>
                  ))}
                </View>
                <FlatList
                  data={visibleRows}
                  keyExtractor={row => row.key}
                  renderItem={renderRow}
                  keyboardShouldPersistTaps="handled"
                  initialNumToRender={20}
                  ListFooterComponent={
                    <Pressable accessibilityRole="button" onPress={addRow} style={styles.addRow}>
                      <Text style={{ color: EXCEL_GREEN, fontWeight: '800', fontSize: 13 }}>{t('sheet_addRow')}</Text>
                    </Pressable>
                  }
                />
              </View>
            </ScrollView>

            {/* Sheet tabs, like the tabs at the bottom of an Excel workbook */}
            <View style={styles.tabsBar}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {sheets.map((s, i) => {
                  const pending = s.rows.filter(isChanged).length;
                  const selected = i === active;
                  return (
                    <Pressable
                      key={s.name}
                      accessibilityRole="tab"
                      accessibilityState={{ selected }}
                      onPress={() => { setActive(i); setSearch(''); }}
                      style={[styles.tab, selected && styles.tabActive]}>
                      <Text style={[styles.tabText, selected && styles.tabTextActive]}>{s.name}</Text>
                      {pending > 0 && (
                        <View style={styles.tabBadge}>
                          <Text style={styles.tabBadgeText}>{pending}</Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
                <Pressable accessibilityRole="button" onPress={() => setShowNewSheet(true)} style={styles.tab}>
                  <Text style={[styles.tabText, { color: EXCEL_GREEN }]}>{t('sheet_addSheet')}</Text>
                </Pressable>
              </ScrollView>
            </View>

            <View style={styles.footer}>
              <Pressable
                accessibilityRole="button"
                onPress={handleSave}
                disabled={!changedCount || saving}
                style={[styles.saveBtn, (!changedCount || saving) && { opacity: 0.5 }]}>
                <Text style={styles.saveBtnText}>
                  {saving
                    ? t('common_saving')
                    : !changedCount
                    ? t('sheet_noChanges')
                    : changedCount === 1
                    ? t('sheet_saveOne')
                    : t('sheet_save', { count: changedCount })}
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </View>

      {/* Unit picker */}
      <Modal visible={!!pickerRow} transparent animationType="fade" onRequestClose={() => setUnitPickerRow(null)}>
        <Pressable style={styles.overlay} onPress={() => setUnitPickerRow(null)}>
          <Pressable style={styles.dialog} onPress={() => {}}>
            <Text style={styles.dialogTitle}>{t('inv_unitPickerTitle')}</Text>
            <Text style={{ fontSize: 12, color: palette.muted, marginBottom: 12 }}>{t('inv_unitPickerHint')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {units.map(unit => {
                const selected = (pickerRow?.unit || 'kg') === unit;
                return (
                  <Pressable
                    key={unit}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      if (pickerRow) updateRow(pickerRow.key, { unit });
                      setUnitPickerRow(null);
                    }}
                    style={[styles.unitChip, selected && { borderColor: EXCEL_GREEN, backgroundColor: EXCEL_GREEN }]}>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: selected ? '#FFFFFF' : palette.navy }}>{unitLabel(unit)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* New sheet */}
      <Modal visible={showNewSheet} transparent animationType="fade" onRequestClose={() => setShowNewSheet(false)}>
        <Pressable style={styles.overlay} onPress={() => setShowNewSheet(false)}>
          <Pressable style={styles.dialog} onPress={() => {}}>
            <Text style={styles.dialogTitle}>{t('sheet_newSheetTitle')}</Text>
            <Text style={{ fontSize: 12, color: palette.muted, marginBottom: 10 }}>{t('sheet_newSheetHint')}</Text>
            <TextInput
              value={newSheetName}
              onChangeText={setNewSheetName}
              placeholder={t('sheet_newSheetPlaceholder')}
              placeholderTextColor={palette.muted}
              autoFocus
              maxLength={60}
              onSubmitEditing={handleCreateSheet}
              style={styles.dialogInput}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <Pressable onPress={() => setShowNewSheet(false)} style={styles.dialogBtn}>
                <Text style={{ color: palette.muted, fontWeight: '700' }}>{t('common_cancel')}</Text>
              </Pressable>
              <Pressable onPress={handleCreateSheet} style={[styles.dialogBtn, { backgroundColor: EXCEL_GREEN }]}>
                <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>{t('sheet_create')}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Modal>
  );
}

const EXCEL_GREEN = '#107C41';

const COL = { number: 32, name: 150, unit: 68, stock: 62, price: 68, cost: 64 };

const palette = {
  navy: '#0F172A',
  slate: '#334155',
  muted: '#64748B',
  grid: '#D4D9E0',
  page: '#F8FAFC',
  head: '#E2EFDA',
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.page },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: EXCEL_GREEN,
    paddingTop: 44,
    paddingBottom: 12,
    paddingHorizontal: 14,
  },
  title: { fontSize: 18, fontWeight: '800', color: '#FFFFFF' },
  subtitle: { fontSize: 11, color: '#DCFCE7', marginTop: 2 },
  headerBtn: { alignItems: 'center', minWidth: 54 },
  headerBtnIcon: { fontSize: 18 },
  headerBtnText: { fontSize: 9, fontWeight: '700', color: '#FFFFFF', marginTop: 2 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 12,
    marginVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: palette.grid,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
  },
  row: { flexDirection: 'row' },
  cell: {
    minHeight: 38,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: palette.grid,
    paddingHorizontal: 6,
    justifyContent: 'center',
  },
  input: { fontSize: 13, color: palette.navy, paddingVertical: 4 },
  headCell: { backgroundColor: palette.head, minHeight: 32, borderBottomWidth: 1, borderBottomColor: '#A9C9A0' },
  headText: { fontSize: 11, fontWeight: '800', color: palette.slate },
  rowNumber: { width: COL.number, alignItems: 'center', backgroundColor: '#F1F3F5', paddingHorizontal: 0 },
  rowNumberText: { fontSize: 10, color: palette.muted, fontWeight: '700' },
  existingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: EXCEL_GREEN },
  existingName: { flex: 1, fontSize: 13, fontWeight: '700', color: palette.navy },
  addRow: { paddingVertical: 12, paddingLeft: COL.number + 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.grid },
  tabsBar: { borderTopWidth: 1, borderTopColor: palette.grid, backgroundColor: '#F1F3F5', paddingHorizontal: 6 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: palette.grid,
  },
  tabActive: { backgroundColor: '#FFFFFF', borderBottomWidth: 3, borderBottomColor: EXCEL_GREEN },
  tabText: { fontSize: 12, fontWeight: '700', color: palette.slate },
  tabTextActive: { color: EXCEL_GREEN },
  tabBadge: { minWidth: 16, height: 16, borderRadius: 8, backgroundColor: '#F59E0B', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  tabBadgeText: { fontSize: 9, fontWeight: '800', color: '#FFFFFF' },
  footer: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 18, backgroundColor: '#FFFFFF' },
  saveBtn: { backgroundColor: EXCEL_GREEN, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  saveBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  overlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.5)', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 18 },
  dialogTitle: { fontSize: 17, fontWeight: '800', color: palette.navy, marginBottom: 4 },
  dialogInput: { borderWidth: 1, borderColor: palette.grid, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: palette.navy },
  dialogBtn: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 9 },
  unitChip: {
    minWidth: '30%',
    flexGrow: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.grid,
    backgroundColor: palette.page,
  },
});
