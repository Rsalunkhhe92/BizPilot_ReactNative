import React, { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertCircle,
  Bell,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CreditCard,
  Database,
  // Edit3,
  LayoutDashboard,
  LogOut,
  Menu,
  MoreHorizontal,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import './App.css'
import BusinessTypes from './components/BusinessTypes'
import Subscription from './components/subscription'
import CustomerActivity from './components/CustomerActivity'
import BusinessReports from './components/BusinessReports'
import AuditLogs from './components/AuditLogs'
import NotificationsCenter, { type AdminNotification } from './components/NotificationsCenter'

type UserType = 'admin' | 'customer'
type Status = 'Active' | 'Inactive' | 'Suspended'
type Plan = 'Monthly' | 'Quarterly' | 'Yearly' | 'None'

type AdminUser = {
  id: number
  fullName: string
  email: string
  userType: UserType
  status?: string
}

type DashboardSummary = {
  totalUsers: number
  activeUsers: number
  inactiveUsers: number
}

type CustomerRecord = {
  id: number
  fullName: string
  email: string
  dob: string
  status: Status
  businessType: string
  subscriptionPlan: Plan
  planAmount: number
  enabledFeatures?: string[]
}

type CustomerFormData = {
  fullName: string
  email: string
  dob: string
  businessType: string
  status: 'active' | 'inactive' | 'suspended'
  subscriptionPlan: string
  planAmount: string
  enabledFeatures: string[]
}

export type FeatureItem = {
  key: string
  label: string
  category: string
  description: string
}

export const SYSTEM_FEATURES: FeatureItem[] = [
  // Auto Driver
  { key: 'vehicle', label: 'Vehicle', category: 'Auto Driver', description: 'Vehicle Reg, RC & Insurance' },
  { key: 'trips', label: 'Trips', category: 'Auto Driver', description: 'Daily rides & meter fares' },
  { key: 'fuel', label: 'Fuel Log', category: 'Auto Driver', description: 'CNG/Petrol/Diesel fill-ups' },

  // Fruit & Veg / Retail
  { key: 'products', label: 'Products', category: 'Retail / Grocery', description: 'Price list & item units' },
  { key: 'inventory', label: 'Inventory', category: 'Retail / Grocery', description: 'Stock levels & wastage' },
  { key: 'sales', label: 'Sales / Billing', category: 'Retail / Grocery', description: 'Counter POS & customer billing' },
  { key: 'purchases', label: 'Purchases', category: 'Retail / Grocery', description: 'Supplier & mandi purchases' },

  // Mechanic
  { key: 'service_jobs', label: 'Service Jobs', category: 'Mechanic', description: 'Job cards & repair orders' },
  { key: 'vehicle_customer', label: 'Vehicle Customer', category: 'Mechanic', description: 'Owner details & vehicle info' },
  { key: 'spare_parts', label: 'Spare Parts', category: 'Mechanic', description: 'Parts inventory & items used' },
  { key: 'job_status', label: 'Job Status', category: 'Mechanic', description: 'Live progress tracking' },

  // Collection
  { key: 'collection_records', label: 'Collection Records', category: 'Collection', description: 'Field collection logs' },
  { key: 'due_amount', label: 'Due Amount', category: 'Collection', description: 'Customer balance & dues' },
  { key: 'payment_collection', label: 'Payment Collection', category: 'Collection', description: 'Receipts & payment modes' },

  // Travels
  { key: 'online_booking', label: 'Online Booking', category: 'Travel Operator', description: 'Bus trips, seat map & bookings' },
]

export const DEFAULT_BUSINESS_FEATURES: Record<string, string[]> = {
  'Auto-rickshaw drivers': ['vehicle', 'trips', 'fuel'],
  'Auto-rickshaw driver': ['vehicle', 'trips', 'fuel'],
  'Auto Driver': ['vehicle', 'trips', 'fuel'],
  'Fruit sellers': ['products', 'inventory', 'purchases', 'sales'],
  'Vegetable sellers': ['products', 'inventory', 'purchases', 'sales'],
  'Small retailers': ['products', 'inventory', 'sales', 'purchases'],
  'Mechanics': ['service_jobs', 'vehicle_customer', 'spare_parts', 'job_status'],
  'Collection': ['collection_records', 'due_amount', 'payment_collection'],
  'Travels Bus Booking Online': ['online_booking', 'vehicle', 'trips', 'fuel'],
  'Travels Online Booking': ['online_booking', 'vehicle', 'trips', 'fuel'],
  'Travels': ['online_booking', 'vehicle', 'trips', 'fuel'],
  'Other local businesses': ['ledger', 'dues'],
}

type SubscriptionCycleAmount = {
  cycle: string
  amount: number
  label: string
}

type SubscriptionOption = {
  plan: string
  amount: number
  amounts?: SubscriptionCycleAmount[]
}

type HealthState = {
  api: boolean
  database: boolean
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'

const emptyCustomerForm: CustomerFormData = {
  fullName: '',
  email: '',
  dob: '',
  businessType: '',
  status: 'active',
  subscriptionPlan: '',
  planAmount: '',
  enabledFeatures: [],
}

const navigation = [
  { label: 'Dashboard', icon: LayoutDashboard, section: 'Overview' },
  { label: 'Customer Management', icon: Users, section: 'Customers' },
  { label: 'Customer Activity', icon: Activity, section: 'Customers' },
  { label: 'Business Types', icon: Building2, section: 'Business' },
  { label: 'Subscription Plans', icon: CreditCard, section: 'Subscriptions' },
  { label: 'Business Reports', icon: TrendingUp, section: 'Reports & Logs' },
  { label: 'Audit Logs', icon: ShieldCheck, section: 'Reports & Logs' },
  { label: 'Notifications', icon: Bell, section: 'Settings' },
]

function mapPlan(plan?: string): Plan {
  if (plan === 'monthly') return 'Monthly'
  if (plan === 'quarterly') return 'Quarterly'
  if (plan === 'yearly') return 'Yearly'
  return 'None'
}

function mapStatus(status?: string): Status {
  if (status === 'active') return 'Active'
  if (status === 'suspended') return 'Suspended'
  return 'Inactive'
}

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

function App() {
  const [email, setEmail] = useState('admin@example.com')
  const [dob, setDob] = useState('1988-01-15')
  const [message, setMessage] = useState('')
  const [user, setUser] = useState<AdminUser | null>(null)
  const [summary, setSummary] = useState<DashboardSummary>({ totalUsers: 0, activeUsers: 0, inactiveUsers: 0 })
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [formData, setFormData] = useState<CustomerFormData>(emptyCustomerForm)
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null)
  const [activeNav, setActiveNav] = useState('Dashboard')
  const [search, setSearch] = useState('')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notificationsList, setNotificationsList] = useState<AdminNotification[]>([])
  const [unreadCount, setUnreadCount] = useState<number>(0)
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [health, setHealth] = useState<HealthState>({ api: true, database: true })
  const [businessTypes, setBusinessTypes] = useState<string[]>([])
  const [subscriptionOptions, setSubscriptionOptions] = useState<SubscriptionOption[]>([])

  async function loadFormOptions(adminEmail: string) {
    const headers = { 'X-User-Type': 'admin', 'X-User-Email': adminEmail }
    const [businessTypesResponse, subscriptionOptionsResponse] = await Promise.all([
      fetch(`${API_BASE}/api/admin/business-types`, { headers }),
      fetch(`${API_BASE}/api/admin/subscription-options`, { headers }),
    ])

    if (!businessTypesResponse.ok || !subscriptionOptionsResponse.ok) {
      throw new Error('Business types or subscription plans could not be loaded.')
    }

    const [businessTypesResult, subscriptionOptionsResult] = await Promise.all([
      businessTypesResponse.json(),
      subscriptionOptionsResponse.json(),
    ])
    const rawTypes = (businessTypesResult.businessTypes || []).map((bt: { name: string }) => bt.name.trim())
    setBusinessTypes(Array.from(new Set(rawTypes.filter(Boolean))))

    const rawOptions: SubscriptionOption[] = subscriptionOptionsResult.subscriptionOptions || []
    const uniqueOptionsMap = new Map<string, SubscriptionOption>()
    for (const opt of rawOptions) {
      const key = opt.plan.trim().toLowerCase()
      if (!uniqueOptionsMap.has(key)) {
        uniqueOptionsMap.set(key, opt)
      }
    }
    const uniqueOptions = Array.from(uniqueOptionsMap.values())
    setSubscriptionOptions(uniqueOptions)

    setFormData((current) => {
      if (current.planAmount) return current
      const selectedOption = uniqueOptions.find((option: SubscriptionOption) => option.plan.toLowerCase() === current.subscriptionPlan.toLowerCase())
      if (!selectedOption) return current
      const defaultAmount = selectedOption.amounts?.[0]?.amount ?? selectedOption.amount
      return { ...current, planAmount: String(defaultAmount) }
    })
  }

  async function loadAdminData(adminEmail: string) {
    setLoading(true)
    setMessage('')
    const headers = {
      'Content-Type': 'application/json',
      'X-User-Type': 'admin',
      'X-User-Email': adminEmail,
    }

    try {
      const [dashboardResponse, customerResponse, apiHealthResponse, dbHealthResponse, businessTypesResponse, subscriptionOptionsResponse] = await Promise.all([
        fetch(`${API_BASE}/api/admin/dashboard`, { headers }),
        fetch(`${API_BASE}/api/admin/drivers`, { headers }),
        fetch(`${API_BASE}/api/health`),
        fetch(`${API_BASE}/api/health/db`),
        fetch(`${API_BASE}/api/admin/business-types`, { headers }),
        fetch(`${API_BASE}/api/admin/subscription-options`, { headers }),
      ])

      setHealth({ api: apiHealthResponse.ok, database: dbHealthResponse.ok })

      if (!dashboardResponse.ok) {
        throw new Error('Dashboard data unavailable')
      }

      const dashboardResult = await dashboardResponse.json()
      setSummary({
        totalUsers: Number(dashboardResult.totalUsers || 0),
        activeUsers: Number(dashboardResult.activeUsers || 0),
        inactiveUsers: Number(dashboardResult.inactiveUsers || 0),
      })

      if (!customerResponse.ok) {
        throw new Error('Customer data unavailable')
      }

      const customerResult = await customerResponse.json()
      if (businessTypesResponse.ok) {
        const businessTypesResult = await businessTypesResponse.json()
        setBusinessTypes((businessTypesResult.businessTypes || []).map((businessType: { name: string }) => businessType.name))
      }
      if (subscriptionOptionsResponse.ok) {
        const subscriptionOptionsResult = await subscriptionOptionsResponse.json()
        setSubscriptionOptions(subscriptionOptionsResult.subscriptionOptions || [])
      }
      const nextCustomers = (customerResult.drivers || []).map((customer: any) => ({
        id: Number(customer.id),
        fullName: customer.fullName,
        email: customer.email,
        dob: customer.dob,
        status: mapStatus(customer.status),
        businessType: customer.businessType || 'Other local businesses',
        subscriptionPlan: mapPlan(customer.subscriptionPlan),
        planAmount: Number(customer.planAmount || 0),
      }))

      setCustomers(nextCustomers)
      fetchNotifications(adminEmail)
    } catch {
      setHealth((current) => ({ ...current, api: false }))
      setMessage('Could not load live data. Make sure the Flask API and PostgreSQL database are running.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const savedUser = localStorage.getItem('ssas_admin_user')
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser))
      } catch {
        localStorage.removeItem('ssas_admin_user')
      }
    }
  }, [])

  useEffect(() => {
    if (user?.userType === 'admin') {
      loadAdminData(user.email)
      loadFormOptions(user.email).catch(() => setMessage('Could not load business types and subscription plans.'))
      fetchNotifications(user.email)
    }
  }, [user])

  async function fetchNotifications(adminEmail: string) {
    try {
      const headers = {
        'Content-Type': 'application/json',
        'X-User-Type': 'admin',
        'X-User-Email': adminEmail,
      }
      const res = await fetch(`${API_BASE}/api/admin/notifications`, { headers })
      if (res.ok) {
        const json = await res.json()
        setNotificationsList(json.notifications || [])
        setUnreadCount(json.unreadCount || 0)
      }
    } catch {
      // Graceful fallback
    }
  }

  async function markAllNotificationsRead() {
    if (!user) return
    try {
      const headers = {
        'Content-Type': 'application/json',
        'X-User-Type': 'admin',
        'X-User-Email': user.email,
      }
      await fetch(`${API_BASE}/api/admin/notifications/mark-all-read`, {
        method: 'POST',
        headers,
      })
      fetchNotifications(user.email)
    } catch {
      // Graceful fallback
    }
  }

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')
    if (!email.trim() || !dob.trim()) {
      setMessage('Please enter both the admin email and DOB.')
      return
    }

    try {
      const response = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), dob: dob.trim() }),
      })
      const result = await response.json()
      if (!response.ok) {
        setMessage(result.message || 'Invalid email or date of birth.')
        return
      }
      if (result.user.userType !== 'admin') {
        setMessage('This account does not have administrator access.')
        return
      }
      const nextUser = {
        id: result.user.id,
        fullName: result.user.fullName,
        email: result.user.email,
        userType: result.user.userType,
        status: result.user.status || 'active',
      }
      setUser(nextUser)
      localStorage.setItem('ssas_admin_user', JSON.stringify(nextUser))
    } catch {
      setMessage('API connection failed. Please start the backend service first.')
    }
  }

  function handleFormChange(field: keyof CustomerFormData, value: string) {
    setFormData((current) => ({ ...current, [field]: value }))
  }

  function handlePlanChange(plan: string) {
    const option = subscriptionOptions.find((item) => item.plan.toLowerCase() === plan.toLowerCase())
    const defaultAmount = option?.amounts?.[0]?.amount ?? option?.amount ?? ''
    setFormData((current) => ({
      ...current,
      subscriptionPlan: plan,
      planAmount: defaultAmount !== '' ? String(defaultAmount) : '',
    }))
  }

  function handleBusinessTypeChange(newType: string) {
    const defaults = DEFAULT_BUSINESS_FEATURES[newType] || ['ledger', 'dues']
    setFormData((current) => ({
      ...current,
      businessType: newType,
      enabledFeatures: defaults,
    }))
  }

  function handleToggleFeature(featureKey: string) {
    setFormData((current) => {
      const currentFeatures = current.enabledFeatures || []
      const exists = currentFeatures.includes(featureKey)
      return {
        ...current,
        enabledFeatures: exists
          ? currentFeatures.filter((k) => k !== featureKey)
          : [...currentFeatures, featureKey],
      }
    })
  }

  function resetForm() {
    setSelectedCustomerId(null)
    setFormData(emptyCustomerForm)
    setShowCustomerModal(false)
  }

  function openCreateCustomer() {
    setSelectedCustomerId(null)
    setFormData(emptyCustomerForm)
    setShowCustomerModal(true)
    if (user) loadFormOptions(user.email).catch(() => setMessage('Could not load business types and subscription plans.'))
  }

  function handleEditCustomer(customer: CustomerRecord) {
    setSelectedCustomerId(customer.id)
    const initialFeatures =
      customer.enabledFeatures && customer.enabledFeatures.length > 0
        ? customer.enabledFeatures
        : (DEFAULT_BUSINESS_FEATURES[customer.businessType] || ['ledger', 'dues'])

    setFormData({
      fullName: customer.fullName,
      email: customer.email,
      dob: customer.dob,
      businessType: customer.businessType,
      status: customer.status === 'Active' ? 'active' : customer.status === 'Inactive' ? 'inactive' : 'suspended',
      subscriptionPlan:
        customer.subscriptionPlan === 'Monthly'
          ? 'monthly'
          : customer.subscriptionPlan === 'Quarterly'
            ? 'quarterly'
            : customer.subscriptionPlan === 'Yearly'
              ? 'yearly'
              : '',
      planAmount: String(customer.planAmount || 0),
      enabledFeatures: initialFeatures,
    })
    setShowCustomerModal(true)
    if (user) loadFormOptions(user.email).catch(() => setMessage('Could not load business types and subscription plans.'))
  }

  async function handleCustomerSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user || user.userType !== 'admin') return

    const isEditing = selectedCustomerId !== null
    const endpoint = isEditing ? `${API_BASE}/api/admin/drivers/${selectedCustomerId}` : `${API_BASE}/api/admin/drivers`
    try {
      const response = await fetch(endpoint, {
        method: isEditing ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Type': 'admin',
          'X-User-Email': user.email,
        },
        body: JSON.stringify(formData),
      })
      const result = await response.json()
      if (!response.ok) {
        setMessage(result.message || 'Unable to save customer data.')
        return
      }
      setMessage(isEditing ? 'Customer updated successfully.' : 'Customer created successfully.')
      resetForm()
      await loadAdminData(user.email)
    } catch {
      setMessage('Customer save failed. Please check the backend connection.')
    }
  }

  // async function handleToggleCustomerStatus(customer: CustomerRecord) {
  //   if (!user || user.userType !== 'admin') return
  //   const nextStatus = customer.status === 'Active' ? 'inactive' : 'active'
  //   try {
  //     const response = await fetch(`${API_BASE}/api/admin/drivers/${customer.id}`, {
  //       method: 'PUT',
  //       headers: {
  //         'Content-Type': 'application/json',
  //         'X-User-Type': 'admin',
  //         'X-User-Email': user.email,
  //       },
  //       body: JSON.stringify({ status: nextStatus }),
  //     })
  //     const result = await response.json()
  //     if (!response.ok) {
  //       setMessage(result.message || 'Unable to update customer status.')
  //       return
  //     }
  //     setMessage(`${customer.fullName} is now ${nextStatus === 'active' ? 'active' : 'inactive'}.`)
  //     await loadAdminData(user.email)
  //   } catch {
  //     setMessage('Status update failed. Please check the backend connection.')
  //   }
  // }

  function logout() {
    localStorage.removeItem('ssas_admin_user')
    setUser(null)
    setProfileOpen(false)
  }

  const filteredCustomers = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return customers
    return customers.filter((customer) =>
      [customer.fullName, customer.email, customer.status, customer.subscriptionPlan].some((value) => value.toLowerCase().includes(query)),
    )
  }, [customers, search])

  const planCounts = useMemo(() => {
    return {
      Monthly: customers.filter((customer) => customer.subscriptionPlan === 'Monthly').length,
      Quarterly: customers.filter((customer) => customer.subscriptionPlan === 'Quarterly').length,
      Yearly: customers.filter((customer) => customer.subscriptionPlan === 'Yearly').length,
      None: customers.filter((customer) => customer.subscriptionPlan === 'None').length,
    }
  }, [customers])

  const activePercent = summary.totalUsers ? Math.round((summary.activeUsers / summary.totalUsers) * 100) : 0
  const inactivePercent = summary.totalUsers ? Math.round((summary.inactiveUsers / summary.totalUsers) * 100) : 0
  const planTotal = customers.length || 1

  if (!user || user.userType !== 'admin') {
    return (
      <div className="auth-shell">
        <div className="auth-orb orb-one" />
        <div className="auth-orb orb-two" />
        <div className="auth-card">
          <div className="auth-brand">
            <div className="brand-mark large"><Sparkles size={22} /></div>
            <div><strong>SSAS</strong><span>ADMINISTRATION</span></div>
          </div>
          <div className="auth-copy">
            <span className="eyebrow">Secure workspace</span>
            <h1>Welcome to your admin portal.</h1>
            <p>Manage customers, subscriptions and platform operations from one focused workspace.</p>
          </div>
          <form onSubmit={handleLogin} className="auth-form">
            <label>Admin email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@example.com" /></label>
            <label>Date of birth<input type="date" value={dob} onChange={(event) => setDob(event.target.value)} /></label>
            <button type="submit" className="primary-button">Continue to dashboard <ChevronRight size={17} /></button>
            {message && <div className="form-alert"><AlertCircle size={16} />{message}</div>}
          </form>
          <div className="auth-footer"><ShieldCheck size={15} /> Admin access is protected by your Flask API</div>
        </div>
      </div>
    )
  }

  const selectedPlanOption = subscriptionOptions.find(
    (opt) => opt.plan.toLowerCase() === (formData.subscriptionPlan || '').toLowerCase()
  )
  const availablePlanAmounts =
    selectedPlanOption?.amounts && selectedPlanOption.amounts.length > 0
      ? selectedPlanOption.amounts
      : selectedPlanOption?.amount
        ? [{ cycle: 'monthly', amount: selectedPlanOption.amount, label: `$${selectedPlanOption.amount} (Monthly)` }]
        : []

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><Sparkles size={20} /></div>
          <div><strong>SSAS</strong><span>ADMINISTRATION</span></div>
        </div>

        <div className="sidebar-scroll">
          {['Overview', 'Customers', 'Business', 'Subscriptions', 'Reports & Logs', 'Settings'].map((section) => {
            const items = navigation.filter((item) => item.section === section)
            if (!items.length) return null
            return (
              <div className="nav-section" key={section}>
                <div className="nav-caption">{section}</div>
                {items.map((item) => {
                  const Icon = item.icon
                  const active = activeNav === item.label
                  return (
                    <button
                      key={item.label}
                      type="button"
                      className={`nav-item ${active ? 'active' : ''}`}
                      onClick={() => {
                        setActiveNav(item.label)
                        setMobileNavOpen(false)
                      }}
                    >
                      <Icon size={18} strokeWidth={1.9} />
                      <span>{item.label}</span>
                      {item.label === 'Notifications' && unreadCount > 0 && (
                        <span className="sidebar-nav-badge">{unreadCount}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>

        <div className="sidebar-upgrade">
          <div className="upgrade-icon"><Sparkles size={16} /></div>
          <strong>Make your workspace better</strong>
          <p>Keep customer operations organized from one place.</p>
          <button
            type="button"
            onClick={() => {
              setActiveNav('Subscription Plans')
              setMobileNavOpen(false)
            }}
          >
            Explore plans <ChevronRight size={15} />
          </button>
        </div>
        <button type="button" className="signout" onClick={logout}><LogOut size={18} /> Sign out</button>
      </aside>

      {mobileNavOpen && <button className="mobile-overlay" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}

      <main className="main-area">
        <header className="topbar">
          <button type="button" className="mobile-menu" onClick={() => setMobileNavOpen(true)}><Menu size={20} /></button>
          <button type="button" className="collapse-button" onClick={() => setMobileNavOpen((value) => !value)}><ChevronLeft size={18} /></button>
          <div className="global-search">
            <Search size={18} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customers, plans, reports..." />
            <kbd>⌘ K</kbd>
          </div>
          <div className="top-actions">
            <button type="button" className="top-icon" onClick={() => setMessage('Help center is ready to be connected.')}><CircleHelp size={18} /></button>
            <div className="notification-wrap">
              <button
                type="button"
                className="top-icon"
                onClick={() => setNotificationsOpen((value) => !value)}
                title="View Notifications"
              >
                <Bell size={18} />
                {unreadCount > 0 && (
                  <span className="notification-dot">{unreadCount}</span>
                )}
              </button>
              {notificationsOpen && (
                <div className="popover notification-popover">
                  <div className="notif-popover-header">
                    <strong>Notifications ({unreadCount})</strong>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        className="notif-popover-mark"
                        onClick={markAllNotificationsRead}
                      >
                        Mark all read
                      </button>
                    )}
                  </div>

                  {notificationsList.length === 0 ? (
                    <p style={{ color: '#64748b', fontSize: 12, margin: '8px 0' }}>
                      No active customer or application alerts.
                    </p>
                  ) : (
                    <div className="notif-popover-list">
                      {notificationsList.slice(0, 5).map((n) => (
                        <div
                          key={n.id}
                          className={`notif-popover-item ${!n.isRead ? 'unread' : ''}`}
                          onClick={() => {
                            setNotificationsOpen(false)
                            if (n.actionUrl) {
                              setActiveNav(n.actionUrl)
                            } else {
                              setActiveNav('Notifications')
                            }
                          }}
                        >
                          <div className="notif-popover-item-header">
                            <span className={`notif-popover-tag ${(n.category || 'System').toLowerCase()}`}>
                              {n.category || 'System'}
                            </span>
                            <span className="notif-popover-time">
                              {n.createdAt ? n.createdAt.split(' ')[0] : ''}
                            </span>
                          </div>
                          <div className="notif-popover-title">{n.title || 'Notification'}</div>
                          <div className="notif-popover-msg">{n.message || ''}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    className="notif-popover-all-btn"
                    onClick={() => {
                      setNotificationsOpen(false)
                      setActiveNav('Notifications')
                    }}
                  >
                    View All in Notification Center →
                  </button>
                </div>
              )}
            </div>
            <div className="profile-wrap">
              <button type="button" className="profile-button" onClick={() => setProfileOpen((value) => !value)}>
                <span className="avatar">{initials(user?.fullName || 'Admin')}</span>
                <span className="profile-text"><strong>{user?.fullName || 'Admin'}</strong><small>Administrator</small></span>
                <ChevronDown size={16} />
              </button>
              {profileOpen && <div className="popover profile-popover"><button type="button"><UserRound size={16} /> Profile</button><button type="button"><Settings size={16} /> Settings</button><button type="button" onClick={logout}><LogOut size={16} /> Sign out</button></div>}
            </div>
          </div>
        </header>

        <div className="content">
          {activeNav === 'Business Types' ? (
            <BusinessTypes user={user} onMessage={setMessage} />
          ) : activeNav === 'Subscription Plans' ? (
            <Subscription user={user} />
          ) : activeNav === 'Customer Activity' ? (
            <CustomerActivity />
          ) : activeNav === 'Business Reports' ? (
            <BusinessReports user={user} />
          ) : activeNav === 'Audit Logs' ? (
            <AuditLogs user={user} />
          ) : activeNav === 'Notifications' ? (
            <NotificationsCenter
              user={user}
              onNavigate={(page) => setActiveNav(page)}
              onNotificationsUpdated={() => fetchNotifications(user.email)}
            />
          ) : (
            <>
          <div className="page-heading">
            <div>
              <div className="breadcrumbs">Workspace <span>/</span> Dashboard</div>
              <h1>Welcome back, {(user?.fullName || 'Admin').split(' ')[0]}! <span>👋</span></h1>
              <p>Here's a clear overview of what's happening across your SaaS workspace.</p>
            </div>
            <button type="button" className="refresh-button" onClick={() => loadAdminData(user.email)} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'spin' : ''} /> {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          <div className="kpi-grid">
            <KpiCard icon={<Users size={20} />} label="Total customers" value={summary.totalUsers} hint="Live from PostgreSQL" tone="blue" />
            <KpiCard icon={<CheckCircle2 size={20} />} label="Active customers" value={summary.activeUsers} hint={`${activePercent}% of customers`} tone="green" />
            <KpiCard icon={<UserRound size={20} />} label="Inactive customers" value={summary.inactiveUsers} hint={`${inactivePercent}% of customers`} tone="orange" />
            <KpiCard icon={<CreditCard size={20} />} label="Subscription plans" value={customers.filter((customer) => customer.subscriptionPlan !== 'None').length} hint="Assigned to customers" tone="purple" />
          </div>

          <div className="dashboard-grid top-grid">
            <section className="panel customer-overview">
              <PanelHeading title="Customer overview" subtitle="Current customer status distribution" action={<button type="button" className="text-action" onClick={() => setActiveNav('Customer Management')}>View customers <ChevronRight size={15} /></button>} />
              <div className="overview-content">
                <div className="donut-wrap" style={{ '--active': `${activePercent}%`, '--inactive': `${inactivePercent}%` } as React.CSSProperties}>
                  <div className="donut-center"><strong>{summary.totalUsers}</strong><span>Total</span></div>
                </div>
                <div className="legend-list">
                  <LegendRow dot="blue" label="Active customers" value={summary.activeUsers} percent={`${activePercent}%`} />
                  <LegendRow dot="orange" label="Inactive customers" value={summary.inactiveUsers} percent={`${inactivePercent}%`} />
                  <LegendRow dot="gray" label="Suspended" value={customers.filter((customer) => customer.status === 'Suspended').length} percent="—" />
                </div>
              </div>
            </section>

            <section className="panel health-panel">
              <PanelHeading title="System health" subtitle="Live service status" action={<span className="live-badge">LIVE</span>} />
              <div className="health-list">
                <HealthRow icon={<Server size={17} />} title="Application server" subtitle="Flask API" healthy={health.api} />
                <HealthRow icon={<Database size={17} />} title="PostgreSQL" subtitle="Database connection" healthy={health.database} />
                <HealthRow icon={<ShieldCheck size={17} />} title="Admin access" subtitle="Authenticated session" healthy={true} />
              </div>
            </section>
          </div>

          <div className="dashboard-grid lower-grid">
            <section className="panel recent-panel">
              <PanelHeading
                title={activeNav === 'Customer Management' ? 'Customer management' : 'Recent customers'}
                subtitle={activeNav === 'Customer Management' ? 'Manage your registered customers and business feature access' : 'Latest records from your database'}
                action={activeNav !== 'Customer Management' ? (
                  <button type="button" className="text-action" onClick={() => setActiveNav('Customer Management')}>View all <ChevronRight size={15} /></button>
                ) : (
                  <button type="button" className="primary-button" style={{ padding: '6px 12px', fontSize: 11 }} onClick={openCreateCustomer}>+ Add customer</button>
                )}
              />
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Business Type</th>
                      <th>Plan</th>
                      <th>Status</th>
                      <th>Active Features</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(activeNav === 'Customer Management' ? filteredCustomers : filteredCustomers.slice(0, 6)).map((customer) => (
                      <tr key={customer.id}>
                        <td>
                          <div className="customer-cell">
                            <span className="table-avatar">{initials(customer.fullName)}</span>
                            <span>
                              <strong>{customer.fullName}</strong>
                              <small>{customer.email}</small>
                            </span>
                          </div>
                        </td>
                        <td>
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#334155' }}>
                            {customer.businessType}
                          </span>
                        </td>
                        <td><span className="plan-text">{customer.subscriptionPlan}</span></td>
                        <td><span className={`status ${customer.status.toLowerCase()}`}>{customer.status}</span></td>
                        <td>
                          <div className="feature-badge-list">
                            {(customer.enabledFeatures && customer.enabledFeatures.length > 0) ? (
                              customer.enabledFeatures.map((f) => (
                                <span key={f} className="feature-badge">{f}</span>
                              ))
                            ) : (
                              <small style={{ color: '#94a3b8' }}>None</small>
                            )}
                          </div>
                        </td>
                        <td>
                          <button type="button" className="row-menu" onClick={() => handleEditCustomer(customer)} title="Edit customer & features">
                            <MoreHorizontal size={18} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filteredCustomers.length && (
                  <div className="empty-state">
                    <Users size={24} />
                    <strong>No customers found</strong>
                    <span>{search ? 'Try another search.' : 'Create your first customer to populate the dashboard.'}</span>
                    <button type="button" onClick={openCreateCustomer}>Add customer</button>
                  </div>
                )}
              </div>
            </section>

            <section className="panel subscription-panel">
              <PanelHeading title="Subscription mix" subtitle="Plan assignment overview" action={<CreditCard size={17} className="muted-icon" />} />
              <div className="subscription-list">
                <ProgressRow label="Monthly" value={planCounts.Monthly} total={planTotal} tone="blue" />
                <ProgressRow label="Quarterly" value={planCounts.Quarterly} total={planTotal} tone="green" />
                <ProgressRow label="Yearly" value={planCounts.Yearly} total={planTotal} tone="purple" />
                <ProgressRow label="No plan" value={planCounts.None} total={planTotal} tone="gray" />
              </div>
              <div className="subscription-footer"><span>Assigned</span><strong>{customers.length - planCounts.None}</strong><span>of {customers.length} customers</span></div>
            </section>
          </div>

          <section className="panel activity-panel">
            <PanelHeading title="Customer activity" subtitle="A live snapshot based on your current database records" action={<span className="period-chip">Current snapshot <ChevronDown size={14} /></span>} />
            <div className="activity-content">
              <div className="activity-stat"><span>Active rate</span><strong>{activePercent}%</strong><small><TrendingUp size={14} /> Based on current customers</small></div>
              <div className="activity-bars">
                {[summary.totalUsers, summary.activeUsers, summary.inactiveUsers, customers.filter((customer) => customer.subscriptionPlan !== 'None').length].map((value, index) => {
                  const max = Math.max(summary.totalUsers, 1)
                  const labels = ['Total', 'Active', 'Inactive', 'Subscribed']
                  return <div className="bar-group" key={labels[index]}><div className="bar-track"><div className={`bar bar-${index}`} style={{ height: `${Math.max((value / max) * 100, value ? 10 : 2)}%` }} /></div><strong>{value}</strong><span>{labels[index]}</span></div>
                })}
              </div>
              <div className="activity-note"><Activity size={17} /><div><strong>Live data</strong><span>Charts are calculated from your PostgreSQL customer records—no demo numbers are shown.</span></div></div>
            </div>
          </section>

            </>
          )}
          {message && <div className="dashboard-message"><AlertCircle size={17} /><span>{message}</span><button type="button" onClick={() => setMessage('')}><X size={16} /></button></div>}
        </div>
      </main>

      {activeNav !== 'Business Types' && activeNav !== 'Subscription Plans' && <button type="button" className="floating-add" onClick={openCreateCustomer}>+ <span>Add customer</span></button>}

      {showCustomerModal && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && resetForm()}>
          <div className="customer-modal">
            <div className="modal-header"><div><span className="eyebrow">Customer workspace</span><h2>{selectedCustomerId ? 'Edit customer' : 'Create customer'}</h2><p>Keep account details and subscription status up to date.</p></div><button type="button" className="close-button" onClick={resetForm}><X size={19} /></button></div>
            <form onSubmit={handleCustomerSubmit} className="modal-form">
              <label>Full name<input required value={formData.fullName} onChange={(event) => handleFormChange('fullName', event.target.value)} placeholder="Customer name" /></label>
              <label>Email<input required type="email" value={formData.email} onChange={(event) => handleFormChange('email', event.target.value)} placeholder="customer@example.com" /></label>
              <label>Date of birth<input required type="date" value={formData.dob} onChange={(event) => handleFormChange('dob', event.target.value)} /></label>
              <div className="modal-two-col">
                <label>
                  Business Type
                  <select
                    required
                    value={formData.businessType}
                    onChange={(event) => handleBusinessTypeChange(event.target.value)}
                  >
                    <option value="">Select business type</option>
                    {businessTypes.map((businessType) => (
                      <option key={businessType} value={businessType}>
                        {businessType}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Status
                  <select
                    value={formData.status}
                    onChange={(event) => handleFormChange('status', event.target.value)}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </label>
              </div>
              <div className="modal-two-col">
                <label>
                  Plan
                  <select
                    required
                    value={formData.subscriptionPlan}
                    onChange={(event) => handlePlanChange(event.target.value)}
                  >
                    <option value="">Select plan</option>
                    {subscriptionOptions.map((option) => (
                      <option key={option.plan} value={option.plan}>
                        {option.plan.charAt(0).toUpperCase() + option.plan.slice(1)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Plan Amount
                  <select
                    required
                    value={formData.planAmount}
                    onChange={(event) => handleFormChange('planAmount', event.target.value)}
                    disabled={!formData.subscriptionPlan}
                  >
                    {!formData.subscriptionPlan ? (
                      <option value="">Select a plan first</option>
                    ) : availablePlanAmounts.length === 0 ? (
                      <option value="">No amounts available</option>
                    ) : (
                      availablePlanAmounts.map((amt) => (
                        <option key={`${amt.cycle}-${amt.amount}`} value={String(amt.amount)}>
                          {amt.label}
                        </option>
                      ))
                    )}
                  </select>
                </label>
              </div>

              {/* Business-Specific Feature Entitlements */}
              <div className="features-group-wrap">
                <div className="features-group-title">
                  <span>Business Features Access (Mobile App)</span>
                  <span className="features-active-count">
                    {formData.enabledFeatures.length} enabled
                  </span>
                </div>
                <p className="features-group-hint">
                  Selected features will be displayed on the customer's mobile app. Unselected features are completely hidden.
                </p>

                {formData.businessType && (
                  <div className="features-defaults-bar">
                    <span>
                      Defaults for <strong>{formData.businessType}</strong>
                    </span>
                    <button
                      type="button"
                      className="features-reset-btn"
                      onClick={() =>
                        setFormData((cur) => ({
                          ...cur,
                          enabledFeatures: DEFAULT_BUSINESS_FEATURES[cur.businessType] || ['ledger', 'dues'],
                        }))
                      }
                    >
                      Reset to Type Defaults
                    </button>
                  </div>
                )}

                <div className="features-grid">
                  {SYSTEM_FEATURES.map((feature) => {
                    const isChecked = formData.enabledFeatures.includes(feature.key)
                    const isDefault =
                      formData.businessType &&
                      (DEFAULT_BUSINESS_FEATURES[formData.businessType] || []).includes(feature.key)

                    return (
                      <div
                        key={feature.key}
                        className={`feature-checkbox-card ${isChecked ? 'selected' : ''}`}
                        onClick={() => handleToggleFeature(feature.key)}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}}
                          className="feature-checkbox-input"
                        />
                        <div className="feature-checkbox-content">
                          <div className="feature-checkbox-header">
                            <strong>{feature.label}</strong>
                            {isDefault && <span className="feature-default-pill">Default</span>}
                          </div>
                          <small>{feature.description}</small>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="modal-actions"><button type="button" className="secondary-button" onClick={resetForm}>Cancel</button><button type="submit" className="primary-button">{selectedCustomerId ? 'Save changes' : 'Create customer'} <ChevronRight size={16} /></button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function KpiCard({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: number; hint: string; tone: string }) {
  return <div className={`kpi-card ${tone}`}><div className="kpi-icon">{icon}</div><div className="kpi-copy"><span>{label}</span><strong>{value.toLocaleString()}</strong><small>{hint}</small></div><MoreHorizontal size={18} className="kpi-more" /></div>
}

function PanelHeading({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return <div className="panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div>{action}</div>
}

function LegendRow({ dot, label, value, percent }: { dot: string; label: string; value: number; percent: string }) {
  return <div className="legend-row"><span className={`legend-dot ${dot}`} /><span>{label}</span><strong>{value}</strong><small>{percent}</small></div>
}

function HealthRow({ icon, title, subtitle, healthy }: { icon: React.ReactNode; title: string; subtitle: string; healthy: boolean }) {
  return <div className="health-row"><div className="health-icon">{icon}</div><div><strong>{title}</strong><span>{subtitle}</span></div><span className={`health-status ${healthy ? 'healthy' : 'down'}`}>{healthy ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}{healthy ? 'Healthy' : 'Offline'}</span></div>
}

function ProgressRow({ label, value, total, tone }: { label: string; value: number; total: number; tone: string }) {
  const percent = Math.round((value / total) * 100)
  return <div className="progress-row"><div><span>{label}</span><strong>{value}</strong></div><div className="progress-track"><div className={`progress-fill ${tone}`} style={{ width: `${percent}%` }} /></div><small>{percent}%</small></div>
}

export default App
