import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'

const categoryImages = {
  '1 FISH': 'photo-1510130387422-82bed34b37e9',
  '2 SEAFOOD': 'photo-1559737558-2f5a35f4523b',
  '3 POULTRY': 'photo-1604503468506-a8da13d82791',
  '4 PORK': 'photo-1602470520998-f4a52199a3d6',
  '5 BEEF': 'photo-1607623814075-e51df1bdc82f',
  '6 LAMB': 'photo-1607623814075-e51df1bdc82f',
}

const initialCompanyDetails = {
  name: "Butcher's Block",
  address: '',
  phone: '',
  email: '',
  taxId: '',
  taxName: 'GST',
  taxRate: '10',
  taxInclusive: 'true',
  website: '',
  receiptMessage: 'Thank you for your purchase!',
  logoDataUrl: '',
}
const categoryName = (category) => category.replace(/^\d+\s+/, '')
const categoryClassName = (category) => {
  const name = categoryName(category).toLowerCase().replace(/\s+/g, '-')
  return ['fish', 'seafood', 'poultry', 'pork', 'beef', 'lamb'].includes(name) ? name : 'custom'
}

const emptyNewCustomer = { type: 'person', name: '', companyName: '', contactName: '', taxId: '', phone: '', email: '' }

const actions = [
  { label: 'Expenses', color: 'red' }, { label: 'Discount', color: 'green' },
  { label: 'Void Item', color: 'blue' }, { label: 'Void All Items', color: 'blue' },
  { label: 'Redeem Points', color: 'green' }, { label: 'Day End', color: 'red' },
  { label: 'Search Stock Item', color: 'gray' }, { label: 'Customer', color: 'gray' },
  { label: 'Sales Refund', color: 'gray' }, { label: 'Recall Order', color: 'yellow' },
  { label: 'Hold Order', color: 'yellow' }, { label: 'Change Operator', color: 'yellow' },
  { label: 'Advanced', color: 'green' }, { label: 'Quotation', color: 'blue' },
]

const currency = (amount) => `$${amount.toFixed(2)}`
const ADVANCED_PIN = '1234'
const emptyShopState = {
  products: [],
  categories: [],
  customers: [],
  paymentMethods: [],
  closedDaySaleIds: [],
  closedDayRefundIds: [],
  expenses: [],
  closedDayExpenseIds: [],
  dayEndReports: [],
  sales: [],
  heldOrders: [],
  companyDetails: initialCompanyDetails,
  stock: {},
  inventoryMovements: [],
  stockReceipts: [],
  processingHistory: [],
  stocktakeHistory: [],
}

function normalizeShopState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Supabase returned invalid shop data.')
  }
  const normalized = { ...emptyShopState }
  for (const key of Object.keys(emptyShopState)) {
    const saved = value[key]
    if (key === 'companyDetails') {
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        normalized.companyDetails = Object.fromEntries(Object.keys(initialCompanyDetails).map((field) => [
          field,
          typeof saved[field] === 'string' ? saved[field] : initialCompanyDetails[field],
        ]))
      }
    } else if (key === 'stock') {
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) normalized.stock = saved
    } else if (Array.isArray(saved)) {
      normalized[key] = saved
    }
  }
  normalized.stock = Object.fromEntries(normalized.products.map((product) => {
    const quantity = Number(normalized.stock[product.id])
    return [product.id, Number.isFinite(quantity) && quantity >= 0 ? quantity : 0]
  }))
  return normalized
}
const localDateKey = (timestamp) => {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function Pagination({ page, pageCount, totalItems, pageSize, label, onPageChange }) {
  if (totalItems <= pageSize) return null
  const firstItem = page * pageSize + 1
  const lastItem = Math.min(totalItems, (page + 1) * pageSize)
  return (
    <nav aria-label={`${label} pagination`} className="flex flex-wrap items-center justify-between gap-2 border-t border-[#ddd] bg-white px-3 py-2 text-sm">
      <span className="text-xs text-[#666]">Showing {firstItem}–{lastItem} of {totalItems}</span>
      <div className="flex items-center gap-2">
        <button aria-label={`Previous ${label} page`} className="touch-button gray min-h-9 px-3 font-semibold disabled:cursor-not-allowed disabled:opacity-45" disabled={page === 0} onClick={() => onPageChange(page - 1)} type="button">Previous</button>
        <span aria-live="polite" className="min-w-20 text-center text-xs font-semibold">Page {page + 1} of {pageCount}</span>
        <button aria-label={`Next ${label} page`} className="touch-button gray min-h-9 px-3 font-semibold disabled:cursor-not-allowed disabled:opacity-45" disabled={page >= pageCount - 1} onClick={() => onPageChange(page + 1)} type="button">Next</button>
      </div>
    </nav>
  )
}

function App() {
  const [currentDateTime, setCurrentDateTime] = useState(() => new Date())
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const [authUser, setAuthUser] = useState(null)
  const [staffRole, setStaffRole] = useState(null)
  const [shopReady, setShopReady] = useState(false)
  const [syncStatus, setSyncStatus] = useState('loading')
  const [syncError, setSyncError] = useState('')
  const [realtimeError, setRealtimeError] = useState('')
  const [saveVersion, setSaveVersion] = useState(0)
  const revisionRef = useRef(0)
  const lastSavedSnapshotRef = useRef('')
  const currentSnapshotRef = useRef('')
  const saveInFlightRef = useRef(false)
  const saveQueuedRef = useRef(false)
  const [currentUsername, setCurrentUsername] = useState('')
  const [companyDetails, setCompanyDetails] = useState(initialCompanyDetails)
  const [companyDraft, setCompanyDraft] = useState(initialCompanyDetails)
  const [companyError, setCompanyError] = useState('')
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [staffAccounts, setStaffAccounts] = useState([])
  const [staffLoading, setStaffLoading] = useState(false)
  const [staffCreating, setStaffCreating] = useState(false)
  const [staffEmail, setStaffEmail] = useState('')
  const [staffPassword, setStaffPassword] = useState('')
  const [staffError, setStaffError] = useState('')
  const [staffNotice, setStaffNotice] = useState('')
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [cart, setCart] = useState([])
  const [category, setCategory] = useState('')
  const [notice, setNotice] = useState('')
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [tenderEntryFresh, setTenderEntryFresh] = useState(true)
  const [heldOrders, setHeldOrders] = useState([])
  const [recallOpen, setRecallOpen] = useState(false)
  const [sales, setSales] = useState([])
  const [paymentMethods, setPaymentMethods] = useState([])
  const [newPaymentMethod, setNewPaymentMethod] = useState('')
  const [paymentMethodError, setPaymentMethodError] = useState('')
  const [editingPaymentMethod, setEditingPaymentMethod] = useState(null)
  const [paymentMethodDraft, setPaymentMethodDraft] = useState('')
  const [closedDaySaleIds, setClosedDaySaleIds] = useState([])
  const [closedDayRefundIds, setClosedDayRefundIds] = useState([])
  const [expenses, setExpenses] = useState([])
  const [closedDayExpenseIds, setClosedDayExpenseIds] = useState([])
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [expenseDraft, setExpenseDraft] = useState({ category: 'Food', description: '', amount: '', method: 'CASH' })
  const [expenseError, setExpenseError] = useState('')
  const [dayEndReports, setDayEndReports] = useState([])
  const [dayEndOpen, setDayEndOpen] = useState(false)
  const [dayEndCashCount, setDayEndCashCount] = useState('')
  const [dayEndCashError, setDayEndCashError] = useState('')
  const [completedSale, setCompletedSale] = useState(null)
  const [quotationPreview, setQuotationPreview] = useState(null)
  const [reportStartDate, setReportStartDate] = useState('')
  const [reportEndDate, setReportEndDate] = useState('')
  const [paidAmount, setPaidAmount] = useState(0)
  const [paymentEntries, setPaymentEntries] = useState([])
  const [paymentError, setPaymentError] = useState('')
  const [refundOpen, setRefundOpen] = useState(false)
  const [selectedRefundSaleId, setSelectedRefundSaleId] = useState(null)
  const [refundQuantities, setRefundQuantities] = useState({})
  const [refundReason, setRefundReason] = useState('Customer return')
  const [refundMethod, setRefundMethod] = useState('CASH')
  const [customerOpen, setCustomerOpen] = useState(false)
  const [customerCreateOpen, setCustomerCreateOpen] = useState(false)
  const [customers, setCustomers] = useState([])
  const [selectedCustomerId, setSelectedCustomerId] = useState(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [newCustomer, setNewCustomer] = useState(emptyNewCustomer)
  const [discountOpen, setDiscountOpen] = useState(false)
  const [discount, setDiscount] = useState({ type: 'percent', value: 0 })
  const [discountDraft, setDiscountDraft] = useState({ type: 'percent', value: '10' })
  const [redeemedPoints, setRedeemedPoints] = useState(0)
  const [redeemCustomerId, setRedeemCustomerId] = useState(null)
  const [redeemOpen, setRedeemOpen] = useState(false)
  const [redeemDraft, setRedeemDraft] = useState('')
  const [redeemError, setRedeemError] = useState('')
  const [cashTendered, setCashTendered] = useState('0.00')
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [listPages, setListPages] = useState({})
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [advancedPinOpen, setAdvancedPinOpen] = useState(false)
  const [advancedPin, setAdvancedPin] = useState('')
  const [advancedPinError, setAdvancedPinError] = useState('')
  const [advancedView, setAdvancedView] = useState('Overview')
  const [activityFilter, setActivityFilter] = useState('All activity')
  const [customerAdminSearch, setCustomerAdminSearch] = useState('')
  const [customerAdminType, setCustomerAdminType] = useState('All customers')
  const [customerAdminDraft, setCustomerAdminDraft] = useState(null)
  const [customerAdminError, setCustomerAdminError] = useState('')
  const [customerAdminNotice, setCustomerAdminNotice] = useState('')
  const [stock, setStock] = useState({})
  const [inventoryMovements, setInventoryMovements] = useState([])
  const [newProduct, setNewProduct] = useState({ name: '', category: '', price: '', initialStock: '', imageDataUrl: '' })
  const [productFormError, setProductFormError] = useState('')
  const [productToDelete, setProductToDelete] = useState(null)
  const [editingProductId, setEditingProductId] = useState(null)
  const [productEditDraft, setProductEditDraft] = useState(null)
  const [productEditError, setProductEditError] = useState('')
  const [newCategoryName, setNewCategoryName] = useState('')
  const [categoryFormError, setCategoryFormError] = useState('')
  const [categoryToDelete, setCategoryToDelete] = useState(null)
  const [editingCategory, setEditingCategory] = useState(null)
  const [categoryEditName, setCategoryEditName] = useState('')
  const [categoryEditError, setCategoryEditError] = useState('')
  const [stockReceipts, setStockReceipts] = useState([])
  const [processingInputs, setProcessingInputs] = useState([{ productId: 0, quantity: '' }])
  const [processingOutputs, setProcessingOutputs] = useState([{ productId: 0, quantity: '' }])
  const [processingError, setProcessingError] = useState('')
  const [processingHistory, setProcessingHistory] = useState([])
  const [stocktake, setStocktake] = useState({ productId: 0, quantity: '' })
  const [stocktakeHistory, setStocktakeHistory] = useState([])
  const [adjustWaste, setAdjustWaste] = useState({ productId: 0, type: 'increase', quantity: '', reason: '' })
  const [adjustWasteError, setAdjustWasteError] = useState('')
  const [receipt, setReceipt] = useState({
    productId: 0,
    quantity: '',
    unitCost: '',
    supplier: '',
    reference: '',
  })

  const shopSnapshot = useMemo(() => ({
    products,
    categories,
    customers,
    paymentMethods,
    closedDaySaleIds,
    closedDayRefundIds,
    expenses,
    closedDayExpenseIds,
    dayEndReports,
    sales,
    heldOrders,
    companyDetails,
    stock,
    inventoryMovements,
    stockReceipts,
    processingHistory,
    stocktakeHistory,
  }), [
    products, categories, customers, paymentMethods, closedDaySaleIds,
    closedDayRefundIds, expenses, closedDayExpenseIds, dayEndReports, sales,
    heldOrders, companyDetails, stock, inventoryMovements, stockReceipts,
    processingHistory, stocktakeHistory,
  ])
  const serializedShopSnapshot = useMemo(() => JSON.stringify(shopSnapshot), [shopSnapshot])
  currentSnapshotRef.current = serializedShopSnapshot

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentDateTime(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  function applyShopState(value, revision) {
    const data = normalizeShopState(value)
    setProducts(data.products)
    setCategories(data.categories)
    setCategory((current) => data.categories.includes(current) ? current : data.categories[0] ?? '')
    setNewProduct((current) => ({ ...current, category: data.categories.includes(current.category) ? current.category : data.categories[0] ?? '' }))
    setCustomers(data.customers)
    setPaymentMethods(data.paymentMethods)
    setClosedDaySaleIds(data.closedDaySaleIds)
    setClosedDayRefundIds(data.closedDayRefundIds)
    setExpenses(data.expenses)
    setClosedDayExpenseIds(data.closedDayExpenseIds)
    setDayEndReports(data.dayEndReports)
    setSales(data.sales)
    setHeldOrders(data.heldOrders)
    setCompanyDetails(data.companyDetails)
    setCompanyDraft(data.companyDetails)
    setStock(data.stock)
    setInventoryMovements(data.inventoryMovements)
    setStockReceipts(data.stockReceipts)
    setProcessingHistory(data.processingHistory)
    setStocktakeHistory(data.stocktakeHistory)
    const firstProductId = data.products[0]?.id ?? 0
    setStocktake((current) => ({ ...current, productId: data.products.some((product) => product.id === current.productId) ? current.productId : firstProductId }))
    setAdjustWaste((current) => ({ ...current, productId: data.products.some((product) => product.id === current.productId) ? current.productId : firstProductId }))
    setProcessingInputs((current) => current.map((line) => ({ ...line, productId: data.products.some((product) => product.id === line.productId) ? line.productId : firstProductId })))
    setProcessingOutputs((current) => current.map((line) => ({ ...line, productId: data.products.some((product) => product.id === line.productId) ? line.productId : firstProductId })))
    setReceipt((current) => {
      const product = data.products.find((item) => item.id === current.productId) ?? data.products[0]
      return { ...current, productId: product?.id ?? 0, unitCost: product?.price.toFixed(2) ?? '' }
    })
    const nextRevision = Number(revision) || 0
    revisionRef.current = nextRevision
    lastSavedSnapshotRef.current = nextRevision > 0 ? JSON.stringify(data) : ''
    setSyncError('')
    setRealtimeError('')
    setSyncStatus('saved')
    setShopReady(true)
  }

  async function loadShopState(userId) {
    if (!supabase) throw new Error('Supabase is not configured. Check the VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY settings.')
    if (!userId) throw new Error('No signed-in Supabase user is available.')
    setShopReady(false)
    setSyncStatus('loading')
    const { data: membership, error: membershipError } = await supabase
      .from('butcher_shop_members')
      .select('user_id, role')
      .eq('user_id', userId)
      .maybeSingle()
    if (membershipError) throw membershipError
    if (!membership) throw new Error('This account is not authorized for this shop. Ask the administrator to add it to butcher_shop_members in Supabase.')
    setStaffRole(membership.role)
    const { data, error } = await supabase.rpc('load_butcher_shop_state')
    if (error) throw error
    applyShopState(data?.data ?? emptyShopState, data?.revision ?? 0)
  }

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true)
      setSyncStatus('error')
      setSyncError('Supabase configuration is missing. Add the project URL and publishable key to .env.local, then restart Vite.')
      return undefined
    }

    let active = true
    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT' || !active) return
      setAuthUser(null)
      setStaffRole(null)
      setIsAuthenticated(false)
      setCurrentUsername('')
      setShopReady(false)
      setSyncStatus('idle')
      setCart([])
    })

    async function restoreSession() {
      const { data, error } = await supabase.auth.getSession()
      if (!active) return
      setAuthReady(true)
      if (error) {
        setLoginError(`Unable to restore your Supabase session: ${error.message}`)
        return
      }
      if (!data.session?.user) {
        setSyncStatus('idle')
        return
      }
      const user = data.session.user
      setAuthUser(user)
      setIsAuthenticated(true)
      setCurrentUsername(user.email ?? user.id)
      try {
        await loadShopState(user.id)
      } catch (loadError) {
        if (!active) return
        setSyncError(`Unable to load shop data from Supabase: ${loadError.message}`)
        setSyncStatus('error')
      }
    }

    restoreSession()
    return () => {
      active = false
      authListener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!supabase || !isAuthenticated || !shopReady || syncStatus === 'conflict' || syncStatus === 'error') return undefined
    const serializedSnapshot = serializedShopSnapshot
    if (serializedSnapshot === lastSavedSnapshotRef.current) return undefined

    const timer = window.setTimeout(async () => {
      if (saveInFlightRef.current) {
        saveQueuedRef.current = true
        return
      }
      saveInFlightRef.current = true
      setSyncStatus('saving')
      setSyncError('')
      let saved = false
      try {
        const { data, error } = await supabase.rpc('save_butcher_shop_state', {
          p_data: shopSnapshot,
          p_expected_revision: revisionRef.current,
        })
        if (error) {
          if (error.code === '40001') {
            setSyncStatus('conflict')
            setSyncError('Shop data changed in another signed-in session. Reload the latest data before continuing.')
          } else {
            setSyncStatus('error')
            setSyncError(`Unable to save shop data to Supabase: ${error.message}`)
          }
          return
        }
        const nextRevision = Number(data)
        if (!Number.isSafeInteger(nextRevision) || nextRevision <= revisionRef.current) {
          setSyncStatus('error')
          setSyncError('Supabase returned an invalid shop data revision. Please reload before continuing.')
          return
        }
        revisionRef.current = nextRevision
        lastSavedSnapshotRef.current = serializedSnapshot
        setSyncStatus('saved')
        saved = true
      } catch (error) {
        setSyncStatus('error')
        setSyncError(`Unable to save shop data to Supabase: ${error.message}`)
      } finally {
        saveInFlightRef.current = false
        if (saveQueuedRef.current) {
          saveQueuedRef.current = false
          if (saved) setSaveVersion((version) => version + 1)
        }
      }
    }, 650)

    return () => window.clearTimeout(timer)
  }, [isAuthenticated, shopReady, shopSnapshot, serializedShopSnapshot, saveVersion, syncStatus])

  useEffect(() => {
    if (!supabase || !isAuthenticated || !authUser || !shopReady) return undefined
    const channel = supabase
      .channel('butcher-shop-state')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'butcher_shop_state',
        filter: 'id=eq.main',
      }, async (payload) => {
        const revision = Number(payload.new.revision) || 0
        if (revision <= revisionRef.current) return
        if (saveInFlightRef.current && revision === revisionRef.current + 1) return
        if (currentSnapshotRef.current === lastSavedSnapshotRef.current && !saveInFlightRef.current) {
          try {
            await loadShopState(authUser.id)
          } catch (error) {
            setSyncStatus('error')
            setSyncError(`Unable to refresh shop data from Supabase: ${error.message}`)
          }
          return
        }
        setSyncStatus('conflict')
        setSyncError('Another signed-in session changed shop data while you had unsaved changes. Reload the latest data before continuing.')
      })
      .subscribe((status, error) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setRealtimeError(`Live updates are unavailable: ${error?.message ?? status}. Shop data will still save; reload to fetch the latest changes.`)
        }
      })
    return () => {
      supabase.removeChannel(channel)
    }
  }, [isAuthenticated, authUser, shopReady])

  async function retryShopSync() {
    if (syncStatus === 'conflict' || !shopReady) {
      if (syncStatus === 'conflict' && !window.confirm('Reload the latest shop data and discard this device’s unsaved changes?')) return
      try {
        await loadShopState(authUser?.id)
      } catch (error) {
        setSyncStatus('error')
        setSyncError(`Unable to reload shop data from Supabase: ${error.message}`)
      }
      return
    }
    setSyncError('')
    setSyncStatus('idle')
    setSaveVersion((version) => version + 1)
  }

  async function getStaffFunctionError(error) {
    if (error.context instanceof Response) {
      if (error.context.status === 404) {
        return new Error('The manage-staff Edge Function is not deployed. Deploy it to your Supabase project, then refresh this list.')
      }
      const responseText = await error.context.clone().text()
      try {
        const details = JSON.parse(responseText)
        if (typeof details?.error === 'string') return new Error(details.error)
      } catch {
        if (responseText) return new Error(responseText)
      }
      return new Error(`The Edge Function returned HTTP ${error.context.status}.`)
    }
    if (error.name === 'FunctionsFetchError') {
      return new Error('Could not reach the manage-staff Edge Function. Confirm it is deployed to this Supabase project and check your network connection.')
    }
    return new Error(error.message)
  }

  async function refreshStaffAccounts() {
    if (!supabase || staffRole !== 'admin') return
    setStaffLoading(true)
    setStaffError('')
    try {
      const { data, error } = await supabase.functions.invoke('manage-staff', { body: { action: 'list' } })
      if (error) throw await getStaffFunctionError(error)
      if (!Array.isArray(data?.staff)) throw new Error('Supabase returned an invalid staff list.')
      setStaffAccounts(data.staff)
    } catch (error) {
      setStaffError(`Unable to load staff accounts: ${error.message}`)
    } finally {
      setStaffLoading(false)
    }
  }

  async function createStaffAccount(event) {
    event.preventDefault()
    if (!supabase || staffRole !== 'admin' || staffCreating) return
    setStaffCreating(true)
    setStaffError('')
    setStaffNotice('')
    try {
      const { data, error } = await supabase.functions.invoke('manage-staff', {
        body: { action: 'create', email: staffEmail.trim(), password: staffPassword },
      })
      if (error) throw await getStaffFunctionError(error)
      if (!data?.staff?.userId) throw new Error('Supabase did not confirm the new staff account.')
      setStaffEmail('')
      setStaffPassword('')
      setStaffNotice(`Staff account created for ${data.staff.email}.`)
      await refreshStaffAccounts()
    } catch (error) {
      setStaffError(`Unable to create staff account: ${error.message}`)
    } finally {
      setStaffCreating(false)
    }
  }

  const subtotal = useMemo(
    () => cart.reduce((total, item) => total + item.weight * item.price, 0),
    [cart],
  )
  const discountAmount = Math.min(
    subtotal,
    Math.round((discount.type === 'percent' ? subtotal * discount.value / 100 : discount.value) * 100) / 100,
  )
  const taxRate = Number(companyDetails.taxRate) || 0
  const taxInclusive = companyDetails.taxInclusive === 'true'
  const discountedSubtotal = Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100)
  const taxAmount = Math.round((taxInclusive
    ? discountedSubtotal * taxRate / (100 + taxRate)
    : discountedSubtotal * taxRate / 100) * 100) / 100
  const redeemableTotal = discountedSubtotal + (taxInclusive ? 0 : taxAmount)
  const redeemAmount = Math.min(
    Math.max(0, redeemableTotal),
    redeemedPoints / 100,
  )
  const totalDue = Math.max(0, Math.round((discountedSubtotal + (taxInclusive ? 0 : taxAmount) - redeemAmount) * 100) / 100)
  const paymentBalance = Math.max(0, Math.round((totalDue - paidAmount) * 100) / 100)
  const itemCount = cart.length
  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) ?? null
  const selectedStocktakeProduct = products.find((product) => product.id === Number(stocktake.productId)) ?? null
  const stocktakeSystemQuantity = selectedStocktakeProduct ? stock[selectedStocktakeProduct.id] ?? 0 : 0
  const stocktakeCountedQuantity = stocktake.quantity === '' ? null : Number(stocktake.quantity)
  const stocktakeVariance = stocktakeCountedQuantity === null
    ? null
    : Number((stocktakeCountedQuantity - stocktakeSystemQuantity).toFixed(3))
  const selectedAdjustmentProduct = products.find((product) => product.id === Number(adjustWaste.productId)) ?? null
  const adjustmentQuantity = Number(adjustWaste.quantity) || 0
  const adjustmentSign = adjustWaste.type === 'increase' ? 1 : -1
  const adjustmentPreview = selectedAdjustmentProduct
    ? Number(((stock[selectedAdjustmentProduct.id] ?? 0) + adjustmentSign * adjustmentQuantity).toFixed(3))
    : 0
  const matchingCustomers = customers.filter((customer) => (
    `${customer.name} ${customer.contactName ?? ''} ${customer.taxId ?? ''} ${customer.phone} ${customer.email}`.toLowerCase().includes(customerSearch.trim().toLowerCase())
  ))
  const selectedRefundSale = sales.find((sale) => sale.id === selectedRefundSaleId) ?? null
  const refundTotal = selectedRefundSale
    ? Math.round(selectedRefundSale.items.reduce((total, item) => {
      const quantity = Number(refundQuantities[item.id]) || 0
      const saleTotalRatio = selectedRefundSale.subtotal > 0 ? selectedRefundSale.total / selectedRefundSale.subtotal : 0
      return total + quantity * item.price * saleTotalRatio
    }, 0) * 100) / 100
    : 0
  const visibleProducts = useMemo(() => {
    const filtered = products.filter((product) => product.category === category)
    return filtered.filter((product) => product.name.toLowerCase().includes(search.toLowerCase()))
  }, [category, products, search])

  function getCartProduct(item) {
    return products.find((product) => product.id === item.id)
      ?? products.find((product) => product.name === item.name)
  }

  function findCartStockShortage(items = cart) {
    const requiredByProduct = new Map()
    for (const item of items) {
      const product = getCartProduct(item)
      if (!product) return `Cannot verify stock for ${item.name}. Remove it and add the catalogue product again.`
      requiredByProduct.set(product.id, (requiredByProduct.get(product.id) ?? 0) + item.weight)
    }
    for (const [productId, required] of requiredByProduct) {
      const product = products.find((candidate) => candidate.id === productId)
      const available = stock[productId] ?? 0
      if (required > available + 1e-9) {
        return `Insufficient stock for ${product.name}: ${available.toFixed(3)} kg available, ${required.toFixed(3)} kg in the sale.`
      }
    }
    return ''
  }

  function addProduct(product) {
    const existingIndex = cart.findIndex((item) => getCartProduct(item)?.id === product.id)
    const existing = existingIndex >= 0 ? cart[existingIndex] : null
    const currentWeight = cart.reduce((total, item) => total + (getCartProduct(item)?.id === product.id ? item.weight : 0), 0)
    const nextWeight = Number((currentWeight + 1).toFixed(3))
    const available = stock[product.id] ?? 0
    if (nextWeight > available + 1e-9) {
      setNotice(`Insufficient stock for ${product.name}: ${available.toFixed(3)} kg available.`)
      window.setTimeout(() => setNotice(''), 3000)
      return
    }
    setCart(existing
      ? cart.map((item, index) => index === existingIndex ? { ...item, weight: Number((item.weight + 1).toFixed(3)) } : item)
      : [...cart, { id: product.id, name: product.name, weight: 1, price: product.price }])
    setNotice(`${product.name} added`)
    window.setTimeout(() => setNotice(''), 1800)
  }

  function runAction(label) {
    if (label === 'Void All Items') {
      if (redeemedPoints && redeemCustomerId !== null) {
        setCustomers((current) => current.map((customer) => customer.id === redeemCustomerId
          ? { ...customer, points: customer.points + redeemedPoints }
          : customer))
      }
      setCart([])
      setDiscount({ type: 'percent', value: 0 })
      setSelectedCustomerId(null)
      setPaidAmount(0)
      setPaymentEntries([])
      setRedeemedPoints(0)
      setRedeemCustomerId(null)
      setPaymentOpen(false)
      setNotice('Order cleared')
    } else if (label === 'Void Item' && cart.length) {
      if (redeemedPoints) {
        setNotice('Remove the points redemption before removing sale items')
        window.setTimeout(() => setNotice(''), 2600)
      } else {
        setCart((current) => current.slice(0, -1))
        setNotice('Last item removed')
      }
    } else if (label === 'Discount') {
      if (redeemedPoints) {
        setNotice('Remove the points redemption before changing the sale discount')
        window.setTimeout(() => setNotice(''), 2600)
      } else {
        setDiscountDraft({
          type: discount.type,
          value: discount.value ? String(discount.value) : '',
        })
        setDiscountOpen(true)
      }
    } else if (label === 'Redeem Points') {
      if (!selectedCustomer) {
        setNotice('Select a customer before redeeming points')
        window.setTimeout(() => setNotice(''), 2400)
      } else if (!cart.length || subtotal <= discountAmount) {
        setNotice('Add sale items before redeeming points')
        window.setTimeout(() => setNotice(''), 2400)
      } else if (paidAmount > 0) {
        setNotice('Points cannot be redeemed after payment has started')
        window.setTimeout(() => setNotice(''), 2400)
      } else if (redeemedPoints) {
        setCustomers((current) => current.map((customer) => customer.id === redeemCustomerId
          ? { ...customer, points: customer.points + redeemedPoints }
          : customer))
        setRedeemedPoints(0)
        setRedeemCustomerId(null)
        setNotice('Points redemption removed · points restored')
        window.setTimeout(() => setNotice(''), 2400)
      } else {
        setRedeemDraft('')
        setRedeemError('')
        setRedeemOpen(true)
      }
    } else if (label === 'Customer') {
      setCustomerSearch('')
      setCustomerCreateOpen(false)
      setCustomerOpen(true)
    } else if (label === 'Sales Refund') {
      setSelectedRefundSaleId(null)
      setRefundQuantities({})
      setRefundReason('Customer return')
      setListPages((current) => ({ ...current, 'refund-sales': 0 }))
      setRefundOpen(true)
    } else if (label === 'Expenses') {
      setExpenseDraft({ category: 'Food', description: '', amount: '', method: 'CASH' })
      setExpenseError('')
      setExpenseOpen(true)
    } else if (label === 'Day End') {
      setDayEndCashError('')
      setDayEndOpen(true)
    } else if (label === 'Quotation') {
      createQuotation()
    } else if (label === 'Hold Order') {
      holdCurrentOrder()
    } else if (label === 'Recall Order') {
      setRecallOpen(true)
    } else if (label === 'Search Stock Item') {
      setSearchOpen((open) => !open)
      setSearch('')
    } else if (label === 'Advanced') {
      setAdvancedPin('')
      setAdvancedPinError('')
      setAdvancedPinOpen(true)
    } else {
      setNotice(`${label} selected`)
    }

    if (label !== 'Search Stock Item') window.setTimeout(() => setNotice(''), 1800)
  }

  function createQuotation() {
    if (!cart.length) {
      setNotice('Add products before creating a quotation')
      window.setTimeout(() => setNotice(''), 2400)
      return
    }
    if (paidAmount > 0) {
      setNotice('Quotations are unavailable after payment has started')
      window.setTimeout(() => setNotice(''), 2600)
      return
    }
    if (redeemedPoints > 0) {
      setNotice('Remove redeemed points before creating a quotation')
      window.setTimeout(() => setNotice(''), 2600)
      return
    }

    const createdAt = new Date()
    const validUntil = new Date(createdAt)
    validUntil.setDate(validUntil.getDate() + 30)
    const id = Date.now()
    setQuotationPreview({
      id,
      number: `Q${String(id).slice(-6)}`,
      createdAt: createdAt.toLocaleString(),
      validUntil: validUntil.toLocaleDateString(),
      customer: selectedCustomer?.name ?? 'Cash Customer',
      customerContact: selectedCustomer?.contactName ?? '',
      customerTaxId: selectedCustomer?.taxId ?? '',
      items: cart.map((item) => ({ ...item })),
      subtotal,
      discount: discountAmount,
      taxName: companyDetails.taxName,
      taxRate,
      taxInclusive,
      taxAmount,
      total: Math.max(0, Math.round((discountedSubtotal + (taxInclusive ? 0 : taxAmount)) * 100) / 100),
    })
  }

  function unlockAdvanced(event) {
    event.preventDefault()
    if (advancedPin !== ADVANCED_PIN) {
      setAdvancedPinError('Incorrect PIN. Try again.')
      setAdvancedPin('')
      return
    }

    setAdvancedPinOpen(false)
    setAdvancedOpen(true)
    setAdvancedView('Overview')
    setAdvancedPin('')
    setAdvancedPinError('')
  }

  function createHeldOrder() {
    const heldAt = new Date()
    return {
      id: `${heldAt.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
      heldAt: heldAt.toLocaleString(),
      items: cart.map((item) => ({ ...item })),
      subtotal,
      discount: { ...discount },
      paidAmount,
      paymentEntries: paymentEntries.map((entry) => ({ ...entry })),
      redeemedPoints,
      redeemCustomerId,
      customerId: selectedCustomerId,
      customerName: selectedCustomer?.name ?? 'Cash Customer',
    }
  }

  function holdCurrentOrder() {
    if (!cart.length) {
      setNotice('There is no sale to hold')
      return
    }

    const heldOrder = createHeldOrder()
    setHeldOrders((current) => [heldOrder, ...current])
    setCart([])
    setDiscount({ type: 'percent', value: 0 })
    setSelectedCustomerId(null)
    setPaidAmount(0)
    setPaymentEntries([])
    setRedeemedPoints(0)
    setRedeemCustomerId(null)
    setNotice('Order held · ready for the next sale')
  }

  function recallHeldOrder(order) {
    if (!order) return

    if (cart.length) {
      const currentOrder = createHeldOrder()
      setHeldOrders((current) => [currentOrder, ...current.filter((held) => held.id !== order.id)])
    } else {
      setHeldOrders((current) => current.filter((held) => held.id !== order.id))
    }

    setCart(order.items.map((item) => ({ ...item })))
    setDiscount({ ...order.discount })
    setSelectedCustomerId(order.customerId)
    setPaidAmount(order.paidAmount ?? 0)
    setPaymentEntries((order.paymentEntries ?? []).map((entry) => ({ ...entry })))
    setRedeemedPoints(order.redeemedPoints ?? 0)
    setRedeemCustomerId(order.redeemCustomerId ?? null)
    setRecallOpen(false)
    setNotice(cart.length
      ? `Order recalled · current sale held · ${order.customerName}`
      : `Order recalled · ${order.customerName}`)
    window.setTimeout(() => setNotice(''), 2600)
  }

  function saveCustomer(event) {
    event.preventDefault()
    if (redeemedPoints) {
      setNotice('Remove the points redemption before changing the sale customer')
      window.setTimeout(() => setNotice(''), 2600)
      return
    }
    const isBusiness = newCustomer.type === 'business'
    const name = (isBusiness ? newCustomer.companyName : newCustomer.name).trim()
    const contactName = newCustomer.contactName.trim()
    const taxId = newCustomer.taxId.trim()
    const phone = newCustomer.phone.trim()
    const email = newCustomer.email.trim()
    if (!name || (!phone && !email) || (isBusiness && !contactName)) {
      setNotice(isBusiness && !contactName
        ? 'Enter a business contact name'
        : 'Enter a customer name and a phone number or email address')
      window.setTimeout(() => setNotice(''), 2600)
      return
    }

    const customer = {
      id: Date.now(),
      type: newCustomer.type,
      name,
      contactName,
      taxId,
      phone,
      email,
      points: 0,
    }
    setCustomers((current) => [customer, ...current])
    setSelectedCustomerId(customer.id)
    setNewCustomer(emptyNewCustomer)
    setCustomerCreateOpen(false)
    setCustomerOpen(false)
    setNotice(`${customer.name} added to sale`)
    window.setTimeout(() => setNotice(''), 2200)
  }

  function selectCustomer(customer) {
    if (redeemedPoints && customer?.id !== redeemCustomerId) {
      setNotice('Remove the points redemption before changing the sale customer')
      window.setTimeout(() => setNotice(''), 2600)
      return
    }
    setSelectedCustomerId(customer?.id ?? null)
    setCustomerOpen(false)
    setCustomerCreateOpen(false)
    setNotice(customer ? `${customer.name} linked to sale` : 'Sale set to Cash Customer')
    window.setTimeout(() => setNotice(''), 2200)
  }

  function saveCustomerAdmin(event) {
    event.preventDefault()
    if (!customerAdminDraft) return
    const isBusiness = customerAdminDraft.type === 'business'
    const name = String((isBusiness ? customerAdminDraft.companyName : customerAdminDraft.name) ?? '').trim()
    const contactName = String(customerAdminDraft.contactName ?? '').trim()
    const phone = String(customerAdminDraft.phone ?? '').trim()
    const email = String(customerAdminDraft.email ?? '').trim()
    if (!name || (!phone && !email) || (isBusiness && !contactName)) {
      setCustomerAdminError(isBusiness && !contactName
        ? 'Enter a business contact name.'
        : 'Enter a customer name and a phone number or email address.')
      return
    }
    const duplicate = customers.some((customer) => (
      customer.id !== customerAdminDraft.id
      && customer.type === customerAdminDraft.type
      && customer.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase()
    ))
    if (duplicate) {
      setCustomerAdminError('A customer with this name and type already exists.')
      return
    }

    const updatedCustomer = {
      ...customerAdminDraft,
      name,
      contactName,
      taxId: String(customerAdminDraft.taxId ?? '').trim(),
      phone,
      email,
    }
    if (customerAdminDraft.id == null) {
      updatedCustomer.id = Date.now()
      updatedCustomer.points = 0
      updatedCustomer.createdAtMs = updatedCustomer.id
      setCustomers((current) => [updatedCustomer, ...current])
      setCustomerAdminNotice(`${updatedCustomer.name} added.`)
    } else {
      setCustomers((current) => current.map((customer) => (
        customer.id === updatedCustomer.id
          ? { ...updatedCustomer, points: customer.points }
          : customer
      )))
      setCustomerAdminNotice(`${updatedCustomer.name} updated.`)
    }
    setCustomerAdminDraft(null)
    setCustomerAdminError('')
  }

  function removeCustomer(customer) {
    const linkedSales = sales.filter((sale) => (
      sale.customerId === customer.id
      || (sale.customerId == null && sale.customer === customer.name)
    )).length
    const linkedHeldOrders = heldOrders.filter((order) => order.customerId === customer.id).length
    const historyWarning = linkedSales || linkedHeldOrders
      ? ` This customer is linked to ${linkedSales} completed sale${linkedSales === 1 ? '' : 's'} and ${linkedHeldOrders} held order${linkedHeldOrders === 1 ? '' : 's'}; their saved transaction snapshots will remain.`
      : ''
    if (!window.confirm(`Delete ${customer.name}?${historyWarning}`)) return
    setCustomers((current) => current.filter((item) => item.id !== customer.id))
    setHeldOrders((current) => current.map((order) => order.customerId === customer.id
      ? { ...order, customerId: null, customerName: order.customerName || customer.name }
      : order))
    if (selectedCustomerId === customer.id) setSelectedCustomerId(null)
    setCustomerAdminDraft(null)
    setCustomerAdminNotice(`${customer.name} deleted.`)
  }

  function applyDiscount(event) {
    event.preventDefault()
    const value = Number(discountDraft.value)
    const max = discountDraft.type === 'percent' ? 100 : subtotal
    if (!Number.isFinite(value) || value < 0 || value > max) return

    setDiscount({ type: discountDraft.type, value })
    setDiscountOpen(false)
  }

  function applyPointRedemption(event) {
    event.preventDefault()
    const requestedPoints = Number(redeemDraft)
    const currentCustomer = customers.find((customer) => customer.id === selectedCustomerId)
    const maxAffordablePoints = Math.floor(Math.max(0, redeemableTotal) * 100)
    const maxRedeemablePoints = Math.floor(Math.min(currentCustomer?.points ?? 0, maxAffordablePoints) / 100) * 100
    if (!currentCustomer) {
      setRedeemError('Select a customer before redeeming points.')
      return
    }
    if (!Number.isInteger(requestedPoints) || requestedPoints <= 0 || requestedPoints % 100 !== 0) {
      setRedeemError('Enter points in increments of 100.')
      return
    }
    if (requestedPoints > maxRedeemablePoints) {
      setRedeemError(`You can redeem up to ${maxRedeemablePoints} points for this sale.`)
      return
    }

    setCustomers((current) => current.map((customer) => customer.id === currentCustomer.id
      ? { ...customer, points: customer.points - requestedPoints }
      : customer))
    setRedeemedPoints(requestedPoints)
    setRedeemCustomerId(currentCustomer.id)
    setRedeemOpen(false)
    setRedeemError('')
    setNotice(`${requestedPoints} points redeemed · ${currency(requestedPoints / 100)} off`)
    window.setTimeout(() => setNotice(''), 2600)
  }

  function openPayment() {
    const stockError = findCartStockShortage()
    if (stockError) {
      setNotice(stockError)
      window.setTimeout(() => setNotice(''), 3500)
      return
    }
    setPaymentError('')
    setCashTendered('0.00')
    setTenderEntryFresh(true)
    setPaymentOpen(true)
  }

  function setPaymentPreset(amount) {
    setCashTendered(amount.toFixed(2))
    setTenderEntryFresh(false)
    setPaymentError('')
  }

  function enterPaymentKey(key) {
    setPaymentError('')
    if (key === 'Clear') {
      setCashTendered('')
      setTenderEntryFresh(false)
      return
    }

    const base = tenderEntryFresh ? '' : cashTendered
    const next = `${base}${key}`
    if (/^\d*\.?\d{0,2}$/.test(next)) {
      setCashTendered(next)
      setTenderEntryFresh(false)
    }
  }

  function selectRefundSale(sale) {
    setSelectedRefundSaleId(sale.id)
    setRefundQuantities(Object.fromEntries(sale.items.map((item) => [item.id, '0'])))
    setRefundMethod(sale.payments[0]?.method ?? paymentMethods[0])
  }

  function processRefund(event) {
    event.preventDefault()
    if (!selectedRefundSale) return

    const refundItems = selectedRefundSale.items
      .map((item) => ({ ...item, quantity: Number(refundQuantities[item.id]) || 0 }))
      .filter((item) => item.quantity > 0)
    if (!refundItems.length || refundTotal <= 0 || !refundReason.trim()) return

    const invalidQuantity = refundItems.some((item) => {
      const original = selectedRefundSale.items.find((saleItem) => saleItem.id === item.id)
      return !original || item.quantity > original.quantity - original.refundedQuantity + 1e-9
    })
    if (invalidQuantity) return

    const refund = {
      id: Date.now(),
      createdAtMs: Date.now(),
      amount: refundTotal,
      taxAmount: Math.round((refundItems.reduce((total, item) => total + item.quantity * item.price * (1 - (selectedRefundSale.discountRate ?? 0)), 0)
        * (selectedRefundSale.taxInclusive
          ? (selectedRefundSale.taxRate ?? 0) / (100 + (selectedRefundSale.taxRate ?? 0))
          : (selectedRefundSale.taxRate ?? 0) / 100)) * 100) / 100,
      method: refundMethod,
      reason: refundReason,
      operator: currentUsername,
      items: refundItems.map(({ id, name, quantity }) => ({ id, name, quantity })),
      createdAt: new Date().toLocaleString(),
    }
    setSales((current) => current.map((sale) => sale.id === selectedRefundSale.id
      ? {
        ...sale,
        refunds: [...sale.refunds, refund],
        items: sale.items.map((item) => {
          const returned = refundItems.find((refundItem) => refundItem.id === item.id)
          return returned
            ? { ...item, refundedQuantity: Number((item.refundedQuantity + returned.quantity).toFixed(3)) }
            : item
        }),
      }
      : sale))
    setStock((current) => {
      const next = { ...current }
      for (const item of refundItems) {
        const product = products.find((candidate) => candidate.id === item.productId)
          ?? products.find((candidate) => candidate.name === item.name)
        if (product) next[product.id] = Number(((next[product.id] ?? 0) + item.quantity).toFixed(3))
      }
      return next
    })
    const returnedAt = new Date().toLocaleString()
    setInventoryMovements((current) => [
      ...refundItems.map((item) => {
        const product = products.find((candidate) => candidate.id === item.productId)
          ?? products.find((candidate) => candidate.name === item.name)
        return product ? {
          id: `${refund.id}-${item.id}`,
          createdAt: returnedAt,
          productId: product.id,
          product: product.name,
          type: 'Refund',
          quantity: item.quantity,
          reference: `Refund for sale ${selectedRefundSale.number}`,
          operator: currentUsername,
        } : null
      }).filter(Boolean),
      ...current,
    ])
    setRefundOpen(false)
    setSelectedRefundSaleId(null)
    setNotice(`Refund processed · ${currency(refundTotal)} to ${refundMethod}`)
    window.setTimeout(() => setNotice(''), 2800)
  }

  function selectReceiptProduct(productId) {
    const product = products.find((item) => item.id === Number(productId))
    setReceipt((current) => ({
      ...current,
      productId: Number(productId),
      unitCost: product ? product.price.toFixed(2) : current.unitCost,
    }))
  }

  function receiveStock(event) {
    event.preventDefault()
    const product = products.find((item) => item.id === Number(receipt.productId))
    const quantity = Number(receipt.quantity)
    const unitCost = Number(receipt.unitCost)
    if (!product || quantity <= 0 || unitCost < 0) return

    const receiptId = Date.now()
    const receivedAt = new Date().toLocaleString()
    setStock((current) => ({
      ...current,
      [product.id]: Number(((current[product.id] ?? 0) + quantity).toFixed(3)),
    }))
    setStockReceipts((current) => [{
      id: receiptId,
      createdAtMs: receiptId,
      product: product.name,
      quantity,
      unitCost,
      supplier: receipt.supplier.trim() || 'Unspecified supplier',
      reference: receipt.reference.trim() || '—',
      operator: currentUsername,
      receivedAt,
    }, ...current])
    setInventoryMovements((current) => [{
      id: receiptId,
      createdAt: receivedAt,
      productId: product.id,
      product: product.name,
      type: 'Stock received',
      quantity,
      reference: receipt.reference.trim() || '—',
      operator: currentUsername,
    }, ...current])
    setReceipt((current) => ({ ...current, quantity: '', reference: '' }))
    setNotice(`${quantity.toFixed(3)} kg of ${product.name} received`)
    window.setTimeout(() => setNotice(''), 2600)
    setAdvancedView('Overview')
  }

  function processStock(event) {
    event.preventDefault()
    const inputs = processingInputs.map((line) => ({
      product: products.find((product) => product.id === Number(line.productId)),
      quantity: Number(line.quantity),
    }))
    const outputs = processingOutputs.map((line) => ({
      product: products.find((product) => product.id === Number(line.productId)),
      quantity: Number(line.quantity),
    }))
    if (inputs.some((line) => !line.product || !/^\d+(?:\.\d{1,3})?$/.test(String(line.quantity)) || !Number.isFinite(line.quantity) || line.quantity <= 0)) {
      setProcessingError('Choose an input product and enter a valid quantity greater than zero for every input.')
      return
    }
    if (outputs.some((line) => !line.product || !/^\d+(?:\.\d{1,3})?$/.test(String(line.quantity)) || !Number.isFinite(line.quantity) || line.quantity <= 0)) {
      setProcessingError('Choose an output product and enter a valid quantity greater than zero for every output.')
      return
    }
    const requiredByProduct = new Map()
    inputs.forEach(({ product, quantity }) => {
      requiredByProduct.set(product.id, (requiredByProduct.get(product.id) ?? 0) + quantity)
    })
    for (const [productId, required] of requiredByProduct) {
      const product = products.find((item) => item.id === productId)
      const available = stock[productId] ?? 0
      if (required > available + 1e-9) {
        setProcessingError(`Insufficient ${product.name} stock: ${available.toFixed(3)} kg available, ${required.toFixed(3)} kg required.`)
        return
      }
    }
    const totalInput = inputs.reduce((total, line) => total + line.quantity, 0)
    const totalOutput = outputs.reduce((total, line) => total + line.quantity, 0)
    if (totalOutput > totalInput + 1e-9) {
      setProcessingError(`Total output (${totalOutput.toFixed(3)} kg) cannot exceed total input (${totalInput.toFixed(3)} kg). Additives are not tracked as inventory yet.`)
      return
    }

    const batchId = Date.now()
    const batchNumber = `P${String(batchId).slice(-6)}`
    const processedAt = new Date().toLocaleString()
    const inventoryChanges = new Map()
    inputs.forEach(({ product, quantity }) => {
      inventoryChanges.set(product.id, (inventoryChanges.get(product.id) ?? 0) - quantity)
    })
    outputs.forEach(({ product, quantity }) => {
      inventoryChanges.set(product.id, (inventoryChanges.get(product.id) ?? 0) + quantity)
    })
    setStock((current) => {
      const next = { ...current }
      inventoryChanges.forEach((change, productId) => {
        next[productId] = Number(((next[productId] ?? 0) + change).toFixed(3))
      })
      return next
    })
    setInventoryMovements((current) => [
      ...inputs.map(({ product, quantity }, index) => ({
        id: `${batchId}-in-${index}`,
        createdAt: processedAt,
        createdAtMs: batchId,
        productId: product.id,
        product: product.name,
        type: 'Processing input',
        quantity: -quantity,
        reference: `Batch ${batchNumber}`,
        operator: currentUsername,
      })),
      ...outputs.map(({ product, quantity }, index) => ({
        id: `${batchId}-out-${index}`,
        createdAt: processedAt,
        createdAtMs: batchId,
        productId: product.id,
        product: product.name,
        type: 'Processing output',
        quantity,
        reference: `Batch ${batchNumber}`,
        operator: currentUsername,
      })),
      ...current,
    ])
    setProcessingHistory((current) => [{
      id: batchId,
      createdAtMs: batchId,
      number: batchNumber,
      processedAt,
      operator: currentUsername,
      inputs: inputs.map(({ product, quantity }) => ({ productId: product.id, product: product.name, quantity })),
      outputs: outputs.map(({ product, quantity }) => ({ productId: product.id, product: product.name, quantity, price: product.price })),
      totalInput,
      totalOutput,
      yieldPercent: totalInput > 0 ? totalOutput / totalInput * 100 : 0,
      loss: Number((totalInput - totalOutput).toFixed(3)),
    }, ...current])
    setProcessingInputs([{ productId: products[0]?.id ?? 0, quantity: '' }])
    setProcessingOutputs([{ productId: products[0]?.id ?? 0, quantity: '' }])
    setProcessingError('')
    setNotice(`Processing batch ${batchNumber} recorded · ${totalOutput.toFixed(3)} kg output`)
    window.setTimeout(() => setNotice(''), 3000)
  }

  function applyStocktake(event) {
    event.preventDefault()
    const product = selectedStocktakeProduct
    const quantity = Number(stocktake.quantity)
    if (!product || quantity < 0 || stocktake.quantity === '') return
    const previousQuantity = stock[product.id] ?? 0
    const variance = Number((quantity - previousQuantity).toFixed(3))
    const stocktakeId = Date.now()
    setStocktakeHistory((current) => [{
      id: stocktakeId,
      productId: product.id,
      product: product.name,
      expected: previousQuantity,
      counted: Number(quantity.toFixed(3)),
      variance,
      createdAt: new Date().toLocaleString(),
      createdAtMs: stocktakeId,
      operator: currentUsername,
    }, ...current])
    setStock((current) => ({ ...current, [product.id]: Number(quantity.toFixed(3)) }))
    setInventoryMovements((current) => [{
      id: stocktakeId,
      createdAt: new Date().toLocaleString(),
      createdAtMs: stocktakeId,
      productId: product.id,
      product: product.name,
      type: 'Stocktake adjustment',
      quantity: variance,
      reference: `Counted ${Number(quantity.toFixed(3)).toFixed(3)} kg`,
      operator: currentUsername,
    }, ...current])
    setNotice(variance === 0
      ? `Stocktake matched recorded quantity · ${product.name}`
      : `Stocktake discrepancy ${variance > 0 ? '+' : ''}${variance.toFixed(3)} kg · ${product.name}`)
    window.setTimeout(() => setNotice(''), 2200)
    setStocktake((current) => ({ ...current, quantity: '' }))
  }

  function recordStockAdjustment(event) {
    event.preventDefault()
    const product = selectedAdjustmentProduct
    const quantity = Number(adjustWaste.quantity)
    const reason = adjustWaste.reason.trim()
    if (!product || !/^\d+(?:\.\d{1,3})?$/.test(adjustWaste.quantity) || !Number.isFinite(quantity) || quantity <= 0) {
      setAdjustWasteError('Choose a product and enter a quantity greater than zero with up to 3 decimal places.')
      return
    }
    if (!reason) {
      setAdjustWasteError('Enter a reason for this stock change.')
      return
    }
    const available = stock[product.id] ?? 0
    const isIncrease = adjustWaste.type === 'increase'
    if (!isIncrease && quantity > available + 1e-9) {
      setAdjustWasteError(`Insufficient ${product.name} stock: ${available.toFixed(3)} kg available.`)
      return
    }

    const change = Number((isIncrease ? quantity : -quantity).toFixed(3))
    const createdAtMs = Date.now()
    const createdAt = new Date(createdAtMs).toLocaleString()
    const entryId = `manual-${createdAtMs}`
    const type = isIncrease
      ? 'Stock adjustment (increase)'
      : adjustWaste.type === 'waste' ? 'Waste' : 'Stock adjustment (decrease)'
    setStock((current) => ({
      ...current,
      [product.id]: Number(((current[product.id] ?? 0) + change).toFixed(3)),
    }))
    setInventoryMovements((current) => [{
      id: entryId,
      createdAt,
      createdAtMs,
      productId: product.id,
      product: product.name,
      type,
      quantity: change,
      reference: reason,
      operator: currentUsername,
    }, ...current])
    setAdjustWaste((current) => ({ ...current, quantity: '', reason: '' }))
    setAdjustWasteError('')
    setNotice(`${type} recorded · ${product.name} ${change > 0 ? '+' : ''}${change.toFixed(3)} kg`)
    window.setTimeout(() => setNotice(''), 2800)
  }

  function createProduct(event) {
    event.preventDefault()
    const name = newProduct.name.trim()
    const price = Number(newProduct.price)
    const initialStock = Number(newProduct.initialStock || 0)
    if (!name || !categories.includes(newProduct.category) || !Number.isFinite(price) || price <= 0 || !Number.isFinite(initialStock) || initialStock < 0) {
      setProductFormError('Enter a product name, choose a category, enter a price greater than zero, and provide a valid starting stock quantity.')
      return
    }
    if (products.some((product) => product.name.toLowerCase() === name.toLowerCase())) {
      setProductFormError('A product with this name already exists.')
      return
    }

    const product = {
      id: Math.max(0, ...products.map((item) => item.id)) + 1,
      name,
      category: newProduct.category,
      price: Math.round(price * 100) / 100,
      imageDataUrl: newProduct.imageDataUrl,
      image: categoryImages[newProduct.category] ?? categoryImages['5 BEEF'],
    }
    setProducts((current) => [...current, product])
    setStock((current) => ({ ...current, [product.id]: Number(initialStock.toFixed(3)) }))
    if (initialStock > 0) {
      setInventoryMovements((current) => [{
        id: `opening-${product.id}`,
        createdAt: new Date().toLocaleString(),
        productId: product.id,
        product: product.name,
        type: 'Opening stock',
        quantity: Number(initialStock.toFixed(3)),
        reference: 'Product creation',
        operator: currentUsername,
      }, ...current])
    }
    setNewProduct({ name: '', category: categories[0] ?? '', price: '', initialStock: '', imageDataUrl: '' })
    setProductFormError('')
    setCategory(product.category)
    setSearch('')
    setSearchOpen(false)
    setNotice(`${product.name} added to products`)
    window.setTimeout(() => setNotice(''), 2400)
  }

  function beginProductEdit(product) {
    setEditingProductId(product.id)
    setProductEditDraft({
      name: product.name,
      category: product.category,
      price: String(product.price),
      imageDataUrl: product.imageDataUrl ?? '',
    })
    setProductEditError('')
    setProductToDelete(null)
  }

  function saveProductEdit(event, product) {
    event.preventDefault()
    const name = productEditDraft.name.trim()
    const price = Number(productEditDraft.price)
    if (!name || !Number.isFinite(price) || price <= 0) {
      setProductEditError('Enter a product name and a price greater than zero.')
      return
    }
    if (products.some((item) => item.id !== product.id && item.name.toLowerCase() === name.toLowerCase())) {
      setProductEditError('A product with this name already exists.')
      return
    }

    const previousName = product.name
    setProducts((current) => current.map((item) => item.id === product.id
      ? { ...item, name, category: productEditDraft.category, price: Math.round(price * 100) / 100, imageDataUrl: productEditDraft.imageDataUrl }
      : item))
    if (name !== previousName) {
      setCart((current) => current.map((item) => item.id === product.id || item.name === previousName
        ? { ...item, name }
        : item))
      setHeldOrders((current) => current.map((order) => ({
        ...order,
        items: order.items.map((item) => item.id === product.id || item.name === previousName
          ? { ...item, name }
          : item),
      })))
    }
    setEditingProductId(null)
    setProductEditDraft(null)
    setProductEditError('')
    setNotice(`${name} updated`)
    window.setTimeout(() => setNotice(''), 2400)
  }

  function selectProductEditImage(file) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setProductEditError('Select a valid image file.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setProductEditError('Product images must be 5 MB or smaller.')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        setProductEditError('The image could not be read. Please try another file.')
        return
      }
      setProductEditDraft((current) => ({ ...current, imageDataUrl: reader.result }))
      setProductEditError('')
    }
    reader.onerror = () => setProductEditError('The image could not be read. Please try another file.')
    reader.readAsDataURL(file)
  }

  function selectProductImage(file) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setProductFormError('Select a valid image file.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setProductFormError('Product images must be 5 MB or smaller.')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        setProductFormError('The image could not be read. Please try another file.')
        return
      }
      setNewProduct((current) => ({ ...current, imageDataUrl: reader.result }))
      setProductFormError('')
    }
    reader.onerror = () => setProductFormError('The image could not be read. Please try another file.')
    reader.readAsDataURL(file)
  }

  function createCategory(event) {
    event.preventDefault()
    const name = categoryName(newCategoryName.trim()).toLocaleUpperCase()
    if (!name) {
      setCategoryFormError('Enter a category name.')
      return
    }
    if (categories.some((item) => categoryName(item).toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setCategoryFormError('A category with this name already exists.')
      return
    }

    const nextNumber = Math.max(0, ...categories.map((item) => Number(item.match(/^\d+/)?.[0]) || 0)) + 1
    const newCategory = `${nextNumber} ${name}`
    setCategories((current) => [...current, newCategory])
    setNewCategoryName('')
    setCategoryFormError('')
    setNewProduct((current) => ({ ...current, category: newCategory }))
    setCategory(newCategory)
    setSearch('')
    setSearchOpen(false)
    setNotice(`${name} category created`)
    window.setTimeout(() => setNotice(''), 2400)
  }

  function beginCategoryEdit(item) {
    setEditingCategory(item)
    setCategoryEditName(categoryName(item))
    setCategoryEditError('')
    setCategoryToDelete(null)
  }

  function saveCategoryEdit(event, oldCategory) {
    event.preventDefault()
    const name = categoryName(categoryEditName.trim()).toLocaleUpperCase()
    if (!name) {
      setCategoryEditError('Enter a category name.')
      return
    }
    if (categories.some((item) => item !== oldCategory && categoryName(item).toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setCategoryEditError('A category with this name already exists.')
      return
    }

    const number = oldCategory.match(/^\d+/)?.[0]
    const updatedCategory = number ? `${number} ${name}` : name
    setCategories((current) => current.map((item) => item === oldCategory ? updatedCategory : item))
    setProducts((current) => current.map((product) => product.category === oldCategory
      ? { ...product, category: updatedCategory }
      : product))
    if (category === oldCategory) setCategory(updatedCategory)
    if (newProduct.category === oldCategory) {
      setNewProduct((current) => ({ ...current, category: updatedCategory }))
    }
    if (productEditDraft?.category === oldCategory) {
      setProductEditDraft((current) => ({ ...current, category: updatedCategory }))
    }
    setEditingCategory(null)
    setCategoryEditName('')
    setCategoryEditError('')
    setNotice(`${name} category updated`)
    window.setTimeout(() => setNotice(''), 2400)
  }

  function deleteCategory(categoryToRemove) {
    const productsInCategory = products.some((product) => product.category === categoryToRemove)
    if (productsInCategory || categories.length === 1) {
      setNotice(productsInCategory
        ? 'Move or delete this category’s products before deleting the category'
        : 'At least one category must remain')
      window.setTimeout(() => setNotice(''), 3000)
      setCategoryToDelete(null)
      return
    }

    const remainingCategories = categories.filter((item) => item !== categoryToRemove)
    setCategories(remainingCategories)
    if (category === categoryToRemove) setCategory(remainingCategories[0])
    if (newProduct.category === categoryToRemove) {
      setNewProduct((current) => ({ ...current, category: remainingCategories[0] }))
    }
    setCategoryToDelete(null)
    setNotice(`${categoryName(categoryToRemove)} category deleted`)
    window.setTimeout(() => setNotice(''), 2400)
  }

  function deleteProduct(product) {
    const inCurrentSale = cart.some((item) => item.id === product.id || item.name === product.name)
    const inHeldSale = heldOrders.some((order) => order.items.some((item) => item.id === product.id || item.name === product.name))
    const inCompletedSale = sales.some((sale) => sale.items.some((item) => item.productId === product.id || item.name === product.name))
    const inInventoryHistory = inventoryMovements.some((movement) => movement.productId === product.id)
    if (inCurrentSale || inHeldSale || inCompletedSale || inInventoryHistory || products.length === 1) {
      const reason = products.length === 1
        ? 'at least one product must remain in the catalogue'
        : 'it is referenced by a sale or has inventory movement history'
      setNotice(`${product.name} cannot be deleted because ${reason}`)
      window.setTimeout(() => setNotice(''), 3000)
      setProductToDelete(null)
      return
    }

    const remainingProducts = products.filter((item) => item.id !== product.id)
    setProducts((current) => current.filter((item) => item.id !== product.id))
    setStock((current) => {
      const next = { ...current }
      delete next[product.id]
      return next
    })
    if (Number(receipt.productId) === product.id) {
      setReceipt((current) => ({
        ...current,
        productId: remainingProducts[0].id,
        unitCost: remainingProducts[0].price.toFixed(2),
      }))
    }
    if (Number(stocktake.productId) === product.id) {
      setStocktake((current) => ({ ...current, productId: remainingProducts[0].id }))
    }
    setProductToDelete(null)
    setNotice(`${product.name} removed from products`)
    window.setTimeout(() => setNotice(''), 2400)
  }

  function finishPayment(method) {
    const parsedTender = Number(cashTendered)
    if (!/^\d*\.?\d{0,2}$/.test(cashTendered) || !Number.isFinite(parsedTender) || parsedTender < 0) {
      setPaymentError('Enter a valid payment amount.')
      return
    }
    const tendered = Math.round(parsedTender * 100) / 100
    const balance = paymentBalance
    if (!cart.length) {
      setPaymentError('There are no items in this sale.')
      return
    }
    const stockError = findCartStockShortage()
    if (stockError) {
      setPaymentError(stockError)
      return
    }
    if (balance > 0 && tendered <= 0) {
      setPaymentError('Enter a payment amount greater than $0.00.')
      return
    }

    const amountPaid = Math.min(tendered, balance)
    const changeDue = method === 'CASH' && balance > 0 ? Math.max(0, tendered - balance) : 0
    const payment = {
      method,
      amount: amountPaid,
      tendered: method === 'CASH' ? tendered : amountPaid,
      change: changeDue,
      createdAt: new Date().toLocaleString(),
    }
    const updatedEntries = [...paymentEntries, payment]
    const remaining = Math.max(0, Math.round((balance - amountPaid) * 100) / 100)

    if (remaining > 0) {
      setPaidAmount((current) => Number((current + amountPaid).toFixed(2)))
      setPaymentEntries(updatedEntries)
      setCashTendered(remaining.toFixed(2))
      setTenderEntryFresh(true)
      setPaymentError('')
      setNotice(`Payment of ${currency(amountPaid)} recorded · ${currency(remaining)} remaining`)
      window.setTimeout(() => setNotice(''), 2600)
      return
    }

    if (cart.length) {
      const saleId = Date.now()
      const sale = {
        id: saleId,
        createdAtMs: Date.now(),
        number: `S${String(saleId).slice(-6)}`,
        createdAt: new Date().toLocaleString(),
        operator: currentUsername,
        customer: selectedCustomer?.name ?? 'Cash Customer',
        customerContact: selectedCustomer?.contactName ?? '',
        customerTaxId: selectedCustomer?.taxId ?? '',
        method: updatedEntries.map((entry) => entry.method).join(' + '),
        payments: updatedEntries,
        subtotal,
        discount: discountAmount,
        redeemedPoints,
        redeemAmount,
        taxName: companyDetails.taxName,
        taxRate,
        taxInclusive,
        taxAmount,
        total: totalDue,
        discountRate: subtotal > 0 ? discountAmount / subtotal : 0,
        customerId: selectedCustomer?.id ?? null,
        items: cart.map((item, index) => ({
          id: `${saleId}-${index}`,
          productId: getCartProduct(item)?.id ?? item.id,
          name: item.name,
          quantity: item.weight,
          refundedQuantity: 0,
          price: item.price,
        })),
        refunds: [],
      }
      setStock((current) => {
        const next = { ...current }
        for (const item of cart) {
          const product = getCartProduct(item)
          if (product) next[product.id] = Number(((next[product.id] ?? 0) - item.weight).toFixed(3))
        }
        return next
      })
      setInventoryMovements((current) => [
        ...cart.map((item, index) => {
          const product = getCartProduct(item)
          return product ? {
            id: `${saleId}-${index}`,
            createdAt: sale.createdAt,
            productId: product.id,
            product: product.name,
            type: 'Sale',
            quantity: -item.weight,
            reference: `Sale ${sale.number}`,
            operator: currentUsername,
          } : null
        }).filter(Boolean),
        ...current,
      ])
      setSales((current) => [sale, ...current])
      setCompletedSale(sale)
    }
    setNotice(`Payment complete · ${method}${changeDue ? ` · Change ${currency(changeDue)}` : ''}`)
    setCart([])
    setDiscount({ type: 'percent', value: 0 })
    setSelectedCustomerId(null)
    setPaidAmount(0)
    setPaymentEntries([])
    setRedeemedPoints(0)
    setRedeemCustomerId(null)
    setTenderEntryFresh(true)
    setPaymentError('')
    setPaymentOpen(false)
    window.setTimeout(() => setNotice(''), 2600)
  }

  function addPaymentMethod(event) {
    event.preventDefault()
    const name = newPaymentMethod.trim().toLocaleUpperCase()
    if (!name) {
      setPaymentMethodError('Enter a payment method name.')
      return
    }
    if (paymentMethods.some((method) => method.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setPaymentMethodError('This payment method already exists.')
      return
    }
    setPaymentMethods((current) => [...current, name])
    setNewPaymentMethod('')
    setPaymentMethodError('')
  }

  function savePaymentMethodEdit(event, oldMethod) {
    event.preventDefault()
    const name = paymentMethodDraft.trim().toLocaleUpperCase()
    if (!name) {
      setPaymentMethodError('Enter a payment method name.')
      return
    }
    if (paymentMethods.some((method) => method !== oldMethod && method.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setPaymentMethodError('This payment method already exists.')
      return
    }
    setPaymentMethods((current) => current.map((method) => method === oldMethod ? name : method))
    if (refundMethod === oldMethod) setRefundMethod(name)
    if (expenseDraft.method === oldMethod) setExpenseDraft((current) => ({ ...current, method: name }))
    setEditingPaymentMethod(null)
    setPaymentMethodDraft('')
    setPaymentMethodError('')
  }

  function deletePaymentMethod(method) {
    if (method === 'CASH') {
      setPaymentMethodError('CASH is required for cash change and day-end cash reconciliation.')
      return
    }
    const inUse = sales.some((sale) => sale.payments.some((payment) => payment.method === method)
      || sale.refunds.some((refund) => refund.method === method))
      || expenses.some((expense) => expense.method === method)
    if (inUse || paymentMethods.length === 1) {
      setPaymentMethodError(inUse
        ? 'This method is already used by a sale, refund, or expense and cannot be deleted.'
        : 'At least one payment method must remain.')
      return
    }
    setPaymentMethods((current) => current.filter((item) => item !== method))
    if (refundMethod === method) setRefundMethod('CASH')
    if (expenseDraft.method === method) setExpenseDraft((current) => ({ ...current, method: 'CASH' }))
    setPaymentMethodError('')
  }

  function selectCompanyLogo(file) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setCompanyError('Choose a valid image file for the company logo.')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setCompanyError('Company logos must be 2 MB or smaller.')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        setCompanyError('The logo could not be read. Please choose another image.')
        return
      }
      setCompanyDraft((current) => ({ ...current, logoDataUrl: reader.result }))
      setCompanyError('')
    }
    reader.onerror = () => setCompanyError('The logo could not be read. Please choose another image.')
    reader.readAsDataURL(file)
  }

  function saveCompanyDetails(event) {
    event.preventDefault()
    const name = companyDraft.name.trim()
    if (!name) {
      setCompanyError('Enter a company or store name.')
      return
    }
    const configuredRate = Number(companyDraft.taxRate)
    if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(companyDraft.taxRate) || !Number.isFinite(configuredRate) || configuredRate < 0 || configuredRate > 100) {
      setCompanyError('Enter a tax rate from 0 to 100%.')
      return
    }
    if (configuredRate > 0 && !companyDraft.taxName.trim()) {
      setCompanyError('Enter a tax name when the tax rate is greater than 0%.')
      return
    }
    const taxSettingsChanged = companyDraft.taxName.trim() !== companyDetails.taxName
      || String(configuredRate) !== companyDetails.taxRate
      || companyDraft.taxInclusive !== companyDetails.taxInclusive
    if (taxSettingsChanged && (paidAmount > 0 || redeemedPoints > 0)) {
      setCompanyError('Complete or clear the current sale and its point redemption before changing tax settings.')
      return
    }
    const nextCompanyDetails = { ...companyDraft, name, taxName: companyDraft.taxName.trim() || 'Tax', taxRate: String(configuredRate) }
    setCompanyDetails(nextCompanyDetails)
    setCompanyDraft(nextCompanyDetails)
    setCompanyError('')
    setNotice('Company details saved')
    window.setTimeout(() => setNotice(''), 2400)
  }

  function recordExpense(event) {
    event.preventDefault()
    const amount = Number(expenseDraft.amount)
    if (!expenseDraft.description.trim()) {
      setExpenseError('Enter what the expense was for.')
      return
    }
    if (!/^\d+(\.\d{1,2})?$/.test(expenseDraft.amount) || !Number.isFinite(amount) || amount <= 0) {
      setExpenseError('Enter an expense amount greater than $0.00, with up to two decimal places.')
      return
    }

    setExpenses((current) => [{
      id: Date.now(),
      createdAtMs: Date.now(),
      category: expenseDraft.category,
      description: expenseDraft.description.trim(),
      amount: Math.round(amount * 100) / 100,
      method: expenseDraft.method,
      operator: currentUsername,
      createdAt: new Date().toLocaleString(),
    }, ...current])
    setExpenseOpen(false)
    setNotice(`Expense recorded · ${currency(amount)}`)
    window.setTimeout(() => setNotice(''), 2600)
  }

  const change = Math.max(0, Number(cashTendered || 0) - paymentBalance)
  const totalStockWeight = Object.values(stock).reduce((total, quantity) => total + quantity, 0)
  const inStockCount = Object.values(stock).filter((quantity) => quantity > 0).length
  const isShopStateDirty = serializedShopSnapshot !== lastSavedSnapshotRef.current
  const adjustmentMovements = inventoryMovements.filter((movement) => (
    movement.type.startsWith('Stock adjustment') || movement.type === 'Waste'
  ))
  const detailedReport = useMemo(() => {
    const isInReportRange = (timestamp) => {
      const date = localDateKey(timestamp)
      return (!reportStartDate || date >= reportStartDate) && (!reportEndDate || date <= reportEndDate)
    }
    const filteredSales = sales.filter((sale) => isInReportRange(sale.createdAtMs ?? Date.parse(sale.createdAt)))
    const filteredRefunds = sales.flatMap((sale) => sale.refunds.map((refund) => ({ ...refund, saleNumber: sale.number })))
      .filter((refund) => isInReportRange(refund.createdAtMs ?? Date.parse(refund.createdAt)))
    const filteredExpenses = expenses.filter((expense) => isInReportRange(expense.createdAtMs ?? Date.parse(expense.createdAt)))
    const filteredReceipts = stockReceipts.filter((item) => isInReportRange(item.createdAtMs ?? Date.parse(item.receivedAt)))
    const report = {
      sales: filteredSales,
      refunds: filteredRefunds,
      expenses: filteredExpenses,
      receipts: filteredReceipts,
      grossSales: 0,
      discounts: 0,
      redeemed: 0,
      netSales: 0,
      taxCollected: 0,
      refundTotal: 0,
      expenseTotal: 0,
      stockReceived: 0,
      stockCost: 0,
      tenders: {},
      products: {},
    }

    filteredSales.forEach((sale) => {
      report.grossSales += sale.subtotal
      report.discounts += sale.discount
      report.redeemed += sale.redeemAmount
      report.netSales += sale.total
      report.taxCollected += sale.taxAmount ?? 0
      sale.payments.forEach((payment) => {
        report.tenders[payment.method] = (report.tenders[payment.method] ?? 0) + payment.amount
      })
      sale.items.forEach((item) => {
        const product = report.products[item.productId] ?? {
          id: item.productId,
          name: item.name,
          quantity: 0,
          gross: 0,
          netBeforeRefunds: 0,
          refundQuantity: 0,
          refundAmount: 0,
        }
        product.quantity += item.quantity
        product.gross += item.quantity * item.price
        const saleTotalRatio = sale.subtotal > 0 ? sale.total / sale.subtotal : 0
        product.netBeforeRefunds += item.quantity * item.price * saleTotalRatio
        report.products[item.productId] = product
      })
    })
    filteredRefunds.forEach((refund) => {
      report.refundTotal += refund.amount
      report.taxCollected -= refund.taxAmount ?? 0
      refund.items.forEach((returnedItem) => {
        const sale = sales.find((item) => item.number === refund.saleNumber)
        const saleItem = sale?.items.find((item) => item.id === returnedItem.id)
        const productId = saleItem?.productId ?? returnedItem.name
        const product = report.products[productId] ?? {
          id: productId,
          name: returnedItem.name,
          quantity: 0,
          gross: 0,
          netBeforeRefunds: 0,
          refundQuantity: 0,
          refundAmount: 0,
        }
        product.refundQuantity += returnedItem.quantity
        const saleTotalRatio = sale?.subtotal > 0 ? sale.total / sale.subtotal : 0
        product.refundAmount += returnedItem.quantity * (saleItem?.price ?? 0) * saleTotalRatio
        report.products[productId] = product
      })
    })
    filteredExpenses.forEach((expense) => {
      report.expenseTotal += expense.amount
    })
    filteredReceipts.forEach((item) => {
      report.stockReceived += item.quantity
      report.stockCost += item.quantity * item.unitCost
    })

    return {
      ...report,
      netTakings: report.netSales - report.refundTotal - report.expenseTotal,
      products: Object.values(report.products)
        .map((product) => ({ ...product, net: product.netBeforeRefunds - product.refundAmount }))
        .sort((a, b) => b.net - a.net),
    }
  }, [expenses, reportEndDate, reportStartDate, sales, stockReceipts])

  const activityLog = useMemo(() => {
    const entries = []
    const addEntry = (entry) => {
      const timestamp = new Date(entry.timestamp).getTime()
      if (!Number.isFinite(timestamp)) return
      entries.push({ ...entry, timestamp })
    }

    sales.forEach((sale) => {
      addEntry({
        id: `sale-${sale.id}`,
        category: 'Sales',
        activity: 'Sale completed',
        details: `${sale.number} · ${sale.customer} · ${currency(sale.total)}`,
        operator: sale.operator || 'Staff',
        timestamp: sale.createdAtMs ?? sale.createdAt,
      })
      ;(sale.refunds ?? []).forEach((refund) => {
        addEntry({
          id: `refund-${refund.id}`,
          category: 'Refunds',
          activity: 'Refund processed',
          details: `${sale.number} · ${refund.reason} · ${currency(refund.amount)}`,
          operator: refund.operator || 'Staff',
          timestamp: refund.createdAtMs ?? refund.createdAt,
        })
      })
    })
    expenses.forEach((expense) => addEntry({
      id: `expense-${expense.id}`,
      category: 'Expenses',
      activity: 'Expense recorded',
      details: `${expense.category} · ${expense.description} · ${currency(expense.amount)}`,
      operator: expense.operator || 'Staff',
      timestamp: expense.createdAtMs ?? expense.createdAt,
    }))
    stockReceipts.forEach((receiptEntry) => addEntry({
      id: `receipt-${receiptEntry.id}`,
      category: 'Stock',
      activity: 'Stock received',
      details: `${receiptEntry.product} · ${Number(receiptEntry.quantity).toFixed(3)} kg · ${receiptEntry.supplier}`,
      operator: receiptEntry.operator || 'Staff',
      timestamp: receiptEntry.createdAtMs ?? receiptEntry.receivedAt,
    }))
    processingHistory.forEach((batch) => addEntry({
      id: `processing-${batch.id}`,
      category: 'Processing',
      activity: 'Processing batch completed',
      details: `${batch.number} · ${Number(batch.totalInput).toFixed(3)} kg input → ${Number(batch.totalOutput).toFixed(3)} kg output`,
      operator: batch.operator || 'Staff',
      timestamp: batch.createdAtMs ?? batch.processedAt,
    }))
    stocktakeHistory.forEach((stocktakeEntry) => addEntry({
      id: `stocktake-${stocktakeEntry.id}`,
      category: 'Stock',
      activity: stocktakeEntry.variance === 0 ? 'Stocktake matched' : 'Stocktake discrepancy',
      details: `${stocktakeEntry.product} · expected ${Number(stocktakeEntry.expected).toFixed(3)} kg, counted ${Number(stocktakeEntry.counted).toFixed(3)} kg, variance ${stocktakeEntry.variance > 0 ? '+' : ''}${Number(stocktakeEntry.variance).toFixed(3)} kg`,
      operator: stocktakeEntry.operator || 'Staff',
      timestamp: stocktakeEntry.createdAtMs ?? stocktakeEntry.createdAt,
    }))
    inventoryMovements
      .filter((movement) => movement.type === 'Waste' || movement.type.startsWith('Stock adjustment'))
      .forEach((movement) => addEntry({
        id: `movement-${movement.id}`,
        category: 'Stock',
        activity: movement.type,
        details: `${movement.product} · ${movement.quantity > 0 ? '+' : ''}${Number(movement.quantity).toFixed(3)} kg · ${movement.reference}`,
        operator: movement.operator || 'Staff',
        timestamp: movement.createdAtMs ?? movement.createdAt,
      }))
    dayEndReports.forEach((report) => addEntry({
      id: `day-end-${report.id}`,
      category: 'Day end',
      activity: 'Day closed',
      details: `${report.saleCount} sales · net takings ${currency(report.netTakings)}`,
      operator: report.closedBy || 'Staff',
      timestamp: report.closedAt,
    }))
    return entries.sort((first, second) => second.timestamp - first.timestamp)
  }, [dayEndReports, expenses, inventoryMovements, processingHistory, sales, stockReceipts, stocktakeHistory])
  const filteredActivityLog = activityFilter === 'All activity'
    ? activityLog
    : activityLog.filter((entry) => entry.category === activityFilter)

  function getListPage(key, totalItems, pageSize = 10) {
    const pageCount = Math.max(1, Math.ceil(totalItems / pageSize))
    const currentPage = Math.min(listPages[key] ?? 0, pageCount - 1)
    return {
      page: currentPage,
      pageCount,
      pageSize,
      start: currentPage * pageSize,
      end: Math.min(totalItems, (currentPage + 1) * pageSize),
    }
  }

  function changeListPage(key, nextPage) {
    setListPages((current) => ({ ...current, [key]: Math.max(0, nextPage) }))
  }

  function renderPagination(key, totalItems, label, pageSize = 10) {
    const pagination = getListPage(key, totalItems, pageSize)
    return (
      <Pagination
        label={label}
        onPageChange={(nextPage) => changeListPage(key, nextPage)}
        page={pagination.page}
        pageCount={pagination.pageCount}
        pageSize={pageSize}
        totalItems={totalItems}
      />
    )
  }

  function paginationRowClass(key, index, totalItems, pageSize = 10) {
    const pagination = getListPage(key, totalItems, pageSize)
    return index < pagination.start || index >= pagination.end ? 'pagination-row-hidden' : ''
  }

  const dayEndSales = sales.filter((sale) => !closedDaySaleIds.includes(sale.id))
  const dayEndRefunds = sales.flatMap((sale) => sale.refunds)
    .filter((refund) => !closedDayRefundIds.includes(refund.id))
  const dayEndExpenses = expenses.filter((expense) => !closedDayExpenseIds.includes(expense.id))
  const dayEndHasActivity = dayEndSales.length > 0 || dayEndRefunds.length > 0 || dayEndExpenses.length > 0
  const dayEndSummary = dayEndSales.reduce((summary, sale) => {
    summary.grossSales += sale.subtotal
    summary.discounts += sale.discount
    summary.pointsRedeemed += sale.redeemAmount
    summary.netSales += sale.total
    summary.taxCollected += sale.taxAmount ?? 0
    sale.payments.forEach((payment) => {
      summary.tenders[payment.method] = (summary.tenders[payment.method] ?? 0) + payment.amount
    })
    return summary
  }, { grossSales: 0, discounts: 0, pointsRedeemed: 0, netSales: 0, taxCollected: 0, refunds: 0, expenses: 0, cashExpenses: 0, tenders: {}, refundTenders: {}, expenseTenders: {}, expenseCategories: {} })
  dayEndRefunds.forEach((refund) => {
    dayEndSummary.refunds += refund.amount
    dayEndSummary.taxCollected -= refund.taxAmount ?? 0
    dayEndSummary.refundTenders[refund.method] = (dayEndSummary.refundTenders[refund.method] ?? 0) + refund.amount
  })
  dayEndExpenses.forEach((expense) => {
    dayEndSummary.expenses += expense.amount
    dayEndSummary.expenseTenders[expense.method] = (dayEndSummary.expenseTenders[expense.method] ?? 0) + expense.amount
    dayEndSummary.expenseCategories[expense.category] = (dayEndSummary.expenseCategories[expense.category] ?? 0) + expense.amount
    if (expense.method === 'CASH') dayEndSummary.cashExpenses += expense.amount
  })
  const expectedCash = Math.round(((dayEndSummary.tenders.CASH ?? 0) - (dayEndSummary.refundTenders.CASH ?? 0) - dayEndSummary.cashExpenses) * 100) / 100
  const parsedDayEndCashCount = Number(dayEndCashCount)
  const dayEndCashVariance = dayEndCashCount === '' || !Number.isFinite(parsedDayEndCashCount)
    ? null
    : Math.round((parsedDayEndCashCount - expectedCash) * 100) / 100

  function closeDay() {
    if (!dayEndHasActivity) return
    if (!/^\d+(?:\.\d{1,2})?$/.test(dayEndCashCount) || !Number.isFinite(parsedDayEndCashCount) || parsedDayEndCashCount < 0) {
      setDayEndCashError('Enter the physical cash counted, with up to two decimal places, before closing.')
      return
    }

    const closedAtMs = Date.now()
    const closedAt = new Date(closedAtMs).toLocaleString()
    const report = {
      id: closedAtMs,
      closedAtMs,
      closedAt,
      saleCount: dayEndSales.length,
      grossSales: dayEndSummary.grossSales,
      discounts: dayEndSummary.discounts,
      pointsRedeemed: dayEndSummary.pointsRedeemed,
      netSales: dayEndSummary.netSales,
      taxCollected: dayEndSummary.taxCollected,
      refunds: dayEndSummary.refunds,
      expenses: dayEndSummary.expenses,
      netTakings: dayEndSummary.netSales - dayEndSummary.refunds - dayEndSummary.expenses,
      cashExpected: expectedCash,
      cashCounted: Math.round(parsedDayEndCashCount * 100) / 100,
      cashVariance: dayEndCashVariance,
      closedBy: currentUsername,
      tenders: { ...dayEndSummary.tenders },
      refundTenders: { ...dayEndSummary.refundTenders },
      expenseTenders: { ...dayEndSummary.expenseTenders },
      expenseCategories: { ...dayEndSummary.expenseCategories },
    }
    setDayEndReports((current) => [report, ...current])
    setClosedDaySaleIds((current) => [...current, ...dayEndSales.map((sale) => sale.id)])
    setClosedDayRefundIds((current) => [...current, ...dayEndRefunds.map((refund) => refund.id)])
    setClosedDayExpenseIds((current) => [...current, ...dayEndExpenses.map((expense) => expense.id)])
    setDayEndCashError('')
    setDayEndCashCount('')
    setNotice('Day closed · summary saved')
    setDayEndOpen(false)
    window.setTimeout(() => setNotice(''), 2600)
  }

  function reportTemplateHeader(title) {
    return (
      <header className="report-template-header">
        {companyDetails.logoDataUrl && <img alt="" src={companyDetails.logoDataUrl} />}
        <div>
          <h1>{companyDetails.name}</h1>
          {companyDetails.address && <p>{companyDetails.address}</p>}
          {companyDetails.phone && <p>{companyDetails.phone}</p>}
          {companyDetails.taxId && <p>Business / tax ID: {companyDetails.taxId}</p>}
        </div>
        <div className="report-print-date">
          <strong>{title}</strong>
          <span>{reportStartDate || reportEndDate ? `${reportStartDate || 'Beginning'} to ${reportEndDate || 'Today'}` : 'All recorded activity'}</span>
          <span>Printed {new Date().toLocaleString()}</span>
        </div>
      </header>
    )
  }

  function printDetailedReport(section) {
    const printClass = 'print-a4-report'
    const cleanup = () => {
      document.body.classList.remove(printClass)
      document.documentElement.classList.remove(printClass)
      delete document.body.dataset.reportPrint
      window.removeEventListener('afterprint', cleanup)
    }
    document.body.classList.add(printClass)
    document.documentElement.classList.add(printClass)
    if (section) document.body.dataset.reportPrint = section
    else delete document.body.dataset.reportPrint
    window.addEventListener('afterprint', cleanup, { once: true })
    window.print()
  }

  async function signIn(event) {
    event.preventDefault()
    if (loginLoading) return
    if (!supabase) {
      setLoginError('Supabase is not configured. Add the project URL and publishable key to .env.local, then restart the app.')
      return
    }
    setLoginError('')
    setLoginLoading(true)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginUsername.trim(),
        password: loginPassword,
      })
      if (error || !data.user) {
        setLoginError(error?.message ?? 'Supabase did not return a signed-in user.')
        return
      }
      setAuthUser(data.user)
      setIsAuthenticated(true)
      setCurrentUsername(data.user.email ?? data.user.id)
      setLoginPassword('')
      try {
        await loadShopState(data.user.id)
      } catch (loadError) {
        setSyncStatus('error')
        setSyncError(`Unable to load shop data from Supabase: ${loadError.message}`)
      }
    } catch (loadError) {
      setLoginError(`Unable to sign in to Supabase: ${loadError.message}`)
    } finally {
      setLoginLoading(false)
    }
  }

  async function signOut() {
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) {
      setSyncError(`Unable to sign out from Supabase: ${error.message}`)
      setSyncStatus('error')
      return
    }
    setLoginUsername('')
    setLoginPassword('')
    setLoginError('')
  }

  if (isAuthenticated && !shopReady && syncError) {
    return (
      <main className="auth-screen flex min-h-screen items-center justify-center px-4 py-8">
        <section aria-live="polite" className="w-full max-w-[520px] border border-[#777] bg-[#f8f8f6] p-6 text-[#222] shadow-2xl">
          <h1 className="text-xl font-bold">Unable to connect to your shop</h1>
          <p role="alert" className="mt-4 border border-[#e5aaaa] bg-[#fff0f0] p-3 text-sm font-semibold text-[#a51f1f]">{syncError}</p>
          <button className="touch-button gray mt-4 min-h-10 px-4 font-semibold" onClick={retryShopSync} type="button">Retry connection</button>
          <button className="touch-button gray mt-4 min-h-10 px-4 font-semibold" onClick={signOut} type="button">Sign out</button>
        </section>
      </main>
    )
  }

  if (!isAuthenticated || !shopReady) {
    return (
      <main className="auth-screen flex min-h-screen items-center justify-center px-4 py-8">
        <section aria-labelledby="login-title" className="w-full max-w-[400px]">
          <div className="mb-7 text-center">
            {companyDetails.logoDataUrl && <img alt={`${companyDetails.name} logo`} className="mx-auto mb-3 max-h-16 max-w-40 object-contain" src={companyDetails.logoDataUrl} />}
            <p className="text-xs font-bold uppercase tracking-[.2em] text-[#9a513c]">{companyDetails.name}</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#faf8f4]" id="login-title">Welcome back</h1>
            <p className="mt-2 text-sm text-[#d0ccc5]">Sign in to open the point of sale.</p>
          </div>
          <form className="space-y-4" onSubmit={signIn}>
            <label className="admin-field text-[#f1eee8]">Staff email
              <input autoComplete="username" autoFocus className="admin-input" disabled={!authReady || !supabase} onChange={(event) => { setLoginUsername(event.target.value); setLoginError('') }} placeholder="Enter your Supabase Auth email" required type="email" value={loginUsername} />
            </label>
            <label className="admin-field text-[#f1eee8]">Password
              <input autoComplete="current-password" className="admin-input" disabled={!authReady || !supabase} onChange={(event) => { setLoginPassword(event.target.value); setLoginError('') }} placeholder="Enter your password" required type="password" value={loginPassword} />
            </label>
            {loginError && <p aria-live="assertive" className="border border-[#e5aaaa] bg-[#fff0f0] p-3 text-sm font-semibold text-[#a51f1f]">{loginError}</p>}
            {!supabase && <p role="alert" className="border border-[#e5aaaa] bg-[#fff0f0] p-3 text-sm font-semibold text-[#a51f1f]">Supabase is not configured. Add the project URL and publishable key to .env.local, then restart the app.</p>}
            <button
              className="touch-button green flex min-h-12 w-full items-center justify-center gap-2 border-[#609e34] text-base font-bold disabled:opacity-50"
              disabled={!authReady || !supabase || loginLoading || (isAuthenticated && !shopReady)}
              type="submit"
            >
              {loginLoading || (isAuthenticated && !shopReady)
                ? <><span aria-hidden="true" className="h-5 w-5 animate-spin rounded-full border-2 border-current border-r-transparent" /><span>{isAuthenticated ? 'Loading shop...' : 'Signing in...'}</span></>
                : authReady ? 'Sign in' : 'Connecting...'}
            </button>
          </form>
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#e8e9e7] px-3 py-5 text-[#222] sm:px-6 sm:py-8">
      <section className="pos-shell mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-[1450px] flex-col border border-[#9c9c9c] bg-[#f8f8f6] shadow-[0_10px_34px_rgba(0,0,0,.16)] sm:min-h-[calc(100vh-4rem)]">
        <header className="pos-header flex h-9 shrink-0 items-center justify-between gap-3 border-b border-[#b9b9b9] bg-[#efefed] px-3 text-[11px] sm:px-4">
          <div className="flex min-w-0 items-center gap-3 whitespace-nowrap">
            <time className="font-medium" dateTime={currentDateTime.toISOString()}>
              {currentDateTime.toLocaleString('en-AU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
              })}
            </time>
            <span className="hidden text-[#737373] sm:inline">|</span>
            <span className="hidden font-semibold tracking-wide sm:inline">{currentUsername.toLocaleUpperCase()}</span>
            <span className="text-[#aaa]">|</span>
            <button className="touch-button gray max-w-[180px] truncate px-2 py-1 text-left text-[#555] hover:underline" onClick={() => runAction('Customer')} type="button">{selectedCustomer?.name ?? 'Cash Customer'}</button>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden border border-[#a8a8a8] bg-white px-2 py-0.5 sm:inline">Till 01</span>
            {(isShopStateDirty || syncStatus === 'saving') && syncStatus !== 'error' && syncStatus !== 'conflict' && (
              <span aria-label="Saving changes" className="inline-flex h-7 w-7 items-center justify-center text-[#8a6a12]" role="status" title="Saving changes">
                <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
                <span className="sr-only">Saving changes</span>
              </span>
            )}
            <button aria-label="Sign out" className="touch-button gray min-h-7 px-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50" disabled={syncStatus === 'saving' || (isShopStateDirty && syncStatus !== 'error' && syncStatus !== 'conflict')} onClick={signOut} title={isShopStateDirty ? 'Wait for shop changes to sync before signing out.' : undefined} type="button">Sign out</button>
          </div>
        </header>

        {(syncStatus === 'error' || syncStatus === 'conflict' || realtimeError) && (
          <div aria-live="polite" className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e5aaaa] bg-[#fff0f0] px-3 py-2 text-sm text-[#8e2727]">
            <span>{syncError || realtimeError}</span>
            {syncStatus === 'conflict' ? (
              <button className="touch-button yellow min-h-9 px-3 text-xs font-bold" onClick={retryShopSync} type="button">Reload latest data</button>
            ) : syncStatus === 'error' ? (
              <button className="touch-button gray min-h-9 px-3 text-xs font-bold" onClick={retryShopSync} type="button">Retry sync</button>
            ) : null}
          </div>
        )}

        <div className="pos-layout grid flex-1 gap-[3px] p-[3px]">
          <section className="left-panel grid min-h-0 gap-[3px]">
            <div className="receipt-wrap min-h-[250px] overflow-hidden border border-[#b1b1b1] bg-white">
              <div className="receipt-head grid grid-cols-[34px_minmax(0,1fr)_74px_69px_76px] border-b border-[#c9c9c9] bg-[#ededed] text-[11px] font-semibold">
                <span>No</span><span>Description</span><span className="text-right">Qty</span><span className="text-right">Price</span><span className="pr-1 text-right">Amount</span>
              </div>
              <div className="receipt-lines">
                {cart.length === 0 ? (
                  <div className="p-5 text-center text-[12px] text-[#777]">Sale is empty — select a product to begin</div>
                ) : cart.map((item, index) => (
                  <div className={`receipt-row grid grid-cols-[34px_minmax(0,1fr)_74px_69px_76px] text-[12px] ${index % 2 ? 'bg-[#f1f1f1]' : 'bg-white'}`} key={item.id}>
                    <span className="pl-1 text-[#666]">{index + 1}</span>
                    <span className="truncate font-medium">{item.name}</span>
                    <span className="text-right">{item.weight.toFixed(3)}kg</span>
                    <span className="text-right">{currency(item.price)}/kg</span>
                    <span className="pr-1 text-right">{currency(item.weight * item.price)}</span>
                  </div>
                ))}
              </div>
              <div className="receipt-scroll"><span /></div>
            </div>

            <div className="left-lower grid min-h-0 gap-[3px]">
              <div className="action-grid grid grid-cols-3 grid-rows-5 gap-[2px]">
                {actions.map((action) => (
                  <button
                    className={`touch-button action-button ${action.color} ${action.label === 'Advanced' ? 'col-span-2' : ''}`}
                    key={action.label}
                    onClick={() => runAction(action.label)}
                    type="button"
                  >
                    {action.label}
                  </button>
                ))}
              </div>

              <div className="sale-side">
                <div aria-label="Sale totals" className="totals">
                  <div className="flex justify-between"><span>Amount</span><span>{currency(subtotal)}</span></div>
                  <div className="flex justify-between"><span>Discount</span><span>-{currency(discountAmount)}</span></div>
                  <div className="flex justify-between"><span>Redeem</span><span>-{currency(redeemAmount)}</span></div>
                  <div className="flex justify-between"><span>Voucher</span><span>$0.00</span></div>
                  <div className="mt-1 flex justify-between border-t border-[#ddd] pt-1 text-[16px] font-bold text-[#c93333]"><span>Total</span><span>{currency(totalDue)}</span></div>
                  {taxRate > 0 && <div className="flex justify-between text-[10px] text-[#555]"><span>{taxInclusive ? `${companyDetails.taxName} included` : `${companyDetails.taxName} added`}</span><span>{currency(taxAmount)}</span></div>}
                  <div className="flex justify-between text-[10px] text-[#555]"><span>Total item(s)</span><span>{itemCount}</span></div>
                </div>
                <div aria-label="Payment summary" className="checkout-summary">
                  <div className="flex justify-between text-[11px]"><span>Payment</span><strong>CASH</strong></div>
                  <div className="flex justify-between text-[11px]"><span>Paid</span><strong>{currency(paidAmount)}</strong></div>
                  <div className="flex justify-between text-[11px]"><span>Receivable</span><strong>{currency(paymentBalance)}</strong></div>
                  <button className="pay-button touch-button green font-bold disabled:cursor-not-allowed disabled:opacity-50" disabled={!cart.length} onClick={openPayment} type="button">
                    {paidAmount ? 'CONTINUE PAYMENT' : 'PAY NOW'}
                    <span>{currency(paymentBalance)}</span>
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="right-panel flex min-h-0 flex-col gap-[3px]">
            <div className="product-grid grid min-h-0 flex-1 grid-cols-4 gap-[3px]">
              {visibleProducts.length ? visibleProducts.map((product) => (
                <button
                  className="product-tile group relative min-h-[76px] overflow-hidden border border-[#777] bg-[#773d31] text-left shadow-sm"
                  key={product.id}
                  onClick={() => addProduct(product)}
                  type="button"
                >
                  <img
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                    onError={(event) => { event.currentTarget.style.display = 'none' }}
                    src={product.imageDataUrl || `https://images.unsplash.com/${product.image}?auto=format&fit=crop&w=440&q=75`}
                  />
                  <span className="product-label absolute left-1 right-1 top-1 z-10 line-clamp-2 border border-[#777] bg-[#f6f6f2]/95 px-1 py-0.5 text-center text-[11px] font-bold leading-[1.1] text-[#303030] shadow-sm">{product.name}</span>
                  <span className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-black/5" />
                  <span className="absolute bottom-1 left-1 z-10 rounded-sm bg-black/55 px-1 text-[10px] font-semibold text-white">{stock[product.id].toFixed(1)} kg</span>
                  <span className="absolute bottom-1 right-1 z-10 rounded-sm bg-black/55 px-1 text-[10px] font-semibold text-white">{currency(product.price)}/kg</span>
                </button>
              )) : (
                <div className="col-span-4 flex items-center justify-center bg-[#eee] px-4 text-center text-sm text-[#777]">
                  {products.length ? 'No matching stock items' : 'No products yet. Create a category and products in Advanced tools to start selling.'}
                </div>
              )}
            </div>

            <div className="product-controls grid grid-cols-4 gap-[3px]">
              <div className="col-span-2 flex items-center border border-[#aaa] bg-[#dededc] px-3 text-[13px] font-bold">
                {searchOpen ? (
                  <input autoFocus className="w-full bg-transparent outline-none" onChange={(event) => setSearch(event.target.value)} placeholder="Search stock…" value={search} />
                ) : (
                  <span>{categoryName(category)}</span>
                )}
              </div>
              <button className="touch-button gray page-arrow" onClick={() => setPage((current) => Math.max(0, current - 1))} type="button" aria-label="Previous products">‹</button>
              <button className="touch-button gray page-arrow" onClick={() => setPage((current) => current + 1)} type="button" aria-label="Next products">›</button>
            </div>

            <div className="category-grid grid grid-cols-4 gap-[3px]">
              {categories.map((item) => (
                <button
                  className={`touch-button category-button ${item === category ? 'selected' : ''} category-${categoryClassName(item)}`}
                  key={item}
                  onClick={() => { setCategory(item); setSearch(''); setSearchOpen(false) }}
                  type="button"
                >
                  {item}
                </button>
              ))}
              <button className="touch-button gray page-arrow" onClick={() => setPage((current) => Math.max(0, current - 1))} type="button" aria-label="Previous category page">‹</button>
              <button className="touch-button gray page-arrow" onClick={() => setPage((current) => current + 1)} type="button" aria-label="Next category page">›</button>
            </div>
          </section>
        </div>
        <footer className="flex h-6 shrink-0 items-center justify-between border-t border-[#bcbcb9] bg-[#ececea] px-3 text-[10px] text-[#666]">
          <span>{companyDetails.name} POS&nbsp; · &nbsp;Register 01</span>
          <span>{new Date().toLocaleDateString('en-AU')}</span>
        </footer>
      </section>

      {notice && <div className="notice fixed bottom-5 left-1/2 z-50 -translate-x-1/2 border border-[#8b8b8b] bg-[#333] px-4 py-2 text-sm font-semibold text-white shadow-lg">{notice}</div>}

      {advancedPinOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
          onClick={() => setAdvancedPinOpen(false)}
        >
          <section
            aria-labelledby="advanced-pin-title"
            aria-modal="true"
            className="w-full max-w-[400px] border-2 border-[#555] bg-[#f2f2ef] p-5 shadow-2xl sm:p-6"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#666]">Supervisor access</p>
                <h2 className="mt-1 text-xl font-bold" id="advanced-pin-title">Enter PIN</h2>
                <p className="mt-1 text-sm text-[#666]">Enter the PIN to open Advanced tools.</p>
              </div>
              <button aria-label="Cancel PIN entry" className="touch-button red h-9 w-10 text-xl" onClick={() => setAdvancedPinOpen(false)} type="button">×</button>
            </div>
            <form className="space-y-4" onSubmit={unlockAdvanced}>
              <label className="admin-field">Supervisor PIN
                <input
                  aria-label="Supervisor PIN"
                  autoComplete="off"
                  autoFocus
                  className="admin-input text-center text-2xl font-bold tracking-[.45em]"
                  inputMode="numeric"
                  maxLength={4}
                  onChange={(event) => {
                    setAdvancedPin(event.target.value.replace(/\D/g, '').slice(0, 4))
                    setAdvancedPinError('')
                  }}
                  pattern="[0-9]{4}"
                  placeholder="••••"
                  required
                  type="password"
                  value={advancedPin}
                />
              </label>
              {advancedPinError && <p aria-live="assertive" className="border border-[#e5aaaa] bg-[#fff0f0] p-2 text-sm font-semibold text-[#a51f1f]">{advancedPinError}</p>}
              <p className="text-xs text-[#777]">Demo PIN guard only; this does not provide server-side security.</p>
              <div className="flex justify-end gap-2">
                <button className="touch-button gray min-h-11 px-4 font-semibold" onClick={() => setAdvancedPinOpen(false)} type="button">Cancel</button>
                <button className="touch-button green min-h-11 px-5 font-bold" type="submit">Unlock Advanced</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {recallOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-4" onClick={() => setRecallOpen(false)}>
          <section
            aria-label="Recall held order"
            aria-modal="true"
            className="payment-modal flex max-h-[min(760px,94vh)] w-full max-w-[680px] flex-col border-2 border-[#666] bg-[#f2f2ef] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="flex shrink-0 items-center justify-between border-b border-[#aaa] px-4 py-3 sm:px-5">
              <div>
                <h2 className="text-[18px] font-bold">Recall order</h2>
                <p className="text-[12px] text-[#666]">Select a held sale to continue where you left off.</p>
              </div>
              <button aria-label="Close recall orders" className="touch-button red h-9 w-10 text-lg" onClick={() => setRecallOpen(false)} type="button">×</button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {heldOrders.length ? (
                <div className="space-y-2">
                  {heldOrders.map((order) => {
                    const orderDiscount = Math.min(
                      order.subtotal,
                      order.discount.type === 'percent'
                        ? order.subtotal * order.discount.value / 100
                        : order.discount.value,
                    )
                    return (
                      <button
                        className="recall-order flex min-h-[88px] w-full items-center justify-between gap-3 border border-[#aaa] bg-white p-3 text-left hover:bg-[#f3f7ed]"
                        key={order.id}
                        onClick={() => recallHeldOrder(order)}
                        type="button"
                      >
                        <span className="min-w-0">
                          <strong className="block truncate">{order.customerName}</strong>
                          <span className="mt-1 block text-xs text-[#555]">Held {order.heldAt}</span>
                          <span className="mt-1 block truncate text-xs text-[#666]">
                            {order.items.length} item(s) · {order.items.map((item) => item.name).join(', ')}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <strong className="block text-lg">{currency(Math.max(0, order.subtotal - orderDiscount - (order.redeemedPoints ?? 0) / 100))}</strong>
                          <span className="mt-1 inline-block bg-[#86d943] px-3 py-1 text-xs font-bold">Recall</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="flex min-h-48 flex-col items-center justify-center border border-dashed border-[#aaa] bg-white p-6 text-center">
                  <strong className="text-lg">No held orders</strong>
                  <p className="mt-1 max-w-sm text-sm text-[#666]">Use Hold Order to save the current sale. It will appear here and can be recalled later.</p>
                </div>
              )}
              {heldOrders.length > 0 && cart.length > 0 && (
                <p className="mt-3 border border-[#e2ca79] bg-[#fff7dc] p-3 text-xs text-[#5c4b20]">
                  Your current sale will be held automatically when you recall another order, so no items are lost.
                </p>
              )}
            </div>
          </section>
        </div>
      )}

      {refundOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-3 sm:p-5" onClick={() => setRefundOpen(false)}>
          <section
            aria-label="Process sales refund"
            aria-modal="true"
            className="payment-modal flex max-h-[94dvh] w-full max-w-[900px] flex-col border-2 border-[#666] bg-[#f2f2ef] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="flex shrink-0 items-center justify-between border-b border-[#aaa] px-4 py-3 sm:px-5">
              <div>
                <h2 className="text-[18px] font-bold">Sales refund</h2>
                <p className="text-[12px] text-[#666]">Select a completed sale, then choose the items to refund.</p>
              </div>
              <button aria-label="Close refund dialog" className="touch-button red h-9 w-10 text-lg" onClick={() => setRefundOpen(false)} type="button">×</button>
            </header>

            <div className="refund-layout grid min-h-0 flex-1">
              <div className="refund-sales min-h-0 overflow-y-auto border-b border-[#bbb] bg-[#e9e9e6] p-3 sm:border-b-0 sm:border-r">
                <h3 className="mb-2 text-sm font-bold">Completed sales ({sales.length})</h3>
                {sales.length ? (
                  <>
                    <div className="space-y-2">
                    {sales.slice(getListPage('refund-sales', sales.length).start, getListPage('refund-sales', sales.length).end).map((sale) => {
                      const refundable = sale.items.some((item) => item.refundedQuantity < item.quantity - 1e-9)
                      const refunded = sale.refunds.reduce((total, refund) => total + refund.amount, 0)
                      return (
                        <button
                          className={`w-full border p-3 text-left ${selectedRefundSaleId === sale.id ? 'border-[#337d35] bg-[#e6f3dc]' : 'border-[#bbb] bg-white hover:bg-[#f7f7f4]'}`}
                          key={sale.id}
                          onClick={() => selectRefundSale(sale)}
                          type="button"
                        >
                          <span className="flex items-center justify-between gap-2"><strong>{sale.number}</strong><span className={`text-[11px] font-bold ${refundable ? 'text-[#315e25]' : 'text-[#8e3428]'}`}>{refundable ? 'Refund available' : 'Fully refunded'}</span></span>
                          <span className="mt-1 block text-xs text-[#555]">{sale.createdAt}</span>
                          <span className="mt-1 block truncate text-xs text-[#555]">{sale.customer} · {sale.method}</span>
                          <span className="mt-2 flex justify-between border-t border-[#ddd] pt-2 text-sm"><span>Total {currency(sale.total)}</span><strong>{refunded ? `${currency(refunded)} refunded` : 'No refunds'}</strong></span>
                        </button>
                      )
                    })}
                    </div>
                    {renderPagination('refund-sales', sales.length, 'completed sales')}
                  </>
                ) : (
                  <p className="border border-dashed border-[#aaa] bg-white p-4 text-sm text-[#666]">There are no completed sales to refund yet. Complete a sale first, then select it here.</p>
                )}
              </div>

              <div className="refund-details min-h-0 overflow-y-auto p-3 sm:p-5">
                {selectedRefundSale ? (
                  <form className="space-y-4" onSubmit={processRefund}>
                    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#ccc] pb-3">
                      <div><h3 className="font-bold">{selectedRefundSale.number}</h3><p className="text-xs text-[#666]">{selectedRefundSale.customer} · {selectedRefundSale.createdAt}</p></div>
                      <div className="text-right text-sm"><span className="block text-xs text-[#666]">Original total</span><strong>{currency(selectedRefundSale.total)}</strong></div>
                    </div>

                    <div className="overflow-x-auto border border-[#bbb] bg-white">
                      <table className="admin-table w-full text-left text-sm">
                        <thead className="bg-[#e9e9e6]"><tr><th>Item</th><th className="text-right">Sold</th><th className="text-right">Available</th><th className="text-right">Refund qty (kg)</th></tr></thead>
                        <tbody>{selectedRefundSale.items.map((item) => {
                          const available = Math.max(0, item.quantity - item.refundedQuantity)
                          return (
                            <tr className="border-t border-[#ddd]" key={item.id}>
                              <td><strong className="block">{item.name}</strong><span className="text-xs text-[#666]">{currency(item.price)}/kg</span></td>
                              <td className="text-right">{item.quantity.toFixed(3)} kg</td>
                              <td className="text-right">{available.toFixed(3)} kg</td>
                              <td className="text-right">
                                <input
                                  aria-label={`Refund quantity for ${item.name}`}
                                  className="w-24 border border-[#aaa] px-2 py-2 text-right"
                                  max={available}
                                  min="0"
                                  onChange={(event) => setRefundQuantities((current) => ({ ...current, [item.id]: event.target.value }))}
                                  step="0.001"
                                  type="number"
                                  value={refundQuantities[item.id] ?? '0'}
                                />
                              </td>
                            </tr>
                          )
                        })}</tbody>
                      </table>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="admin-field">Refund reason
                        <select className="admin-input" onChange={(event) => setRefundReason(event.target.value)} value={refundReason}>
                          {['Customer return', 'Incorrect item', 'Quality issue', 'Overcharge', 'Other'].map((reason) => <option key={reason}>{reason}</option>)}
                        </select>
                      </label>
                      <label className="admin-field">Refund method
                        <select className="admin-input" onChange={(event) => setRefundMethod(event.target.value)} value={refundMethod}>
                          {paymentMethods.map((method) => <option key={method}>{method}</option>)}
                        </select>
                      </label>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#bbb] pt-3">
                      <div><span className="block text-xs text-[#666]">Refund amount</span><strong className="text-xl text-[#c93333]">{currency(refundTotal)}</strong></div>
                      <button className="touch-button red min-h-12 px-5 font-bold disabled:cursor-not-allowed disabled:opacity-50" disabled={refundTotal <= 0} type="submit">Confirm refund</button>
                    </div>
                  </form>
                ) : (
                  <div className="flex h-full min-h-40 items-center justify-center border border-dashed border-[#bbb] bg-white p-6 text-center text-sm text-[#666]">Select a completed sale to review refundable items.</div>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {customerOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-4" onClick={() => setCustomerOpen(false)}>
          <section
            aria-label="Select sale customer"
            aria-modal="true"
            className="payment-modal flex max-h-[min(760px,94vh)] w-full max-w-[620px] flex-col border-2 border-[#666] bg-[#f2f2ef] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-[#aaa] px-4 py-3">
              <div>
                <h2 className="text-[17px] font-bold">Select customer</h2>
                <p className="text-[12px] text-[#666]">Link this sale to a customer account.</p>
              </div>
              <button aria-label="Close customer dialog" className="touch-button red h-9 w-10 text-lg" onClick={() => setCustomerOpen(false)} type="button">×</button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {customerCreateOpen ? (
                <form className="grid gap-3 border border-[#bbb] bg-white p-4" onSubmit={saveCustomer}>
                  <h3 className="font-bold">Add customer</h3>
                  <label className="admin-field">Customer type
                    <select className="admin-input" onChange={(event) => setNewCustomer((current) => ({ ...current, type: event.target.value }))} value={newCustomer.type}>
                      <option value="person">Individual</option>
                      <option value="business">Business</option>
                    </select>
                  </label>
                  {newCustomer.type === 'business' ? (
                    <>
                      <label className="admin-field">Business name
                        <input autoFocus autoComplete="organization" className="admin-input" onChange={(event) => setNewCustomer((current) => ({ ...current, companyName: event.target.value }))} placeholder="Registered business name" required value={newCustomer.companyName} />
                      </label>
                      <label className="admin-field">Contact person
                        <input autoComplete="name" className="admin-input" onChange={(event) => setNewCustomer((current) => ({ ...current, contactName: event.target.value }))} placeholder="Primary contact name" required value={newCustomer.contactName} />
                      </label>
                      <label className="admin-field">ABN / Tax ID <span className="font-normal text-[#666]">(optional)</span>
                        <input className="admin-input" onChange={(event) => setNewCustomer((current) => ({ ...current, taxId: event.target.value }))} placeholder="Business registration number" value={newCustomer.taxId} />
                      </label>
                    </>
                  ) : (
                    <label className="admin-field">Full name
                      <input autoFocus autoComplete="name" className="admin-input" onChange={(event) => setNewCustomer((current) => ({ ...current, name: event.target.value }))} placeholder="Customer name" required value={newCustomer.name} />
                    </label>
                  )}
                  <label className="admin-field">Phone number
                    <input autoComplete="tel" className="admin-input" onChange={(event) => setNewCustomer((current) => ({ ...current, phone: event.target.value }))} placeholder="Optional if email is provided" type="tel" value={newCustomer.phone} />
                  </label>
                  <label className="admin-field">Email address
                    <input autoComplete="email" className="admin-input" onChange={(event) => setNewCustomer((current) => ({ ...current, email: event.target.value }))} placeholder="Optional if phone is provided" type="email" value={newCustomer.email} />
                  </label>
                  <p className="text-xs text-[#666]">Enter a phone number or email address so the customer can be found again.</p>
                  <div className="flex justify-end gap-2">
                    <button className="touch-button gray min-h-10 px-4 font-semibold" onClick={() => setCustomerCreateOpen(false)} type="button">Cancel</button>
                    <button className="touch-button green min-h-10 px-5 font-bold" type="submit">Save &amp; select</button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap gap-2">
                    <input
                      aria-label="Search customers"
                      autoFocus
                      className="admin-input min-w-[180px] flex-1"
                      onChange={(event) => { setCustomerSearch(event.target.value); changeListPage('customers', 0) }}
                      placeholder="Search name, phone or email"
                      type="search"
                      value={customerSearch}
                    />
                    <button className="touch-button green min-h-11 px-4 font-bold" onClick={() => setCustomerCreateOpen(true)} type="button">＋ New customer</button>
                  </div>
                  <button className="mb-3 flex min-h-14 w-full items-center justify-between border border-[#aaa] bg-[#e7f1fb] px-3 text-left hover:bg-[#dceafa]" onClick={() => selectCustomer(null)} type="button">
                    <span><strong className="block">Cash Customer</strong><span className="text-xs text-[#666]">Do not link this sale to a customer</span></span>
                    <span className="text-sm font-bold">{selectedCustomerId === null ? 'Current' : 'Select'}</span>
                  </button>
                  <div className="space-y-2">
                    {matchingCustomers.length ? matchingCustomers.slice(getListPage('customers', matchingCustomers.length).start, getListPage('customers', matchingCustomers.length).end).map((customer) => (
                      <button className="flex min-h-[68px] w-full items-center justify-between gap-3 border border-[#bbb] bg-white px-3 py-2 text-left hover:bg-[#f3f7ed]" key={customer.id} onClick={() => selectCustomer(customer)} type="button">
                        <span className="min-w-0">
                          <strong className="block truncate">{customer.name}</strong>
                          {customer.type === 'business' && <span className="block truncate text-xs font-semibold text-[#7c493b]">Business · {customer.contactName}</span>}
                          {customer.type === 'business' && customer.taxId && <span className="block truncate text-xs text-[#777]">ABN / Tax ID: {customer.taxId}</span>}
                          <span className="block truncate text-xs text-[#555]">{customer.phone || customer.email}</span>
                          {customer.phone && customer.email && <span className="block truncate text-xs text-[#777]">{customer.email}</span>}
                        </span>
                        <span className="shrink-0 text-right">
                          <strong className="block text-sm">{customer.points} pts</strong>
                          <span className="text-xs text-[#666]">{selectedCustomerId === customer.id ? 'Current' : 'Select'}</span>
                        </span>
                      </button>
                    )) : (
                      <p className="border border-dashed border-[#bbb] bg-white p-4 text-center text-sm text-[#666]">No customers found. Add a customer to continue.</p>
                    )}
                    {renderPagination('customers', matchingCustomers.length, 'customers')}
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      )}

      {discountOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-4" onClick={() => setDiscountOpen(false)}>
          <section
            aria-label="Apply sale discount"
            aria-modal="true"
            className="payment-modal w-full max-w-[460px] border-2 border-[#666] bg-[#f2f2ef] p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="mb-3 flex items-center justify-between border-b border-[#aaa] pb-2">
              <div>
                <h2 className="text-[17px] font-bold">Sale discount</h2>
                <p className="text-[12px] text-[#666]">Apply a discount to the whole sale.</p>
              </div>
              <button aria-label="Close discount dialog" className="touch-button red h-8 w-9" onClick={() => setDiscountOpen(false)} type="button">×</button>
            </div>
            <form onSubmit={applyDiscount}>
              <div className="mb-3 grid grid-cols-2 gap-[3px]">
                <button
                  aria-pressed={discountDraft.type === 'percent'}
                  className={`touch-button h-11 font-bold ${discountDraft.type === 'percent' ? 'green' : 'gray'}`}
                  onClick={() => setDiscountDraft((current) => ({ ...current, type: 'percent' }))}
                  type="button"
                >
                  Percentage
                </button>
                <button
                  aria-pressed={discountDraft.type === 'amount'}
                  className={`touch-button h-11 font-bold ${discountDraft.type === 'amount' ? 'green' : 'gray'}`}
                  onClick={() => setDiscountDraft((current) => ({ ...current, type: 'amount' }))}
                  type="button"
                >
                  Fixed amount
                </button>
              </div>
              <label className="admin-field">
                {discountDraft.type === 'percent' ? 'Discount percentage' : 'Discount amount'}
                <div className="relative">
                  <input
                    autoFocus
                    className="admin-input pr-12 text-right text-lg font-bold"
                    max={discountDraft.type === 'percent' ? 100 : subtotal}
                    min="0"
                    onChange={(event) => setDiscountDraft((current) => ({ ...current, value: event.target.value }))}
                    required
                    step={discountDraft.type === 'percent' ? '0.1' : '0.01'}
                    type="number"
                    value={discountDraft.value}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 font-bold text-[#555]">{discountDraft.type === 'percent' ? '%' : '$'}</span>
                </div>
              </label>
              <div className="mt-3 flex justify-between border border-[#bbb] bg-white px-3 py-2 text-sm">
                <span>Sale total after discount</span>
                <strong>{currency(Math.max(0, subtotal - (discountDraft.type === 'percent' ? subtotal * (Number(discountDraft.value) || 0) / 100 : Number(discountDraft.value) || 0)))}</strong>
              </div>
              <p className="mt-2 text-[12px] text-[#666]">
                {discountDraft.type === 'percent' ? 'Enter a value from 0 to 100%.' : `Enter an amount from $0.00 to ${currency(subtotal)}.`}
              </p>
              <div className="mt-4 flex justify-between gap-2">
                <button className="touch-button gray min-h-11 px-4 font-semibold" onClick={() => { setDiscount({ type: 'percent', value: 0 }); setDiscountOpen(false) }} type="button">Remove discount</button>
                <button className="touch-button green min-h-11 px-5 font-bold" type="submit">Apply discount</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {redeemOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-4" onClick={() => setRedeemOpen(false)}>
          <section
            aria-label="Redeem loyalty points"
            aria-modal="true"
            className="payment-modal w-full max-w-[460px] border-2 border-[#666] bg-[#f2f2ef] p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="mb-3 flex items-center justify-between border-b border-[#aaa] pb-2">
              <div>
                <h2 className="text-[17px] font-bold">Redeem loyalty points</h2>
                <p className="text-[12px] text-[#666]">{selectedCustomer?.name} · 100 points = $1.00</p>
              </div>
              <button aria-label="Close points dialog" className="touch-button red h-8 w-9" onClick={() => setRedeemOpen(false)} type="button">×</button>
            </div>
            <form onSubmit={applyPointRedemption}>
              <div className="mb-3 grid grid-cols-2 gap-3 border border-[#bbb] bg-white p-3 text-sm">
                <div><span className="block text-[#666]">Available points</span><strong className="text-lg">{selectedCustomer?.points ?? 0}</strong></div>
                <div className="text-right"><span className="block text-[#666]">Sale after discount</span><strong className="text-lg">{currency(Math.max(0, subtotal - discountAmount))}</strong></div>
              </div>
              <label className="admin-field">Points to redeem
                <input
                  aria-label="Points to redeem"
                  autoFocus
                  className="admin-input text-right text-lg font-bold"
                  max={Math.floor(Math.min(selectedCustomer?.points ?? 0, Math.max(0, redeemableTotal) * 100) / 100) * 100}
                  min="100"
                  onChange={(event) => { setRedeemDraft(event.target.value); setRedeemError('') }}
                  placeholder="e.g. 500"
                  required
                  step="100"
                  type="number"
                  value={redeemDraft}
                />
              </label>
              <p className="mt-2 text-xs text-[#666]">Redeem in 100-point increments. Points are deducted now and restored if this sale is voided.</p>
              {redeemError && <p aria-live="assertive" className="mt-3 border border-[#e5aaaa] bg-[#fff0f0] p-2 text-sm font-semibold text-[#a51f1f]">{redeemError}</p>}
              <div className="mt-4 flex justify-end gap-2">
                <button className="touch-button gray min-h-11 px-4 font-semibold" onClick={() => setRedeemOpen(false)} type="button">Cancel</button>
                <button className="touch-button green min-h-11 px-5 font-bold" type="submit">Redeem points</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {advancedOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-3 sm:p-6" onClick={() => setAdvancedOpen(false)}>
          <section
            aria-label="Advanced admin menu"
            aria-modal="true"
            className="admin-menu flex max-h-[min(900px,94vh)] w-full max-w-[1100px] flex-col overflow-hidden border-2 border-[#555] bg-[#f2f2ef] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="flex shrink-0 items-center justify-between border-b border-[#aaa] bg-[#e8e8e5] px-4 py-3 sm:px-6">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#666]">Supervisor tools</p>
                <h2 className="text-xl font-bold">Advanced menu</h2>
              </div>
              <button aria-label="Close advanced menu" className="touch-button red h-10 w-11 text-xl" onClick={() => setAdvancedOpen(false)} type="button">×</button>
            </header>
            <div className="admin-content grid min-h-0 flex-1">
              <nav aria-label="Admin sections" className="admin-nav flex gap-2 overflow-x-auto border-b border-[#bbb] bg-[#e9e9e6] p-2 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r sm:p-3">
                {['Overview', 'Products', 'Categories', 'Customers', 'Payment methods', 'Users', 'Activity log', 'Company details', 'Receive stock', 'Processing', 'Stock on hand', 'Adjust & waste', 'Stocktake', 'Reports'].map((item) => (
                  <button
                    className={`admin-nav-button shrink-0 border px-3 py-3 text-left text-sm font-bold ${advancedView === item ? 'border-[#337d35] bg-[#86d943]' : 'border-[#bbb] bg-white hover:bg-[#f4f4f2]'}`}
                    key={item}
                    onClick={() => {
                      setAdvancedView(item)
                      if (item === 'Users' && staffRole === 'admin') refreshStaffAccounts()
                    }}
                    type="button"
                  >
                    {item}
                  </button>
                ))}
              </nav>
              <div className="admin-view min-h-0 overflow-y-auto p-4 sm:p-6">
                {advancedView === 'Overview' && (
                  <div>
                    <h3 className="mb-1 text-xl font-bold">Store operations</h3>
                    <p className="mb-5 text-sm text-[#666]">Manage stock and review activity for this register.</p>
                    <div className="admin-stats grid grid-cols-2 gap-3 lg:grid-cols-3">
                      <div className="border border-[#bbb] bg-white p-4"><span className="text-sm text-[#666]">Stock on hand</span><strong className="mt-1 block text-2xl">{totalStockWeight.toFixed(3)} kg</strong></div>
                      <div className="border border-[#bbb] bg-white p-4"><span className="text-sm text-[#666]">Products in stock</span><strong className="mt-1 block text-2xl">{inStockCount} / {products.length}</strong></div>
                      <div className="col-span-2 border border-[#bbb] bg-white p-4 lg:col-span-1"><span className="text-sm text-[#666]">Deliveries today</span><strong className="mt-1 block text-2xl">{stockReceipts.length}</strong></div>
                    </div>
                    <div className="mt-6 flex flex-wrap gap-3">
                      <button className="touch-button green min-h-12 px-5 text-sm font-bold" onClick={() => setAdvancedView('Products')} type="button">＋ Manage products</button>
                      <button className="touch-button blue min-h-12 px-5 text-sm font-bold" onClick={() => setAdvancedView('Categories')} type="button">＋ Manage categories</button>
                      <button className="touch-button green min-h-12 px-5 text-sm font-bold" onClick={() => setAdvancedView('Receive stock')} type="button">＋ Receive a delivery</button>
                      <button className="touch-button yellow min-h-12 px-5 text-sm font-bold" onClick={() => setAdvancedView('Processing')} type="button">＋ Process stock</button>
                      <button className="touch-button blue min-h-12 px-5 text-sm font-bold" onClick={() => setAdvancedView('Stock on hand')} type="button">View inventory</button>
                      <button className="touch-button red min-h-12 px-5 text-sm font-bold" onClick={() => setAdvancedView('Adjust & waste')} type="button">Adjust stock / record waste</button>
                      <button className="touch-button yellow min-h-12 px-5 text-sm font-bold" onClick={() => setAdvancedView('Stocktake')} type="button">Adjust stock count</button>
                    </div>
                    <div className="mt-7">
                      <h4 className="mb-2 font-bold">Recent deliveries</h4>
                      {stockReceipts.length ? (
                        <div className="overflow-x-auto border border-[#bbb] bg-white">
                          <table className="admin-table w-full text-left text-sm">
                            <thead className="bg-[#e9e9e6]"><tr><th>Received</th><th>Product</th><th>Supplier</th><th className="text-right">Quantity</th></tr></thead>
                            <tbody>{stockReceipts.slice(0, 5).map((item) => <tr className="border-t border-[#ddd]" key={item.id}><td>{item.receivedAt}</td><td>{item.product}</td><td>{item.supplier}</td><td className="text-right">{item.quantity.toFixed(3)} kg</td></tr>)}</tbody>
                          </table>
                        </div>
                      ) : <p className="border border-dashed border-[#bbb] bg-white p-4 text-sm text-[#666]">No deliveries received yet. Receive a delivery to add stock to inventory.</p>}
                    </div>
                  </div>
                )}

                {advancedView === 'Products' && (
                  <div>
                    <h3 className="mb-1 text-xl font-bold">Product catalogue</h3>
                    <p className="mb-5 text-sm text-[#666]">Create products for the POS and manage items currently in the catalogue.</p>
                    {!categories.length && <button className="touch-button blue mb-4 min-h-10 px-4 text-sm font-bold" onClick={() => setAdvancedView('Categories')} type="button">Create a category first</button>}
                    <form className="mb-6 grid gap-3 border border-[#bbb] bg-white p-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={createProduct}>
                      <label className="admin-field sm:col-span-2">Product name
                        <input autoComplete="off" className="admin-input" maxLength="60" onChange={(event) => { setNewProduct((current) => ({ ...current, name: event.target.value })); setProductFormError('') }} placeholder="e.g. Pork Sausage" required value={newProduct.name} />
                      </label>
                      <label className="admin-field">Category
                        <select className="admin-input" onChange={(event) => setNewProduct((current) => ({ ...current, category: event.target.value }))} required value={newProduct.category}>
                          <option disabled value="">Select a category</option>
                          {categories.map((item) => <option key={item} value={item}>{categoryName(item)}</option>)}
                        </select>
                      </label>
                      <label className="admin-field">Price per kg
                        <input className="admin-input" min="0.01" onChange={(event) => { setNewProduct((current) => ({ ...current, price: event.target.value })); setProductFormError('') }} placeholder="e.g. 14.99" required step="0.01" type="number" value={newProduct.price} />
                      </label>
                      <label className="admin-field">Starting stock (kg)
                        <input className="admin-input" min="0" onChange={(event) => { setNewProduct((current) => ({ ...current, initialStock: event.target.value })); setProductFormError('') }} placeholder="Optional, defaults to 0" step="0.001" type="number" value={newProduct.initialStock} />
                      </label>
                      <label className="admin-field sm:col-span-2 lg:col-span-2">Product image (optional)
                        <input
                          accept="image/*"
                          aria-label="Product image"
                          className="admin-input h-auto min-h-11"
                          onChange={(event) => selectProductImage(event.target.files?.[0])}
                          type="file"
                        />
                      </label>
                      <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-2">
                        {newProduct.imageDataUrl && (
                          <>
                            <img alt="Product image preview" className="h-16 w-16 border border-[#aaa] object-cover" src={newProduct.imageDataUrl} />
                            <button className="touch-button gray min-h-9 px-3 text-sm font-semibold" onClick={() => { setNewProduct((current) => ({ ...current, imageDataUrl: '' })); setProductFormError('') }} type="button">Remove image</button>
                          </>
                        )}
                      </div>
                      <div className="flex items-end sm:col-span-2 lg:col-span-4">
                        <button className="touch-button green min-h-11 w-full px-5 font-bold sm:w-auto" type="submit">＋ Create product</button>
                      </div>
                      {productFormError && <p aria-live="assertive" className="border border-[#e5aaaa] bg-[#fff0f0] p-2 text-sm font-semibold text-[#a51f1f] sm:col-span-2 lg:col-span-4">{productFormError}</p>}
                    </form>

                    <div className="overflow-x-auto border border-[#bbb] bg-white">
                      <table className="admin-table w-full text-left text-sm">
                        <thead className="bg-[#e9e9e6]"><tr><th>Product</th><th>Category</th><th className="text-right">Price / kg</th><th className="text-right">On hand</th><th className="text-right">Action</th></tr></thead>
                        <tbody>{products.slice(getListPage('product-catalogue', products.length).start, getListPage('product-catalogue', products.length).end).map((product) => {
                          const protectedByCurrentSale = cart.some((item) => item.id === product.id || item.name === product.name)
                          const protectedByHeldSale = heldOrders.some((order) => order.items.some((item) => item.id === product.id || item.name === product.name))
                          const protectedByCompletedSale = sales.some((sale) => sale.items.some((item) => item.productId === product.id || item.name === product.name))
                          const protectedByInventoryHistory = inventoryMovements.some((movement) => movement.productId === product.id)
                          const cannotDelete = protectedByCurrentSale || protectedByHeldSale || protectedByCompletedSale || protectedByInventoryHistory || products.length === 1
                          if (editingProductId === product.id && productEditDraft) {
                            return (
                              <tr className="border-t border-[#bbb] bg-[#f7f8f3]" key={product.id}>
                                <td className="p-3" colSpan="5">
                                  <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(event) => saveProductEdit(event, product)}>
                                    <label className="admin-field sm:col-span-2">Product name
                                      <input autoFocus className="admin-input" maxLength="60" onChange={(event) => { setProductEditDraft((current) => ({ ...current, name: event.target.value })); setProductEditError('') }} required value={productEditDraft.name} />
                                    </label>
                                    <label className="admin-field">Category
                                      <select className="admin-input" onChange={(event) => setProductEditDraft((current) => ({ ...current, category: event.target.value }))} value={productEditDraft.category}>
                                        {categories.map((item) => <option key={item} value={item}>{categoryName(item)}</option>)}
                                      </select>
                                    </label>
                                    <label className="admin-field">Price per kg
                                      <input className="admin-input" min="0.01" onChange={(event) => { setProductEditDraft((current) => ({ ...current, price: event.target.value })); setProductEditError('') }} required step="0.01" type="number" value={productEditDraft.price} />
                                    </label>
                                    <label className="admin-field sm:col-span-2">Replace product image (optional)
                                      <input accept="image/*" aria-label={`Replace ${product.name} image`} className="admin-input h-auto min-h-11" onChange={(event) => selectProductEditImage(event.target.files?.[0])} type="file" />
                                    </label>
                                    <div className="flex items-center gap-3 sm:col-span-2">
                                      {productEditDraft.imageDataUrl && <img alt={`${productEditDraft.name} image preview`} className="h-14 w-14 border border-[#aaa] object-cover" src={productEditDraft.imageDataUrl} />}
                                      {productEditDraft.imageDataUrl && <button className="touch-button gray min-h-9 px-3 text-sm font-semibold" onClick={() => setProductEditDraft((current) => ({ ...current, imageDataUrl: '' }))} type="button">Remove custom image</button>}
                                    </div>
                                    {productEditError && <p aria-live="assertive" className="border border-[#e5aaaa] bg-[#fff0f0] p-2 text-sm font-semibold text-[#a51f1f] sm:col-span-2 lg:col-span-4">{productEditError}</p>}
                                    <div className="flex justify-end gap-2 sm:col-span-2 lg:col-span-4">
                                      <button className="touch-button gray min-h-10 px-4 font-semibold" onClick={() => { setEditingProductId(null); setProductEditDraft(null); setProductEditError('') }} type="button">Cancel</button>
                                      <button className="touch-button green min-h-10 px-4 font-bold" type="submit">Save product</button>
                                    </div>
                                  </form>
                                </td>
                              </tr>
                            )
                          }
                          return (
                            <tr className="border-t border-[#ddd]" key={product.id}>
                              <td className="font-semibold">{product.name}</td>
                              <td>{categoryName(product.category)}</td>
                              <td className="text-right">{currency(product.price)}</td>
                              <td className="text-right">{(stock[product.id] ?? 0).toFixed(3)} kg</td>
                              <td className="text-right">
                                {productToDelete === product.id ? (
                                  <span className="inline-flex items-center gap-1">
                                    <button className="touch-button red min-h-9 px-2 text-xs font-bold" onClick={() => deleteProduct(product)} type="button">Confirm</button>
                                    <button className="touch-button gray min-h-9 px-2 text-xs font-bold" onClick={() => setProductToDelete(null)} type="button">Cancel</button>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1">
                                    <button aria-label={`Edit ${product.name}`} className="touch-button blue min-h-9 px-3 text-xs font-bold" onClick={() => beginProductEdit(product)} type="button">Edit</button>
                                    <button
                                      aria-label={`Delete ${product.name}`}
                                      className="touch-button red min-h-9 px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-45"
                                      disabled={cannotDelete}
                                      onClick={() => setProductToDelete(product.id)}
                                      title={cannotDelete ? 'This product is used by a sale, has inventory movement history, or is the last product in the catalogue.' : 'Remove this product from the catalogue.'}
                                      type="button"
                                    >
                                      Delete
                                    </button>
                                  </span>
                                )}
                              </td>
                            </tr>
                          )
                        })}</tbody>
                      </table>
                    </div>
                    {renderPagination('product-catalogue', products.length, 'products')}
                    <p className="mt-2 text-xs text-[#666]">Products used in active, held, or completed sales cannot be deleted. At least one catalogue product must remain. Deleting an unused product also removes its stock count.</p>
                  </div>
                )}

                {advancedView === 'Customers' && (
                  <div>
                    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <h3 className="mb-1 text-xl font-bold">Customer management</h3>
                        <p className="text-sm text-[#666]">Manage individual and business accounts, contact details, loyalty points, and customer purchase summaries.</p>
                      </div>
                      {!customerAdminDraft && (
                        <button
                          className="touch-button green min-h-11 px-5 font-bold"
                          onClick={() => {
                            setCustomerAdminDraft({ ...emptyNewCustomer, id: null, points: 0 })
                            setCustomerAdminError('')
                            setCustomerAdminNotice('')
                          }}
                          type="button"
                        >＋ Add customer</button>
                      )}
                    </div>
                    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
                      <div className="border border-[#bbb] bg-white p-3"><span className="text-xs text-[#666]">Total customers</span><strong className="mt-1 block text-2xl">{customers.length}</strong></div>
                      <div className="border border-[#bbb] bg-white p-3"><span className="text-xs text-[#666]">Business accounts</span><strong className="mt-1 block text-2xl">{customers.filter((customer) => customer.type === 'business').length}</strong></div>
                      <div className="col-span-2 border border-[#bbb] bg-white p-3 lg:col-span-1"><span className="text-xs text-[#666]">Loyalty points outstanding</span><strong className="mt-1 block text-2xl">{customers.reduce((total, customer) => total + (Number(customer.points) || 0), 0).toLocaleString()}</strong></div>
                    </div>
                    {customerAdminNotice && <p aria-live="polite" className="mb-3 border border-[#a8c99a] bg-[#eef8e9] p-3 text-sm font-semibold text-[#315e25]">{customerAdminNotice}</p>}
                    {customerAdminDraft && (
                      <form className="mb-5 grid gap-3 border border-[#bbb] bg-white p-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={saveCustomerAdmin}>
                        <h4 className="font-bold sm:col-span-2 lg:col-span-3">{customerAdminDraft.id == null ? 'Create customer' : `Edit ${customerAdminDraft.name}`}</h4>
                        <label className="admin-field">Customer type
                          <select
                            className="admin-input"
                            onChange={(event) => setCustomerAdminDraft((current) => ({
                              ...current,
                              type: event.target.value,
                              companyName: event.target.value === 'business'
                                ? current.type === 'person' ? current.name : current.companyName
                                : current.companyName,
                              name: event.target.value === 'person'
                                ? current.type === 'business' ? current.companyName : current.name
                                : current.name,
                            }))}
                            value={customerAdminDraft.type}
                          >
                            <option value="person">Individual</option>
                            <option value="business">Business</option>
                          </select>
                        </label>
                        {customerAdminDraft.type === 'business' ? (
                          <>
                            <label className="admin-field">Business name
                              <input autoFocus className="admin-input" maxLength="100" onChange={(event) => setCustomerAdminDraft((current) => ({ ...current, companyName: event.target.value }))} required value={customerAdminDraft.companyName} />
                            </label>
                            <label className="admin-field">Contact person
                              <input className="admin-input" maxLength="100" onChange={(event) => setCustomerAdminDraft((current) => ({ ...current, contactName: event.target.value }))} required value={customerAdminDraft.contactName} />
                            </label>
                          </>
                        ) : (
                          <label className="admin-field sm:col-span-2">Full name
                            <input autoFocus className="admin-input" maxLength="100" onChange={(event) => setCustomerAdminDraft((current) => ({ ...current, name: event.target.value }))} required value={customerAdminDraft.name} />
                          </label>
                        )}
                        <label className="admin-field">Phone number
                          <input autoComplete="tel" className="admin-input" onChange={(event) => setCustomerAdminDraft((current) => ({ ...current, phone: event.target.value }))} type="tel" value={customerAdminDraft.phone} />
                        </label>
                        <label className="admin-field">Email address
                          <input autoComplete="email" className="admin-input" onChange={(event) => setCustomerAdminDraft((current) => ({ ...current, email: event.target.value }))} type="email" value={customerAdminDraft.email} />
                        </label>
                        {customerAdminDraft.type === 'business' && (
                          <label className="admin-field">ABN / Tax ID
                            <input className="admin-input" onChange={(event) => setCustomerAdminDraft((current) => ({ ...current, taxId: event.target.value }))} value={customerAdminDraft.taxId} />
                          </label>
                        )}
                        <p className="text-xs text-[#666] sm:col-span-2 lg:col-span-3">Provide at least one contact method (phone or email). Existing loyalty points are preserved when profile details are edited.</p>
                        {customerAdminError && <p aria-live="assertive" className="border border-[#e5aaaa] bg-[#fff0f0] p-3 text-sm font-semibold text-[#a51f1f] sm:col-span-2 lg:col-span-3">{customerAdminError}</p>}
                        <div className="flex justify-end gap-2 sm:col-span-2 lg:col-span-3">
                          <button className="touch-button gray min-h-10 px-4 font-semibold" onClick={() => { setCustomerAdminDraft(null); setCustomerAdminError('') }} type="button">Cancel</button>
                          <button className="touch-button green min-h-10 px-5 font-bold" type="submit">{customerAdminDraft.id == null ? 'Create customer' : 'Save changes'}</button>
                        </div>
                      </form>
                    )}
                    <div className="mb-3 flex flex-wrap gap-2">
                      <input
                        aria-label="Search customers"
                        className="admin-input min-w-[200px] flex-1"
                        onChange={(event) => {
                          setCustomerAdminSearch(event.target.value)
                          changeListPage('customer-admin', 0)
                        }}
                        placeholder="Search name, contact, phone, email or tax ID"
                        type="search"
                        value={customerAdminSearch}
                      />
                      <select
                        aria-label="Filter customers by type"
                        className="admin-input min-w-[160px]"
                        onChange={(event) => {
                          setCustomerAdminType(event.target.value)
                          changeListPage('customer-admin', 0)
                        }}
                        value={customerAdminType}
                      >
                        <option>All customers</option>
                        <option value="person">Individuals</option>
                        <option value="business">Businesses</option>
                      </select>
                    </div>
                    {(() => {
                      const filteredCustomers = customers.filter((customer) => (
                        (customerAdminType === 'All customers' || customer.type === customerAdminType)
                        && `${customer.name} ${customer.contactName ?? ''} ${customer.taxId ?? ''} ${customer.phone ?? ''} ${customer.email ?? ''}`
                          .toLowerCase().includes(customerAdminSearch.trim().toLowerCase())
                      ))
                      const customerPage = getListPage('customer-admin', filteredCustomers.length)
                      return (
                        <div className="overflow-x-auto border border-[#bbb] bg-white">
                          <table className="admin-table w-full min-w-[900px] text-left text-sm">
                            <thead className="bg-[#e9e9e6]"><tr><th>Customer</th><th>Contact</th><th className="text-right">Sales</th><th className="text-right">Net spend</th><th className="text-right">Points</th><th>Last purchase</th><th className="text-right">Actions</th></tr></thead>
                            <tbody>
                              {filteredCustomers.slice(customerPage.start, customerPage.end).map((customer) => {
                                const customerSales = sales.filter((sale) => (
                                  sale.customerId === customer.id
                                  || (sale.customerId == null && sale.customer === customer.name)
                                ))
                                const netSpend = customerSales.reduce((total, sale) => (
                                  total + sale.total - (sale.refunds ?? []).reduce((refundTotal, refund) => refundTotal + refund.amount, 0)
                                ), 0)
                                const lastSale = customerSales.reduce((latest, sale) => {
                                  const timestamp = Number(sale.createdAtMs) || Date.parse(sale.createdAt)
                                  return Number.isFinite(timestamp) && timestamp > latest ? timestamp : latest
                                }, 0)
                                return (
                                  <tr className="border-t border-[#ddd]" key={customer.id}>
                                    <td>
                                      <strong className="block">{customer.name}</strong>
                                      <span className="text-xs capitalize text-[#666]">{customer.type === 'business' ? 'Business account' : 'Individual account'}</span>
                                      {customer.type === 'business' && customer.taxId && <span className="block text-xs text-[#666]">Tax ID: {customer.taxId}</span>}
                                    </td>
                                    <td>
                                      {customer.type === 'business' && customer.contactName && <span className="block">{customer.contactName}</span>}
                                      {customer.phone && <span className="block">{customer.phone}</span>}
                                      {customer.email && <span className="block">{customer.email}</span>}
                                      {!customer.phone && !customer.email && <span className="text-[#888]">No contact details</span>}
                                    </td>
                                    <td className="text-right">{customerSales.length}</td>
                                    <td className="text-right font-semibold">{currency(netSpend)}</td>
                                    <td className="text-right">{Number(customer.points) || 0}</td>
                                    <td className="whitespace-nowrap">{lastSale ? new Date(lastSale).toLocaleDateString() : '—'}</td>
                                    <td className="text-right">
                                      <div className="flex justify-end gap-2">
                                        <button
                                          aria-label={`Edit ${customer.name}`}
                                          className="touch-button blue min-h-9 px-3 text-xs font-bold"
                                          onClick={() => {
                                            setCustomerAdminDraft({
                                              ...customer,
                                              companyName: customer.type === 'business' ? customer.name : '',
                                            })
                                            setCustomerAdminError('')
                                            setCustomerAdminNotice('')
                                          }}
                                          type="button"
                                        >Edit</button>
                                        <button
                                          aria-label={`Delete ${customer.name}`}
                                          className="touch-button red min-h-9 px-3 text-xs font-bold"
                                          onClick={() => removeCustomer(customer)}
                                          type="button"
                                        >Delete</button>
                                      </div>
                                    </td>
                                  </tr>
                                )
                              })}
                              {!filteredCustomers.length && (
                                <tr className="border-t border-[#ddd]"><td className="p-6 text-center text-[#666]" colSpan="7">{customers.length ? 'No customers match your search or filter.' : 'No customers yet. Add a customer to build your customer list.'}</td></tr>
                              )}
                            </tbody>
                          </table>
                          {renderPagination('customer-admin', filteredCustomers.length, 'customers')}
                        </div>
                      )
                    })()}
                  </div>
                )}

                {advancedView === 'Categories' && (
                  <div>
                    <h3 className="mb-1 text-xl font-bold">Product categories</h3>
                    <p className="mb-5 text-sm text-[#666]">Create POS categories or remove categories that no longer contain products.</p>
                    <form className="mb-6 grid gap-3 border border-[#bbb] bg-white p-4 sm:grid-cols-[1fr_auto]" onSubmit={createCategory}>
                      <label className="admin-field">Category name
                        <input
                          autoComplete="off"
                          className="admin-input"
                          maxLength="30"
                          onChange={(event) => { setNewCategoryName(event.target.value); setCategoryFormError('') }}
                          placeholder="e.g. SMALLGOODS"
                          required
                          value={newCategoryName}
                        />
                      </label>
                      <div className="flex items-end">
                        <button className="touch-button green min-h-11 w-full px-5 font-bold sm:w-auto" type="submit">＋ Create category</button>
                      </div>
                      {categoryFormError && <p aria-live="assertive" className="border border-[#e5aaaa] bg-[#fff0f0] p-2 text-sm font-semibold text-[#a51f1f] sm:col-span-2">{categoryFormError}</p>}
                    </form>

                    <div className="overflow-x-auto border border-[#bbb] bg-white">
                      <table className="admin-table w-full text-left text-sm">
                        <thead className="bg-[#e9e9e6]"><tr><th>Category</th><th className="text-right">Products</th><th className="text-right">Action</th></tr></thead>
                        <tbody>{categories.map((item) => {
                          const productCount = products.filter((product) => product.category === item).length
                          const cannotDelete = productCount > 0 || categories.length === 1
                          return (
                            <tr className="border-t border-[#ddd]" key={item}>
                              <td className="font-semibold">
                                {editingCategory === item ? (
                                  <form className="flex min-w-[200px] items-center gap-2" onSubmit={(event) => saveCategoryEdit(event, item)}>
                                    <input aria-label="Edit category name" autoFocus className="admin-input min-h-9" maxLength="30" onChange={(event) => { setCategoryEditName(event.target.value); setCategoryEditError('') }} required value={categoryEditName} />
                                    <button aria-label="Save category" className="touch-button green min-h-9 px-3 text-xs font-bold" type="submit">Save</button>
                                    <button aria-label="Cancel category edit" className="touch-button gray min-h-9 px-3 text-xs font-bold" onClick={() => { setEditingCategory(null); setCategoryEditName(''); setCategoryEditError('') }} type="button">Cancel</button>
                                  </form>
                                ) : categoryName(item)}
                                {editingCategory === item && categoryEditError && <p aria-live="assertive" className="mt-1 text-xs font-semibold text-[#a51f1f]">{categoryEditError}</p>}
                              </td>
                              <td className="text-right">{productCount}</td>
                              <td className="text-right">
                                {editingCategory === item ? null : categoryToDelete === item ? (
                                  <span className="inline-flex items-center gap-1">
                                    <button className="touch-button red min-h-9 px-2 text-xs font-bold" onClick={() => deleteCategory(item)} type="button">Confirm</button>
                                    <button className="touch-button gray min-h-9 px-2 text-xs font-bold" onClick={() => setCategoryToDelete(null)} type="button">Cancel</button>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1">
                                    <button aria-label={`Edit ${categoryName(item)} category`} className="touch-button blue min-h-9 px-3 text-xs font-bold" onClick={() => beginCategoryEdit(item)} type="button">Edit</button>
                                    <button
                                      aria-label={`Delete ${categoryName(item)} category`}
                                      className="touch-button red min-h-9 px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-45"
                                      disabled={cannotDelete}
                                      onClick={() => setCategoryToDelete(item)}
                                      title={productCount ? 'Remove or reassign this category’s products before deleting it.' : categories.length === 1 ? 'At least one category must remain.' : 'Remove this empty category.'}
                                      type="button"
                                    >
                                      Delete
                                    </button>
                                  </span>
                                )}
                              </td>
                            </tr>
                          )
                        })}</tbody>
                      </table>
                    </div>
                    <p className="mt-2 text-xs text-[#666]">A category must be empty before deletion. Delete its products first; at least one category must remain. New categories are immediately available in the POS and product form.</p>
                  </div>
                )}

                {advancedView === 'Receive stock' && (
                  <div className="max-w-[760px]">
                    <h3 className="mb-1 text-xl font-bold">Receive stock</h3>
                    <p className="mb-5 text-sm text-[#666]">Record an incoming delivery. The received quantity is added to stock on hand.</p>
                    <form className="grid gap-4 border border-[#bbb] bg-white p-4 sm:grid-cols-2 sm:p-5" onSubmit={receiveStock}>
                      <label className="admin-field sm:col-span-2">Product
                        <select className="admin-input" onChange={(event) => selectReceiptProduct(event.target.value)} value={receipt.productId}>
                          {products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.category}</option>)}
                        </select>
                      </label>
                      <label className="admin-field">Quantity received (kg)
                        <input className="admin-input" min="0.001" onChange={(event) => setReceipt((current) => ({ ...current, quantity: event.target.value }))} placeholder="e.g. 12.500" required step="0.001" type="number" value={receipt.quantity} />
                      </label>
                      <label className="admin-field">Unit cost ($/kg)
                        <input className="admin-input" min="0" onChange={(event) => setReceipt((current) => ({ ...current, unitCost: event.target.value }))} required step="0.01" type="number" value={receipt.unitCost} />
                      </label>
                      <label className="admin-field">Supplier
                        <input className="admin-input" onChange={(event) => setReceipt((current) => ({ ...current, supplier: event.target.value }))} placeholder="Supplier name" value={receipt.supplier} />
                      </label>
                      <label className="admin-field">Invoice / delivery reference
                        <input className="admin-input" onChange={(event) => setReceipt((current) => ({ ...current, reference: event.target.value }))} placeholder="Optional reference" value={receipt.reference} />
                      </label>
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#ddd] pt-4 sm:col-span-2">
                        <span className="text-sm text-[#666]">New stock on hand: <strong className="text-[#222]">{(stock[receipt.productId] + (Number(receipt.quantity) || 0)).toFixed(3)} kg</strong></span>
                        <button className="touch-button green min-h-12 px-6 text-sm font-bold" type="submit">Receive delivery</button>
                      </div>
                    </form>
                  </div>
                )}

                {advancedView === 'Processing' && (
                  <div className="space-y-5">
                    <div>
                      <h3 className="mb-1 text-xl font-bold">Production &amp; processing</h3>
                      <p className="text-sm text-[#666]">Convert raw stock into saleable products such as mince, sausages, or biltong. Each batch records the actual input mix, output composition, yield, and the catalogue selling price for each output product.</p>
                    </div>
                    <form className="space-y-5 border border-[#bbb] bg-white p-4 sm:p-5" onSubmit={processStock}>
                      <section>
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div><h4 className="font-bold">Raw materials used</h4><p className="text-xs text-[#666]">Quantities are deducted from inventory when the batch is recorded.</p></div>
                          <button className="touch-button blue min-h-9 px-3 text-sm font-bold" onClick={() => setProcessingInputs((current) => [...current, { productId: products[0]?.id ?? 0, quantity: '' }])} type="button">＋ Add input</button>
                        </div>
                        <div className="space-y-2">
                          {processingInputs.map((line, index) => (
                            <div className="grid gap-2 border border-[#ddd] bg-[#f8f8f6] p-3 sm:grid-cols-[minmax(0,1fr)_160px_auto]" key={`processing-input-${index}`}>
                              <label className="admin-field">Input product
                                <select className="admin-input" onChange={(event) => { setProcessingInputs((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, productId: Number(event.target.value) } : entry)); setProcessingError('') }} value={line.productId}>
                                  {products.map((product) => <option key={product.id} value={product.id}>{product.name} · {currency(product.price)}/kg · {Number(stock[product.id] ?? 0).toFixed(3)} kg available</option>)}
                                </select>
                              </label>
                              <label className="admin-field">Quantity used (kg)
                                <input className="admin-input" min="0.001" onChange={(event) => { setProcessingInputs((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, quantity: event.target.value } : entry)); setProcessingError('') }} placeholder="e.g. 10.000" step="0.001" type="number" value={line.quantity} />
                              </label>
                              <button aria-label={`Remove input ${index + 1}`} className="touch-button red min-h-10 self-end px-3 font-bold disabled:opacity-50" disabled={processingInputs.length === 1} onClick={() => setProcessingInputs((current) => current.filter((_, entryIndex) => entryIndex !== index))} type="button">Remove</button>
                            </div>
                          ))}
                        </div>
                      </section>
                      <section>
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div><h4 className="font-bold">Saleable output composition</h4><p className="text-xs text-[#666]">Enter the actual weight produced for each catalogue item; each keeps its own selling price.</p></div>
                          <button className="touch-button blue min-h-9 px-3 text-sm font-bold" onClick={() => setProcessingOutputs((current) => [...current, { productId: products[0]?.id ?? 0, quantity: '' }])} type="button">＋ Add output</button>
                        </div>
                        <div className="space-y-2">
                          {processingOutputs.map((line, index) => {
                            const outputProduct = products.find((product) => product.id === Number(line.productId))
                            return (
                              <div className="grid gap-2 border border-[#ddd] bg-[#f8f8f6] p-3 sm:grid-cols-[minmax(0,1fr)_160px_auto]" key={`processing-output-${index}`}>
                                <label className="admin-field">Output product
                                  <select className="admin-input" onChange={(event) => { setProcessingOutputs((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, productId: Number(event.target.value) } : entry)); setProcessingError('') }} value={line.productId}>
                                    {products.map((product) => <option key={product.id} value={product.id}>{product.name} · selling at {currency(product.price)}/kg</option>)}
                                  </select>
                                  <span className="text-xs text-[#666]">Retail pricing is managed in Products: {currency(outputProduct?.price ?? 0)}/kg</span>
                                </label>
                                <label className="admin-field">Produced quantity (kg)
                                  <input className="admin-input" min="0.001" onChange={(event) => { setProcessingOutputs((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, quantity: event.target.value } : entry)); setProcessingError('') }} placeholder="e.g. 6.250" step="0.001" type="number" value={line.quantity} />
                                </label>
                                <button aria-label={`Remove output ${index + 1}`} className="touch-button red min-h-10 self-end px-3 font-bold disabled:opacity-50" disabled={processingOutputs.length === 1} onClick={() => setProcessingOutputs((current) => current.filter((_, entryIndex) => entryIndex !== index))} type="button">Remove</button>
                              </div>
                            )
                          })}
                        </div>
                      </section>
                      <div className="grid gap-3 border-t border-[#ddd] pt-4 sm:grid-cols-3">
                        <div className="border border-[#ddd] bg-[#f8f8f6] p-3 text-sm">Total input<strong className="mt-1 block text-lg">{processingInputs.reduce((total, line) => total + (Number(line.quantity) || 0), 0).toFixed(3)} kg</strong></div>
                        <div className="border border-[#ddd] bg-[#f8f8f6] p-3 text-sm">Saleable output<strong className="mt-1 block text-lg">{processingOutputs.reduce((total, line) => total + (Number(line.quantity) || 0), 0).toFixed(3)} kg</strong></div>
                        <div className="border border-[#ddd] bg-[#f8f8f6] p-3 text-sm">Processing loss<strong className="mt-1 block text-lg">{Math.max(0, processingInputs.reduce((total, line) => total + (Number(line.quantity) || 0), 0) - processingOutputs.reduce((total, line) => total + (Number(line.quantity) || 0), 0)).toFixed(3)} kg</strong></div>
                      </div>
                      {processingError && <p aria-live="assertive" className="border border-[#e5aaaa] bg-[#fff0f0] p-3 text-sm font-semibold text-[#a51f1f]">{processingError}</p>}
                      <div className="flex justify-end border-t border-[#ddd] pt-4"><button className="touch-button green min-h-12 px-6 font-bold" type="submit">Record processing batch</button></div>
                    </form>
                    <section className="overflow-x-auto border border-[#bbb] bg-white">
                      <div className="border-b border-[#ccc] bg-[#e9e9e6] px-3 py-2">
                        <h4 className="font-bold">Processing batch history</h4>
                        <p className="text-xs text-[#666]">Batch inputs and outputs are also recorded in the inventory movement ledger.</p>
                      </div>
                      <table className="admin-table w-full text-left text-sm">
                        <thead><tr><th>Date</th><th>Batch</th><th>Inputs</th><th>Outputs and retail price</th><th className="text-right">Yield</th><th>Operator</th></tr></thead>
                        <tbody>
                          {processingHistory.length ? processingHistory.slice(getListPage('processing-history', processingHistory.length).start, getListPage('processing-history', processingHistory.length).end).map((batch) => (
                            <tr className="border-t border-[#ddd] align-top" key={batch.id}>
                              <td>{batch.processedAt}</td>
                              <td className="font-semibold">{batch.number}</td>
                              <td>{batch.inputs.map((line) => <div key={`${batch.id}-in-${line.productId}`}>{line.product} · {line.quantity.toFixed(3)} kg</div>)}</td>
                              <td>{batch.outputs.map((line, index) => <div key={`${batch.id}-out-${index}`}>{line.product} · {line.quantity.toFixed(3)} kg · {currency(line.price)}/kg</div>)}</td>
                              <td className="text-right">{batch.yieldPercent.toFixed(1)}%<span className="block text-xs text-[#666]">{batch.loss.toFixed(3)} kg loss</span></td>
                              <td>{batch.operator}</td>
                            </tr>
                          )) : <tr className="border-t border-[#ddd]"><td className="p-4 text-center text-[#666]" colSpan="6">No processing batches recorded yet.</td></tr>}
                        </tbody>
                      </table>
                      {renderPagination('processing-history', processingHistory.length, 'processing batches')}
                    </section>
                  </div>
                )}

                {advancedView === 'Stock on hand' && (
                  <div>
                    <h3 className="mb-1 text-xl font-bold">Stock on hand</h3>
                    <p className="mb-4 text-sm text-[#666]">Current inventory balance by product.</p>
                    <div className="overflow-x-auto border border-[#bbb] bg-white">
                      <table className="admin-table w-full text-left text-sm">
                        <thead className="bg-[#e9e9e6]"><tr><th>Product</th><th>Category</th><th className="text-right">Retail price</th><th className="text-right">On hand</th><th>Status</th></tr></thead>
                        <tbody>{products.slice(getListPage('stock-on-hand', products.length).start, getListPage('stock-on-hand', products.length).end).map((product) => (
                          <tr className="border-t border-[#ddd]" key={product.id}>
                            <td className="font-semibold">{product.name}</td><td>{product.category.slice(2)}</td><td className="text-right">{currency(product.price)}/kg</td>
                            <td className="text-right font-bold">{(stock[product.id] ?? 0).toFixed(3)} kg</td><td><span className={`inline-block px-2 py-1 text-xs font-bold ${(stock[product.id] ?? 0) > 0 ? 'bg-[#dff3d0] text-[#315e25]' : 'bg-[#f5e3df] text-[#8e3428]'}`}>{(stock[product.id] ?? 0) > 0 ? 'In stock' : 'Out of stock'}</span></td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                    {renderPagination('stock-on-hand', products.length, 'stock products')}
                    <section className="mt-5 overflow-x-auto border border-[#bbb] bg-white">
                      <div className="border-b border-[#ccc] bg-[#e9e9e6] px-3 py-2">
                        <h4 className="font-bold">Inventory movement ledger</h4>
                        <p className="text-xs text-[#666]">Auditable stock changes from completed sales, refunds, deliveries, and stocktake adjustments.</p>
                      </div>
                      <table className="admin-table w-full text-left text-sm">
                        <thead><tr><th>Date</th><th>Product</th><th>Movement</th><th className="text-right">Quantity change</th><th>Reference</th><th>Operator</th></tr></thead>
                        <tbody>
                          {inventoryMovements.length ? inventoryMovements.slice(getListPage('inventory-movements', inventoryMovements.length).start, getListPage('inventory-movements', inventoryMovements.length).end).map((movement) => (
                            <tr className="border-t border-[#ddd]" key={movement.id}>
                              <td>{movement.createdAt}</td>
                              <td className="font-semibold">{movement.product}</td>
                              <td>{movement.type}</td>
                              <td className={`text-right font-bold ${movement.quantity > 0 ? 'text-[#315e25]' : movement.quantity < 0 ? 'text-[#a33a2b]' : ''}`}>{movement.quantity > 0 ? '+' : ''}{movement.quantity.toFixed(3)} kg</td>
                              <td>{movement.reference}</td>
                              <td>{movement.operator}</td>
                            </tr>
                          )) : <tr className="border-t border-[#ddd]"><td className="p-4 text-center text-[#666]" colSpan="6">No inventory movements have been recorded yet.</td></tr>}
                        </tbody>
                      </table>
                      {renderPagination('inventory-movements', inventoryMovements.length, 'inventory movements')}
                    </section>
                  </div>
                )}

                {advancedView === 'Adjust & waste' && (
                  <div className="max-w-[1000px] space-y-5">
                    <div>
                      <h3 className="mb-1 text-xl font-bold">Adjust stock & record waste</h3>
                      <p className="text-sm text-[#666]">Record a stock correction or remove spoiled, damaged, or otherwise wasted product. Every change requires a reason and is added to the inventory movement ledger.</p>
                    </div>
                    <form className="grid gap-4 border border-[#bbb] bg-white p-4 sm:grid-cols-2 sm:p-5" onSubmit={recordStockAdjustment}>
                      <label className="admin-field sm:col-span-2">Product
                        <select className="admin-input" onChange={(event) => { setAdjustWaste((current) => ({ ...current, productId: Number(event.target.value) })); setAdjustWasteError('') }} value={adjustWaste.productId}>
                          {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                        </select>
                      </label>
                      <label className="admin-field">Change type
                        <select className="admin-input" onChange={(event) => { setAdjustWaste((current) => ({ ...current, type: event.target.value })); setAdjustWasteError('') }} value={adjustWaste.type}>
                          <option value="increase">Increase stock (correction)</option>
                          <option value="decrease">Decrease stock (correction)</option>
                          <option value="waste">Record waste</option>
                        </select>
                      </label>
                      <label className="admin-field">Quantity (kg)
                        <input aria-label="Stock change quantity (kg)" className="admin-input" min="0.001" onChange={(event) => { setAdjustWaste((current) => ({ ...current, quantity: event.target.value })); setAdjustWasteError('') }} placeholder="e.g. 0.500" required step="0.001" type="number" value={adjustWaste.quantity} />
                      </label>
                      <label className="admin-field sm:col-span-2">Reason
                        <input aria-label="Reason for stock change" className="admin-input" maxLength="120" onChange={(event) => { setAdjustWaste((current) => ({ ...current, reason: event.target.value })); setAdjustWasteError('') }} placeholder={adjustWaste.type === 'waste' ? 'e.g. Spoiled during storage' : 'e.g. Supplier correction or damaged stock'} required value={adjustWaste.reason} />
                      </label>
                      <div className="grid gap-3 sm:col-span-2 sm:grid-cols-3">
                        <div className="border border-[#ddd] bg-[#f4f4f1] p-3 text-sm">Current stock<strong className="mt-1 block text-lg">{selectedAdjustmentProduct ? (stock[selectedAdjustmentProduct.id] ?? 0).toFixed(3) : '0.000'} kg</strong></div>
                        <div className="border border-[#ddd] bg-[#f4f4f1] p-3 text-sm">Stock change<strong className={`mt-1 block text-lg ${adjustmentSign > 0 ? 'text-[#315e25]' : 'text-[#a33a2b]'}`}>{adjustWaste.quantity ? `${adjustmentSign > 0 ? '+' : '−'}${adjustmentQuantity.toFixed(3)} kg` : 'Enter a quantity'}</strong></div>
                        <div className="border border-[#ddd] bg-[#eaf4e3] p-3 text-sm">After recording<strong className="mt-1 block text-lg">{adjustmentPreview.toFixed(3)} kg</strong></div>
                      </div>
                      {adjustWasteError && <p aria-live="assertive" className="border border-[#e5aaaa] bg-[#fff0f0] p-3 text-sm font-semibold text-[#a51f1f] sm:col-span-2">{adjustWasteError}</p>}
                      <div className="flex justify-end sm:col-span-2">
                        <button className={`touch-button ${adjustWaste.type === 'waste' ? 'red' : 'yellow'} min-h-12 px-5 text-sm font-bold`} type="submit">{adjustWaste.type === 'waste' ? 'Record waste' : 'Save stock adjustment'}</button>
                      </div>
                    </form>
                    <section className="overflow-x-auto border border-[#bbb] bg-white">
                      <div className="flex items-center justify-between gap-3 border-b border-[#ccc] bg-[#e9e9e6] px-3 py-2">
                        <div>
                          <h4 className="font-bold">Adjustment & waste history</h4>
                          <p className="text-xs text-[#666]">Manual corrections and waste records, newest first.</p>
                        </div>
                        <span className="text-xs text-[#666]">{adjustmentMovements.length} record{adjustmentMovements.length === 1 ? '' : 's'}</span>
                      </div>
                      <table className="admin-table w-full text-left text-sm">
                        <thead><tr><th>Date</th><th>Product</th><th>Type</th><th className="text-right">Quantity change</th><th>Reason</th><th>Operator</th></tr></thead>
                        <tbody>
                          {adjustmentMovements.length ? adjustmentMovements.slice(getListPage('adjustment-waste-history', adjustmentMovements.length).start, getListPage('adjustment-waste-history', adjustmentMovements.length).end).map((movement) => (
                            <tr className="border-t border-[#ddd] align-top" key={movement.id}>
                              <td>{movement.createdAt}</td>
                              <td className="font-semibold">{movement.product}</td>
                              <td>{movement.type}</td>
                              <td className={`text-right font-bold ${movement.quantity > 0 ? 'text-[#315e25]' : 'text-[#a33a2b]'}`}>{movement.quantity > 0 ? '+' : ''}{movement.quantity.toFixed(3)} kg</td>
                              <td>{movement.reference}</td>
                              <td>{movement.operator}</td>
                            </tr>
                          )) : <tr className="border-t border-[#ddd]"><td className="p-4 text-center text-[#666]" colSpan="6">No stock adjustments or waste have been recorded.</td></tr>}
                        </tbody>
                      </table>
                      {renderPagination('adjustment-waste-history', adjustmentMovements.length, 'adjustments and waste records')}
                    </section>
                  </div>
                )}

                {advancedView === 'Stocktake' && (
                  <div className="max-w-[900px] space-y-5">
                    <h3 className="mb-1 text-xl font-bold">Stocktake adjustment</h3>
                    <div>
                      <p className="mb-4 text-sm text-[#666]">Compare the physical count with recorded inventory. The variance is shown before saving and added to the discrepancy history.</p>
                      <form className="grid gap-4 border border-[#bbb] bg-white p-4 sm:grid-cols-2 sm:p-5" onSubmit={applyStocktake}>
                        <label className="admin-field sm:col-span-2">Product
                          <select className="admin-input" onChange={(event) => setStocktake((current) => ({ ...current, productId: Number(event.target.value) }))} value={stocktake.productId}>
                            {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                          </select>
                        </label>
                        <div className="border border-[#ddd] bg-[#f4f4f1] p-3 text-sm">Expected in system<strong className="mt-1 block text-lg">{stocktakeSystemQuantity.toFixed(3)} kg</strong></div>
                        <label className="admin-field">Physical count (kg)
                          <input aria-label="Counted quantity (kg)" className="admin-input" min="0" onChange={(event) => setStocktake((current) => ({ ...current, quantity: event.target.value }))} placeholder="Enter physical count" required step="0.001" type="number" value={stocktake.quantity} />
                        </label>
                        <div aria-live="polite" className={`border p-3 text-sm sm:col-span-2 ${stocktakeVariance === null ? 'border-[#ddd] bg-[#f4f4f1]' : stocktakeVariance === 0 ? 'border-[#8bb578] bg-[#eaf4e3]' : 'border-[#e4b38a] bg-[#fff4e8]'}`}>
                          <span className="text-[#555]">Discrepancy</span>
                          {stocktakeVariance === null ? (
                            <strong className="mt-1 block text-lg">Enter a physical count to compare</strong>
                          ) : stocktakeVariance === 0 ? (
                            <strong className="mt-1 block text-lg text-[#315e25]">No discrepancy · matches system quantity</strong>
                          ) : (
                            <>
                              <strong className={`mt-1 block text-lg ${stocktakeVariance > 0 ? 'text-[#315e25]' : 'text-[#a33a2b]'}`}>
                                {stocktakeVariance > 0 ? 'Overage' : 'Shortage'} · {stocktakeVariance > 0 ? '+' : ''}{stocktakeVariance.toFixed(3)} kg
                              </strong>
                              <span className="mt-1 block text-xs text-[#666]">{Math.abs(stocktakeVariance).toFixed(3)} kg {stocktakeVariance > 0 ? 'more' : 'less'} than expected</span>
                            </>
                          )}
                        </div>
                        <button className="touch-button yellow min-h-12 px-5 text-sm font-bold sm:col-span-2 sm:justify-self-end" type="submit">Save stocktake adjustment</button>
                      </form>
                    </div>

                    <section className="overflow-x-auto border border-[#bbb] bg-white">
                      <div className="flex items-center justify-between gap-3 border-b border-[#ccc] bg-[#e9e9e6] px-3 py-2">
                        <h4 className="font-bold">Stocktake discrepancies</h4>
                        <span className="text-xs text-[#666]">{stocktakeHistory.length} saved count{stocktakeHistory.length === 1 ? '' : 's'}</span>
                      </div>
                      <table className="admin-table w-full text-left text-sm">
                        <thead><tr><th>Date</th><th>Product</th><th>Operator</th><th className="text-right">Expected</th><th className="text-right">Counted</th><th className="text-right">Variance</th><th>Status</th></tr></thead>
                        <tbody>
                          {stocktakeHistory.length ? stocktakeHistory.slice(getListPage('stocktake-history', stocktakeHistory.length).start, getListPage('stocktake-history', stocktakeHistory.length).end).map((entry) => (
                            <tr className="border-t border-[#ddd]" key={entry.id}>
                              <td>{entry.createdAt}</td>
                              <td className="font-semibold">{entry.product}</td>
                              <td>{entry.operator}</td>
                              <td className="text-right">{entry.expected.toFixed(3)} kg</td>
                              <td className="text-right">{entry.counted.toFixed(3)} kg</td>
                              <td className={`text-right font-bold ${entry.variance > 0 ? 'text-[#315e25]' : entry.variance < 0 ? 'text-[#a33a2b]' : ''}`}>{entry.variance > 0 ? '+' : ''}{entry.variance.toFixed(3)} kg</td>
                              <td className={`font-semibold ${entry.variance > 0 ? 'text-[#315e25]' : entry.variance < 0 ? 'text-[#a33a2b]' : 'text-[#555]'}`}>{entry.variance > 0 ? 'Overage' : entry.variance < 0 ? 'Shortage' : 'Matched'}</td>
                            </tr>
                          )) : (
                            <tr className="border-t border-[#ddd]"><td className="p-4 text-center text-[#666]" colSpan="7">No stocktakes recorded yet. Enter a physical count to identify and record discrepancies.</td></tr>
                          )}
                        </tbody>
                      </table>
                      {renderPagination('stocktake-history', stocktakeHistory.length, 'stocktake records')}
                    </section>
                  </div>
                )}

                {advancedView === 'Payment methods' && (
                  <div className="max-w-[760px]">
                    <h3 className="mb-1 text-xl font-bold">Payment methods</h3>
                    <p className="mb-5 text-sm text-[#666]">Configure the methods available at checkout, for refunds, and for expenses. CASH is required for change and day-end cash reconciliation.</p>
                    <form className="mb-4 flex flex-wrap items-end gap-3 border border-[#bbb] bg-white p-4" onSubmit={addPaymentMethod}>
                      <label className="admin-field min-w-[200px] flex-1">New payment method
                        <input autoComplete="off" className="admin-input" onChange={(event) => { setNewPaymentMethod(event.target.value); setPaymentMethodError('') }} placeholder="e.g. STORE CREDIT" value={newPaymentMethod} />
                      </label>
                      <button className="touch-button green min-h-11 px-5 font-bold" type="submit">＋ Add method</button>
                    </form>
                    {paymentMethodError && <p aria-live="assertive" className="mb-3 border border-[#e5aaaa] bg-[#fff0f0] p-3 text-sm font-semibold text-[#a51f1f]">{paymentMethodError}</p>}
                    <div className="overflow-x-auto border border-[#bbb] bg-white">
                      <table className="admin-table w-full text-left text-sm">
                        <thead className="bg-[#e9e9e6]"><tr><th>Payment method</th><th className="text-right">Actions</th></tr></thead>
                        <tbody>{paymentMethods.map((method) => (
                          <tr className="border-t border-[#ddd]" key={method}>
                            <td>
                              {editingPaymentMethod === method ? (
                                <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => savePaymentMethodEdit(event, method)}>
                                  <input aria-label={`Edit ${method}`} autoFocus className="admin-input min-w-[150px] flex-1" onChange={(event) => { setPaymentMethodDraft(event.target.value); setPaymentMethodError('') }} value={paymentMethodDraft} />
                                  <button aria-label={`Save ${method}`} className="touch-button green min-h-9 px-3 font-bold" type="submit">Save</button>
                                  <button className="touch-button gray min-h-9 px-3 font-semibold" onClick={() => { setEditingPaymentMethod(null); setPaymentMethodError('') }} type="button">Cancel</button>
                                </form>
                              ) : <><strong>{method}</strong>{method === 'CASH' && <span className="ml-2 text-xs text-[#666]">Required</span>}</>}
                            </td>
                            <td className="text-right">
                              {editingPaymentMethod !== method && (
                                <div className="flex justify-end gap-2">
                                  <button aria-label={`Edit ${method}`} className="touch-button blue min-h-9 px-3 text-xs font-bold" onClick={() => { setEditingPaymentMethod(method); setPaymentMethodDraft(method); setPaymentMethodError('') }} type="button">Edit</button>
                                  <button aria-label={`Delete ${method}`} className="touch-button red min-h-9 px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50" disabled={method === 'CASH'} onClick={() => deletePaymentMethod(method)} type="button">Delete</button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </div>
                )}

                {advancedView === 'Users' && (
                  <div className="max-w-[800px]">
                    <h3 className="mb-1 text-xl font-bold">Staff accounts</h3>
                    <p className="mb-5 text-sm text-[#666]">Create Supabase Auth accounts for staff and authorize them for this shop. Passwords are sent to Supabase Auth and are never saved in POS records.</p>
                    {staffRole !== 'admin' ? (
                      <div className="space-y-3 border border-[#bbb] bg-white p-4 text-sm">
                        <p><strong>Signed-in account:</strong> {authUser?.email ?? currentUsername}</p>
                        <p>To enable staff management, promote your account to shop admin once in the Supabase SQL Editor. Replace the email with your Supabase Auth email:</p>
                        <code className="block overflow-x-auto bg-[#f2f2ef] p-3 text-xs">insert into public.butcher_shop_members (user_id, role)<br />select id, 'admin' from auth.users where lower(email) = lower('YOUR_ADMIN_EMAIL')<br />on conflict (user_id) do update set role = 'admin';</code>
                        <p className="text-[#666]">Then sign out and back in so the app loads the admin role.</p>
                      </div>
                    ) : (
                      <>
                        <form className="mb-4 grid gap-3 border border-[#bbb] bg-white p-4 sm:grid-cols-2" onSubmit={createStaffAccount}>
                          <label className="admin-field">Staff email
                            <input autoComplete="off" className="admin-input" onChange={(event) => { setStaffEmail(event.target.value); setStaffError('') }} required type="email" value={staffEmail} />
                          </label>
                          <label className="admin-field">Temporary password
                            <input autoComplete="new-password" className="admin-input" minLength="8" onChange={(event) => { setStaffPassword(event.target.value); setStaffError('') }} required type="password" value={staffPassword} />
                            <span className="text-xs font-normal text-[#666]">At least 8 characters. Share it with the staff member securely.</span>
                          </label>
                          <button className="touch-button green min-h-11 px-5 font-bold disabled:opacity-50 sm:col-span-2 sm:justify-self-end" disabled={staffCreating} type="submit">
                            {staffCreating ? 'Creating account...' : '＋ Create staff account'}
                          </button>
                        </form>
                        {staffError && <p aria-live="assertive" className="mb-3 border border-[#e5aaaa] bg-[#fff0f0] p-3 text-sm font-semibold text-[#a51f1f]">{staffError}</p>}
                        {staffNotice && <p aria-live="polite" className="mb-3 border border-[#a8c99a] bg-[#eef8e9] p-3 text-sm font-semibold text-[#315e25]">{staffNotice}</p>}
                        <div className="overflow-x-auto border border-[#bbb] bg-white">
                          <div className="flex items-center justify-between gap-3 border-b border-[#ccc] bg-[#e9e9e6] px-3 py-2">
                            <h4 className="font-bold">Authorized staff</h4>
                            <button className="touch-button gray min-h-9 px-3 text-xs font-semibold" disabled={staffLoading} onClick={refreshStaffAccounts} type="button">{staffLoading ? 'Loading...' : 'Refresh'}</button>
                          </div>
                          <table className="admin-table w-full text-left text-sm">
                            <thead><tr><th>Email</th><th>Role</th></tr></thead>
                            <tbody>
                              {staffAccounts.map((staff) => (
                                <tr className="border-t border-[#ddd]" key={staff.userId}>
                                  <td>{staff.email}{staff.userId === authUser?.id && <span className="ml-2 text-xs text-[#666]">(you)</span>}</td>
                                  <td className="capitalize">{staff.role}</td>
                                </tr>
                              ))}
                              {!staffAccounts.length && !staffLoading && <tr className="border-t border-[#ddd]"><td className="p-4 text-center text-[#666]" colSpan="2">No staff accounts were returned.</td></tr>}
                              {staffLoading && <tr className="border-t border-[#ddd]"><td className="p-4 text-center text-[#666]" colSpan="2">Loading staff accounts...</td></tr>}
                            </tbody>
                          </table>
                        </div>
                        {staffError && <p className="mt-3 text-xs text-[#666]">Deploy the <code>manage-staff</code> Supabase Edge Function if this feature is not configured yet.</p>}
                      </>
                    )}
                  </div>
                )}

                {advancedView === 'Activity log' && (
                  <div>
                    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <h3 className="mb-1 text-xl font-bold">Activity log</h3>
                        <p className="text-sm text-[#666]">Recent sales, refunds, expenses, stock changes, processing, stocktakes, and day-end closures.</p>
                      </div>
                      <label className="admin-field">Filter activity
                        <select
                          className="admin-input min-w-[180px]"
                          onChange={(event) => {
                            setActivityFilter(event.target.value)
                            changeListPage('activity-log', 0)
                          }}
                          value={activityFilter}
                        >
                          {['All activity', 'Sales', 'Refunds', 'Expenses', 'Stock', 'Processing', 'Day end'].map((filter) => (
                            <option key={filter}>{filter}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="overflow-x-auto border border-[#bbb] bg-white">
                      <table className="admin-table w-full min-w-[680px] text-left text-sm">
                        <thead className="bg-[#e9e9e6]"><tr><th>Date &amp; time</th><th>Activity</th><th>Details</th><th>Staff</th></tr></thead>
                        <tbody>
                          {filteredActivityLog.length ? filteredActivityLog
                            .slice(getListPage('activity-log', filteredActivityLog.length).start, getListPage('activity-log', filteredActivityLog.length).end)
                            .map((entry) => (
                              <tr className="border-t border-[#ddd]" key={entry.id}>
                                <td className="whitespace-nowrap">{new Date(entry.timestamp).toLocaleString()}</td>
                                <td><span className="mr-2 inline-block bg-[#efefec] px-2 py-1 text-xs font-semibold">{entry.category}</span><strong>{entry.activity}</strong></td>
                                <td>{entry.details}</td>
                                <td>{entry.operator}</td>
                              </tr>
                            )) : (
                            <tr className="border-t border-[#ddd]">
                              <td className="p-6 text-center text-[#666]" colSpan="4">
                                {activityLog.length ? `No ${activityFilter.toLowerCase()} activity recorded.` : 'No activity has been recorded yet.'}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                      {renderPagination('activity-log', filteredActivityLog.length, 'activity entries')}
                    </div>
                  </div>
                )}

                {advancedView === 'Company details' && (
                  <div className="max-w-[800px]">
                    <h3 className="mb-1 text-xl font-bold">Company details</h3>
                    <p className="mb-5 text-sm text-[#666]">These details appear on printed sales receipts and day-end summaries, and the company name/logo is used on the sign-in screen.</p>
                    <form className="grid gap-4 border border-[#bbb] bg-white p-4 sm:grid-cols-2 sm:p-5" onSubmit={saveCompanyDetails}>
                      <label className="admin-field sm:col-span-2">Company or store name
                        <input className="admin-input" onChange={(event) => { setCompanyDraft((current) => ({ ...current, name: event.target.value })); setCompanyError('') }} required value={companyDraft.name} />
                      </label>
                      <label className="admin-field sm:col-span-2">Business address
                        <input autoComplete="street-address" className="admin-input" onChange={(event) => setCompanyDraft((current) => ({ ...current, address: event.target.value }))} placeholder="Street, suburb, state and postcode" value={companyDraft.address} />
                      </label>
                      <label className="admin-field">Phone
                        <input autoComplete="tel" className="admin-input" onChange={(event) => setCompanyDraft((current) => ({ ...current, phone: event.target.value }))} type="tel" value={companyDraft.phone} />
                      </label>
                      <label className="admin-field">Email
                        <input autoComplete="email" className="admin-input" onChange={(event) => setCompanyDraft((current) => ({ ...current, email: event.target.value }))} type="email" value={companyDraft.email} />
                      </label>
                      <label className="admin-field">Business / tax registration number
                        <input className="admin-input" onChange={(event) => setCompanyDraft((current) => ({ ...current, taxId: event.target.value }))} placeholder="ABN or other registration number" value={companyDraft.taxId} />
                      </label>
                      <label className="admin-field">Website
                        <input autoComplete="url" className="admin-input" onChange={(event) => setCompanyDraft((current) => ({ ...current, website: event.target.value }))} placeholder="www.example.com" type="url" value={companyDraft.website} />
                      </label>
                      <div className="grid gap-3 border border-[#ddd] bg-[#f8f8f6] p-3 sm:col-span-2 sm:grid-cols-3">
                        <label className="admin-field">Tax name
                          <input className="admin-input" maxLength="24" onChange={(event) => setCompanyDraft((current) => ({ ...current, taxName: event.target.value }))} placeholder="e.g. GST" value={companyDraft.taxName} />
                        </label>
                        <label className="admin-field">Tax rate (%)
                          <input className="admin-input" inputMode="decimal" max="100" min="0" onChange={(event) => setCompanyDraft((current) => ({ ...current, taxRate: event.target.value }))} step="0.01" type="number" value={companyDraft.taxRate} />
                        </label>
                        <label className="admin-field">Price tax mode
                          <select className="admin-input" onChange={(event) => setCompanyDraft((current) => ({ ...current, taxInclusive: event.target.value }))} value={companyDraft.taxInclusive}>
                            <option value="true">Prices include tax</option>
                            <option value="false">Add tax to prices</option>
                          </select>
                        </label>
                        <p className="text-xs text-[#666] sm:col-span-3">Tax configuration is applied to new sales and quotations. Confirm the rate and receipt wording meet your local requirements.</p>
                      </div>
                      <label className="admin-field sm:col-span-2">Receipt footer message
                        <textarea className="admin-input min-h-20 resize-y" maxLength={160} onChange={(event) => setCompanyDraft((current) => ({ ...current, receiptMessage: event.target.value }))} placeholder="Thank you for shopping with us!" value={companyDraft.receiptMessage} />
                      </label>
                      <div className="grid gap-3 border border-[#ddd] bg-[#f8f8f6] p-3 sm:col-span-2 sm:grid-cols-[1fr_auto] sm:items-center">
                        <label className="admin-field">Company logo
                          <input accept="image/*" className="admin-input" onChange={(event) => selectCompanyLogo(event.target.files?.[0])} type="file" />
                          <span className="text-xs font-normal text-[#666]">Image file, up to 2 MB. It will appear at the top of printed receipts.</span>
                        </label>
                        {companyDraft.logoDataUrl && (
                          <div className="flex items-center gap-3">
                            <img alt="Company logo preview" className="max-h-20 max-w-32 border border-[#aaa] bg-white object-contain p-1" src={companyDraft.logoDataUrl} />
                            <button className="touch-button gray min-h-9 px-3 text-sm font-semibold" onClick={() => setCompanyDraft((current) => ({ ...current, logoDataUrl: '' }))} type="button">Remove logo</button>
                          </div>
                        )}
                      </div>
                      {companyError && <p aria-live="assertive" className="border border-[#e5aaaa] bg-[#fff0f0] p-3 text-sm font-semibold text-[#a51f1f] sm:col-span-2">{companyError}</p>}
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#ccc] pt-3 sm:col-span-2">
                        <button className="touch-button gray min-h-11 px-4 font-semibold" onClick={() => { setCompanyDraft({ ...companyDetails }); setCompanyError('') }} type="button">Discard changes</button>
                        <button className="touch-button green min-h-11 px-5 font-bold" type="submit">Save company details</button>
                      </div>
                    </form>
                  </div>
                )}

                {advancedView === 'Reports' && (
                  <div className="report-print-content space-y-5">
                    <header className="report-print-header">
                      {companyDetails.logoDataUrl && <img alt="" src={companyDetails.logoDataUrl} />}
                      <div>
                        <h1>{companyDetails.name}</h1>
                        {companyDetails.address && <p>{companyDetails.address}</p>}
                        {companyDetails.phone && <p>{companyDetails.phone}</p>}
                        {companyDetails.taxId && <p>Business / tax ID: {companyDetails.taxId}</p>}
                      </div>
                      <div className="report-print-date">
                        <strong>Detailed report</strong>
                        <span>{reportStartDate || reportEndDate ? `${reportStartDate || 'Beginning'} to ${reportEndDate || 'Today'}` : 'All recorded activity'}</span>
                        <span>Printed {new Date().toLocaleString()}</span>
                      </div>
                    </header>
                    <div>
                      <h3 className="mb-1 text-xl font-bold">Detailed reports</h3>
                      <p className="text-sm text-[#666]">Review sales, tender, product performance, refunds, expenses, and stock deliveries for a selected date range.</p>
                    </div>
                    <div className="report-print-controls flex flex-wrap items-end gap-3 border border-[#bbb] bg-white p-4">
                      <label className="admin-field">From
                        <input aria-label="Report from date" className="admin-input" max={reportEndDate || undefined} onChange={(event) => setReportStartDate(event.target.value)} type="date" value={reportStartDate} />
                      </label>
                      <label className="admin-field">To
                        <input aria-label="Report to date" className="admin-input" min={reportStartDate || undefined} onChange={(event) => setReportEndDate(event.target.value)} type="date" value={reportEndDate} />
                      </label>
                      <button className="touch-button gray min-h-11 px-4 font-semibold" onClick={() => { setReportStartDate(''); setReportEndDate('') }} type="button">All dates</button>
                      <span className="ml-auto text-xs text-[#666]">{reportStartDate || reportEndDate ? `${reportStartDate || 'Beginning'} to ${reportEndDate || 'Today'}` : 'All recorded activity'}</span>
                    </div>
                    <section className="report-summary-print border border-[#bbb] bg-white p-3" data-report-print-section="summary">
                      {reportTemplateHeader('Report summary')}
                      <div className="report-section-title flex items-center justify-between gap-3">
                        <h4 className="font-bold">Report summary</h4>
                        <button className="report-section-print-button touch-button blue min-h-9 px-3 text-sm font-bold" onClick={() => printDetailedReport('summary')} type="button">Print summary · A4</button>
                      </div>
                      <div className="admin-stats grid grid-cols-2 gap-3 lg:grid-cols-4">
                      <div className="border border-[#bbb] bg-white p-3"><span className="text-xs text-[#666]">Completed sales</span><strong className="mt-1 block text-xl">{detailedReport.sales.length}</strong></div>
                      <div className="border border-[#bbb] bg-white p-3"><span className="text-xs text-[#666]">Gross sales</span><strong className="mt-1 block text-xl">{currency(detailedReport.grossSales)}</strong></div>
                      <div className="border border-[#bbb] bg-white p-3"><span className="text-xs text-[#666]">Discounts</span><strong className="mt-1 block text-xl">-{currency(detailedReport.discounts)}</strong></div>
                      <div className="border border-[#bbb] bg-white p-3"><span className="text-xs text-[#666]">Points redeemed</span><strong className="mt-1 block text-xl">-{currency(detailedReport.redeemed)}</strong></div>
                      <div className="border border-[#bbb] bg-white p-3"><span className="text-xs text-[#666]">Tax collected (net of refunds)</span><strong className="mt-1 block text-xl">{currency(detailedReport.taxCollected)}</strong></div>
                      <div className="border border-[#bbb] bg-white p-3"><span className="text-xs text-[#666]">Net sales</span><strong className="mt-1 block text-xl">{currency(detailedReport.netSales)}</strong></div>
                      <div className="border border-[#bbb] bg-white p-3"><span className="text-xs text-[#666]">Refunds</span><strong className="mt-1 block text-xl">-{currency(detailedReport.refundTotal)}</strong></div>
                      <div className="border border-[#bbb] bg-white p-3"><span className="text-xs text-[#666]">Expenses ({detailedReport.expenses.length})</span><strong className="mt-1 block text-xl">-{currency(detailedReport.expenseTotal)}</strong></div>
                      <div className="border border-[#bbb] bg-[#eaf4e3] p-3"><span className="text-xs text-[#555]">Net takings</span><strong className="mt-1 block text-xl">{currency(detailedReport.netTakings)}</strong></div>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <div className="border border-[#bbb] bg-white p-3"><span className="text-xs text-[#666]">Current stock on hand</span><strong className="mt-1 block text-xl">{totalStockWeight.toFixed(3)} kg</strong><span className="text-xs text-[#666]">{inStockCount} products in stock</span></div>
                      <div className="border border-[#bbb] bg-white p-3"><span className="text-xs text-[#666]">Stock received in range</span><strong className="mt-1 block text-xl">{detailedReport.stockReceived.toFixed(3)} kg</strong><span className="text-xs text-[#666]">{detailedReport.receipts.length} deliveries · {currency(detailedReport.stockCost)} recorded cost</span></div>
                      <div className="border border-[#bbb] bg-white p-3"><span className="text-xs text-[#666]">Average sale</span><strong className="mt-1 block text-xl">{currency(detailedReport.sales.length ? detailedReport.netSales / detailedReport.sales.length : 0)}</strong><span className="text-xs text-[#666]">Based on completed sales in range</span></div>
                      </div>
                    </section>
                    <section className="report-table-section overflow-x-auto border border-[#bbb] bg-white" data-report-print-section="tender-breakdown">
                      {reportTemplateHeader('Tender breakdown')}
                      <div className="report-section-title flex items-center justify-between gap-3 border-b border-[#ccc] bg-[#e9e9e6] px-3 py-2">
                        <h4 className="font-bold">Tender breakdown</h4>
                        <button className="report-section-print-button touch-button blue min-h-9 px-3 text-sm font-bold" onClick={() => printDetailedReport('tender-breakdown')} type="button">Print · A4</button>
                      </div>
                      <table className="admin-table w-full text-left text-sm">
                        <thead><tr><th>Payment method</th><th className="text-right">Transactions</th><th className="text-right">Amount collected</th></tr></thead>
                        <tbody>
                          {Object.keys(detailedReport.tenders).length ? Object.entries(detailedReport.tenders).map(([method, amount]) => (
                            <tr className="border-t border-[#ddd]" key={method}><td>{method}</td><td className="text-right">{detailedReport.sales.reduce((count, sale) => count + sale.payments.filter((payment) => payment.method === method).length, 0)}</td><td className="text-right font-semibold">{currency(amount)}</td></tr>
                          )) : <tr className="border-t border-[#ddd]"><td className="text-center text-[#666]" colSpan="3">No payments in this range.</td></tr>}
                        </tbody>
                      </table>
                    </section>
                    <section className="report-table-section overflow-x-auto border border-[#bbb] bg-white" data-report-print-section="product-performance">
                      {reportTemplateHeader('Product performance')}
                      <div className="report-section-title flex items-center justify-between gap-3 border-b border-[#ccc] bg-[#e9e9e6] px-3 py-2">
                        <h4 className="font-bold">Product performance</h4>
                        <button className="report-section-print-button touch-button blue min-h-9 px-3 text-sm font-bold" onClick={() => printDetailedReport('product-performance')} type="button">Print · A4</button>
                      </div>
                      <table className="admin-table w-full text-left text-sm">
                        <thead><tr><th>Product</th><th className="text-right">Sold (kg)</th><th className="text-right">Gross</th><th className="text-right">Returned (kg)</th><th className="text-right">Refunded</th><th className="text-right">Net sales</th></tr></thead>
                        <tbody>
                          {detailedReport.products.length ? detailedReport.products.map((product, index) => (
                            <tr className={`border-t border-[#ddd] ${paginationRowClass('report-products', index, detailedReport.products.length)}`} key={product.id}><td className="font-semibold">{product.name}</td><td className="text-right">{product.quantity.toFixed(3)}</td><td className="text-right">{currency(product.gross)}</td><td className="text-right">{product.refundQuantity.toFixed(3)}</td><td className="text-right">-{currency(product.refundAmount)}</td><td className="text-right font-bold">{currency(product.net)}</td></tr>
                          )) : <tr className="border-t border-[#ddd]"><td className="text-center text-[#666]" colSpan="6">No product sales in this range.</td></tr>}
                        </tbody>
                      </table>
                      <div className="report-pagination">{renderPagination('report-products', detailedReport.products.length, 'product performance rows')}</div>
                    </section>
                    <section className="report-table-section overflow-x-auto border border-[#bbb] bg-white" data-report-print-section="completed-sales">
                      {reportTemplateHeader('Completed sales')}
                      <div className="report-section-title flex items-center justify-between gap-3 border-b border-[#ccc] bg-[#e9e9e6] px-3 py-2">
                        <h4 className="font-bold">Completed sales</h4>
                        <button className="report-section-print-button touch-button blue min-h-9 px-3 text-sm font-bold" onClick={() => printDetailedReport('completed-sales')} type="button">Print · A4</button>
                      </div>
                      <table className="admin-table w-full text-left text-sm">
                        <thead><tr><th>Receipt</th><th>Date</th><th>Customer</th><th>Items</th><th>Payment</th><th className="text-right">Subtotal</th><th className="text-right">Discount</th><th className="text-right">Total</th></tr></thead>
                        <tbody>
                          {detailedReport.sales.length ? detailedReport.sales.map((sale, index) => (
                            <tr className={`border-t border-[#ddd] ${paginationRowClass('report-sales', index, detailedReport.sales.length)}`} key={sale.id}><td className="font-semibold">{sale.number}</td><td>{sale.createdAt}</td><td>{sale.customer}</td><td>{sale.items.length}</td><td>{sale.method}</td><td className="text-right">{currency(sale.subtotal)}</td><td className="text-right">-{currency(sale.discount + sale.redeemAmount)}</td><td className="text-right font-bold">{currency(sale.total)}</td></tr>
                          )) : <tr className="border-t border-[#ddd]"><td className="text-center text-[#666]" colSpan="8">No completed sales in this range.</td></tr>}
                        </tbody>
                      </table>
                      <div className="report-pagination">{renderPagination('report-sales', detailedReport.sales.length, 'completed sales rows')}</div>
                    </section>
                    <div className="report-detail-grid grid gap-4 xl:grid-cols-2">
                      <section className="report-table-section overflow-x-auto border border-[#bbb] bg-white" data-report-print-section="refund-detail">
                        {reportTemplateHeader('Refund detail')}
                        <div className="report-section-title flex items-center justify-between gap-3 border-b border-[#ccc] bg-[#e9e9e6] px-3 py-2">
                          <h4 className="font-bold">Refund detail</h4>
                          <button className="report-section-print-button touch-button blue min-h-9 px-3 text-sm font-bold" onClick={() => printDetailedReport('refund-detail')} type="button">Print · A4</button>
                        </div>
                        <table className="admin-table w-full text-left text-sm">
                          <thead><tr><th>Sale</th><th>Date</th><th>Reason</th><th>Method</th><th className="text-right">Amount</th></tr></thead>
                          <tbody>
                            {detailedReport.refunds.length ? detailedReport.refunds.map((refund, index) => (
                              <tr className={`border-t border-[#ddd] ${paginationRowClass('report-refunds', index, detailedReport.refunds.length)}`} key={refund.id}><td>{refund.saleNumber}</td><td>{refund.createdAt}</td><td>{refund.reason}</td><td>{refund.method}</td><td className="text-right">-{currency(refund.amount)}</td></tr>
                            )) : <tr className="border-t border-[#ddd]"><td className="text-center text-[#666]" colSpan="5">No refunds in this range.</td></tr>}
                          </tbody>
                        </table>
                        <div className="report-pagination">{renderPagination('report-refunds', detailedReport.refunds.length, 'refund rows')}</div>
                      </section>
                      <section className="report-table-section overflow-x-auto border border-[#bbb] bg-white" data-report-print-section="expense-detail">
                        {reportTemplateHeader('Expense detail')}
                        <div className="report-section-title flex items-center justify-between gap-3 border-b border-[#ccc] bg-[#e9e9e6] px-3 py-2">
                          <h4 className="font-bold">Expense detail</h4>
                          <button className="report-section-print-button touch-button blue min-h-9 px-3 text-sm font-bold" onClick={() => printDetailedReport('expense-detail')} type="button">Print · A4</button>
                        </div>
                        <table className="admin-table w-full text-left text-sm">
                          <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Method</th><th className="text-right">Amount</th></tr></thead>
                          <tbody>
                            {detailedReport.expenses.length ? detailedReport.expenses.map((expense, index) => (
                              <tr className={`border-t border-[#ddd] ${paginationRowClass('report-expenses', index, detailedReport.expenses.length)}`} key={expense.id}><td>{expense.createdAt}</td><td>{expense.description}</td><td>{expense.category}</td><td>{expense.method}</td><td className="text-right">-{currency(expense.amount)}</td></tr>
                            )) : <tr className="border-t border-[#ddd]"><td className="text-center text-[#666]" colSpan="5">No expenses in this range.</td></tr>}
                          </tbody>
                        </table>
                        <div className="report-pagination">{renderPagination('report-expenses', detailedReport.expenses.length, 'expense rows')}</div>
                      </section>
                    </div>
                    <section className="report-table-section overflow-x-auto border border-[#bbb] bg-white" data-report-print-section="stock-delivery-detail">
                      {reportTemplateHeader('Stock delivery detail')}
                      <div className="report-section-title flex items-center justify-between gap-3 border-b border-[#ccc] bg-[#e9e9e6] px-3 py-2">
                        <h4 className="font-bold">Stock delivery detail</h4>
                        <button className="report-section-print-button touch-button blue min-h-9 px-3 text-sm font-bold" onClick={() => printDetailedReport('stock-delivery-detail')} type="button">Print · A4</button>
                      </div>
                      <table className="admin-table w-full text-left text-sm">
                        <thead><tr><th>Date</th><th>Product</th><th>Supplier</th><th>Reference</th><th className="text-right">Quantity (kg)</th><th className="text-right">Unit cost</th><th className="text-right">Total cost</th></tr></thead>
                        <tbody>
                          {detailedReport.receipts.length ? detailedReport.receipts.map((item, index) => (
                            <tr className={`border-t border-[#ddd] ${paginationRowClass('report-receipts', index, detailedReport.receipts.length)}`} key={item.id}><td>{item.receivedAt}</td><td>{item.product}</td><td>{item.supplier}</td><td>{item.reference}</td><td className="text-right">{item.quantity.toFixed(3)}</td><td className="text-right">{currency(item.unitCost)}</td><td className="text-right">{currency(item.quantity * item.unitCost)}</td></tr>
                          )) : <tr className="border-t border-[#ddd]"><td className="text-center text-[#666]" colSpan="7">No stock deliveries in this range.</td></tr>}
                        </tbody>
                      </table>
                      <div className="report-pagination">{renderPagination('report-receipts', detailedReport.receipts.length, 'stock delivery rows')}</div>
                    </section>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {quotationPreview && (
        <>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={() => setQuotationPreview(null)}>
            <section
              aria-label="Quotation created"
              aria-modal="true"
              className="payment-modal w-full max-w-[520px] border-2 border-[#666] bg-[#f2f2ef] shadow-2xl"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
            >
              <div className="border-b border-[#aaa] px-4 py-3">
                <h2 className="text-lg font-bold text-[#315e25]">Quotation created</h2>
                <p className="text-xs text-[#666]">Quote {quotationPreview.number} · valid until {quotationPreview.validUntil}</p>
              </div>
              <div className="max-h-[55dvh] space-y-2 overflow-y-auto p-4 text-sm">
                <div className="flex justify-between gap-2"><span>Customer</span><strong>{quotationPreview.customer}</strong></div>
                {quotationPreview.customerContact && <div className="flex justify-between gap-2"><span>Contact</span><strong>{quotationPreview.customerContact}</strong></div>}
                {quotationPreview.customerTaxId && <div className="flex justify-between gap-2"><span>ABN / Tax ID</span><strong>{quotationPreview.customerTaxId}</strong></div>}
                <div className="border-y border-[#ccc] py-2">
                  {quotationPreview.items.map((item) => (
                    <div className="flex justify-between gap-2 py-1" key={item.id}>
                      <span>{item.name} · {item.weight.toFixed(3)} kg × {currency(item.price)}/kg</span>
                      <strong className="shrink-0">{currency(item.weight * item.price)}</strong>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between"><span>Subtotal</span><strong>{currency(quotationPreview.subtotal)}</strong></div>
                <div className="flex justify-between"><span>Discount</span><strong>-{currency(quotationPreview.discount)}</strong></div>
                {quotationPreview.taxRate > 0 && <div className="flex justify-between"><span>{quotationPreview.taxName} {quotationPreview.taxInclusive ? 'included' : 'added'}</span><strong>{currency(quotationPreview.taxAmount)}</strong></div>}
                <div className="flex justify-between text-base font-bold"><span>{quotationPreview.taxRate > 0 ? 'Quote total (tax included)' : 'Quote total'}</span><strong>{currency(quotationPreview.total)}</strong></div>
              </div>
              <div className="flex justify-end gap-2 border-t border-[#aaa] p-3">
                <button className="touch-button gray min-h-11 px-5 font-semibold" onClick={() => setQuotationPreview(null)} type="button">Done</button>
                <button className="touch-button blue min-h-11 px-5 font-bold" onClick={() => window.print()} type="button">Print quotation</button>
              </div>
            </section>
          </div>
          <section aria-label="Printable quotation" className="thermal-print">
            <header className="thermal-center">
              {companyDetails.logoDataUrl && <img alt="" className="thermal-logo" src={companyDetails.logoDataUrl} />}
              <h1>{companyDetails.name}</h1>
              {companyDetails.address && <span>{companyDetails.address}</span>}
              {companyDetails.phone && <span>{companyDetails.phone}</span>}
              {companyDetails.email && <span>{companyDetails.email}</span>}
              {companyDetails.taxId && <span>ABN / Tax: {companyDetails.taxId}</span>}
              {companyDetails.website && <span>{companyDetails.website}</span>}
              <strong>QUOTATION</strong>
              <span>Quote {quotationPreview.number}</span>
              <span>Created: {quotationPreview.createdAt}</span>
              <span>Valid until: {quotationPreview.validUntil}</span>
            </header>
            <div className="thermal-rule" />
            <div className="thermal-row"><span>Customer</span><strong>{quotationPreview.customer}</strong></div>
            {quotationPreview.customerContact && <div className="thermal-row"><span>Contact</span><strong>{quotationPreview.customerContact}</strong></div>}
            {quotationPreview.customerTaxId && <div className="thermal-row"><span>ABN / Tax ID</span><strong>{quotationPreview.customerTaxId}</strong></div>}
            <div className="thermal-rule" />
            {quotationPreview.items.map((item) => (
              <div className="thermal-receipt-item" key={item.id}>
                <strong>{item.name}</strong>
                <div className="thermal-row">
                  <span>{item.weight.toFixed(3)} kg × {currency(item.price)}/kg</span>
                  <strong>{currency(item.weight * item.price)}</strong>
                </div>
              </div>
            ))}
            <div className="thermal-rule" />
            <div className="thermal-row"><span>Subtotal</span><strong>{currency(quotationPreview.subtotal)}</strong></div>
            <div className="thermal-row"><span>Discount</span><strong>-{currency(quotationPreview.discount)}</strong></div>
            {quotationPreview.taxRate > 0 && <div className="thermal-row"><span>{quotationPreview.taxName} {quotationPreview.taxInclusive ? 'included' : 'added'}</span><strong>{currency(quotationPreview.taxAmount)}</strong></div>}
            <div className="thermal-rule" />
            <div className="thermal-row thermal-total"><span>{quotationPreview.taxRate > 0 ? 'QUOTE TOTAL (TAX INCLUDED)' : 'QUOTE TOTAL'}</span><strong>{currency(quotationPreview.total)}</strong></div>
            <div className="thermal-rule" />
            <p>Quotation only — not a tax invoice. Valid until {quotationPreview.validUntil}. Prices subject to availability.</p>
            {companyDetails.receiptMessage && <p className="thermal-center">{companyDetails.receiptMessage}</p>}
          </section>
        </>
      )}

      {dayEndOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-4" onClick={() => setDayEndOpen(false)}>
          <section
            aria-label="Day end summary"
            aria-modal="true"
            className="payment-modal flex max-h-[94dvh] w-full max-w-[760px] flex-col border-2 border-[#666] bg-[#f2f2ef] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-[#aaa] px-4 py-3">
              <div>
                <h2 className="text-lg font-bold">Day end summary</h2>
                <p className="text-xs text-[#666]">Review sales and tender totals before closing the day.</p>
              </div>
              <button aria-label="Close day end summary" className="touch-button red h-9 w-10 text-lg" onClick={() => setDayEndOpen(false)} type="button">×</button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              {dayEndHasActivity ? (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <div className="border border-[#bbb] bg-white p-3"><span className="text-xs text-[#666]">Completed sales</span><strong className="mt-1 block text-xl">{dayEndSales.length}</strong></div>
                    <div className="border border-[#bbb] bg-white p-3"><span className="text-xs text-[#666]">Gross sales</span><strong className="mt-1 block text-xl">{currency(dayEndSummary.grossSales)}</strong></div>
                    <div className="border border-[#bbb] bg-white p-3"><span className="text-xs text-[#666]">Discounts</span><strong className="mt-1 block text-xl">-{currency(dayEndSummary.discounts)}</strong></div>
                    <div className="border border-[#bbb] bg-white p-3"><span className="text-xs text-[#666]">Points redeemed</span><strong className="mt-1 block text-xl">-{currency(dayEndSummary.pointsRedeemed)}</strong></div>
                    <div className="border border-[#bbb] bg-white p-3"><span className="text-xs text-[#666]">Net sales</span><strong className="mt-1 block text-xl">{currency(dayEndSummary.netSales)}</strong></div>
                    <div className="border border-[#bbb] bg-white p-3"><span className="text-xs text-[#666]">Tax collected (net of refunds)</span><strong className="mt-1 block text-xl">{currency(dayEndSummary.taxCollected)}</strong></div>
                    <div className="border border-[#bbb] bg-white p-3"><span className="text-xs text-[#666]">Refunds</span><strong className="mt-1 block text-xl">-{currency(dayEndSummary.refunds)}</strong></div>
                    <div className="border border-[#bbb] bg-white p-3"><span className="text-xs text-[#666]">Expenses ({dayEndExpenses.length})</span><strong className="mt-1 block text-xl">-{currency(dayEndSummary.expenses)}</strong></div>
                    <div className="col-span-2 border border-[#bbb] bg-[#eaf4e3] p-3 sm:col-span-3"><span className="text-xs text-[#555]">Net takings after refunds and expenses</span><strong className="mt-1 block text-2xl">{currency(dayEndSummary.netSales - dayEndSummary.refunds - dayEndSummary.expenses)}</strong></div>
                  </div>
                  <div className="border border-[#bbb] bg-white">
                    <h3 className="border-b border-[#ccc] bg-[#e9e9e6] px-3 py-2 text-sm font-bold">Tender summary</h3>
                    <div className="divide-y divide-[#e2e2e2] px-3">
                      {Array.from(new Set([...Object.keys(dayEndSummary.tenders), ...Object.keys(dayEndSummary.refundTenders), ...Object.keys(dayEndSummary.expenseTenders)])).map((method) => {
                        const received = dayEndSummary.tenders[method] ?? 0
                        const refunded = dayEndSummary.refundTenders[method] ?? 0
                        const spent = dayEndSummary.expenseTenders[method] ?? 0
                        return (
                          <div className="flex justify-between gap-3 py-2 text-sm" key={method}>
                            <span>{method}</span>
                            <span className="text-right">{currency(received)} received <span className="text-[#777]">· {currency(refunded)} refunded · {currency(spent)} expenses</span></span>
                          </div>
                        )
                      })}
                      <div className="flex justify-between gap-3 py-2 text-sm font-bold">
                        <span>Cash expected after refunds and expenses</span>
                        <span>{currency(expectedCash)}</span>
                      </div>
                      <label className="grid gap-2 border-t border-[#ddd] py-3 text-sm font-semibold sm:grid-cols-[1fr_180px] sm:items-center">
                        Physical cash counted
                        <input
                          aria-label="Physical cash counted"
                          className="admin-input"
                          inputMode="decimal"
                          min="0"
                          onChange={(event) => { setDayEndCashCount(event.target.value); setDayEndCashError('') }}
                          placeholder="0.00"
                          step="0.01"
                          type="number"
                          value={dayEndCashCount}
                        />
                      </label>
                      <div aria-live="polite" className="flex justify-between gap-3 pb-3 text-sm">
                        <span>Cash variance {dayEndCashVariance === null ? '(count required to calculate)' : '(counted − expected)'}</span>
                        <strong className={dayEndCashVariance === null ? 'text-[#666]' : dayEndCashVariance === 0 ? 'text-[#315e25]' : dayEndCashVariance > 0 ? 'text-[#315e25]' : 'text-[#a33a2b]'}>
                          {dayEndCashVariance === null ? '—' : `${dayEndCashVariance > 0 ? '+' : ''}${currency(dayEndCashVariance)}`}
                        </strong>
                      </div>
                      {dayEndCashError && <p aria-live="assertive" className="mb-3 border border-[#e5aaaa] bg-[#fff0f0] p-2 text-sm font-semibold text-[#a51f1f]">{dayEndCashError}</p>}
                    </div>
                  </div>
                  <div className="border border-[#bbb] bg-white">
                    <h3 className="border-b border-[#ccc] bg-[#e9e9e6] px-3 py-2 text-sm font-bold">Expense entries</h3>
                    {dayEndExpenses.length ? (
                      <div className="divide-y divide-[#e2e2e2] px-3">
                        {dayEndExpenses.map((expense) => (
                          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm" key={expense.id}>
                            <span className="min-w-0"><strong>{expense.description}</strong><span className="ml-2 text-xs text-[#666]">{expense.category} · {expense.method}</span></span>
                            <strong className="shrink-0">-{currency(expense.amount)}</strong>
                          </div>
                        ))}
                      </div>
                    ) : <p className="px-3 py-3 text-sm text-[#666]">No expenses recorded in this period.</p>}
                  </div>
                  <p className="text-xs text-[#666]">Closing the day saves this summary and starts a new day-end period. Completed sales remain available for refunds and reports.</p>
                </>
              ) : (
                <div className="border border-dashed border-[#aaa] bg-white p-5 text-center">
                  <h3 className="font-bold">No activity to close</h3>
                  <p className="mt-1 text-sm text-[#666]">There have been no sales, refunds, or expenses since the last day end.</p>
                  {dayEndReports[0] && <p className="mt-3 text-xs text-[#666]">Last day closed: {dayEndReports[0].closedAt} · Net takings {currency(dayEndReports[0].netTakings)} · Cash expected {currency(dayEndReports[0].cashExpected)} · Counted {currency(dayEndReports[0].cashCounted)} · Variance {dayEndReports[0].cashVariance > 0 ? '+' : ''}{currency(dayEndReports[0].cashVariance)} · Closed by {dayEndReports[0].closedBy}</p>}
                </div>
              )}
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-[#aaa] p-3">
              <button className="touch-button blue min-h-11 px-5 font-bold disabled:cursor-not-allowed disabled:opacity-50" disabled={!dayEndHasActivity} onClick={() => window.print()} type="button">Print day end</button>
              <button className="touch-button gray min-h-11 px-5 font-semibold" onClick={() => setDayEndOpen(false)} type="button">Back to POS</button>
              <button className="touch-button red min-h-11 px-5 font-bold disabled:cursor-not-allowed disabled:opacity-50" disabled={!dayEndHasActivity} onClick={closeDay} type="button">Close day</button>
            </div>
          </section>
        </div>
      )}

      {dayEndOpen && (
        <section aria-label="Printable day-end receipt" className="thermal-print">
          <header className="thermal-center">
            {companyDetails.logoDataUrl && <img alt="" className="thermal-logo" src={companyDetails.logoDataUrl} />}
            <h1>{companyDetails.name}</h1>
            {companyDetails.address && <span>{companyDetails.address}</span>}
            {companyDetails.phone && <span>{companyDetails.phone}</span>}
            {companyDetails.email && <span>{companyDetails.email}</span>}
            {companyDetails.taxId && <span>ABN / Tax: {companyDetails.taxId}</span>}
            {companyDetails.website && <span>{companyDetails.website}</span>}
            <strong>DAY END SUMMARY</strong>
            <span>{new Date().toLocaleString()}</span>
            <span>Till 01 · {currentUsername.toLocaleUpperCase()}</span>
          </header>
          <div className="thermal-rule" />
          <div className="thermal-row"><span>Completed sales</span><strong>{dayEndSales.length}</strong></div>
          <div className="thermal-row"><span>Gross sales</span><strong>{currency(dayEndSummary.grossSales)}</strong></div>
          <div className="thermal-row"><span>Discounts</span><strong>-{currency(dayEndSummary.discounts)}</strong></div>
          <div className="thermal-row"><span>Points redeemed</span><strong>-{currency(dayEndSummary.pointsRedeemed)}</strong></div>
          <div className="thermal-row"><span>Tax collected (net of refunds)</span><strong>{currency(dayEndSummary.taxCollected)}</strong></div>
          <div className="thermal-row"><span>Net sales</span><strong>{currency(dayEndSummary.netSales)}</strong></div>
          <div className="thermal-row"><span>Refunds</span><strong>-{currency(dayEndSummary.refunds)}</strong></div>
          <div className="thermal-row"><span>Expenses</span><strong>-{currency(dayEndSummary.expenses)}</strong></div>
          <div className="thermal-rule" />
          <div className="thermal-row thermal-total"><span>NET TAKINGS</span><strong>{currency(dayEndSummary.netSales - dayEndSummary.refunds - dayEndSummary.expenses)}</strong></div>
          <div className="thermal-rule" />
          <h2>TENDER SUMMARY</h2>
          {Array.from(new Set([...Object.keys(dayEndSummary.tenders), ...Object.keys(dayEndSummary.refundTenders), ...Object.keys(dayEndSummary.expenseTenders)])).map((method) => (
            <div className="thermal-row" key={method}>
              <span>{method}<small>In {currency(dayEndSummary.tenders[method] ?? 0)} · Out {currency((dayEndSummary.refundTenders[method] ?? 0) + (dayEndSummary.expenseTenders[method] ?? 0))}</small></span>
              <strong>{currency((dayEndSummary.tenders[method] ?? 0) - (dayEndSummary.refundTenders[method] ?? 0) - (dayEndSummary.expenseTenders[method] ?? 0))}</strong>
            </div>
          ))}
          <div className="thermal-row thermal-total"><span>CASH EXPECTED</span><strong>{currency(expectedCash)}</strong></div>
          <div className="thermal-row"><span>CASH COUNTED</span><strong>{dayEndCashVariance === null ? 'NOT ENTERED' : currency(parsedDayEndCashCount)}</strong></div>
          <div className="thermal-row"><span>OVER / SHORT</span><strong>{dayEndCashVariance === null ? 'NOT RECONCILED' : `${dayEndCashVariance > 0 ? '+' : ''}${currency(dayEndCashVariance)}`}</strong></div>
          <div className="thermal-rule" />
          <h2>EXPENSES ({dayEndExpenses.length})</h2>
          {dayEndExpenses.length ? dayEndExpenses.map((expense) => (
            <div className="thermal-row" key={expense.id}>
              <span>{expense.description}<small>{expense.category} · {expense.method}</small></span>
              <strong>-{currency(expense.amount)}</strong>
            </div>
          )) : <p>No expenses recorded.</p>}
          <div className="thermal-rule" />
          <p className="thermal-center">{companyDetails.receiptMessage || 'End of day report'}</p>
        </section>
      )}

      {completedSale && (
        <>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={() => setCompletedSale(null)}>
            <section
              aria-label="Payment successful"
              aria-modal="true"
              className="payment-modal w-full max-w-[480px] border-2 border-[#666] bg-[#f2f2ef] shadow-2xl"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
            >
              <div className="border-b border-[#aaa] px-4 py-3">
                <h2 className="text-lg font-bold text-[#315e25]">Payment successful</h2>
                <p className="text-xs text-[#666]">Sale {completedSale.number} · {completedSale.createdAt}</p>
              </div>
              <div className="space-y-2 p-4 text-sm">
                <div className="flex justify-between"><span>Customer</span><strong>{completedSale.customer}</strong></div>
                {completedSale.customerContact && <div className="flex justify-between"><span>Contact</span><strong>{completedSale.customerContact}</strong></div>}
                {completedSale.customerTaxId && <div className="flex justify-between"><span>ABN / Tax ID</span><strong>{completedSale.customerTaxId}</strong></div>}
                {completedSale.taxRate > 0 && <div className="flex justify-between"><span>{completedSale.taxName} {completedSale.taxInclusive ? 'included' : 'added'}</span><strong>{currency(completedSale.taxAmount)}</strong></div>}
                <div className="flex justify-between"><span>Total</span><strong>{currency(completedSale.total)}</strong></div>
                <div className="flex justify-between"><span>Payment method</span><strong>{completedSale.method}</strong></div>
                {completedSale.payments.some((payment) => payment.change > 0) && (
                  <div className="flex justify-between"><span>Change</span><strong>{currency(completedSale.payments.reduce((total, payment) => total + payment.change, 0))}</strong></div>
                )}
              </div>
              <div className="flex justify-end gap-2 border-t border-[#aaa] p-3">
                <button className="touch-button gray min-h-11 px-5 font-semibold" onClick={() => setCompletedSale(null)} type="button">Done</button>
                <button className="touch-button blue min-h-11 px-5 font-bold" onClick={() => window.print()} type="button">Print receipt</button>
              </div>
            </section>
          </div>
          <section aria-label="Printable sales receipt" className="thermal-print">
            <header className="thermal-center">
              {companyDetails.logoDataUrl && <img alt="" className="thermal-logo" src={companyDetails.logoDataUrl} />}
              <h1>{companyDetails.name}</h1>
              {companyDetails.address && <span>{companyDetails.address}</span>}
              {companyDetails.phone && <span>{companyDetails.phone}</span>}
              {companyDetails.email && <span>{companyDetails.email}</span>}
              {companyDetails.taxId && <span>ABN / Tax: {companyDetails.taxId}</span>}
              {companyDetails.website && <span>{companyDetails.website}</span>}
              <strong>SALES RECEIPT</strong>
              <span>Sale {completedSale.number}</span>
              <span>{completedSale.createdAt}</span>
            </header>
            <div className="thermal-rule" />
            <div className="thermal-row"><span>Customer</span><strong>{completedSale.customer}</strong></div>
            {completedSale.customerContact && <div className="thermal-row"><span>Contact</span><strong>{completedSale.customerContact}</strong></div>}
            {completedSale.customerTaxId && <div className="thermal-row"><span>ABN / Tax ID</span><strong>{completedSale.customerTaxId}</strong></div>}
            <div className="thermal-rule" />
            {completedSale.items.map((item) => (
              <div className="thermal-receipt-item" key={item.id}>
                <strong>{item.name}</strong>
                <div className="thermal-row">
                  <span>{item.quantity.toFixed(3)} kg × {currency(item.price)}/kg</span>
                  <strong>{currency(item.quantity * item.price)}</strong>
                </div>
              </div>
            ))}
            <div className="thermal-rule" />
            <div className="thermal-row"><span>Subtotal</span><strong>{currency(completedSale.subtotal)}</strong></div>
            <div className="thermal-row"><span>Discount</span><strong>-{currency(completedSale.discount)}</strong></div>
            {completedSale.redeemAmount > 0 && (
              <div className="thermal-row"><span>Points redeemed</span><strong>-{currency(completedSale.redeemAmount)}</strong></div>
            )}
            {completedSale.taxRate > 0 && <div className="thermal-row"><span>{completedSale.taxName} {completedSale.taxInclusive ? 'included' : 'added'}</span><strong>{currency(completedSale.taxAmount)}</strong></div>}
            <div className="thermal-rule" />
            <div className="thermal-row thermal-total"><span>TOTAL</span><strong>{currency(completedSale.total)}</strong></div>
            <div className="thermal-rule" />
            <h2>PAYMENT</h2>
            {completedSale.payments.map((payment, index) => (
              <div className="thermal-row" key={`${payment.createdAt}-${index}`}>
                <span>{payment.method}</span>
                <strong>{currency(payment.amount)}</strong>
              </div>
            ))}
            {completedSale.payments.some((payment) => payment.change > 0) && (
              <div className="thermal-row"><span>Change</span><strong>{currency(completedSale.payments.reduce((total, payment) => total + payment.change, 0))}</strong></div>
            )}
            <div className="thermal-rule" />
            <p className="thermal-center">{companyDetails.receiptMessage}</p>
          </section>
        </>
      )}

      {expenseOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-4" onClick={() => setExpenseOpen(false)}>
          <section
            aria-label="Record expense"
            aria-modal="true"
            className="payment-modal w-full max-w-[500px] border-2 border-[#666] bg-[#f2f2ef] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="flex items-center justify-between border-b border-[#aaa] px-4 py-3">
              <div>
                <h2 className="text-lg font-bold">Record expense</h2>
                <p className="text-xs text-[#666]">Add a business expense to this day-end period.</p>
              </div>
              <button aria-label="Close expense form" className="touch-button red h-9 w-10 text-lg" onClick={() => setExpenseOpen(false)} type="button">×</button>
            </div>
            <form className="grid gap-3 p-4" onSubmit={recordExpense}>
              <label className="admin-field">Category
                <select className="admin-input" onChange={(event) => setExpenseDraft((current) => ({ ...current, category: event.target.value }))} value={expenseDraft.category}>
                  {['Food', 'Supplies', 'Transport', 'Utilities', 'Maintenance', 'Other'].map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
              <label className="admin-field">What was it for?
                <input autoFocus className="admin-input" onChange={(event) => { setExpenseDraft((current) => ({ ...current, description: event.target.value })); setExpenseError('') }} placeholder="e.g. Staff lunch or cleaning supplies" required value={expenseDraft.description} />
              </label>
              <label className="admin-field">Amount
                <input className="admin-input" inputMode="decimal" onChange={(event) => { setExpenseDraft((current) => ({ ...current, amount: event.target.value })); setExpenseError('') }} placeholder="0.00" required step="0.01" min="0.01" type="number" value={expenseDraft.amount} />
              </label>
              <label className="admin-field">Paid from
                <select className="admin-input" onChange={(event) => setExpenseDraft((current) => ({ ...current, method: event.target.value }))} value={expenseDraft.method}>
                  {paymentMethods.map((method) => <option key={method}>{method}</option>)}
                </select>
              </label>
              {expenseError && <p aria-live="assertive" className="border border-[#e5aaaa] bg-[#fff0f0] p-2 text-sm font-semibold text-[#a51f1f]">{expenseError}</p>}
              <div className="mt-1 flex justify-end gap-2 border-t border-[#ccc] pt-3">
                <button className="touch-button gray min-h-11 px-4 font-semibold" onClick={() => setExpenseOpen(false)} type="button">Cancel</button>
                <button className="touch-button green min-h-11 px-5 font-bold" type="submit">Save expense</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {paymentOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-4" onClick={() => setPaymentOpen(false)}>
          <section aria-label="Payment" aria-modal="true" className="payment-modal max-h-[94dvh] w-full max-w-[780px] overflow-y-auto border-2 border-[#666] bg-[#f2f2ef] p-4 shadow-2xl" onClick={(event) => event.stopPropagation()} role="dialog">
            <div className="mb-3 flex items-center justify-between border-b border-[#aaa] pb-2">
              <h2 className="text-[17px] font-bold">Payment</h2>
              <button aria-label="Close payment" className="touch-button red h-8 w-9" onClick={() => setPaymentOpen(false)} type="button">×</button>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
              <div className="space-y-2 border border-[#bbb] bg-white p-3 text-[13px]">
                <div className="flex justify-between"><span>Customer</span><strong>{selectedCustomer?.name ?? 'Cash Customer'}</strong></div>
                <div className="flex justify-between"><span>Total sales</span><strong>{currency(subtotal)}</strong></div>
                <div className="flex justify-between"><span>Discount</span><strong>-{currency(discountAmount)}</strong></div>
                <div className="flex justify-between"><span>Points redeemed</span><strong>-{currency(redeemAmount)} ({redeemedPoints} pts)</strong></div>
                <div className="flex justify-between"><span>Paid</span><strong>{currency(paidAmount)}</strong></div>
                <div className="flex justify-between font-bold"><span>Receivable</span><strong>{currency(paymentBalance)}</strong></div>
                {paymentEntries.length > 0 && (
                  <div className="border-t border-[#ddd] pt-2 text-xs">
                    <span className="mb-1 block font-semibold text-[#555]">Payments received</span>
                    {paymentEntries.map((entry, index) => (
                      <div className="flex justify-between gap-2" key={`${entry.createdAt}-${index}`}>
                        <span>{entry.method}</span><span>{currency(entry.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <label className="mt-4 block font-semibold">Amount tendered
                  <input aria-label="Amount tendered" className="mt-1 w-full border border-[#aaa] bg-white px-2 py-2 text-right text-[18px] font-bold" inputMode="decimal" onChange={(event) => {
                    if (/^\d*\.?\d{0,2}$/.test(event.target.value)) {
                      setCashTendered(event.target.value)
                      setTenderEntryFresh(false)
                      setPaymentError('')
                    }
                  }} type="text" value={cashTendered} />
                </label>
                <div className="flex justify-between font-bold text-[#c93333]"><span>Change (cash)</span><span>{currency(change)}</span></div>
                {paymentError && <p aria-live="assertive" className="border border-[#e5aaaa] bg-[#fff0f0] p-2 text-xs font-semibold text-[#a51f1f]">{paymentError}</p>}
              </div>
              <div className="grid min-h-[220px] grid-cols-3 grid-rows-4 gap-[3px]">
                {['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '.', 'Clear'].map((key) => (
                  <button className={`touch-button ${key === 'Clear' ? 'red' : 'gray'} text-[16px] font-bold`} key={key} onClick={() => enterPaymentKey(key)} type="button">{key}</button>
                ))}
              </div>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-[3px]">
              {[5, 10, 20, 50].map((amount) => (
                <button className="touch-button gray min-h-9 text-sm font-bold" key={amount} onClick={() => setPaymentPreset(amount)} type="button">{currency(amount)}</button>
              ))}
            </div>
            <div className="mt-2 flex justify-end">
              <button className="touch-button gray min-h-9 px-4 text-sm font-semibold" onClick={() => setPaymentPreset(paymentBalance)} type="button">Exact balance · {currency(paymentBalance)}</button>
            </div>
            <div className="mt-3 text-xs text-[#666]">Choose a payment method to record the tender. Partial payments update the balance and can be split across methods.</div>
            <div className="mt-3 grid grid-cols-3 gap-[3px]">
              {paymentMethods.map((method) => <button className="touch-button blue h-11 font-bold" key={method} onClick={() => finishPayment(method)} type="button">{method}</button>)}
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

export default App
