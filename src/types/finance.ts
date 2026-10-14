export type AccountCategory = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

export interface FinanceAccount {
  id: string;
  shopId: string;
  name: string;
  category: AccountCategory;
  balance: number; // Normal balance (positive means expected balance type)
  createdAt: string | Date;
  updatedAt: string | Date;
}

export type TransactionType = 
  | 'SALE' 
  | 'EXPENSE' 
  | 'TRANSFER' 
  | 'VENDOR_PURCHASE' 
  | 'VENDOR_PAYMENT' 
  | 'LOAN_BORROW' 
  | 'LOAN_REPAYMENT'
  | 'OTHER';

export interface FinanceTransaction {
  id: string;
  shopId: string;
  date: string | Date;
  description: string;
  type: TransactionType;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  createdAt: string | Date;
  createdBy?: string;
}
