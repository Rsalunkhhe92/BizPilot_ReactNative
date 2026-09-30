import React, { useEffect, useRef, useState } from "react";
import "./subscription.css";

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';


type SubscriptionRecord = {
  id: number;
  planName: string;
  billingCycle: "monthly" | "quarterly" | "yearly";
  amount: number;
  status: string;
  startDate: string;
  endDate: string;
  description: string;
  features: string[];
  isPopular: boolean;
  createdAt?: string;
};

type SubscriptionProps = {
  user: { email: string };
};

type FormState = {
  planName: string;
  monthlyAmount: string;
  quarterlyAmount: string;
  annualAmount: string;
  description: string;
  features: string;
  isPopular: boolean;
  status: "active" | "expired" | "cancelled";
  startDate: string;
};

function renderPlanIcon(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("free")) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 12l10 10 10-10L12 2z" />
        <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      </svg>
    );
  }
  if (lower.includes("small")) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
      </svg>
    );
  }
  if (lower.includes("pro")) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2L3 12l9 10 9-10L12 2z" />
      </svg>
    );
  }
  if (lower.includes("enterprise") || lower.includes("growth")) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
    </svg>
  );
}

const Subscription: React.FC<SubscriptionProps> = ({ user }) => {
  const [subscriptionsList, setSubscriptionsList] = useState<SubscriptionRecord[]>([]);
  const [subscriptionsLoading, setSubscriptionsLoading] = useState(true);
  const [cycleFilter, setCycleFilter] = useState<"monthly" | "quarterly" | "yearly">("monthly");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [toastMessage, setToastMessage] = useState<string>("");

  const [billingCycle, setBillingCycle] = useState<"monthly" | "quarterly" | "annual">("monthly");
  const [showAddForm, setShowAddForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const initialFormState: FormState = {
    planName: "",
    monthlyAmount: "49",
    quarterlyAmount: "132",
    annualAmount: "468",
    description: "",
    features: "Basic customer management\nEmail support\nBasic reports",
    isPopular: false,
    status: "active",
    startDate: today,
  };

  const [subscriptionForm, setSubscriptionForm] = useState<FormState>(initialFormState);

  const adminHeaders = {
    "Content-Type": "application/json",
    "X-User-Type": "admin",
    "X-User-Email": user.email,
  };

  const fetchSubscriptions = () => {
    setSubscriptionsLoading(true);
    return fetch(`${API_BASE}/api/admin/subscriptions`, { headers: adminHeaders })
      .then((response) => response.json())
      .then((result) => {
        setSubscriptionsList(result.subscriptions || []);
      })
      .catch(() => setSubscriptionsList([]))
      .finally(() => setSubscriptionsLoading(false));
  };

  async function deleteSelected(idsToDelete?: number[]) {
    const ids = idsToDelete && idsToDelete.length ? idsToDelete : selectedIds;
    if (!ids.length) return;

    const confirm = window.confirm(
      `Are you sure you want to delete ${ids.length} selected subscription record(s)?`
    );
    if (!confirm) return;

    try {
      const response = await fetch(`${API_BASE}/api/admin/subscriptions`, {
        method: "DELETE",
        headers: adminHeaders,
        body: JSON.stringify({ ids }),
      });
      const result = await response.json();
      if (!response.ok) {
        window.alert(result.message || "Failed to delete subscription records");
        return;
      }

      setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
      await fetchSubscriptions();
      setToastMessage(result.message || `Deleted ${ids.length} subscription record(s)!`);
      setTimeout(() => setToastMessage(""), 5000);
    } catch {
      window.alert("Network error: Unable to reach server.");
    }
  }

  useEffect(() => {
    fetchSubscriptions();
  }, [user.email]);

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setSubscriptionForm((current) => {
      const updated = { ...current, [field]: value };

      // Auto-calculate suggested quarterly and yearly amounts when monthly changes
      if (field === "monthlyAmount") {
        const m = parseInt(value as string, 10) || 0;
        updated.quarterlyAmount = String(Math.round(m * 3 * 0.9));
        updated.annualAmount = String(m * 12);
      }

      return updated;
    });
  }

  async function addSubscription(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!subscriptionForm.planName.trim()) {
      window.alert("Please provide a plan name.");
      return;
    }

    setSubmitting(true);
    const parsedFeatures = subscriptionForm.features
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);

    const payload = {
      planName: subscriptionForm.planName.trim(),
      monthlyAmount: parseInt(subscriptionForm.monthlyAmount, 10) || 0,
      quarterlyAmount: parseInt(subscriptionForm.quarterlyAmount, 10) || 0,
      annualAmount: parseInt(subscriptionForm.annualAmount, 10) || 0,
      description: subscriptionForm.description.trim(),
      features: parsedFeatures,
      isPopular: subscriptionForm.isPopular,
      status: subscriptionForm.status,
      startDate: subscriptionForm.startDate,
    };

    try {
      const response = await fetch(`${API_BASE}/api/admin/subscriptions`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      if (!response.ok) {
        window.alert(result.message || "Unable to add subscription plan.");
        return;
      }

      // Close modal and reset form
      setShowAddForm(false);
      setSubscriptionForm(initialFormState);

      // Instantly reload subscriptions
      await fetchSubscriptions();

      // Show success notification
      setToastMessage(result.message || `Plan '${payload.planName}' added successfully!`);
      setTimeout(() => setToastMessage(""), 6000);
    } catch {
      window.alert("Network error: Unable to reach server.");
    } finally {
      setSubmitting(false);
    }
  }

  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);
  const plansViewport = useRef<HTMLDivElement>(null);

  function updateScrollButtons() {
    const viewport = plansViewport.current;
    if (!viewport) return;
    const maxScroll = viewport.scrollWidth - viewport.clientWidth;
    setCanScrollLeft(viewport.scrollLeft > 10);
    setCanScrollRight(viewport.scrollLeft < maxScroll - 10);
  }

  useEffect(() => {
    updateScrollButtons();
  }, [subscriptionsList, billingCycle]);

  function scrollPlans(direction: "left" | "right") {
    const viewport = plansViewport.current;
    if (!viewport) return;
    const scrollStep = 270;
    const nextPosition =
      direction === "right"
        ? viewport.scrollLeft + scrollStep
        : viewport.scrollLeft - scrollStep;
    viewport.scrollTo({ left: nextPosition, behavior: "smooth" });
    window.setTimeout(updateScrollButtons, 350);
  }

  const filteredSubscriptions = [...subscriptionsList]
    .filter((s) => s.billingCycle === cycleFilter)
    .sort((a, b) =>
      sortOrder === "asc" ? a.amount - b.amount : b.amount - a.amount
    );

  const targetCycle: "monthly" | "quarterly" | "yearly" =
    billingCycle === "annual"
      ? "yearly"
      : billingCycle === "quarterly"
        ? "quarterly"
        : "monthly";
  const carouselCards = [...subscriptionsList]
    .filter((s) => s.billingCycle === targetCycle)
    .sort((a, b) => a.amount - b.amount);

  const currentTabIds = filteredSubscriptions.map((s) => s.id);
  const isAllSelected =
    currentTabIds.length > 0 &&
    currentTabIds.every((id) => selectedIds.includes(id));

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds((prev) =>
        prev.filter((id) => !currentTabIds.includes(id))
      );
    } else {
      setSelectedIds((prev) =>
        Array.from(new Set([...prev, ...currentTabIds]))
      );
    }
  };

  const toggleSelectRow = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  return (
    <div className="subscription-page">
      <div className="subscription-header">
        <div>
          <div className="breadcrumb">
            Workspace <span>/</span> Subscription Plans
          </div>

          <h1>Pricing</h1>

          <p>
            Sign up in less than 30 seconds. Try our 7 day free trial, upgrade
            at any time, no questions, no hassle.
          </p>
        </div>

        <div className="subscription-header-actions">
          <button
            type="button"
            className="subscription-add-button"
            onClick={() => setShowAddForm(true)}
          >
            + Add Subscription Plan
          </button>
        </div>
      </div>

      {/* CENTERED BILLING TOGGLE */}
      <div className="billing-toggle-container">
        <div className="billing-toggle" role="group" aria-label="Billing cycle">
          <button
            className={billingCycle === "monthly" ? "selected" : ""}
            onClick={() => {
              setBillingCycle("monthly");
              setCycleFilter("monthly");
            }}
          >
            Monthly
          </button>
          <button
            className={billingCycle === "quarterly" ? "selected" : ""}
            onClick={() => {
              setBillingCycle("quarterly");
              setCycleFilter("quarterly");
            }}
          >
            Quarterly
          </button>
          <button
            className={billingCycle === "annual" ? "selected" : ""}
            onClick={() => {
              setBillingCycle("annual");
              setCycleFilter("yearly");
            }}
          >
            Annually
          </button>
        </div>
      </div>

      {toastMessage && (
        <div className="subscription-toast">
          <span>✓ {toastMessage}</span>
          <button type="button" onClick={() => setToastMessage("")}>
            ×
          </button>
        </div>
      )}

      {/* CAROUSEL OF PLANS (100% in sync with database records table) */}
      <div className="plans-carousel-shell">
        <button
          type="button"
          className="carousel-nav-btn prev"
          onClick={() => scrollPlans("left")}
          disabled={!canScrollLeft}
          aria-label="Previous plans"
        >
          &lsaquo;
        </button>

        <div
          ref={plansViewport}
          className="plans-viewport"
          onScroll={updateScrollButtons}
        >
          {subscriptionsLoading ? (
            <div className="subscription-state">Loading plans...</div>
          ) : carouselCards.length === 0 ? (
            <div className="subscription-state">No subscription plans available for this cycle.</div>
          ) : (
            <div className="plans-track">
              {carouselCards.map((card) => {
                const period =
                  billingCycle === "annual"
                    ? "year"
                    : billingCycle === "quarterly"
                      ? "quarter"
                      : "month";

                return (
                  <article
                    key={card.id}
                    className={`pricing-card ${card.isPopular ? "popular" : ""}`}
                  >
                    {card.isPopular && (
                      <div className="popular-badge-pill">MOST POPULAR</div>
                    )}

                    <div className="card-top-icon">
                      {renderPlanIcon(card.planName)}
                    </div>

                    <h3 className="card-plan-title">{card.planName}</h3>
                    <p className="card-plan-subtitle">{card.description}</p>

                    <div className="card-price-row">
                      <span className="card-currency">$</span>
                      <span className="card-amount">{card.amount}</span>
                      <span className="card-period">/{period}</span>
                    </div>

                    <button
                      type="button"
                      className={`card-cta-btn ${card.isPopular ? "primary" : "secondary"
                        }`}
                    >
                      {card.isPopular ? "Current Plan" : "Sign up today"}
                    </button>

                    <div className="card-features-block">
                      <p className="card-features-title">What's included</p>
                      <ul className="card-features-list">
                        {(card.features || []).map((feature, featureIndex) => (
                          <li key={featureIndex}>
                            <span className="card-feature-icon">✓</span>
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <button
          type="button"
          className="carousel-nav-btn next"
          onClick={() => scrollPlans("right")}
          disabled={!canScrollRight}
          aria-label="Next plans"
        >
          &rsaquo;
        </button>
      </div>

      {/* SINGLE UNIFIED DATABASE RECORDS TABLE */}
      <section className="subscription-records-panel">
        <div className="subscription-records-header">
          <div>
            <h2>Database Records Table</h2>
            <p>
              Separate subscription records by billing cycle: Monthly, Quarterly, and Yearly.
            </p>
          </div>

          <div className="subscription-records-actions">
            {selectedIds.length > 0 && (
              <button
                type="button"
                className="delete-selected-button"
                onClick={() => deleteSelected()}
                title="Delete selected subscription rows"
              >
                🗑 Delete Selected ({selectedIds.length})
              </button>
            )}

            <div className="subscription-records-tabs">
              <button
                type="button"
                className={cycleFilter === "monthly" ? "active" : ""}
                onClick={() => {
                  setCycleFilter("monthly");
                  setBillingCycle("monthly");
                  setSelectedIds([]);
                }}
              >
                Monthly ({subscriptionsList.filter((s) => s.billingCycle === "monthly").length})
              </button>
              <button
                type="button"
                className={cycleFilter === "quarterly" ? "active" : ""}
                onClick={() => {
                  setCycleFilter("quarterly");
                  setBillingCycle("quarterly");
                  setSelectedIds([]);
                }}
              >
                Quarterly ({subscriptionsList.filter((s) => s.billingCycle === "quarterly").length})
              </button>
              <button
                type="button"
                className={cycleFilter === "yearly" ? "active" : ""}
                onClick={() => {
                  setCycleFilter("yearly");
                  setBillingCycle("annual");
                  setSelectedIds([]);
                }}
              >
                Yearly ({subscriptionsList.filter((s) => s.billingCycle === "yearly").length})
              </button>
            </div>
          </div>
        </div>

        <div style={{ overflowX: "auto", marginTop: 14 }}>
          {subscriptionsLoading ? (
            <div className="subscription-state">Loading subscriptions table...</div>
          ) : filteredSubscriptions.length === 0 ? (
            <div className="subscription-state">No subscription records found.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: 42, textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all rows"
                      style={{ cursor: "pointer", width: 16, height: 16 }}
                    />
                  </th>
                  <th>ID</th>
                  <th>Plan Name</th>
                  <th>Billing Cycle</th>
                  <th
                    onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
                    style={{ cursor: "pointer", userSelect: "none" }}
                    title="Click to toggle sorting by Plan Amount"
                  >
                    Plan Amount {sortOrder === "asc" ? "▲" : "▼"}
                  </th>
                  <th>Status</th>
                  <th>Start Date</th>
                  <th>End Date</th>
                  <th>Description</th>
                  <th>Popular</th>
                  <th>Features</th>
                  <th>Created At</th>
                  <th style={{ width: 50, textAlign: "center" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredSubscriptions.map((sub) => (
                  <tr
                    key={sub.id}
                    className={selectedIds.includes(sub.id) ? "row-selected" : ""}
                  >
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(sub.id)}
                        onChange={() => toggleSelectRow(sub.id)}
                        aria-label={`Select row ${sub.id}`}
                        style={{ cursor: "pointer", width: 16, height: 16 }}
                      />
                    </td>
                    <td>
                      <strong>#{sub.id}</strong>
                    </td>
                    <td>
                      <div className="plan-title-cell">
                        <strong>{sub.planName}</strong>
                      </div>
                    </td>
                    <td>
                      <span className={`cycle-badge ${sub.billingCycle}`}>
                        {sub.billingCycle}
                      </span>
                    </td>
                    <td>
                      <strong style={{ fontSize: 13, color: "#18243f" }}>
                        ${sub.amount}
                      </strong>
                    </td>
                    <td>
                      <span className={`status ${sub.status.toLowerCase()}`}>
                        {sub.status}
                      </span>
                    </td>
                    <td>{sub.startDate}</td>
                    <td>{sub.endDate}</td>
                    <td>{sub.description || "—"}</td>
                    <td>
                      {sub.isPopular ? (
                        <span className="status active">POPULAR</span>
                      ) : (
                        <span style={{ color: "#9aa4b6" }}>No</span>
                      )}
                    </td>
                    <td>
                      <small style={{ color: "#4f5d75" }}>
                        {(sub.features || []).join(", ") || "—"}
                      </small>
                    </td>
                    <td>
                      <small style={{ color: "#8a96a8" }}>{sub.createdAt || "—"}</small>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <button
                        type="button"
                        className="row-delete-button"
                        onClick={() => deleteSelected([sub.id])}
                        title="Delete this subscription row"
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* POPUP MODAL */}
      {showAddForm && (
        <div
          className="subscription-modal-backdrop"
          onMouseDown={(event) => event.target === event.currentTarget && setShowAddForm(false)}
        >
          <form className="subscription-form" onSubmit={addSubscription}>
            <div className="subscription-form-header">
              <div>
                <h2>Add Subscription Plan</h2>
                <p style={{ margin: "2px 0 0", color: "#8290a8", fontSize: 12 }}>
                  Inserts separate rows for Monthly and Quarterly into the <code>subscriptions</code> table.
                </p>
              </div>
              <button type="button" onClick={() => setShowAddForm(false)}>
                ×
              </button>
            </div>

            <label>
              Plan Name *
              <input
                required
                maxLength={100}
                placeholder="e.g. ABC, Startup, Professional, Enterprise"
                value={subscriptionForm.planName}
                onChange={(event) => updateField("planName", event.target.value)}
              />
            </label>

            {/* BILLING CYCLES / AMOUNTS (Generates separate rows) */}
            <div className="subscription-form-section-title">
              💰 Pricing by Billing Cycle (Creates separate rows)
            </div>

            <div className="subscription-form-grid">
              <label>
                Monthly Amount ($) * <span style={{ fontWeight: 400, color: "#8a96a8" }}>(Row 1: 30 days)</span>
                <input
                  required
                  min="0"
                  type="number"
                  value={subscriptionForm.monthlyAmount}
                  onChange={(event) => updateField("monthlyAmount", event.target.value)}
                />
              </label>

              <label>
                Quarterly Amount ($) * <span style={{ fontWeight: 400, color: "#8a96a8" }}>(Row 2: 90 days)</span>
                <input
                  required
                  min="0"
                  type="number"
                  value={subscriptionForm.quarterlyAmount}
                  onChange={(event) => updateField("quarterlyAmount", event.target.value)}
                />
              </label>
            </div>

            <div className="subscription-form-grid">
              <label>
                Yearly / Annual Amount ($) <span style={{ fontWeight: 400, color: "#8a96a8" }}>(Row 3: 365 days)</span>
                <input
                  min="0"
                  type="number"
                  value={subscriptionForm.annualAmount}
                  onChange={(event) => updateField("annualAmount", event.target.value)}
                />
              </label>

              <label>
                Status *
                <select
                  value={subscriptionForm.status}
                  onChange={(event) =>
                    updateField("status", event.target.value as FormState["status"])
                  }
                >
                  <option value="active">Active</option>
                  <option value="expired">Expired</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
            </div>

            <label>
              Start Date *
              <input
                required
                type="date"
                value={subscriptionForm.startDate}
                onChange={(event) => updateField("startDate", event.target.value)}
              />
            </label>

            <label>
              Description
              <input
                maxLength={255}
                placeholder="Brief plan summary (e.g. For growing teams)"
                value={subscriptionForm.description}
                onChange={(event) => updateField("description", event.target.value)}
              />
            </label>

            <label>
              Features (one per line)
              <textarea
                placeholder="Up to 10 customers&#10;Email support&#10;Advanced reports"
                rows={3}
                value={subscriptionForm.features}
                onChange={(event) => updateField("features", event.target.value)}
              />
            </label>

            <label className="subscription-form-checkbox">
              <input
                type="checkbox"
                checked={subscriptionForm.isPopular}
                onChange={(event) => updateField("isPopular", event.target.checked)}
              />
              Mark as Most Popular plan
            </label>

            <div className="subscription-form-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowAddForm(false)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button type="submit" className="primary-button" disabled={submitting}>
                {submitting ? "Saving..." : "Save Subscription Rows"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default Subscription;