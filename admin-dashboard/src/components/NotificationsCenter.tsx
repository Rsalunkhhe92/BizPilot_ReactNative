import React, { useEffect, useState, useMemo } from "react";
import "./NotificationsCenter.css";

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

export type AdminNotification = {
  id: number;
  category: "Customer" | "Application" | string;
  type: "critical" | "warning" | "issue" | "info" | string;
  title: string;
  message: string;
  customerId?: number | null;
  customerName?: string | null;
  isRead: boolean;
  isResolved: boolean;
  actionUrl: string;
  createdAt: string;
};

type NotificationsPayload = {
  notifications: AdminNotification[];
  unreadCount: number;
  customerIssuesCount: number;
  applicationIssuesCount: number;
  totalCount: number;
};

type NotificationsCenterProps = {
  user: { email: string };
  onNavigate: (page: string) => void;
  onNotificationsUpdated?: () => void;
};

const NotificationsCenter: React.FC<NotificationsCenterProps> = ({
  user,
  onNavigate,
  onNotificationsUpdated,
}) => {
  const [data, setData] = useState<NotificationsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"all" | "customer" | "application" | "unresolved">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const adminHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      "X-User-Type": "admin",
      "X-User-Email": user.email,
    }),
    [user.email]
  );

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/notifications`, {
        headers: adminHeaders,
      });
      if (res.ok) {
        const json = await res.json();
        setData(json);
        if (onNotificationsUpdated) onNotificationsUpdated();
      }
    } catch {
      // Graceful fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, [user.email]);

  const markAsRead = async (id: number) => {
    try {
      await fetch(`${API_BASE}/api/admin/notifications/${id}/read`, {
        method: "POST",
        headers: adminHeaders,
      });
      fetchNotifications();
    } catch {
      // Ignore
    }
  };

  const markAllAsRead = async () => {
    try {
      await fetch(`${API_BASE}/api/admin/notifications/mark-all-read`, {
        method: "POST",
        headers: adminHeaders,
      });
      fetchNotifications();
    } catch {
      // Ignore
    }
  };

  const resolveIssue = async (id: number) => {
    try {
      await fetch(`${API_BASE}/api/admin/notifications/${id}/resolve`, {
        method: "POST",
        headers: adminHeaders,
      });
      fetchNotifications();
    } catch {
      // Ignore
    }
  };

  const deleteNotification = async (id: number) => {
    try {
      await fetch(`${API_BASE}/api/admin/notifications/${id}`, {
        method: "DELETE",
        headers: adminHeaders,
      });
      fetchNotifications();
    } catch {
      // Ignore
    }
  };

  const notifications = data?.notifications || [];

  const filteredNotifications = useMemo(() => {
    return notifications.filter((n) => {
      if (activeTab === "customer" && n.category !== "Customer") return false;
      if (activeTab === "application" && n.category !== "Application") return false;
      if (activeTab === "unresolved" && n.isResolved) return false;

      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        n.title.toLowerCase().includes(q) ||
        n.message.toLowerCase().includes(q) ||
        (n.customerName && n.customerName.toLowerCase().includes(q))
      );
    });
  }, [notifications, activeTab, searchQuery]);

  const unreadCount = data?.unreadCount || 0;
  const customerIssuesCount = data?.customerIssuesCount || 0;
  const applicationIssuesCount = data?.applicationIssuesCount || 0;

  return (
    <div className="notif-center-page">
      {/* HEADER */}
      <div className="notif-center-header">
        <div>
          <h1>Notifications & Issues Center</h1>
          <p>
            Real-time tracking of customer issues, account suspensions, subscription notices, and application health alerts.
          </p>
        </div>

        <div className="notif-header-actions">
          <button
            type="button"
            className="notif-btn notif-btn-secondary"
            onClick={fetchNotifications}
          >
            🔄 Refresh
          </button>
          <button
            type="button"
            className="notif-btn notif-btn-primary"
            onClick={markAllAsRead}
          >
            ✓ Mark All as Read
          </button>
        </div>
      </div>

      {/* STAT CARDS */}
      <div className="notif-stats-grid">
        <div
          className="notif-stat-card"
          style={{ cursor: "pointer" }}
          onClick={() => setActiveTab("all")}
        >
          <div className="notif-stat-icon red">🔔</div>
          <div className="notif-stat-info">
            <span className="notif-stat-title">Unread Alerts</span>
            <span className="notif-stat-value">{unreadCount}</span>
          </div>
        </div>

        <div
          className="notif-stat-card"
          style={{ cursor: "pointer" }}
          onClick={() => setActiveTab("customer")}
        >
          <div className="notif-stat-icon amber">👤</div>
          <div className="notif-stat-info">
            <span className="notif-stat-title">Customer Issues</span>
            <span className="notif-stat-value">{customerIssuesCount}</span>
          </div>
        </div>

        <div
          className="notif-stat-card"
          style={{ cursor: "pointer" }}
          onClick={() => setActiveTab("application")}
        >
          <div className="notif-stat-icon purple">⚙️</div>
          <div className="notif-stat-info">
            <span className="notif-stat-title">Application Alerts</span>
            <span className="notif-stat-value">{applicationIssuesCount}</span>
          </div>
        </div>

        <div
          className="notif-stat-card"
          style={{ cursor: "pointer" }}
          onClick={() => setActiveTab("unresolved")}
        >
          <div className="notif-stat-icon green">🛡️</div>
          <div className="notif-stat-info">
            <span className="notif-stat-title">Pending Resolution</span>
            <span className="notif-stat-value">
              {notifications.filter((n) => !n.isResolved).length}
            </span>
          </div>
        </div>
      </div>

      {/* TABS BAR */}
      <div className="notif-tabs-bar">
        <button
          type="button"
          className={`notif-tab-btn ${activeTab === "all" ? "active" : ""}`}
          onClick={() => setActiveTab("all")}
        >
          🔔 All Notifications <span className="notif-tab-counter">{notifications.length}</span>
        </button>

        <button
          type="button"
          className={`notif-tab-btn ${activeTab === "customer" ? "active" : ""}`}
          onClick={() => setActiveTab("customer")}
        >
          👤 Customer Issues{" "}
          <span className="notif-tab-counter">{customerIssuesCount}</span>
        </button>

        <button
          type="button"
          className={`notif-tab-btn ${activeTab === "application" ? "active" : ""}`}
          onClick={() => setActiveTab("application")}
        >
          ⚙️ Application Alerts{" "}
          <span className="notif-tab-counter">{applicationIssuesCount}</span>
        </button>

        <button
          type="button"
          className={`notif-tab-btn ${activeTab === "unresolved" ? "active" : ""}`}
          onClick={() => setActiveTab("unresolved")}
        >
          ⚠️ Pending Issues{" "}
          <span className="notif-tab-counter">
            {notifications.filter((n) => !n.isResolved).length}
          </span>
        </button>
      </div>

      {/* SEARCH TOOLBAR */}
      <div className="notif-toolbar">
        <input
          type="text"
          className="notif-search-input"
          placeholder="Search alerts by customer, issue title, or message..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <span style={{ fontSize: 13, color: "#64748b" }}>
          Showing {filteredNotifications.length} notification(s)
        </span>
      </div>

      {/* NOTIFICATIONS LIST */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#64748b" }}>
          Loading notifications...
        </div>
      ) : filteredNotifications.length === 0 ? (
        <div className="notif-empty">
          <div className="notif-empty-icon">🎉</div>
          <h3>All caught up!</h3>
          <p>No active alerts or customer issues requiring attention right now.</p>
        </div>
      ) : (
        <div className="notif-list">
          {filteredNotifications.map((notif) => {
            const icon =
              notif.type === "critical"
                ? "🚨"
                : notif.type === "warning"
                ? "⚠️"
                : notif.category === "Customer"
                ? "👤"
                : "⚙️";

            return (
              <div
                key={notif.id}
                className={`notif-card ${!notif.isRead ? "unread" : ""} ${
                  notif.isResolved ? "resolved" : ""
                }`}
              >
                <div className="notif-card-main">
                  <div className={`notif-icon-circle ${notif.type}`}>
                    {icon}
                  </div>

                  <div className="notif-body">
                    <div className="notif-meta-tags">
                      <span
                        className={`notif-tag category-${(notif.category || 'general').toLowerCase()}`}
                      >
                        {notif.category || 'General'}
                      </span>
                      <span className={`notif-tag severity-${(notif.type || 'info').toLowerCase()}`}>
                        {(notif.type || 'INFO').toUpperCase()}
                      </span>
                      {notif.isResolved && (
                        <span
                          className="notif-tag"
                          style={{ background: "#dcfce7", color: "#15803d" }}
                        >
                          ✓ RESOLVED
                        </span>
                      )}
                      <span className="notif-time">{notif.createdAt}</span>
                    </div>

                    <h4 className="notif-title">{notif.title}</h4>
                    <p className="notif-message">{notif.message}</p>
                  </div>
                </div>

                <div className="notif-card-actions">
                  {notif.actionUrl && (
                    <button
                      type="button"
                      className="notif-action-btn primary"
                      onClick={() => onNavigate(notif.actionUrl)}
                      title={`Go to ${notif.actionUrl}`}
                    >
                      Open {notif.actionUrl} →
                    </button>
                  )}

                  {!notif.isResolved && (
                    <button
                      type="button"
                      className="notif-action-btn resolve"
                      onClick={() => resolveIssue(notif.id)}
                      title="Mark this issue as resolved"
                    >
                      ✓ Resolve
                    </button>
                  )}

                  {!notif.isRead && (
                    <button
                      type="button"
                      className="notif-action-btn"
                      onClick={() => markAsRead(notif.id)}
                      title="Mark as read"
                    >
                      Read
                    </button>
                  )}

                  <button
                    type="button"
                    className="notif-action-btn"
                    onClick={() => deleteNotification(notif.id)}
                    title="Dismiss alert"
                    style={{ color: "#dc2626" }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default NotificationsCenter;
