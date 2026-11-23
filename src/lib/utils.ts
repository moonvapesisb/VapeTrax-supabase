import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount).replace('PKR', 'Rs');
}

export function getProductDiscountPercent(product: any): number {
  if (!product || product.onSale === false) return 0;
  const pct = Number(product.saleDiscountPercent) || 0;
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Math.min(90, Math.round(pct * 100) / 100);
}

export function getDiscountedUnitPrice(basePrice: number, discountPercent: number): number {
  const safeBase = Math.max(0, Number(basePrice) || 0);
  if (!discountPercent || discountPercent <= 0) return safeBase;
  return Math.round(safeBase * (1 - discountPercent / 100) * 100) / 100;
}
