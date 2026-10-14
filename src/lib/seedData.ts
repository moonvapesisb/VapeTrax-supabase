import { supabase } from './supabase';

export const seedSampleData = async (shopId: string) => {
  if (!shopId) throw new Error('shopId is required for seeding data');

  const timestampIso = new Date().toISOString();

  // ─── 1. Products ────────────────────────────────────────────────
  const productDefs = [
    { name: 'Vaporesso XROS 3',        category: 'device',   costPrice: 4500,  sellingPrice: 6500,  stockQuantity: 15, minStockLevel: 2, unit: 'piece',  brand: 'Vaporesso' },
    { name: 'Caliburn G2',             category: 'device',   costPrice: 3800,  sellingPrice: 5500,  stockQuantity: 8,  minStockLevel: 2, unit: 'piece',  brand: 'Uwell' },
    { name: 'Geekvape Aegis Legend 2', category: 'device',   costPrice: 12000, sellingPrice: 16500, stockQuantity: 4,  minStockLevel: 2, unit: 'piece',  brand: 'Geekvape' },
    { name: 'XROS Pods 0.6ohm',        category: 'coil',     costPrice: 800,   sellingPrice: 1200,  stockQuantity: 50, minStockLevel: 2, unit: 'piece',  brand: 'Vaporesso' },
    { name: 'Caliburn G Coils 0.8ohm', category: 'coil',     costPrice: 650,   sellingPrice: 950,   stockQuantity: 30, minStockLevel: 2, unit: 'piece',  brand: 'Uwell' },
    { name: 'V God Cubano 30ml',        category: 'e-liquid', costPrice: 1800,  sellingPrice: 2800,  stockQuantity: 20, minStockLevel: 2, unit: 'bottle', brand: 'V God',    bottleSize: '30', nicotineLevel: 25 },
    { name: 'Skwezed Green Apple 30ml', category: 'e-liquid', costPrice: 1600,  sellingPrice: 2500,  stockQuantity: 12, minStockLevel: 2, unit: 'bottle', brand: 'Skwezed',  bottleSize: '30', nicotineLevel: 35 },
    { name: 'Ruthless Grape Drank 60ml',category: 'e-liquid', costPrice: 2200,  sellingPrice: 3500,  stockQuantity: 10, minStockLevel: 2, unit: 'bottle', brand: 'Ruthless', bottleSize: '60', nicotineLevel: 3 },
  ];

  const productRefs: Array<{ id: string } & (typeof productDefs)[number]> = [];
  for (const p of productDefs) {
    const id = crypto.randomUUID();
    await supabase.from('products').insert({
      id,
      ...p,
      shopId,
      createdAt: timestampIso,
      updatedAt: timestampIso,
    });
    productRefs.push({ id, ...p });
  }

  // ─── 2. Customers ───────────────────────────────────────────────
  const customerDefs = [
    { name: 'Ahmed Khan',  phone: '03001234567', email: 'ahmed@example.com',  creditBalance: 1500 },
    { name: 'Sara Ali',    phone: '03217654321', email: 'sara@example.com',   creditBalance: 0 },
    { name: 'Zainab Bibi', phone: '03339876543', email: 'zainab@example.com', creditBalance: 500 },
  ];

  const customerRefs: Array<{ id: string } & (typeof customerDefs)[number]> = [];
  for (const c of customerDefs) {
    const id = crypto.randomUUID();
    await supabase.from('customers').insert({
      id,
      ...c,
      shopId,
      createdAt: timestampIso,
    });
    customerRefs.push({ id, ...c });
  }

  // ─── 3. Expenses ────────────────────────────────────────────────
  const expenseDefs = [
    { description: 'Shop Rent — March', amount: 45000, category: 'Rent',      expenseDate: timestampIso },
    { description: 'Electricity Bill',  amount: 12500, category: 'Utilities', expenseDate: timestampIso },
    { description: 'Staff Salary — Ali',amount: 25000, category: 'Salary',    expenseDate: timestampIso },
  ];
  for (const e of expenseDefs) {
    const id = crypto.randomUUID();
    await supabase.from('expenses').insert({ id, ...e, shopId, createdAt: timestampIso });
  }

  // ─── 4. Sales ───────────────────────────────────────────────────
  const saleDefs = [
    {
      customerId: customerRefs[0].id,
      totalAmount: productRefs[0].sellingPrice,
      paymentMethod: 'cash',
      items: [{ productId: productRefs[0].id, productName: productRefs[0].name, quantity: 1, unitPrice: productRefs[0].sellingPrice, totalPrice: productRefs[0].sellingPrice, saleType: 'regular' }],
    },
    {
      customerId: customerRefs[1].id,
      totalAmount: productRefs[3].sellingPrice * 2 + productRefs[5].sellingPrice,
      paymentMethod: 'online',
      items: [
        { productId: productRefs[3].id, productName: productRefs[3].name, quantity: 2, unitPrice: productRefs[3].sellingPrice, totalPrice: productRefs[3].sellingPrice * 2, saleType: 'regular' },
        { productId: productRefs[5].id, productName: productRefs[5].name, quantity: 1, unitPrice: productRefs[5].sellingPrice, totalPrice: productRefs[5].sellingPrice, saleType: 'regular' },
      ],
    },
    {
      customerId: customerRefs[2].id,
      totalAmount: productRefs[1].sellingPrice,
      paymentMethod: 'credit',
      items: [{ productId: productRefs[1].id, productName: productRefs[1].name, quantity: 1, unitPrice: productRefs[1].sellingPrice, totalPrice: productRefs[1].sellingPrice, saleType: 'regular' }],
    },
  ];
  for (const s of saleDefs) {
    const id = crypto.randomUUID();
    await supabase.from('sales').insert({ id, ...s, shopId, saleDate: timestampIso, createdAt: timestampIso });
  }

  // ─── 5. Inventory Logs ──────────────────────────────────────────
  for (const p of productRefs) {
    const id = crypto.randomUUID();
    await supabase.from('inventory_logs').insert({
      id,
      productId: p.id,
      shopId,
      action: 'restock',
      quantityChange: p.stockQuantity,
      notes: 'Initial stock — sample data seed',
      createdAt: timestampIso,
    });
  }

  // ─── 6. Credits ─────────────────────────────────────────────────
  const creditId = crypto.randomUUID();
  await supabase.from('credits').insert({
    id: creditId,
    creditType: 'customer',
    customerId: customerRefs[0].id,
    entityName: customerRefs[0].name,
    amount: 1500,
    description: 'Opening credit balance',
    transactionType: 'given',
    shopId,
    createdAt: timestampIso,
  });

  // ─── 7. Shop Settings ───────────────────────────────────────────
  await supabase.from('settings').upsert({
    id: shopId,
    shopName: 'My VapeTrax Shop',
    shopAddress: '123 Main Street, City',
    shopPhone: '0300-1234567',
    shopEmail: '',
    currency: 'PKR',
    taxRate: 0,
    footerMessage: 'Thank you for shopping with us!',
    showShopAddress: true,
    showShopPhone: true,
    showCustomerDetails: true,
    showPaymentMethod: true,
    updatedAt: timestampIso,
  });

  return true;
};
