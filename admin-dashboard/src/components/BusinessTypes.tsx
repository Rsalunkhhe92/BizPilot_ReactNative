import { useEffect, useState } from 'react'
import { Building2, MoreVertical, Pencil, Plus, Trash2, X } from 'lucide-react'

type AdminUser = {
  email: string
}

type BusinessType = {
  id: number
  name: string
  description: string
  createdAt: string
}

type BusinessTypesProps = {
  user: AdminUser
  onMessage: (message: string) => void
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'

function BusinessTypes({ user, onMessage }: BusinessTypesProps) {
  const [businessTypes, setBusinessTypes] = useState<BusinessType[]>([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [loading, setLoading] = useState(true)

  const headers = {
    'Content-Type': 'application/json',
    'X-User-Type': 'admin',
    'X-User-Email': user.email,
  }

  async function loadBusinessTypes() {
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/admin/business-types`, { headers })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Unable to load business types.')
      setBusinessTypes(result.businessTypes)
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Unable to load business types.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadBusinessTypes()
  }, [])

  function resetForm() {
    setName('')
    setDescription('')
    setEditingId(null)
    setFormOpen(false)
  }

  function startEditing(businessType: BusinessType) {
    setEditingId(businessType.id)
    setName(businessType.name)
    setDescription(businessType.description)
    setFormOpen(true)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const editing = editingId !== null
    try {
      const response = await fetch(`${API_BASE}/api/admin/business-types${editing ? `/${editingId}` : ''}`, {
        method: editing ? 'PUT' : 'POST',
        headers,
        body: JSON.stringify({ name, description }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Unable to save business type.')
      onMessage(editing ? 'Business type updated successfully.' : 'Business type added successfully.')
      resetForm()
      await loadBusinessTypes()
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Unable to save business type.')
    }
  }

  async function handleDelete(businessType: BusinessType) {
    if (!window.confirm(`Delete ${businessType.name}?`)) return
    try {
      const response = await fetch(`${API_BASE}/api/admin/business-types/${businessType.id}`, { method: 'DELETE', headers })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Unable to delete business type.')
      onMessage('Business type deleted successfully.')
      await loadBusinessTypes()
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Unable to delete business type.')
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="breadcrumbs">Workspace <span>/</span> Business Types</div>
          <h1>Business types</h1>
          <p>Manage the local businesses supported by your workspace.</p>
        </div>
        <button type="button" className="primary-button" onClick={() => { resetForm(); setFormOpen(true) }}><Plus size={16} /> Add business type</button>
      </div>

      <section className="business-types-panel">
        <div className="business-types-toolbar"><div><h2>Business Types</h2><p>Manage all your business types</p></div><span>{businessTypes.length} types</span></div>
        {loading ? <div className="empty-state">Loading business types...</div> : businessTypes.length === 0 ? <div className="empty-state"><Building2 size={24} /><strong>No business types yet</strong><span>Add a business type to get started.</span></div> : (
          <div className="business-types-scroll">
            <div className="business-types-grid">
              {businessTypes.map((businessType) => <article className="business-type-card" key={businessType.id}>
                <div className="business-type-card-top"><div className="business-type-identity"><span className="business-type-icon"><Building2 size={17} /></span><span><strong>{businessType.name}</strong><small>Business type</small></span></div><div className="business-type-actions"><button type="button" className="row-menu" aria-label={`Business type actions for ${businessType.name}`}><MoreVertical size={16} /></button><div className="business-type-action-menu"><button type="button" aria-label={`Edit ${businessType.name}`} onClick={() => startEditing(businessType)}><Pencil size={14} /></button><button type="button" aria-label={`Delete ${businessType.name}`} onClick={() => handleDelete(businessType)}><Trash2 size={14} /></button></div></div></div>
                <div className="business-type-detail"><Building2 size={12} /> {businessType.description || 'Local business account'}</div>
                <div className="business-type-activity"><strong>Activity overview</strong><div className="business-type-bars">{[35, 52, 42, 70, 48, 64, 78, 57].map((height, index) => <span key={index} style={{ height: `${height}%` }} />)}</div></div>
                <small>Added {businessType.createdAt}</small>
              </article>)}
            </div>
          </div>
        )}
      </section>

      {formOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && resetForm()}>
        <div className="customer-modal">
          <div className="modal-header"><div><span className="eyebrow">Business directory</span><h2>{editingId ? 'Edit business type' : 'Add business type'}</h2><p>Keep your supported local businesses organized.</p></div><button type="button" className="close-button" onClick={resetForm}><X size={19} /></button></div>
          <form onSubmit={handleSubmit} className="modal-form">
            <label>Name<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Auto-rickshaw drivers" /></label>
            <label>Description <span className="optional-label">(optional)</span><textarea maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Brief description" /></label>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={resetForm}>Cancel</button><button type="submit" className="primary-button">{editingId ? 'Save changes' : 'Add business type'}</button></div>
          </form>
        </div>
      </div>}
    </>
  )
}

export default BusinessTypes