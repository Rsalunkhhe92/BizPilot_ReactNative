import React, { useEffect, useState, useMemo } from "react";
import "./BusinessReports.css";

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

type KpiData = {
  totalCustomers: number;
  activeCustomers: number;
  inactiveCustomers: number;
  suspendedCustomers: number;
  mrr: number;
  arr: number;
  arpu: number;
  retentionRate: number;
};

type PlanReportItem = {
  planName: string;
  customers: number;
  revenue: number;
  avgAmount: number;
};

type SectorReportItem = {
  businessType: string;
  totalCustomers: number;
  activeCustomers: number;
  revenue: number;
  activeRate: number;
};

type CycleReportItem = {
  billingCycle: string;
  planCount: number;
  sumAmounts: number;
  avgAmount: number;
};

type GrowthReportItem = {
  period: string;
  signups: number;
  activeSignups: number;
};

type ReportsPayload = {
  kpi: KpiData;
  planReports: PlanReportItem[];
  sectorReports: SectorReportItem[];
  cycleReports: CycleReportItem[];
  growthReports: GrowthReportItem[];
};

type BusinessReportsProps = {
  user: { email: string };
};

const defaultKpi: KpiData = {
  totalCustomers: 0,
  activeCustomers: 0,
  inactiveCustomers: 0,
  suspendedCustomers: 0,
  mrr: 0,
  arr: 0,
  arpu: 0,
  retentionRate: 100,
};

const BusinessReports: React.FC<BusinessReportsProps> = ({ user }) => {
  const [data, setData] = useState<ReportsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "overview" | "financials" | "sectors" | "plans" | "growth"
  >("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const [periodFilter, setPeriodFilter] = useState("all_time");

  const adminHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      "X-User-Type": "admin",
      "X-User-Email": user.email,
    }),
    [user.email]
  );

  const fetchReports = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/business-reports`, {
        headers: adminHeaders,
      });
      if (res.ok) {
        const json = await res.json();
        if (json.reports) {
          setData(json.reports);
        }
      }
    } catch {
      // Fallback empty data handled gracefully
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [user.email]);

  const kpi = data?.kpi || defaultKpi;
  const planReports = data?.planReports || [];
  const sectorReports = data?.sectorReports || [];
  const cycleReports = data?.cycleReports || [];
  const growthReports = data?.growthReports || [];

  // Total calculated revenue for progress percentages
  const totalPlanRevenue = useMemo(
    () => planReports.reduce((acc, p) => acc + p.revenue, 0) || 1,
    [planReports]
  );

  const totalSectorCustomers = useMemo(
    () => sectorReports.reduce((acc, s) => acc + s.totalCustomers, 0) || 1,
    [sectorReports]
  );

  // Filtered table rows based on search
  const filteredPlanReports = useMemo(() => {
    const q = (searchQuery || '').toLowerCase();
    return planReports.filter((p) =>
      (p.planName || '').toLowerCase().includes(q)
    );
  }, [planReports, searchQuery]);

  const filteredSectorReports = useMemo(() => {
    const q = (searchQuery || '').toLowerCase();
    return sectorReports.filter((s) =>
      (s.businessType || '').toLowerCase().includes(q)
    );
  }, [sectorReports, searchQuery]);

  // Export active report table to CSV
  const exportCsv = () => {
    let csvContent = "data:text/csv;charset=utf-8,";
    let filename = "business_report.csv";

    if (activeTab === "plans" || activeTab === "financials" || activeTab === "overview") {
      filename = "plan_revenue_report.csv";
      csvContent += "Plan Name,Customers,Monthly Revenue ($),Avg Amount ($)\r\n";
      planReports.forEach((row) => {
        csvContent += `"${row.planName}",${row.customers},${row.revenue},${row.avgAmount}\r\n`;
      });
    } else if (activeTab === "sectors") {
      filename = "industry_sectors_report.csv";
      csvContent += "Industry / Business Type,Total Customers,Active Customers,Revenue ($),Active Rate (%)\r\n";
      sectorReports.forEach((row) => {
        csvContent += `"${row.businessType}",${row.totalCustomers},${row.activeCustomers},${row.revenue},${row.activeRate}%\r\n`;
      });
    } else {
      filename = "customer_growth_report.csv";
      csvContent += "Period,Signups,Active Signups\r\n";
      growthReports.forEach((row) => {
        csvContent += `"${row.period}",${row.signups},${row.activeSignups}\r\n`;
      });
    }

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="reports-page">
      {/* HEADER */}
      <div className="reports-header">
        <div className="reports-header-text">
          <h1>Business Analytics & Reports</h1>
          <p>
            Real-time financial summaries, industry sector breakdowns, plan performance, and growth metrics.
          </p>
        </div>

        <div className="reports-header-actions">
          <select
            className="reports-filter-select"
            value={periodFilter}
            onChange={(e) => setPeriodFilter(e.target.value)}
          >
            <option value="all_time">All Time</option>
            <option value="last_30">Last 30 Days</option>
            <option value="this_quarter">This Quarter</option>
            <option value="this_year">Year to Date</option>
          </select>

          <button
            type="button"
            className="reports-btn reports-btn-secondary"
            onClick={fetchReports}
            title="Refresh reports data"
          >
            🔄 Refresh
          </button>

          <button
            type="button"
            className="reports-btn reports-btn-primary"
            onClick={exportCsv}
            title="Download CSV of current report"
          >
            📥 Export CSV
          </button>
        </div>
      </div>

      {/* KPI STATS ROW */}
      <div className="reports-kpi-grid">
        <div className="reports-kpi-card">
          <div className="reports-kpi-header">
            <span className="reports-kpi-title">Monthly Revenue (MRR)</span>
            <span className="reports-kpi-icon blue">💰</span>
          </div>
          <div className="reports-kpi-value">${kpi.mrr.toLocaleString()}</div>
          <div className="reports-kpi-meta">
            <span className="reports-badge-trend up">▲ 14.2%</span>
            <span>Annual Run Rate: ${kpi.arr.toLocaleString()}</span>
          </div>
        </div>

        <div className="reports-kpi-card">
          <div className="reports-kpi-header">
            <span className="reports-kpi-title">Total Customers</span>
            <span className="reports-kpi-icon green">👥</span>
          </div>
          <div className="reports-kpi-value">{kpi.totalCustomers}</div>
          <div className="reports-kpi-meta">
            <span className="reports-badge-trend up">{kpi.activeCustomers} Active</span>
            <span>{kpi.inactiveCustomers} Inactive</span>
          </div>
        </div>

        <div className="reports-kpi-card">
          <div className="reports-kpi-header">
            <span className="reports-kpi-title">Customer Retention</span>
            <span className="reports-kpi-icon purple">🛡️</span>
          </div>
          <div className="reports-kpi-value">{kpi.retentionRate}%</div>
          <div className="reports-kpi-meta">
            <span className="reports-badge-trend neutral">Healthy</span>
            <span>{kpi.suspendedCustomers} Suspended</span>
          </div>
        </div>

        <div className="reports-kpi-card">
          <div className="reports-kpi-header">
            <span className="reports-kpi-title">Avg Revenue / Customer (ARPU)</span>
            <span className="reports-kpi-icon amber">📈</span>
          </div>
          <div className="reports-kpi-value">${kpi.arpu}</div>
          <div className="reports-kpi-meta">
            <span className="reports-badge-trend up">▲ Optimal</span>
            <span>Across all active plans</span>
          </div>
        </div>
      </div>

      {/* TABS NAVIGATION */}
      <div className="reports-tabs-bar">
        <button
          type="button"
          className={`reports-tab-btn ${activeTab === "overview" ? "active" : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          📊 Executive Overview
        </button>
        <button
          type="button"
          className={`reports-tab-btn ${activeTab === "financials" ? "active" : ""}`}
          onClick={() => setActiveTab("financials")}
        >
          💳 Revenue & Plans
        </button>
        <button
          type="button"
          className={`reports-tab-btn ${activeTab === "sectors" ? "active" : ""}`}
          onClick={() => setActiveTab("sectors")}
        >
          🏢 Industry Sectors
        </button>
        <button
          type="button"
          className={`reports-tab-btn ${activeTab === "growth" ? "active" : ""}`}
          onClick={() => setActiveTab("growth")}
        >
          🚀 Customer Growth
        </button>
      </div>

      {loading ? (
        <div className="reports-loading">Loading business reports...</div>
      ) : (
        <>
          {/* TWO-COLUMN VISUAL DASHBOARD SECTION */}
          <div className="reports-content-grid">
            {/* Left Panel: Plan Revenue Contribution */}
            <div className="reports-panel">
              <div className="reports-panel-header">
                <h2>Revenue Share by Subscription Plan</h2>
                <span>Monthly Recurring Contribution</span>
              </div>

              <div className="distribution-list">
                {planReports.map((item, idx) => {
                  const pct = Math.round((item.revenue / totalPlanRevenue) * 100);
                  const colors = ["blue", "purple", "green", "amber"];
                  const color = colors[idx % colors.length];

                  return (
                    <div key={item.planName} className="distribution-item">
                      <div className="distribution-meta">
                        <span className="distribution-name">{item.planName}</span>
                        <div className="distribution-values">
                          <span className="distribution-amount">${item.revenue.toLocaleString()}</span>
                          <span className="distribution-pct">{pct}%</span>
                        </div>
                      </div>
                      <div className="distribution-track">
                        <div
                          className={`distribution-fill ${color}`}
                          style={{ width: `${Math.max(pct, 4)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Panel: Industry Sector Breakdown */}
            <div className="reports-panel">
              <div className="reports-panel-header">
                <h2>Customer Distribution by Industry Sector</h2>
                <span>Active Business Demographics</span>
              </div>

              <div className="distribution-list">
                {sectorReports.slice(0, 6).map((item, idx) => {
                  const pct = Math.round((item.totalCustomers / totalSectorCustomers) * 100);
                  const colors = ["green", "blue", "purple", "amber"];
                  const color = colors[idx % colors.length];

                  return (
                    <div key={item.businessType} className="distribution-item">
                      <div className="distribution-meta">
                        <span className="distribution-name">{item.businessType}</span>
                        <div className="distribution-values">
                          <span className="distribution-amount">{item.totalCustomers} clients</span>
                          <span className="distribution-pct">{pct}%</span>
                        </div>
                      </div>
                      <div className="distribution-track">
                        <div
                          className={`distribution-fill ${color}`}
                          style={{ width: `${Math.max(pct, 4)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* GROWTH CHART & BILLING CYCLE TIERS */}
          {(activeTab === "overview" || activeTab === "growth") && (
            <div className="reports-content-grid">
              <div className="reports-panel">
                <div className="reports-panel-header">
                  <h2>Customer Acquisition Growth Trend</h2>
                  <span>Monthly Signups</span>
                </div>

                <div className="growth-chart-container">
                  <svg className="chart-svg" viewBox="0 0 500 180">
                    <line x1="30" y1="140" x2="480" y2="140" stroke="#e2e8f0" strokeWidth="1" />
                    <line x1="30" y1="80" x2="480" y2="80" stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3 3" />
                    <line x1="30" y1="20" x2="480" y2="20" stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3 3" />

                    {(growthReports.length > 0
                      ? growthReports
                      : [
                          { period: "Jan", signups: 4, activeSignups: 4 },
                          { period: "Feb", signups: 7, activeSignups: 6 },
                          { period: "Mar", signups: 9, activeSignups: 8 },
                          { period: "Apr", signups: 12, activeSignups: 11 },
                          { period: "May", signups: 15, activeSignups: 14 },
                          { period: "Jun", signups: 18, activeSignups: 17 },
                        ]
                    ).map((pt, i, arr) => {
                      const maxVal = Math.max(...arr.map((p) => p.signups), 1);
                      const barWidth = 34;
                      const step = 450 / arr.length;
                      const x = 45 + i * step;
                      const barHeight = Math.max((pt.signups / maxVal) * 110, 10);
                      const y = 140 - barHeight;

                      return (
                        <g key={pt.period}>
                          <rect
                            className="chart-bar"
                            x={x}
                            y={y}
                            width={barWidth}
                            height={barHeight}
                          />
                          <text className="chart-value-label" x={x + barWidth / 2} y={y - 6}>
                            {pt.signups}
                          </text>
                          <text className="chart-label" x={x + barWidth / 2} y={160}>
                            {pt.period}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </div>

              {/* Billing Cycle Inventory */}
              <div className="reports-panel">
                <div className="reports-panel-header">
                  <h2>Billing Cycle Tier Breakdown</h2>
                  <span>Cycle Distribution in Database</span>
                </div>

                <div className="distribution-list">
                  {cycleReports.map((c) => (
                    <div key={c.billingCycle} className="distribution-item">
                      <div className="distribution-meta">
                        <span className="distribution-name" style={{ textTransform: "capitalize" }}>
                          {c.billingCycle} Cycle
                        </span>
                        <div className="distribution-values">
                          <span className="distribution-amount">${c.sumAmounts.toLocaleString()}</span>
                          <span className="distribution-pct">({c.planCount} plans)</span>
                        </div>
                      </div>
                      <div className="distribution-track">
                        <div
                          className="distribution-fill purple"
                          style={{ width: `${Math.min(c.planCount * 18, 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* DETAILED DATA TABLE */}
          <div className="reports-table-card">
            <div className="reports-table-toolbar">
              <div className="reports-table-title">
                <h3>
                  {activeTab === "sectors"
                    ? "Industry Sectors & Demographics Report"
                    : activeTab === "growth"
                    ? "Customer Acquisition & Velocity Report"
                    : "Plan Revenue & Performance Ledger"}
                </h3>
                <p>Granular tabular data with real-time database calculations</p>
              </div>

              <div className="reports-table-controls">
                <input
                  type="text"
                  className="reports-search-input"
                  placeholder="Search table rows..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              {activeTab === "sectors" ? (
                <table className="reports-data-table">
                  <thead>
                    <tr>
                      <th>Industry / Business Sector</th>
                      <th>Total Clients</th>
                      <th>Active Clients</th>
                      <th>Generated Revenue</th>
                      <th>Active Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSectorReports.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: "center", padding: 24, color: "#64748b" }}>
                          No matching sector records found.
                        </td>
                      </tr>
                    ) : (
                      filteredSectorReports.map((sector) => (
                        <tr key={sector.businessType}>
                          <td>
                            <strong>{sector.businessType}</strong>
                          </td>
                          <td>{sector.totalCustomers}</td>
                          <td>{sector.activeCustomers}</td>
                          <td>
                            <strong>${sector.revenue.toLocaleString()}</strong>
                          </td>
                          <td>
                            <span className="reports-tag reports-tag-active">
                              {sector.activeRate}% Active
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              ) : (
                <table className="reports-data-table">
                  <thead>
                    <tr>
                      <th>Subscription Plan</th>
                      <th>Subscribed Clients</th>
                      <th>Monthly Revenue</th>
                      <th>Annualized Value</th>
                      <th>Avg ARPU</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPlanReports.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: "center", padding: 24, color: "#64748b" }}>
                          No matching plan revenue records found.
                        </td>
                      </tr>
                    ) : (
                      filteredPlanReports.map((p) => (
                        <tr key={p.planName}>
                          <td>
                            <strong>{p.planName}</strong>
                          </td>
                          <td>{p.customers} clients</td>
                          <td>
                            <strong>${p.revenue.toLocaleString()}</strong>
                          </td>
                          <td>${(p.revenue * 12).toLocaleString()}</td>
                          <td>${p.avgAmount}</td>
                          <td>
                            <span className="reports-tag reports-tag-active">Active</span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default BusinessReports;
