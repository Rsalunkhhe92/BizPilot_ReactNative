/** Mahila Bachat Gat - formatting and export helpers (no React). */

export function inr(value: unknown, withSymbol = true): string {
  const n = Number(value ?? 0);
  if (!isFinite(n)) return '-';
  const abs = Math.abs(n);
  const fixed = abs % 1 === 0 ? abs.toFixed(0) : abs.toFixed(2);
  const [whole, frac] = fixed.split('.');
  // Indian digit grouping: 12,34,567
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const grouped = rest ? `${rest},${last3}` : last3;
  return `${n < 0 ? '-' : ''}${withSymbol ? '₹' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(value?: string | null): string {
  if (!value) return '-';
  const [y, m, d] = String(value).slice(0, 10).split('-');
  if (!y || !m || !d) return String(value);
  return `${Number(d)} ${MONTHS[Number(m) - 1] || m} ${y}`;
}

export function isoToday(): string {
  const d = new Date();
  return toIso(d);
}

export function toIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function monthStartIso(): string {
  const d = new Date();
  return toIso(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function fyStartIso(): string {
  const d = new Date();
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-04-01`;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface ReportColumn {
  key: string;
  label: string;
  type: 'text' | 'money' | 'date' | 'number';
}

export function cellText(col: ReportColumn, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (col.type === 'money') return inr(value);
  if (col.type === 'date') return fmtDate(String(value));
  return String(value);
}

/** Printable HTML for a report (rendered to PDF with expo-print on the device). */
export function reportHtml(title: string, meta: string, columns: ReportColumn[], rows: any[], totals: Record<string, number>) {
  const cell = 'border:1px solid #cbd5e1;padding:5px 6px;';
  const head = columns.map(c => `<th style="${cell}background:#eef2ff;text-align:${c.type === 'text' || c.type === 'date' ? 'left' : 'right'}">${escapeHtml(c.label)}</th>`).join('');
  const body = rows.map(r => `<tr>${columns.map(c => `<td style="${cell}text-align:${c.type === 'text' || c.type === 'date' ? 'left' : 'right'}">${escapeHtml(cellText(c, r[c.key]))}</td>`).join('')}</tr>`).join('');
  const hasTotals = Object.keys(totals || {}).length > 0;
  const foot = hasTotals
    ? `<tr>${columns.map((c, i) => `<td style="${cell}font-weight:bold;text-align:${i === 0 ? 'left' : 'right'}">${i === 0 ? 'Total' : escapeHtml(totals[c.key] !== undefined ? cellText(c, totals[c.key]) : '')}</td>`).join('')}</tr>`
    : '';
  return `<html><head><meta charset="utf-8"/></head>
    <body style="font-family:Helvetica,Arial,sans-serif;color:#0f172a;padding:18px;">
      <h2 style="margin:0 0 4px;">${escapeHtml(title)}</h2>
      <div style="color:#64748b;font-size:11px;margin-bottom:12px;">${escapeHtml(meta)}</div>
      <table style="width:100%;border-collapse:collapse;font-size:10px;">
        <thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${columns.length}" style="${cell}text-align:center;color:#94a3b8">No records</td></tr>`}${foot}</tbody>
      </table>
    </body></html>`;
}

export function receiptHtml(r: any, labels: Record<string, string>) {
  const row = (k: string, v: unknown) => v === null || v === undefined || v === '' ? '' :
    `<tr><td style="padding:6px 0;color:#64748b">${escapeHtml(k)}</td><td style="padding:6px 0;text-align:right;font-weight:600">${escapeHtml(v)}</td></tr>`;
  return `<html><head><meta charset="utf-8"/></head>
    <body style="font-family:Helvetica,Arial,sans-serif;color:#0f172a;padding:24px;max-width:480px;margin:auto;">
      <div style="text-align:center;border-bottom:2px solid #4f46e5;padding-bottom:10px;margin-bottom:12px;">
        <div style="font-size:18px;font-weight:bold;">${escapeHtml(r.groupNameMr || '')}</div>
        <div style="font-size:15px;">${escapeHtml(r.groupNameEn)} (${escapeHtml(r.groupCode)})</div>
        <div style="color:#64748b;font-size:12px;">${escapeHtml(r.village || '')}</div>
        <div style="margin-top:8px;font-weight:bold;letter-spacing:1px;">${escapeHtml(labels.title)}</div>
      </div>
      <table style="width:100%;font-size:13px;border-collapse:collapse;">
        ${row(labels.receiptNo, r.receiptNumber || r.txnNumber)}
        ${row(labels.date, fmtDate(r.txnDate))}
        ${row(labels.member, r.memberName ? `${r.memberName} (#${r.memberNumber})` : '')}
        ${row(labels.type, labels.typeValue)}
        ${row(labels.loan, r.applicationNumber)}
        ${Number(r.principalAmount) ? row(labels.principal, inr(r.principalAmount)) : ''}
        ${Number(r.interestAmount) ? row(labels.interest, inr(r.interestAmount)) : ''}
        ${Number(r.penaltyAmount) ? row(labels.penalty, inr(r.penaltyAmount)) : ''}
        ${row(labels.mode, r.paymentMethod + (r.referenceNumber ? ` · ${r.referenceNumber}` : ''))}
        ${row(labels.amount, inr(r.amount))}
        ${r.savingsBalance !== undefined ? row(labels.savingsBalance, inr(r.savingsBalance)) : ''}
        ${r.loanPrincipalOutstanding !== undefined ? row(labels.loanBalance, inr(r.loanPrincipalOutstanding)) : ''}
        ${r.postingStatus === 'Reversed' ? row(labels.status, labels.reversed) : ''}
      </table>
      <div style="display:flex;justify-content:space-between;margin-top:40px;font-size:12px;color:#334155;">
        <div>${escapeHtml(r.signatories?.Treasurer || '')}<br/>${escapeHtml(labels.treasurer)}</div>
        <div style="text-align:right">${escapeHtml(r.signatories?.President || '')}<br/>${escapeHtml(labels.president)}</div>
      </div>
      <div style="margin-top:24px;font-size:10px;color:#94a3b8;text-align:center">${escapeHtml(r.txnNumber)}</div>
    </body></html>`;
}
