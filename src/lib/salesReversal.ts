import { supabase } from './supabase';
import { parseBottleSizeMl } from './bottles';

export const reverseSaleImpact = async (sale: any, shopId: string, actorMeta: any, isEdit: boolean = false, deleteSale: boolean = false) => {
  const bottleUpdates: any[] = [];
  const productUpdates: any[] = [];
  const inventoryLogs: any[] = [];

  // Reverse inventory changes
  for (const item of sale.items) {
    const { data: productSnap } = await supabase.from('products').select('*').eq('id', item.productId).single();

    const isELiquidLine = item.saleType === 'refill' || item.saleType === 'full_bottle';
    if (isELiquidLine) {
      const bottleSizeMl = parseBottleSizeMl(item.bottleSize, 30);
      const mlToRestore =
        item.saleType === 'refill'
          ? (Number(item.refillAmount) || 0) * (Number(item.quantity) || 0)
          : bottleSizeMl * (Number(item.quantity) || 0);

      if (mlToRestore > 0 && productSnap) {
        productUpdates.push({
          productId: item.productId,
          addition: mlToRestore
        });
      }

      const bottleChanges: any[] = Array.isArray(item.bottleChanges) ? item.bottleChanges : [];
      for (const bc of bottleChanges) {
        if (!bc?.bottleId) continue;
        bottleUpdates.push({
          bottleId: bc.bottleId,
          remainingMl: Number(bc.beforeRemainingMl) || 0,
          status: bc.beforeStatus || 'closed',
          openedDate: bc.beforeOpenedDate || null,
          updatedAt: new Date().toISOString()
        });
      }

      inventoryLogs.push({
        id: crypto.randomUUID(),
        productId: item.productId,
        productName: item.productName || 'Unknown Product',
        shopId,
        action: 'return',
        type: 'return',
        mlChange: mlToRestore,
        change: mlToRestore,
        quantityChange: item.saleType === 'full_bottle' ? Number(item.quantity) || 0 : 0,
        reason: isEdit ? `Sale edited (restored old): ${(sale.id ? sale.id.slice(-6).toUpperCase() : '') || sale.id}` : `Sale deleted (restored): ${(sale.id ? sale.id.slice(-6).toUpperCase() : '') || sale.id}`,
        notes: productSnap ? `Inventory restored` : `Product was missing`,
        ...actorMeta,
        createdAt: new Date().toISOString(),
        createdAtClient: new Date().toISOString()
      });
    } else {
      if (productSnap) {
        productUpdates.push({
          productId: item.productId,
          addition: Number(item.quantity) || 0
        });
      }

      inventoryLogs.push({
        id: crypto.randomUUID(),
        productId: item.productId,
        productName: item.productName || 'Unknown Product',
        shopId,
        action: 'return',
        type: 'return',
        change: Number(item.quantity) || 0,
        quantityChange: item.quantity,
        reason: isEdit ? `Sale edited (restored old): ${(sale.id ? sale.id.slice(-6).toUpperCase() : '') || sale.id}` : `Sale deleted (restored): ${(sale.id ? sale.id.slice(-6).toUpperCase() : '') || sale.id}`,
        notes: productSnap ? `Inventory restored` : `Product was missing`,
        ...actorMeta,
        createdAt: new Date().toISOString(),
        createdAtClient: new Date().toISOString()
      });
    }
  }

  // Reverse credit if applicable
  let creditToReverse = 0;
  if (sale.paymentMethod === 'credit') {
    creditToReverse = sale.totalAmount;
  } else if (sale.paymentMethod === 'split') {
    creditToReverse = sale.splitAmounts?.credit || 0;
  }

  const { error } = await supabase.rpc('process_reversal', {
    p_shop_id: shopId,
    p_sale_id: sale.id,
    p_delete_sale: deleteSale,
    p_inventory_logs: inventoryLogs.length > 0 ? inventoryLogs : null,
    p_bottle_updates: bottleUpdates.length > 0 ? bottleUpdates : null,
    p_product_updates: productUpdates.length > 0 ? productUpdates : null,
    p_customer_id: sale.customerId || null,
    p_credit_decrement: creditToReverse
  });

  // The server's code travels with the error, so the screen can say it plainly
  // (for example 42501: only the shop admin can delete or edit a sale).
  if (error) {
    throw Object.assign(new Error(`Reversal Failed: ${error.message}`), {
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
  }
};

export const deleteSaleWithReversal = async (sale: any, shopId: string, actorMeta: any) => {
  if (!shopId) throw new Error('Shop not loaded');
  await reverseSaleImpact(sale, shopId, actorMeta, false, true);
};
