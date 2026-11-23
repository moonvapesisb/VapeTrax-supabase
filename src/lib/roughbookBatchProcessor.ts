import {
  collection,
  doc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  increment,
  writeBatch,
  serverTimestamp,
  db,
} from './firestoreCompat';
import { ExtractedSaleLine } from '../types/aiVision';
import {
  applyRefillToBottles,
  getAvailableMl,
  orderBottlesForRefill,
  parseBottleSizeMl,
  type BottleDoc,
} from './bottles';

export interface BatchCommitOptions {
  lines: ExtractedSaleLine[];
  shopId: string;
  actorMeta: any;
  catalog: any[];
  saleDateOverride?: Date;
  onProgress?: (current: number, total: number) => void;
}

export interface BatchCommitResult {
  successCount: number;
  failedCount: number;
  totalAmountProcessed: number;
  errors: string[];
}

/**
 * Commits a list of validated roughbook sale lines into the local POS database.
 */
export async function commitRoughbookBatch(options: BatchCommitOptions): Promise<BatchCommitResult> {
  const { lines, shopId, actorMeta, catalog, saleDateOverride, onProgress } = options;

  const validLines = lines.filter((l) => !l.isExcluded && l.matchedProductId && l.totalPrice > 0);

  if (validLines.length === 0) {
    throw new Error('No valid sales lines selected to commit.');
  }

  const result: BatchCommitResult = {
    successCount: 0,
    failedCount: 0,
    totalAmountProcessed: 0,
    errors: [],
  };

  const finalSaleDate = saleDateOverride ? saleDateOverride : serverTimestamp();
  const finalSaleDateClient = saleDateOverride ? saleDateOverride : new Date();

  // Commit each roughbook entry
  for (let i = 0; i < validLines.length; i++) {
    const line = validLines[i];
    if (onProgress) {
      onProgress(i + 1, validLines.length);
    }

    try {
      const batch = writeBatch(db);
      const productData = catalog.find((p) => p.id === line.matchedProductId);
      const productRef = doc(db, 'products', line.matchedProductId!);
      const saleItems: any[] = [];

      if (line.saleType === 'refill') {
        const mlNeeded = (line.refillAmount || 10) * line.quantity;
        const bottleSizeMl = parseBottleSizeMl(productData?.bottleSize, line.bottleSize || 30);

        // Fetch bottles for this e-liquid product
        const bottlesQuery = query(
          collection(db, `products/${line.matchedProductId}/bottles`),
          where('shopId', '==', shopId)
        );
        const bottlesSnapshot = await getDocs(bottlesQuery);
        const bottles: BottleDoc[] = bottlesSnapshot.docs.map((d) => {
          const data: any = d.data();
          return {
            id: d.id,
            bottleSize: Number(data.bottleSize) || bottleSizeMl,
            remainingMl: Number(data.remainingMl) || 0,
            status: data.status,
            createdAt: data.createdAt,
            openedDate: data.openedDate,
            updatedAt: data.updatedAt,
          };
        });

        const activeBottles = bottles.filter((b) => b.status !== 'sold');
        const availableMl = getAvailableMl(activeBottles);

        if (availableMl >= mlNeeded) {
          const ordered = orderBottlesForRefill(bottles);
          const { plans, mlApplied } = applyRefillToBottles({
            orderedBottles: ordered,
            mlNeeded,
            openedDateValue: serverTimestamp(),
          });

          const bottleChanges = [];
          for (const p of plans) {
            const bottleRef = doc(db, `products/${line.matchedProductId}/bottles`, p.bottleId);
            batch.update(bottleRef, {
              remainingMl: p.after.remainingMl,
              status: p.after.status,
              ...(p.after.openedDate ? { openedDate: p.after.openedDate } : {}),
              updatedAt: serverTimestamp(),
            });
            bottleChanges.push({
              bottleId: p.bottleId,
              beforeRemainingMl: p.before.remainingMl,
              afterRemainingMl: p.after.remainingMl,
              beforeStatus: p.before.status,
              afterStatus: p.after.status,
            });
          }

          // Decrement liquid stock in product
          batch.update(productRef, {
            stockQuantity: increment(-mlNeeded),
          });

          const unitCostPrice = (Number(productData?.costPrice) || 0) / bottleSizeMl * (line.refillAmount || 10);
          const totalCost = unitCostPrice * line.quantity;
          const profit = line.totalPrice - totalCost;

          saleItems.push({
            productId: line.matchedProductId,
            productName: line.matchedProductName,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            costPrice: unitCostPrice,
            totalPrice: line.totalPrice,
            totalCost,
            profit,
            saleType: 'refill',
            refillAmount: line.refillAmount || 10,
            bottleSize: bottleSizeMl,
            bottleChanges,
          });
        } else {
          // If not enough ml tracked in bottles, still record sale & decrement stock quantity
          batch.update(productRef, {
            stockQuantity: increment(-mlNeeded),
          });
          const unitCostPrice = (Number(productData?.costPrice) || 0) / bottleSizeMl * (line.refillAmount || 10);
          saleItems.push({
            productId: line.matchedProductId,
            productName: line.matchedProductName,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            costPrice: unitCostPrice,
            totalPrice: line.totalPrice,
            totalCost: unitCostPrice * line.quantity,
            profit: line.totalPrice - (unitCostPrice * line.quantity),
            saleType: 'refill',
            refillAmount: line.refillAmount || 10,
            bottleSize: bottleSizeMl,
          });
        }

        // Inventory log
        const logRef = doc(collection(db, 'inventoryLogs'));
        batch.set(logRef, {
          productId: line.matchedProductId,
          productName: line.matchedProductName,
          shopId,
          action: 'sale',
          type: 'sale',
          mlChange: -mlNeeded,
          change: -mlNeeded,
          quantityChange: 0,
          reason: 'Roughbook AI Ingest: Refill',
          notes: `Roughbook note: "${line.rawText}"`,
          ...actorMeta,
          createdAt: finalSaleDate,
          createdAtClient: finalSaleDateClient,
        });
      } else if (line.saleType === 'full_bottle') {
        const bottleSizeMl = parseBottleSizeMl(productData?.bottleSize, line.bottleSize || 30);
        const closedBottlesQuery = query(
          collection(db, `products/${line.matchedProductId}/bottles`),
          where('shopId', '==', shopId),
          where('status', '==', 'closed'),
          orderBy('createdAt', 'asc'),
          limit(line.quantity)
        );
        const closedSnapshot = await getDocs(closedBottlesQuery);

        closedSnapshot.docs.forEach((bDoc) => {
          batch.update(bDoc.ref, {
            status: 'sold',
            remainingMl: 0,
            updatedAt: serverTimestamp(),
          });
        });

        batch.update(productRef, {
          stockQuantity: increment(-(bottleSizeMl * line.quantity)),
        });

        const itemCostPrice = Number(productData?.costPrice) || 0;
        const totalCost = itemCostPrice * line.quantity;
        const profit = line.totalPrice - totalCost;

        saleItems.push({
          productId: line.matchedProductId,
          productName: line.matchedProductName,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          costPrice: itemCostPrice,
          totalPrice: line.totalPrice,
          totalCost,
          profit,
          saleType: 'full_bottle',
          bottleSize: bottleSizeMl,
        });

        const logRef = doc(collection(db, 'inventoryLogs'));
        batch.set(logRef, {
          productId: line.matchedProductId,
          productName: line.matchedProductName,
          shopId,
          action: 'sale',
          type: 'sale',
          mlChange: -(bottleSizeMl * line.quantity),
          change: -(bottleSizeMl * line.quantity),
          quantityChange: -line.quantity,
          reason: 'Roughbook AI Ingest: Full Bottle',
          notes: `Roughbook note: "${line.rawText}"`,
          ...actorMeta,
          createdAt: finalSaleDate,
          createdAtClient: finalSaleDateClient,
        });
      } else {
        // Regular piece sale (device, coil, pod, accessory)
        batch.update(productRef, {
          stockQuantity: increment(-line.quantity),
        });

        const itemCostPrice = Number(productData?.costPrice) || 0;
        const totalCost = itemCostPrice * line.quantity;
        const profit = line.totalPrice - totalCost;

        saleItems.push({
          productId: line.matchedProductId,
          productName: line.matchedProductName,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          costPrice: itemCostPrice,
          totalPrice: line.totalPrice,
          totalCost,
          profit,
          saleType: 'regular',
        });

        const logRef = doc(collection(db, 'inventoryLogs'));
        batch.set(logRef, {
          productId: line.matchedProductId,
          productName: line.matchedProductName,
          shopId,
          action: 'sale',
          type: 'sale',
          change: -line.quantity,
          quantityChange: -line.quantity,
          reason: 'Roughbook AI Ingest: Regular Item',
          notes: `Roughbook note: "${line.rawText}"`,
          ...actorMeta,
          createdAt: finalSaleDate,
          createdAtClient: finalSaleDateClient,
        });
      }

      // Create Sale Document
      const saleRef = doc(collection(db, 'sales'));
      const totalCOGS = saleItems.reduce((acc, it) => acc + (it.totalCost || 0), 0);
      const totalProfit = line.totalPrice - totalCOGS;

      const saleData: any = {
        customerId: line.matchedCustomerId || null,
        shopId,
        totalAmount: line.totalPrice,
        totalCOGS,
        totalProfit,
        paymentMethod: line.paymentMethod,
        saleDate: finalSaleDate,
        saleDateClient: finalSaleDateClient,
        items: saleItems,
        notes: `AI Roughbook: ${line.rawText}`,
        ...actorMeta,
      };

      batch.set(saleRef, saleData);

      // Handle Customer Udhaar (Credit) Increment
      if (line.paymentMethod === 'credit' && line.matchedCustomerId) {
        const customerRef = doc(db, 'customers', line.matchedCustomerId);
        batch.update(customerRef, {
          creditBalance: increment(line.totalPrice),
        });
      }

      // Commit to local SQLite
      await batch.commit();

      result.successCount++;
      result.totalAmountProcessed += line.totalPrice;
    } catch (err: any) {
      console.error(`Failed to commit roughbook line #${i + 1}:`, err);
      result.failedCount++;
      result.errors.push(`Row ${i + 1} (${line.matchedProductName}): ${err.message || 'Unknown write error'}`);
    }
  }

  return result;
}
