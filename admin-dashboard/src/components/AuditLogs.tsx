import React, { useEffect, useState, useMemo } from "react";
import "./AuditLogs.css";

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

type AuditLogItem = {
  id: number;
  recordId?: number;
  name: string;
  action: "CREATED" | "UPDATED" | "DELETED" | string;
  performedBy: string;
  details: string;
  oldValues: Record<string, any>;
  newValues: Record<string, any>;
  createdAt: string;
  category: "Customer" | "Subscription" | "Business Type";
};

type AuditLogsResponse = {
  allLogs: AuditLogItem[];
  customerLogs: AuditLogItem[];
  subscriptionLogs: AuditLogItem[];
  businessTypeLogs: AuditLogItem[];
  stats: {
    totalCustomerLogs: number;
    totalSubscriptionLogs: number;
    totalBusinessTypeLogs: number;
    totalLogs: number;
  };
};

type AuditLogsProps = {
  user: { email: string };
};

const AuditLogs: React.FC<AuditLogsProps> = ({ user }) => {
  const [data, setData] = useState<AuditLogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"all" | "customer" | "subscription" | "business_type">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [expandedRowIds, setExpandedRowIds] = useState<Set<number>>(new Set());

  const adminHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      "X-User-Type": "admin",
      "X-User-Email": user.email,
    }),
    [user.email]
  );

  const fetchAuditLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/audit-logs?entity=all`, {
        headers: adminHeaders,
      });
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuditLogs();
  }, [user.email]);

  const toggleRowDiff = (id: number) => {
    setExpandedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Determine active log dataset based on selected tab
  const activeDataset: AuditLogItem[] = useMemo(() => {
    if (!data) return [];
    if (activeTab === "customer") return data.customerLogs || [];
    if (activeTab === "subscription") return data.subscriptionLogs || [];
    if (activeTab === "business_type") return data.businessTypeLogs || [];
    return data.allLogs || [];
  }, [data, activeTab]);

  // Apply filters
  const filteredLogs = useMemo(() => {
    return activeDataset.filter((item) => {
      const q = (searchQuery || '').toLowerCase();
      const matchesSearch =
        (item.name || '').toLowerCase().includes(q) ||
        (item.details || '').toLowerCase().includes(q) ||
        (item.performedBy || '').toLowerCase().includes(q) ||
        (item.action || '').toLowerCase().includes(q);

      const matchesAction =
        actionFilter === "all" || (item.action || '').toUpperCase() === actionFilter.toUpperCase();

      return matchesSearch && matchesAction;
    });
  }, [activeDataset, searchQuery, actionFilter]);

  const stats = data?.stats || {
    totalCustomerLogs: data?.customerLogs?.length || 0,
    totalSubscriptionLogs: data?.subscriptionLogs?.length || 0,
    totalBusinessTypeLogs: data?.businessTypeLogs?.length || 0,
    totalLogs: data?.allLogs?.length || 0,
  };

  // CSV Export for active view
  const exportCsv = () => {
    if (filteredLogs.length === 0) return;

    let filename = `audit_logs_${activeTab}.csv`;
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Log ID,Category,Action,Target Record,Performed By,Details,Timestamp\r\n";

    filteredLogs.forEach((l) => {
      const safeDetails = l.details.replace(/"/g, '""');
      const safeName = l.name.replace(/"/g, '""');
      csvContent += `${l.id},"${l.category}","${l.action}","${safeName}","${l.performedBy}","${safeDetails}","${l.createdAt}"\r\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="audit-logs-page">
      {/* HEADER */}
      <div className="audit-header">
        <div className="audit-header-text">
          <h1>System Audit & Modification Logs</h1>
          <p>
            Detailed traceability of customer modifications, subscription plan changes, and business category updates.
          </p>
        </div>

        <div className="audit-header-actions">
          <button
            type="button"
            className="audit-btn audit-btn-secondary"
            onClick={fetchAuditLogs}
            title="Refresh logs from database"
          >
            🔄 Refresh
          </button>
          <button
            type="button"
            className="audit-btn audit-btn-primary"
            onClick={exportCsv}
            title="Export filtered logs to CSV"
          >
            📥 Export CSV
          </button>
        </div>
      </div>

      {/* STAT CARDS */}
      <div className="audit-stat-grid">
        <div
          className="audit-stat-card"
          style={{ cursor: "pointer" }}
          onClick={() => setActiveTab("all")}
        >
          <div className="audit-stat-icon blue">🛡️</div>
          <div className="audit-stat-info">
            <span className="audit-stat-title">Total Modifications</span>
            <span className="audit-stat-value">{stats.totalLogs}</span>
          </div>
        </div>

        <div
          className="audit-stat-card"
          style={{ cursor: "pointer" }}
          onClick={() => setActiveTab("customer")}
        >
          <div className="audit-stat-icon green">👤</div>
          <div className="audit-stat-info">
            <span className="audit-stat-title">Customer Logs</span>
            <span className="audit-stat-value">{stats.totalCustomerLogs}</span>
          </div>
        </div>

        <div
          className="audit-stat-card"
          style={{ cursor: "pointer" }}
          onClick={() => setActiveTab("subscription")}
        >
          <div className="audit-stat-icon purple">💳</div>
          <div className="audit-stat-info">
            <span className="audit-stat-title">Subscription Logs</span>
            <span className="audit-stat-value">{stats.totalSubscriptionLogs}</span>
          </div>
        </div>

        <div
          className="audit-stat-card"
          style={{ cursor: "pointer" }}
          onClick={() => setActiveTab("business_type")}
        >
          <div className="audit-stat-icon amber">🏢</div>
          <div className="audit-stat-info">
            <span className="audit-stat-title">Business Type Logs</span>
            <span className="audit-stat-value">{stats.totalBusinessTypeLogs}</span>
          </div>
        </div>
      </div>

      {/* TABS SWITCHER */}
      <div className="audit-tabs-bar">
        <button
          type="button"
          className={`audit-tab-btn ${activeTab === "all" ? "active" : ""}`}
          onClick={() => setActiveTab("all")}
        >
          📑 All Logs <span className="audit-tab-counter">{stats.totalLogs}</span>
        </button>

        <button
          type="button"
          className={`audit-tab-btn ${activeTab === "customer" ? "active" : ""}`}
          onClick={() => setActiveTab("customer")}
        >
          👤 Customer Logs{" "}
          <span className="audit-tab-counter">{stats.totalCustomerLogs}</span>
        </button>

        <button
          type="button"
          className={`audit-tab-btn ${activeTab === "subscription" ? "active" : ""}`}
          onClick={() => setActiveTab("subscription")}
        >
          💳 Subscription Logs{" "}
          <span className="audit-tab-counter">{stats.totalSubscriptionLogs}</span>
        </button>

        <button
          type="button"
          className={`audit-tab-btn ${activeTab === "business_type" ? "active" : ""}`}
          onClick={() => setActiveTab("business_type")}
        >
          🏢 Business Type Logs{" "}
          <span className="audit-tab-counter">{stats.totalBusinessTypeLogs}</span>
        </button>
      </div>

      {/* MAIN LOGS CARD */}
      <div className="audit-card">
        {/* TOOLBAR */}
        <div className="audit-toolbar">
          <div className="audit-toolbar-left">
            <h3>
              {activeTab === "customer"
                ? "Customer Audit Trail & Modifications"
                : activeTab === "subscription"
                ? "Subscription Plans & Pricing Audit Trail"
                : activeTab === "business_type"
                ? "Business Types & Categories Audit Trail"
                : "Consolidated Workspace Audit Stream"}
            </h3>
            <p>
              Showing {filteredLogs.length} record(s) matching your criteria
            </p>
          </div>

          <div className="audit-toolbar-filters">
            <div className="audit-search-box">
              <span className="audit-search-icon">🔍</span>
              <input
                type="text"
                className="audit-search-input"
                placeholder={`Search ${activeTab.replace("_", " ")} logs...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <select
              className="audit-select-filter"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
            >
              <option value="all">All Actions</option>
              <option value="CREATED">CREATED</option>
              <option value="UPDATED">UPDATED</option>
              <option value="DELETED">DELETED</option>
            </select>
          </div>
        </div>

        {/* TABLE CONTENT */}
        {loading ? (
          <div className="audit-loading">Loading audit records from database...</div>
        ) : filteredLogs.length === 0 ? (
          <div className="audit-empty">
            <div className="audit-empty-icon">📭</div>
            <p>No audit log entries found for the selected view and filter criteria.</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="audit-table">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Action</th>
                  {activeTab === "all" && <th style={{ width: 120 }}>Entity</th>}
                  <th style={{ width: 180 }}>
                    {activeTab === "customer"
                      ? "Customer Name"
                      : activeTab === "subscription"
                      ? "Plan Name"
                      : activeTab === "business_type"
                      ? "Category Name"
                      : "Record Target"}
                  </th>
                  <th>Modification Details</th>
                  <th style={{ width: 160 }}>Performed By</th>
                  <th style={{ width: 160 }}>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => {
                  const hasDiff =
                    (log.oldValues && Object.keys(log.oldValues).length > 0) ||
                    (log.newValues && Object.keys(log.newValues).length > 0);
                  const isExpanded = expandedRowIds.has(log.id);

                  let badgeClass = "created";
                  if (log.action === "UPDATED") badgeClass = "updated";
                  if (log.action === "DELETED") badgeClass = "deleted";

                  return (
                    <tr key={log.id}>
                      <td>
                        <span className={`audit-badge ${badgeClass}`}>
                          {log.action}
                        </span>
                      </td>

                      {activeTab === "all" && (
                        <td>
                          <span className="audit-entity-tag">{log.category}</span>
                        </td>
                      )}

                      <td>
                        <strong>{log.name}</strong>
                        {log.recordId && (
                          <div style={{ fontSize: 11, color: "#64748b" }}>
                            ID #{log.recordId}
                          </div>
                        )}
                      </td>

                      <td>
                        <div className="audit-details-text">{log.details}</div>

                        {hasDiff && (
                          <div>
                            <button
                              type="button"
                              className="audit-diff-trigger"
                              onClick={() => toggleRowDiff(log.id)}
                            >
                              {isExpanded ? "▼ Hide Changes" : "▶ View Field Diffs"}
                            </button>

                            {isExpanded && (
                              <div className="audit-diff-box">
                                {log.oldValues && Object.keys(log.oldValues).length > 0 && (
                                  <div style={{ marginBottom: 6 }}>
                                    <strong style={{ color: "#b91c1c" }}>Before (Old):</strong>
                                    {Object.entries(log.oldValues).map(([k, v]) => (
                                      <div key={k} className="audit-diff-row">
                                        <span>{k}:</span>
                                        <span className="audit-diff-old">
                                          {typeof v === "object" ? JSON.stringify(v) : String(v)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {log.newValues && Object.keys(log.newValues).length > 0 && (
                                  <div>
                                    <strong style={{ color: "#15803d" }}>After (New):</strong>
                                    {Object.entries(log.newValues).map(([k, v]) => (
                                      <div key={k} className="audit-diff-row">
                                        <span>{k}:</span>
                                        <span className="audit-diff-new">
                                          {typeof v === "object" ? JSON.stringify(v) : String(v)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      <td>
                        <div style={{ fontWeight: 500, color: "#1e293b" }}>
                          {log.performedBy}
                        </div>
                      </td>

                      <td>
                        <div style={{ color: "#64748b", fontSize: 12 }}>
                          {log.createdAt}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuditLogs;
