/**
 * Food Seller - module dictionary. English and Marathi are complete; Hindi covers
 * the navigation and falls back to English, as in the Bachat Gat module.
 * Uses the same {var} interpolation as ../../../i18n.ts.
 */

import { Language } from '../../../i18n';

const en = {
  nav_inventory: 'Purchase Products', nav_purchases: 'Purchases', nav_consumption: 'Consumption', nav_menu: 'Selling Products', nav_sales: 'Sales',
  nav_expenses: 'Expenses', nav_reports: 'Reports', nav_ai: 'AI Assistant',

  common_date: 'Date', common_thisMonth: 'This month', common_lastMonth: 'Last month', common_product: 'Product', common_selectProduct: 'Select product',
  common_quantity: 'Quantity', common_qtyShort: 'Qty', common_total: 'Total', common_notes: 'Notes', common_none: 'None', common_add: 'Add', common_addRow: 'Add another product',
  common_remove: 'Remove', common_removeRow: 'Remove this row', common_saved: 'Saved', common_deleted: 'Deleted', common_void: 'Void entry', common_voided: 'Entry voided',
  common_viewAll: 'View all', common_delete: 'Delete',

  st_active: 'Active', st_inactive: 'Inactive', st_posted: 'Posted', st_voided: 'Voided', st_pending: 'Waiting for you', st_confirmed: 'Confirmed', st_rejected: 'Rejected', st_expired: 'Expired',
  pay_cash: 'Cash', pay_upi: 'UPI', pay_credit: 'Credit', pay_split: 'Split',

  stock_ok: 'In stock', stock_low: 'Low stock', stock_out: 'Out of stock', stock_notEnough: 'Not enough stock', stock_shortBy: 'short by {qty} {unit}',
  stock_saveAnyway: 'Save anyway', stock_saveAnywayHint: 'Saving anyway takes stock below zero. Do this only if the stock is physically there but not yet recorded.',
  stock_alertToast: 'Saved. Stock running low: {items}',

  setup_title: 'Welcome to your food business', setup_hint: 'Start with a ready list of common raw materials, consumables and a sample menu (Vada Pav recipe included). You can edit or delete anything later. Prices and stock start at zero.',
  setup_useStarter: 'Add starter products', setup_startEmpty: 'Start with an empty list', setup_done: 'Added {products} products and {foods} food items',

  qa_sale: 'Record sale', qa_purchase: 'Add purchase', qa_consumption: 'Record usage', qa_expense: 'Add expense', qa_ai: 'Ask AI',

  dash_title: 'Food Business Dashboard', dash_netProfitToday: 'Net profit today', dash_netProfit: 'Net profit', dash_monthNet: 'This month', dash_sales: 'Total sales', dash_purchase: 'Total purchase',
  dash_consumption: 'Product consumption', dash_openingStock: 'Opening stock', dash_remainingStock: 'Remaining stock', dash_expenses: 'Total expenses', dash_expensesExcludedHint: '+{amount} in stock costs', dash_gross: 'Gross profit',
  dash_cashReceived: 'Cash received', dash_upiReceived: 'UPI received', dash_pending: 'Pending payments', dash_toCollect: 'To collect from customers', dash_supplierDue: 'Supplier dues', dash_toPay: 'To pay suppliers',
  dash_salesTrend: 'Sales, last 7 days', dash_net: 'Net', dash_cashVsUpi: 'Cash vs UPI', dash_pnlTitle: 'Profit & loss', dash_purchaseNote: 'Purchases stay in stock until used, so they are not taken from profit.',
  dash_fullPnl: 'Full profit & loss', dash_topFoods: 'Profit by food product', dash_noSales: 'No sales recorded yet.', dash_attention: 'Stock needing attention ({count})',

  pnl_title: 'Profit & Loss', pnl_hint: 'Revenue, cost of goods, expenses and net profit, by product and by sale.', pnl_revenue: 'Revenue', pnl_cogs: 'Cost of goods sold', pnl_gross: 'Gross profit',
  pnl_otherExpenses: 'Other expenses', pnl_wastage: 'Wastage & spoilage', pnl_adjustments: 'Stock adjustments', pnl_net: 'Net profit', pnl_note: 'Profit counts what you used and sold, not what you bought. Unsold stock stays in closing stock.',
  pnl_afterDiscount: 'After {amount} discount', pnl_recipeCost: 'Cost of items sold (recipes)', pnl_unmatched: 'Manual usage beyond recipes', pnl_outside: 'Not part of profit', pnl_purchases: 'Purchases (kept in stock)',
  pnl_excludedExpenses: 'Gas, packaging etc. already in stock costs', pnl_outsideHint: 'Personal use is what the owner took for themselves, so it is shown here and not as a business cost.', pnl_byProduct: 'Product-wise profit', pnl_bySale: 'Sales-wise profit',

  inv_title: 'Purchase Products (Stock)', inv_search: 'Search products', inv_needsAttention: 'Needs attention', inv_allCategories: 'All categories', inv_noCategory: 'No category', inv_summary: '{count} products · stock value {value}',
  inv_empty: 'No products yet. Add your raw materials and consumables.',

  prod_add: 'Add purchase product', prod_edit: 'Edit purchase product', prod_delete: 'Delete purchase product', prod_name: 'Product name', prod_category: 'Category', prod_unit: 'Unit', prod_unitHelp: 'The unit stock is counted in. Purchases and recipes can use related units, like Gram for KG.',
  prod_purchasePrice: 'Purchase price (per unit)', prod_sellingPrice: 'Selling price', prod_sellingHelp: 'Only if you also sell this item as it is.', prod_openingStock: 'Opening stock', prod_openingEditHelp: 'Can change only until stock has moved. After that, use a stock adjustment.',
  prod_minAlert: 'Minimum stock alert', prod_supplier: 'Supplier', prod_inStock: 'In stock', prod_stockValue: 'Stock value', prod_avgCost: 'Average cost', prod_history: 'Stock history', prod_alertAt: 'alert at {qty}',
  prod_deleteHint: 'Delete {name}? A product with history is archived, not erased.',

  led_OPENING: 'Opening stock', led_PURCHASE: 'Purchase', led_CONSUMPTION: 'Manual usage', led_SALE_USAGE: 'Used for sales', led_ADJUST_IN: 'Adjustment in', led_ADJUST_OUT: 'Adjustment out', led_WASTAGE: 'Wastage', led_SPOILAGE: 'Spoilage', led_PERSONAL: 'Personal use',

  adj_title: 'Stock adjustment', adj_direction: 'Type', adj_in: 'Add to stock', adj_out: 'Remove from stock', adj_reason: 'Reason', adj_reasonHint: 'e.g. Counted stock, found less', adj_hint: 'Now in stock: {qty} {unit}. Use this when a physical count differs from the app.',

  sup_title: 'Suppliers', sup_add: 'Add supplier', sup_edit: 'Edit supplier', sup_name: 'Supplier name', sup_mobile: 'Mobile', sup_address: 'Address', sup_empty: 'No suppliers yet.', sup_line: '{bills} bills · {total}', sup_due: 'Due', sup_totalPurchases: 'Total purchases',

  cat_title: 'Categories', cat_add: 'Add category', cat_edit: 'Edit category', cat_name: 'Name',
  unit_title: 'Units', unit_add: 'Add unit', unit_edit: 'Edit unit', unit_name: 'Unit name', unit_kind: 'Converts with', unit_custom: 'Nothing (own unit)', unit_mass: 'Weight (KG, Gram)', unit_volume: 'Volume (Liter, ML)', unit_count: 'Count (Pieces, Dozen)',
  unit_kindHelp: 'Units of the same kind convert automatically.', unit_toBase: 'Size in smallest unit', unit_toBaseHelp: 'Grams per unit for weight, ML for volume, pieces for count. Example: KG = 1000.',

  set_title: 'Settings', set_allowNegative: 'Always allow stock below zero', set_allowNegativeHelp: 'Off: you are asked before stock goes below zero.', set_coverDays: 'Days to plan purchases for', set_coverDaysHelp: 'Purchase suggestions keep this many days of stock.',
  set_excessRatio: 'Excess usage alert (times usual)', set_excessRatioHelp: 'Alert when today\'s usage is this many times the usual day.', set_expenseRatio: 'Unusual expense alert (times usual)', set_expenseRatioHelp: 'Alert when an expense is this many times its usual amount.',

  pur_title: 'Daily Purchases', pur_new: 'New purchase', pur_total: 'Purchases', pur_due: 'Due to suppliers', pur_note: 'Purchases add to stock. They reach profit only when the stock is used or sold.', pur_empty: 'No purchases in this period.', pur_allSuppliers: 'All suppliers', pur_noSupplier: 'No supplier',
  pur_items: 'Products bought', pur_rate: 'Rate', pur_payment: 'Payment', pur_paidNow: 'Paid now', pur_paidNowHelp: 'The rest is added to supplier dues.', pur_invoice: 'Invoice number', pur_grandTotal: 'Purchase total', pur_save: 'Save purchase', pur_saved: 'Purchase saved: {total}. Stock updated.',
  pur_rowsProblem: 'Select a product and enter quantity and rate in every row.', pur_addProductFirst: 'Add items in Purchase Products first.', pur_detail: 'Purchase details', pur_paid: 'Paid', pur_voidHint: 'This removes the purchased quantity from stock.', pur_history: 'Purchase history',

  con_title: 'Daily Consumption', con_new: 'Record usage', con_cost: 'Consumption cost', con_lostCost: 'Wastage & personal use', con_noDoubleHint: 'Manual usage and recipe usage of a day are matched: only the larger one leaves stock, so nothing is deducted twice.',
  con_history: 'Usage history', con_todayTable: 'Stock for the day', con_empty: 'No stock movement on this day.', con_available: 'Opening + bought', con_used: 'Used', con_remaining: 'Remaining', con_recipeUsed: 'recipes {qty}', con_lost: 'lost {qty}',
  con_preparation: 'Preparation', con_wastage: 'Wastage', con_spoilage: 'Spoilage', con_personal: 'Personal use', con_items: 'Products used', con_purpose: 'Used for', con_save: 'Save usage', con_rowsProblem: 'Select a product and enter the quantity in every row.',
  con_purposeHint: 'Preparation is matched against sales. Wastage, spoilage and personal use always reduce stock and are reported separately.', con_coveredToast: 'Saved. Already taken by today\'s sales, not deducted again: {items}', con_voidHint: 'This returns the quantity to stock.',

  menu_title: 'Selling Products', menu_add: 'Add selling product', menu_edit: 'Edit selling product', menu_search: 'Search selling products', menu_empty: 'No selling products yet. Add what you prepare and sell.', menu_ingredients: '{count} ingredients', menu_packagedLine: 'Sold directly from {name}', menu_cost: 'Prep cost', menu_profit: 'Profit', menu_canMake: 'can make {count}',
  menu_noPrices: 'Stock prices not set yet: cost and profit unknown', menu_noRecipe: 'No recipe: stock not deducted, cost unknown', menu_noCost: 'cost unknown', menu_name: 'Food product name', menu_price: 'Selling price', menu_howSold: 'How is it made?', menu_typeRecipe: 'Prepared with a recipe', menu_typePackaged: 'Packaged, sold as it is',
  menu_packagedHint: 'Each sale takes the stock item directly.', menu_stockItem: 'Stock item', menu_perSale: 'Quantity per unit sold', menu_recipeHint: 'Enter what one batch uses. Sales deduct the right share automatically. Recipe changes apply to future sales only.', menu_yield: 'This recipe makes (quantity)', menu_ingredient: 'Ingredient', menu_addIngredient: 'Add ingredient',
  menu_available: 'Can make from stock', menu_pickPackaged: 'Select the stock item this product is sold from.', menu_recipeProblem: 'Enter how many the recipe makes, and a quantity for every ingredient.', menu_deleteHint: 'Remove {name} from the menu? Past sales stay on record.',

  sale_title: 'Daily Sales', sale_new: 'New sale', sale_total: 'Total sales', sale_qty: 'Quantity sold', sale_discount: 'Discount', sale_pending: 'Pending', sale_entries: 'Sale entries', sale_empty: 'No sales in this period.', sale_price: 'Price', sale_payment: 'Payment', sale_customer: 'Customer name', sale_subtotal: 'Subtotal', sale_payable: 'Bill total', sale_entered: 'Entered',
  sale_save: 'Save sale', sale_saved: 'Sale saved: {total}. Stock updated.', sale_pickItems: 'Add at least one food product.', sale_needCustomer: 'Enter the customer name for a credit sale.', sale_splitProblem: 'Cash + UPI + Credit must equal {total}.', sale_addFoodFirst: 'Add a food product first.', sale_less: 'Less', sale_more: 'More', sale_detail: 'Sale details', sale_items: 'Items',
  sale_voidHint: 'This cancels the sale and returns its ingredients to stock.',

  pend_title: 'Pending payments', pend_amount: 'Amount', pend_method: 'Paid by', pend_none: 'Nothing pending.', pend_collect: 'Collect payment', pend_pay: 'Pay supplier',

  exp_title: 'Expenses', exp_add: 'Add expense', exp_edit: 'Edit expense', exp_today: 'Today', exp_month: 'This month', exp_category: 'Expense type', exp_amount: 'Amount', exp_categories: 'Expense types', exp_addCategory: 'Add expense type', exp_editCategory: 'Edit expense type', exp_empty: 'No expenses in this period.',
  exp_countsInPnl: 'Reduce profit by this expense', exp_countsHelp: 'Turn off for items you track as stock, such as gas or packaging: their cost already reaches profit when used.', exp_inPnl: 'Reduces profit', exp_notInPnl: 'Already in stock cost, not counted again',
  exp_excludedNote: '{amount} today is for items tracked as stock, so it does not reduce profit a second time.', exp_doubleHint: 'Gas Refill and Packaging do not reduce profit again, because they are costed when used from stock. To add them to stock, record a Purchase.',

  rep_title: 'Reports', rep_group_purchases: 'Purchases', rep_group_sales: 'Sales', rep_group_stock: 'Stock', rep_group_profit: 'Profit & loss',
  rep_daily_purchase: 'Daily Purchase Report', rep_supplier_purchase: 'Supplier-wise Purchase Report', rep_daily_sales: 'Daily Sales Report', rep_food_profit: 'Food Product Profitability', rep_sale_profit: 'Sales-wise Profit', rep_cash_upi: 'Cash vs UPI Report',
  rep_daily_consumption: 'Daily Consumption Report', rep_stock: 'Product-wise Stock Report', rep_low_stock: 'Low Stock Report', rep_wastage: 'Wastage Report', rep_daily_pnl: 'Daily Profit & Loss', rep_monthly_pnl: 'Monthly Profit & Loss',

  ntf_title: 'Alerts', ntf_readAll: 'Mark all read', ntf_empty: 'No alerts right now.',
  ntf_low_stock: '{name} is low: {qty} {unit} left', ntf_out_of_stock: '{name} is out of stock', ntf_excess_consumption: '{name}: used {qty} {unit} today, usually about {usual}',
  ntf_unusual_expense: '{name} expense of ₹{amount} is unusually high (usually about ₹{usual})', ntf_pending_payments: 'Pending: ₹{receivable} to collect, ₹{payable} to pay suppliers',
  ntf_sales_summary: '{date}: sales ₹{revenue} from {bills} bills', ntf_profit_summary: '{date}: net profit ₹{net}',

  ai_title: 'AI Business Assistant', ai_subtitle: 'Answers from your own records', ai_intro: 'Ask about stock, purchases, profit or what to buy next. I can also prepare a purchase or stock change, but nothing is saved until you confirm it.',
  ai_placeholder: 'Ask about your business', ai_send: 'Send', ai_suggestBtn: 'What should I buy?', ai_summaryBtn: 'Today\'s summary', ai_proposalTitle: 'Needs your confirmation', ai_confirmHint: 'Nothing has changed yet. Confirm to save this.', ai_confirm: 'Confirm', ai_reject: 'Reject', ai_review: 'Edit first', ai_confirmedToast: 'Confirmed and saved',
  ai_inStock: '{qty} in stock', ai_planIntro: 'To cover the next {days} days:', ai_planNone: 'Stock looks enough for the next {days} days.', ai_sumHead: 'Today: sales {revenue}, purchases {purchases}, consumption cost {consumption}, other expenses {expenses}, net profit {net}.',
  ai_sumTop: 'Best seller by profit: {name} ({profit}).', ai_sumLow: 'Low stock: {items}.', ai_sumPending: 'Pending: {collect} to collect, {pay} to pay.',
  ai_q_stock: 'How much potato stock is remaining?', ai_q_spend: 'How much did I spend on purchases today?', ai_q_net: 'What is my net profit today?', ai_q_top: 'Which food product generated the highest profit?', ai_q_oil: 'How much oil did I consume this week?',
  ai_q_buy: 'Which ingredients should I purchase tomorrow?', ai_q_low: 'Which products have low stock?', ai_q_why: 'Why is my profit lower compared to yesterday?', ai_q_target: 'How much Vada Pav should I sell to achieve ₹1,000 profit?',
};

export type FoodKey = keyof typeof en;

const mr: typeof en = {
  nav_inventory: 'खरेदी माल', nav_purchases: 'खरेदी', nav_consumption: 'वापर', nav_menu: 'विक्री पदार्थ', nav_sales: 'विक्री',
  nav_expenses: 'खर्च', nav_reports: 'अहवाल', nav_ai: 'AI सहाय्यक',

  common_date: 'तारीख', common_thisMonth: 'हा महिना', common_lastMonth: 'मागील महिना', common_product: 'वस्तू', common_selectProduct: 'वस्तू निवडा',
  common_quantity: 'प्रमाण', common_qtyShort: 'नग', common_total: 'एकूण', common_notes: 'टीप', common_none: 'काही नाही', common_add: 'जोडा', common_addRow: 'आणखी वस्तू जोडा',
  common_remove: 'काढा', common_removeRow: 'ही ओळ काढा', common_saved: 'जतन केले', common_deleted: 'हटवले', common_void: 'नोंद रद्द करा', common_voided: 'नोंद रद्द केली',
  common_viewAll: 'सर्व पहा', common_delete: 'हटवा',

  st_active: 'सक्रिय', st_inactive: 'निष्क्रिय', st_posted: 'नोंदवले', st_voided: 'रद्द', st_pending: 'तुमच्या मंजुरीसाठी', st_confirmed: 'मंजूर', st_rejected: 'नाकारले', st_expired: 'मुदत संपली',
  pay_cash: 'रोख', pay_upi: 'UPI', pay_credit: 'उधार', pay_split: 'विभागून',

  stock_ok: 'साठा आहे', stock_low: 'कमी साठा', stock_out: 'साठा संपला', stock_notEnough: 'पुरेसा साठा नाही', stock_shortBy: '{qty} {unit} कमी',
  stock_saveAnyway: 'तरीही जतन करा', stock_saveAnywayHint: 'तरीही जतन केल्यास साठा शून्याखाली जाईल. माल प्रत्यक्ष आहे पण नोंद झालेली नाही, तेव्हाच हे करा.',
  stock_alertToast: 'जतन केले. साठा कमी होत आहे: {items}',

  setup_title: 'तुमच्या खाद्य व्यवसायात स्वागत', setup_hint: 'नेहमीचा कच्चा माल, इतर वस्तू आणि नमुना मेनू (वडापाव रेसिपीसह) यांच्या तयार यादीने सुरुवात करा. नंतर काहीही बदलू किंवा हटवू शकता. किंमत आणि साठा शून्यापासून सुरू होतो.',
  setup_useStarter: 'तयार यादी जोडा', setup_startEmpty: 'रिकाम्या यादीने सुरू करा', setup_done: '{products} वस्तू आणि {foods} खाद्यपदार्थ जोडले',

  qa_sale: 'विक्री नोंदवा', qa_purchase: 'खरेदी जोडा', qa_consumption: 'वापर नोंदवा', qa_expense: 'खर्च जोडा', qa_ai: 'AI ला विचारा',

  dash_title: 'खाद्य व्यवसाय डॅशबोर्ड', dash_netProfitToday: 'आजचा निव्वळ नफा', dash_netProfit: 'निव्वळ नफा', dash_monthNet: 'हा महिना', dash_sales: 'एकूण विक्री', dash_purchase: 'एकूण खरेदी',
  dash_consumption: 'मालाचा वापर', dash_openingStock: 'सुरुवातीचा साठा', dash_remainingStock: 'शिल्लक साठा', dash_expenses: 'एकूण खर्च', dash_expensesExcludedHint: '+{amount} साठ्याच्या खर्चात', dash_gross: 'ढोबळ नफा',
  dash_cashReceived: 'मिळालेली रोख', dash_upiReceived: 'मिळालेले UPI', dash_pending: 'बाकी रक्कम', dash_toCollect: 'ग्राहकांकडून येणे', dash_supplierDue: 'पुरवठादार देणे', dash_toPay: 'पुरवठादारांना देणे',
  dash_salesTrend: 'विक्री, मागील ७ दिवस', dash_net: 'निव्वळ', dash_cashVsUpi: 'रोख व UPI', dash_pnlTitle: 'नफा-तोटा', dash_purchaseNote: 'खरेदी केलेला माल वापरेपर्यंत साठ्यात राहतो, म्हणून तो नफ्यातून वजा होत नाही.',
  dash_fullPnl: 'संपूर्ण नफा-तोटा', dash_topFoods: 'पदार्थनिहाय नफा', dash_noSales: 'अजून विक्रीची नोंद नाही.', dash_attention: 'लक्ष द्यावा असा साठा ({count})',

  pnl_title: 'नफा-तोटा', pnl_hint: 'विक्री, मालाचा खर्च, इतर खर्च आणि निव्वळ नफा, पदार्थनिहाय व विक्रीनिहाय.', pnl_revenue: 'विक्री', pnl_cogs: 'विकलेल्या मालाचा खर्च', pnl_gross: 'ढोबळ नफा',
  pnl_otherExpenses: 'इतर खर्च', pnl_wastage: 'वाया व खराब माल', pnl_adjustments: 'साठा दुरुस्ती', pnl_net: 'निव्वळ नफा', pnl_note: 'नफा तुम्ही खरेदी केलेल्या नव्हे, तर वापरलेल्या व विकलेल्या मालावर मोजला जातो. न विकलेला माल शिल्लक साठ्यात राहतो.',
  pnl_afterDiscount: '{amount} सूट वजा करून', pnl_recipeCost: 'विकलेल्या पदार्थांचा खर्च (रेसिपी)', pnl_unmatched: 'रेसिपीपेक्षा जास्त वापर', pnl_outside: 'नफ्यात धरलेले नाही', pnl_purchases: 'खरेदी (साठ्यात)',
  pnl_excludedExpenses: 'गॅस, पॅकिंग इ. साठ्याच्या खर्चात आधीच', pnl_outsideHint: 'वैयक्तिक वापर हा मालकाने स्वतःसाठी घेतलेला माल आहे, म्हणून तो इथे दाखवला आहे, व्यवसायाचा खर्च म्हणून नाही.', pnl_byProduct: 'पदार्थनिहाय नफा', pnl_bySale: 'विक्रीनिहाय नफा',

  inv_title: 'खरेदी माल (साठा)', inv_search: 'वस्तू शोधा', inv_needsAttention: 'लक्ष द्या', inv_allCategories: 'सर्व प्रकार', inv_noCategory: 'प्रकार नाही', inv_summary: '{count} वस्तू · साठ्याची किंमत {value}',
  inv_empty: 'अजून वस्तू नाहीत. कच्चा माल आणि इतर वस्तू जोडा.',

  prod_add: 'खरेदी माल जोडा', prod_edit: 'खरेदी माल बदला', prod_delete: 'खरेदी माल हटवा', prod_name: 'वस्तूचे नाव', prod_category: 'प्रकार', prod_unit: 'एकक', prod_unitHelp: 'साठा या एककात मोजला जातो. खरेदी व रेसिपीत संबंधित एकक वापरता येते, उदा. किलोसाठी ग्रॅम.',
  prod_purchasePrice: 'खरेदी किंमत (प्रति एकक)', prod_sellingPrice: 'विक्री किंमत', prod_sellingHelp: 'ही वस्तू जशीच्या तशी विकत असाल तरच.', prod_openingStock: 'सुरुवातीचा साठा', prod_openingEditHelp: 'साठ्याची हालचाल होईपर्यंतच बदलता येतो. नंतर साठा दुरुस्ती वापरा.',
  prod_minAlert: 'किमान साठा सूचना', prod_supplier: 'पुरवठादार', prod_inStock: 'साठ्यात', prod_stockValue: 'साठ्याची किंमत', prod_avgCost: 'सरासरी किंमत', prod_history: 'साठ्याचा इतिहास', prod_alertAt: '{qty} ला सूचना',
  prod_deleteHint: '{name} हटवायचे? इतिहास असलेली वस्तू पूर्ण पुसली जात नाही, संग्रहित होते.',

  led_OPENING: 'सुरुवातीचा साठा', led_PURCHASE: 'खरेदी', led_CONSUMPTION: 'नोंदवलेला वापर', led_SALE_USAGE: 'विक्रीसाठी वापर', led_ADJUST_IN: 'दुरुस्ती (वाढ)', led_ADJUST_OUT: 'दुरुस्ती (घट)', led_WASTAGE: 'वाया गेले', led_SPOILAGE: 'खराब झाले', led_PERSONAL: 'वैयक्तिक वापर',

  adj_title: 'साठा दुरुस्ती', adj_direction: 'प्रकार', adj_in: 'साठ्यात वाढ', adj_out: 'साठ्यातून घट', adj_reason: 'कारण', adj_reasonHint: 'उदा. मोजणीत कमी भरला', adj_hint: 'सध्याचा साठा: {qty} {unit}. प्रत्यक्ष मोजणी व अ‍ॅपमधील साठा वेगळा असल्यास वापरा.',

  sup_title: 'पुरवठादार', sup_add: 'पुरवठादार जोडा', sup_edit: 'पुरवठादार बदला', sup_name: 'पुरवठादाराचे नाव', sup_mobile: 'मोबाईल', sup_address: 'पत्ता', sup_empty: 'अजून पुरवठादार नाहीत.', sup_line: '{bills} बिले · {total}', sup_due: 'देणे', sup_totalPurchases: 'एकूण खरेदी',

  cat_title: 'प्रकार', cat_add: 'प्रकार जोडा', cat_edit: 'प्रकार बदला', cat_name: 'नाव',
  unit_title: 'एकके', unit_add: 'एकक जोडा', unit_edit: 'एकक बदला', unit_name: 'एककाचे नाव', unit_kind: 'रूपांतर', unit_custom: 'नाही (स्वतंत्र एकक)', unit_mass: 'वजन (किलो, ग्रॅम)', unit_volume: 'द्रव (लिटर, मिली)', unit_count: 'नग (नग, डझन)',
  unit_kindHelp: 'एकाच प्रकारची एकके आपोआप रूपांतरित होतात.', unit_toBase: 'सर्वात लहान एककात आकार', unit_toBaseHelp: 'वजनासाठी ग्रॅम, द्रवासाठी मिली, नगासाठी नग. उदा. किलो = 1000.',

  set_title: 'सेटिंग्ज', set_allowNegative: 'साठा शून्याखाली जाऊ द्या', set_allowNegativeHelp: 'बंद असल्यास, साठा शून्याखाली जाण्यापूर्वी विचारले जाईल.', set_coverDays: 'किती दिवसांची खरेदी सुचवावी', set_coverDaysHelp: 'खरेदी सूचना इतक्या दिवसांचा साठा ठेवते.',
  set_excessRatio: 'जास्त वापर सूचना (नेहमीच्या किती पट)', set_excessRatioHelp: 'आजचा वापर नेहमीच्या इतक्या पट झाल्यावर सूचना.', set_expenseRatio: 'असामान्य खर्च सूचना (नेहमीच्या किती पट)', set_expenseRatioHelp: 'खर्च नेहमीच्या इतक्या पट झाल्यावर सूचना.',

  pur_title: 'दैनंदिन खरेदी', pur_new: 'नवीन खरेदी', pur_total: 'खरेदी', pur_due: 'पुरवठादारांना देणे', pur_note: 'खरेदीने साठा वाढतो. माल वापरला किंवा विकला गेल्यावरच तो नफ्यात धरला जातो.', pur_empty: 'या काळात खरेदी नाही.', pur_allSuppliers: 'सर्व पुरवठादार', pur_noSupplier: 'पुरवठादार नाही',
  pur_items: 'खरेदी केलेल्या वस्तू', pur_rate: 'दर', pur_payment: 'पेमेंट', pur_paidNow: 'आता दिलेले', pur_paidNowHelp: 'उरलेली रक्कम पुरवठादाराच्या देण्यात जोडली जाते.', pur_invoice: 'बिल क्रमांक', pur_grandTotal: 'खरेदीची एकूण रक्कम', pur_save: 'खरेदी जतन करा', pur_saved: 'खरेदी जतन: {total}. साठा अद्ययावत झाला.',
  pur_rowsProblem: 'प्रत्येक ओळीत वस्तू निवडा आणि प्रमाण व दर भरा.', pur_addProductFirst: 'आधी खरेदी माल विभागात वस्तू जोडा.', pur_detail: 'खरेदीचा तपशील', pur_paid: 'दिलेले', pur_voidHint: 'यामुळे खरेदी केलेले प्रमाण साठ्यातून कमी होईल.', pur_history: 'खरेदीचा इतिहास',

  con_title: 'दैनंदिन वापर', con_new: 'वापर नोंदवा', con_cost: 'वापराचा खर्च', con_lostCost: 'वाया व वैयक्तिक वापर', con_noDoubleHint: 'दिवसातील नोंदवलेला वापर व रेसिपीचा वापर जुळवला जातो: दोन्हीपैकी जास्त तेवढाच साठ्यातून वजा होतो, त्यामुळे काहीही दोनदा वजा होत नाही.',
  con_history: 'वापराचा इतिहास', con_todayTable: 'दिवसाचा साठा', con_empty: 'या दिवशी साठ्याची हालचाल नाही.', con_available: 'सुरुवात + खरेदी', con_used: 'वापर', con_remaining: 'शिल्लक', con_recipeUsed: 'रेसिपी {qty}', con_lost: 'वाया {qty}',
  con_preparation: 'तयारीसाठी', con_wastage: 'वाया गेले', con_spoilage: 'खराब झाले', con_personal: 'वैयक्तिक वापर', con_items: 'वापरलेल्या वस्तू', con_purpose: 'कशासाठी', con_save: 'वापर जतन करा', con_rowsProblem: 'प्रत्येक ओळीत वस्तू निवडा आणि प्रमाण भरा.',
  con_purposeHint: 'तयारीचा वापर विक्रीशी जुळवला जातो. वाया, खराब व वैयक्तिक वापर नेहमी साठा कमी करतात आणि वेगळे दाखवले जातात.', con_coveredToast: 'जतन केले. आजच्या विक्रीत आधीच वजा, पुन्हा वजा नाही: {items}', con_voidHint: 'यामुळे प्रमाण साठ्यात परत येईल.',

  menu_title: 'विक्री पदार्थ', menu_add: 'विक्री पदार्थ जोडा', menu_edit: 'पदार्थ बदला', menu_search: 'पदार्थ शोधा', menu_empty: 'अजून पदार्थ नाहीत. तुम्ही बनवता आणि विकता ते जोडा.', menu_ingredients: '{count} घटक', menu_packagedLine: '{name} मधून थेट विक्री', menu_cost: 'बनवण्याचा खर्च', menu_profit: 'नफा', menu_canMake: '{count} बनू शकतात',
  menu_noPrices: 'वस्तूंच्या किमती अजून भरलेल्या नाहीत: खर्च व नफा अज्ञात', menu_noRecipe: 'रेसिपी नाही: साठा वजा होत नाही, खर्च अज्ञात', menu_noCost: 'खर्च अज्ञात', menu_name: 'पदार्थाचे नाव', menu_price: 'विक्री किंमत', menu_howSold: 'कसा बनतो?', menu_typeRecipe: 'रेसिपीने बनतो', menu_typePackaged: 'पॅकबंद, जसाच्या तसा',
  menu_packagedHint: 'प्रत्येक विक्रीत ही साठ्यातील वस्तू थेट वजा होते.', menu_stockItem: 'साठ्यातील वस्तू', menu_perSale: 'प्रति विक्री प्रमाण', menu_recipeHint: 'एका बॅचला लागणारे प्रमाण भरा. विक्रीनुसार योग्य प्रमाण आपोआप वजा होते. रेसिपीतील बदल पुढील विक्रीलाच लागू होतात.', menu_yield: 'या रेसिपीने किती बनतात', menu_ingredient: 'घटक', menu_addIngredient: 'घटक जोडा',
  menu_available: 'साठ्यातून बनू शकतात', menu_pickPackaged: 'हा पदार्थ ज्या वस्तूतून विकला जातो ती निवडा.', menu_recipeProblem: 'रेसिपीने किती बनतात आणि प्रत्येक घटकाचे प्रमाण भरा.', menu_deleteHint: '{name} मेनूतून काढायचा? मागील विक्रीची नोंद राहील.',

  sale_title: 'दैनंदिन विक्री', sale_new: 'नवीन विक्री', sale_total: 'एकूण विक्री', sale_qty: 'विकलेले प्रमाण', sale_discount: 'सूट', sale_pending: 'बाकी', sale_entries: 'विक्रीच्या नोंदी', sale_empty: 'या काळात विक्री नाही.', sale_price: 'किंमत', sale_payment: 'पेमेंट', sale_customer: 'ग्राहकाचे नाव', sale_subtotal: 'उप-एकूण', sale_payable: 'बिलाची रक्कम', sale_entered: 'भरलेले',
  sale_save: 'विक्री जतन करा', sale_saved: 'विक्री जतन: {total}. साठा अद्ययावत झाला.', sale_pickItems: 'किमान एक पदार्थ जोडा.', sale_needCustomer: 'उधार विक्रीसाठी ग्राहकाचे नाव भरा.', sale_splitProblem: 'रोख + UPI + उधार मिळून {total} व्हायला हवे.', sale_addFoodFirst: 'आधी पदार्थ जोडा.', sale_less: 'कमी', sale_more: 'जास्त', sale_detail: 'विक्रीचा तपशील', sale_items: 'पदार्थ',
  sale_voidHint: 'यामुळे विक्री रद्द होईल आणि घटक साठ्यात परत येतील.',

  pend_title: 'बाकी रक्कम', pend_amount: 'रक्कम', pend_method: 'पेमेंट पद्धत', pend_none: 'काही बाकी नाही.', pend_collect: 'रक्कम घ्या', pend_pay: 'पुरवठादाराला द्या',

  exp_title: 'खर्च', exp_add: 'खर्च जोडा', exp_edit: 'खर्च बदला', exp_today: 'आज', exp_month: 'हा महिना', exp_category: 'खर्चाचा प्रकार', exp_amount: 'रक्कम', exp_categories: 'खर्चाचे प्रकार', exp_addCategory: 'खर्चाचा प्रकार जोडा', exp_editCategory: 'खर्चाचा प्रकार बदला', exp_empty: 'या काळात खर्च नाही.',
  exp_countsInPnl: 'हा खर्च नफ्यातून वजा करा', exp_countsHelp: 'गॅस, पॅकिंगसारख्या साठ्यात ठेवलेल्या वस्तूंसाठी बंद ठेवा: त्यांचा खर्च वापरताना नफ्यात येतोच.', exp_inPnl: 'नफा कमी करतो', exp_notInPnl: 'साठ्याच्या खर्चात आधीच, पुन्हा धरलेले नाही',
  exp_excludedNote: 'आजचे {amount} साठ्यात ठेवलेल्या वस्तूंसाठी आहेत, म्हणून नफ्यातून दुसऱ्यांदा वजा होत नाहीत.', exp_doubleHint: 'गॅस रिफिल व पॅकिंग नफ्यातून पुन्हा वजा होत नाहीत, कारण साठ्यातून वापरताना त्यांचा खर्च धरला जातो. साठ्यात जोडण्यासाठी खरेदी नोंदवा.',

  rep_title: 'अहवाल', rep_group_purchases: 'खरेदी', rep_group_sales: 'विक्री', rep_group_stock: 'साठा', rep_group_profit: 'नफा-तोटा',
  rep_daily_purchase: 'दैनंदिन खरेदी अहवाल', rep_supplier_purchase: 'पुरवठादारनिहाय खरेदी अहवाल', rep_daily_sales: 'दैनंदिन विक्री अहवाल', rep_food_profit: 'पदार्थनिहाय नफा', rep_sale_profit: 'विक्रीनिहाय नफा', rep_cash_upi: 'रोख व UPI अहवाल',
  rep_daily_consumption: 'दैनंदिन वापर अहवाल', rep_stock: 'वस्तूनिहाय साठा अहवाल', rep_low_stock: 'कमी साठा अहवाल', rep_wastage: 'वाया माल अहवाल', rep_daily_pnl: 'दैनंदिन नफा-तोटा', rep_monthly_pnl: 'मासिक नफा-तोटा',

  ntf_title: 'सूचना', ntf_readAll: 'सर्व वाचले', ntf_empty: 'सध्या सूचना नाहीत.',
  ntf_low_stock: '{name} कमी आहे: {qty} {unit} शिल्लक', ntf_out_of_stock: '{name} संपले आहे', ntf_excess_consumption: '{name}: आज {qty} {unit} वापरले, नेहमी साधारण {usual}',
  ntf_unusual_expense: '{name} खर्च ₹{amount} नेहमीपेक्षा खूप जास्त (नेहमी साधारण ₹{usual})', ntf_pending_payments: 'बाकी: ₹{receivable} येणे, ₹{payable} पुरवठादारांना देणे',
  ntf_sales_summary: '{date}: {bills} बिलांतून विक्री ₹{revenue}', ntf_profit_summary: '{date}: निव्वळ नफा ₹{net}',

  ai_title: 'AI व्यवसाय सहाय्यक', ai_subtitle: 'तुमच्या नोंदींवरून उत्तरे', ai_intro: 'साठा, खरेदी, नफा किंवा पुढे काय घ्यावे हे विचारा. मी खरेदी किंवा साठा बदल तयार करू शकतो, पण तुम्ही मंजूर केल्याशिवाय काहीही जतन होत नाही.',
  ai_placeholder: 'व्यवसायाबद्दल विचारा', ai_send: 'पाठवा', ai_suggestBtn: 'काय खरेदी करू?', ai_summaryBtn: 'आजचा सारांश', ai_proposalTitle: 'तुमची मंजुरी हवी', ai_confirmHint: 'अजून काहीही बदललेले नाही. जतन करण्यासाठी मंजूर करा.', ai_confirm: 'मंजूर', ai_reject: 'नाकारा', ai_review: 'आधी बदला', ai_confirmedToast: 'मंजूर व जतन केले',
  ai_inStock: '{qty} साठ्यात', ai_planIntro: 'पुढील {days} दिवसांसाठी:', ai_planNone: 'पुढील {days} दिवसांसाठी साठा पुरेसा दिसतो.', ai_sumHead: 'आज: विक्री {revenue}, खरेदी {purchases}, वापराचा खर्च {consumption}, इतर खर्च {expenses}, निव्वळ नफा {net}.',
  ai_sumTop: 'सर्वाधिक नफा: {name} ({profit}).', ai_sumLow: 'कमी साठा: {items}.', ai_sumPending: 'बाकी: {collect} येणे, {pay} देणे.',
  ai_q_stock: 'बटाट्याचा (potato) किती साठा शिल्लक आहे?', ai_q_spend: 'आज खरेदीवर किती खर्च झाला?', ai_q_net: 'आजचा निव्वळ नफा किती?', ai_q_top: 'कोणत्या पदार्थाने सर्वाधिक नफा दिला?', ai_q_oil: 'या आठवड्यात oil किती वापरले?',
  ai_q_buy: 'उद्या कोणता माल खरेदी करू?', ai_q_low: 'कोणत्या वस्तूंचा साठा कमी आहे?', ai_q_why: 'कालपेक्षा आज नफा कमी का आहे?', ai_q_target: '₹1,000 नफ्यासाठी किती Vada Pav विकावे?',
};

const hi: Partial<typeof en> = {
  nav_inventory: 'स्टॉक', nav_purchases: 'खरीद', nav_consumption: 'उपयोग', nav_menu: 'फूड मेनू', nav_sales: 'बिक्री', nav_expenses: 'खर्च', nav_reports: 'रिपोर्ट', nav_ai: 'AI सहायक',
};

const dictionaries: Partial<Record<Language, Partial<typeof en>>> = { en, mr, hi };

export function foodTranslate(lang: Language, key: FoodKey, vars?: Record<string, string | number>): string {
  let text = dictionaries[lang]?.[key] || en[key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v));
  }
  return text;
}

/** Translated label for a status value coming from the server (e.g. "Voided"). */
export function foodStatus(lang: Language, value?: string | null): string {
  if (!value) return '';
  const key = `st_${value.toLowerCase()}` as FoodKey;
  return key in en ? foodTranslate(lang, key) : value;
}
