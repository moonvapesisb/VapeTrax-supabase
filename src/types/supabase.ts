export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      bottles: {
        Row: {
          bottleSize: number | null
          createdAt: string | null
          id: string
          openedDate: string | null
          productId: string
          remainingMl: number | null
          shopId: string
          status: string | null
          updatedAt: string | null
        }
        Insert: {
          bottleSize?: number | null
          createdAt?: string | null
          id: string
          openedDate?: string | null
          productId: string
          remainingMl?: number | null
          shopId: string
          status?: string | null
          updatedAt?: string | null
        }
        Update: {
          bottleSize?: number | null
          createdAt?: string | null
          id?: string
          openedDate?: string | null
          productId?: string
          remainingMl?: number | null
          shopId?: string
          status?: string | null
          updatedAt?: string | null
        }
        Relationships: []
      }
      credits: {
        Row: {
          actorName: string | null
          actorRole: string | null
          accountId: string | null
          amount: number
          createdAt: string | null
          createdAtClient: string | null
          createdBy: string | null
          creditType: string | null
          customerId: string | null
          description: string | null
          entityContact: string | null
          entityName: string | null
          id: string
          paymentMethod: string | null
          shopId: string
          supplierId: string | null
          transactionType: string | null
        }
        Insert: {
          actorName?: string | null
          actorRole?: string | null
          accountId?: string | null
          amount?: number
          createdAt?: string | null
          createdAtClient?: string | null
          createdBy?: string | null
          creditType?: string | null
          customerId?: string | null
          description?: string | null
          entityContact?: string | null
          entityName?: string | null
          id: string
          paymentMethod?: string | null
          shopId: string
          supplierId?: string | null
          transactionType?: string | null
        }
        Update: {
          actorName?: string | null
          actorRole?: string | null
          accountId?: string | null
          amount?: number
          createdAt?: string | null
          createdAtClient?: string | null
          createdBy?: string | null
          creditType?: string | null
          customerId?: string | null
          description?: string | null
          entityContact?: string | null
          entityName?: string | null
          id?: string
          paymentMethod?: string | null
          shopId?: string
          supplierId?: string | null
          transactionType?: string | null
        }
        Relationships: []
      }
      customers: {
        Row: {
          createdAt: string | null
          createdAtClient: string | null
          creditBalance: number | null
          deletedAt: string | null
          deletedBy: string | null
          deleteReason: string | null
          email: string | null
          id: string
          name: string
          phone: string | null
          shopId: string
          updatedAt: string | null
        }
        Insert: {
          createdAt?: string | null
          createdAtClient?: string | null
          creditBalance?: number | null
          deletedAt?: string | null
          deletedBy?: string | null
          deleteReason?: string | null
          email?: string | null
          id: string
          name: string
          phone?: string | null
          shopId: string
          updatedAt?: string | null
        }
        Update: {
          createdAt?: string | null
          createdAtClient?: string | null
          creditBalance?: number | null
          deletedAt?: string | null
          deletedBy?: string | null
          deleteReason?: string | null
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          shopId?: string
          updatedAt?: string | null
        }
        Relationships: []
      }
      daily_summaries: {
        Row: {
          createdAt: string | null
          data: Json | null
          id: string
          shopId: string
          summaryDate: string | null
        }
        Insert: {
          createdAt?: string | null
          data?: Json | null
          id: string
          shopId: string
          summaryDate?: string | null
        }
        Update: {
          createdAt?: string | null
          data?: Json | null
          id?: string
          shopId?: string
          summaryDate?: string | null
        }
        Relationships: []
      }
      expenses: {
        Row: {
          actorName: string | null
          actorRole: string | null
          amount: number
          category: string | null
          createdAt: string | null
          createdAtClient: string | null
          createdBy: string | null
          description: string | null
          expenseDate: string | null
          id: string
          paidFromAccountId: string | null
          shopId: string
          updatedAt: string | null
        }
        Insert: {
          actorName?: string | null
          actorRole?: string | null
          amount?: number
          category?: string | null
          createdAt?: string | null
          createdAtClient?: string | null
          createdBy?: string | null
          description?: string | null
          expenseDate?: string | null
          id: string
          paidFromAccountId?: string | null
          shopId: string
          updatedAt?: string | null
        }
        Update: {
          actorName?: string | null
          actorRole?: string | null
          amount?: number
          category?: string | null
          createdAt?: string | null
          createdAtClient?: string | null
          createdBy?: string | null
          description?: string | null
          expenseDate?: string | null
          id?: string
          paidFromAccountId?: string | null
          shopId?: string
          updatedAt?: string | null
        }
        Relationships: []
      }
      finance_accounts: {
        Row: {
          accountNumber: string | null
          archivedAt: string | null
          balance: number
          bankName: string | null
          createdAt: string
          id: string
          isArchived: boolean
          isOverdrawn: boolean
          name: string
          ownerShopId: string
          shopId: string
          type: string
          updatedAt: string
        }
        Insert: {
          accountNumber?: string | null
          archivedAt?: string | null
          balance?: number
          bankName?: string | null
          createdAt?: string
          id?: string
          isArchived?: boolean
          isOverdrawn?: boolean
          name: string
          ownerShopId: string
          shopId: string
          type: string
          updatedAt?: string
        }
        Update: {
          accountNumber?: string | null
          archivedAt?: string | null
          balance?: number
          bankName?: string | null
          createdAt?: string
          id?: string
          isArchived?: boolean
          isOverdrawn?: boolean
          name?: string
          ownerShopId?: string
          shopId?: string
          type?: string
          updatedAt?: string
        }
        Relationships: []
      }
      finance_transactions: {
        Row: {
          accountId: string
          actorName: string | null
          actorRole: string | null
          amount: number
          category: string | null
          counterpartyAccountId: string | null
          createdAt: string
          createdBy: string | null
          description: string | null
          direction: string
          id: string
          notes: string | null
          occurredAt: string
          ownerShopId: string
          paidTo: string | null
          referenceId: string | null
          referenceType: string | null
          shopId: string
          transferId: string | null
          type: string
          updatedAt: string
        }
        Insert: {
          accountId: string
          actorName?: string | null
          actorRole?: string | null
          amount: number
          category?: string | null
          counterpartyAccountId?: string | null
          createdAt?: string
          createdBy?: string | null
          description?: string | null
          direction: string
          id?: string
          notes?: string | null
          occurredAt?: string
          ownerShopId: string
          paidTo?: string | null
          referenceId?: string | null
          referenceType?: string | null
          shopId: string
          transferId?: string | null
          type: string
          updatedAt?: string
        }
        Update: {
          accountId?: string
          actorName?: string | null
          actorRole?: string | null
          amount?: number
          category?: string | null
          counterpartyAccountId?: string | null
          createdAt?: string
          createdBy?: string | null
          description?: string | null
          direction?: string
          id?: string
          notes?: string | null
          occurredAt?: string
          ownerShopId?: string
          paidTo?: string | null
          referenceId?: string | null
          referenceType?: string | null
          shopId?: string
          transferId?: string | null
          type?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_transactions_accountId_fkey"
            columns: ["accountId"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_logs: {
        Row: {
          action: string | null
          actorName: string | null
          actorRole: string | null
          change: number | null
          createdAt: string | null
          createdAtClient: string | null
          createdBy: string | null
          id: string
          mlChange: number | null
          newStock: number | null
          newStockMl: number | null
          notes: string | null
          previousStock: number | null
          productId: string | null
          productName: string | null
          quantityChange: number | null
          reason: string | null
          shopId: string
          type: string | null
          userName: string | null
        }
        Insert: {
          action?: string | null
          actorName?: string | null
          actorRole?: string | null
          change?: number | null
          createdAt?: string | null
          createdAtClient?: string | null
          createdBy?: string | null
          id: string
          mlChange?: number | null
          newStock?: number | null
          newStockMl?: number | null
          notes?: string | null
          previousStock?: number | null
          productId?: string | null
          productName?: string | null
          quantityChange?: number | null
          reason?: string | null
          shopId: string
          type?: string | null
          userName?: string | null
        }
        Update: {
          action?: string | null
          actorName?: string | null
          actorRole?: string | null
          change?: number | null
          createdAt?: string | null
          createdAtClient?: string | null
          createdBy?: string | null
          id?: string
          mlChange?: number | null
          newStock?: number | null
          newStockMl?: number | null
          notes?: string | null
          previousStock?: number | null
          productId?: string | null
          productName?: string | null
          quantityChange?: number | null
          reason?: string | null
          shopId?: string
          type?: string | null
          userName?: string | null
        }
        Relationships: []
      }
      personal_expenses: {
        Row: {
          amount: number | null
          category: string | null
          createdAt: string | null
          createdAtClient: string | null
          description: string | null
          id: string
          shopId: string
        }
        Insert: {
          amount?: number | null
          category?: string | null
          createdAt?: string | null
          createdAtClient?: string | null
          description?: string | null
          id: string
          shopId: string
        }
        Update: {
          amount?: number | null
          category?: string | null
          createdAt?: string | null
          createdAtClient?: string | null
          description?: string | null
          id?: string
          shopId?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          bottleSize: string | null
          brand: string | null
          category: string | null
          costPrice: number | null
          createdAt: string | null
          createdAtClient: string | null
          id: string
          imageUrl: string | null
          lowStockAlert: number | null
          minStockLevel: number | null
          name: string
          nicotineLevel: number | null
          pricePerMl: number | null
          sellingPrice: number | null
          shopId: string
          stockQuantity: number | null
          unit: string | null
          unitCostPerMl: number | null
          updatedAt: string | null
        }
        Insert: {
          bottleSize?: string | null
          brand?: string | null
          category?: string | null
          costPrice?: number | null
          createdAt?: string | null
          createdAtClient?: string | null
          id: string
          imageUrl?: string | null
          lowStockAlert?: number | null
          minStockLevel?: number | null
          name: string
          nicotineLevel?: number | null
          pricePerMl?: number | null
          sellingPrice?: number | null
          shopId: string
          stockQuantity?: number | null
          unit?: string | null
          unitCostPerMl?: number | null
          updatedAt?: string | null
        }
        Update: {
          bottleSize?: string | null
          brand?: string | null
          category?: string | null
          costPrice?: number | null
          createdAt?: string | null
          createdAtClient?: string | null
          id?: string
          imageUrl?: string | null
          lowStockAlert?: number | null
          minStockLevel?: number | null
          name?: string
          nicotineLevel?: number | null
          pricePerMl?: number | null
          sellingPrice?: number | null
          shopId?: string
          stockQuantity?: number | null
          unit?: string | null
          unitCostPerMl?: number | null
          updatedAt?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          createdAt: string | null
          email: string | null
          id: string
          role: string
          shopId: string | null
          username: string
        }
        Insert: {
          createdAt?: string | null
          email?: string | null
          id: string
          role?: string
          shopId?: string | null
          username: string
        }
        Update: {
          createdAt?: string | null
          email?: string | null
          id?: string
          role?: string
          shopId?: string | null
          username?: string
        }
        Relationships: []
      }
      purchases: {
        Row: {
          created_at: string | null
          id: string
          product_id: string
          purchase_date: string
          purchase_price: number
          quantity: number
          shop_id: string
          supplier_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          product_id: string
          purchase_date: string
          purchase_price: number
          quantity: number
          shop_id: string
          supplier_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          product_id?: string
          purchase_date?: string
          purchase_price?: number
          quantity?: number
          shop_id?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          actorName: string | null
          actorRole: string | null
          createdAt: string | null
          customerId: string | null
          id: string
          items: Json | null
          notes: string | null
          paymentMethod: string | null
          saleDate: string | null
          saleDateClient: string | null
          shopId: string
          splitAmounts: Json | null
          totalAmount: number
          totalCOGS: number | null
          totalProfit: number | null
          updatedAt: string | null
          userName: string | null
        }
        Insert: {
          actorName?: string | null
          actorRole?: string | null
          createdAt?: string | null
          customerId?: string | null
          id: string
          items?: Json | null
          notes?: string | null
          paymentMethod?: string | null
          saleDate?: string | null
          saleDateClient?: string | null
          shopId: string
          splitAmounts?: Json | null
          totalAmount?: number
          totalCOGS?: number | null
          totalProfit?: number | null
          updatedAt?: string | null
          userName?: string | null
        }
        Update: {
          actorName?: string | null
          actorRole?: string | null
          createdAt?: string | null
          customerId?: string | null
          id?: string
          items?: Json | null
          notes?: string | null
          paymentMethod?: string | null
          saleDate?: string | null
          saleDateClient?: string | null
          shopId?: string
          splitAmounts?: Json | null
          totalAmount?: number
          totalCOGS?: number | null
          totalProfit?: number | null
          updatedAt?: string | null
          userName?: string | null
        }
        Relationships: []
      }
      settings: {
        Row: {
          accentColor: string | null
          currency: string | null
          footerMessage: string | null
          invoiceFooter: string | null
          invoicePrefix: string | null
          lastBackupDate: string | null
          logoUrl: string | null
          lowStockThreshold: number | null
          shopAddress: string | null
          shopEmail: string | null
          shopId: string
          shopLogo: string | null
          shopName: string | null
          shopPhone: string | null
          shopWebsite: string | null
          showCustomerDetails: boolean | null
          showPaymentMethod: boolean | null
          showShopAddress: boolean | null
          showShopEmail: boolean | null
          showShopPhone: boolean | null
          showTaxDetails: boolean | null
          taxRate: number | null
          themeColor: string | null
          updatedAt: string | null
        }
        Insert: {
          accentColor?: string | null
          currency?: string | null
          footerMessage?: string | null
          invoiceFooter?: string | null
          invoicePrefix?: string | null
          lastBackupDate?: string | null
          logoUrl?: string | null
          lowStockThreshold?: number | null
          shopAddress?: string | null
          shopEmail?: string | null
          shopId: string
          shopLogo?: string | null
          shopName?: string | null
          shopPhone?: string | null
          shopWebsite?: string | null
          showCustomerDetails?: boolean | null
          showPaymentMethod?: boolean | null
          showShopAddress?: boolean | null
          showShopEmail?: boolean | null
          showShopPhone?: boolean | null
          showTaxDetails?: boolean | null
          taxRate?: number | null
          themeColor?: string | null
          updatedAt?: string | null
        }
        Update: {
          accentColor?: string | null
          currency?: string | null
          footerMessage?: string | null
          invoiceFooter?: string | null
          invoicePrefix?: string | null
          lastBackupDate?: string | null
          logoUrl?: string | null
          lowStockThreshold?: number | null
          shopAddress?: string | null
          shopEmail?: string | null
          shopId?: string
          shopLogo?: string | null
          shopName?: string | null
          shopPhone?: string | null
          shopWebsite?: string | null
          showCustomerDetails?: boolean | null
          showPaymentMethod?: boolean | null
          showShopAddress?: boolean | null
          showShopEmail?: boolean | null
          showShopPhone?: boolean | null
          showTaxDetails?: boolean | null
          taxRate?: number | null
          themeColor?: string | null
          updatedAt?: string | null
        }
        Relationships: []
      }
      shop_links: {
        Row: {
          createdAt: string
          createdBy: string | null
          shopA: string
          shopB: string
        }
        Insert: {
          createdAt?: string
          createdBy?: string | null
          shopA: string
          shopB: string
        }
        Update: {
          createdAt?: string
          createdBy?: string | null
          shopA?: string
          shopB?: string
        }
        Relationships: []
      }
      stock_alerts: {
        Row: {
          active: boolean | null
          createdAt: string | null
          id: string
          productId: string | null
          shopId: string
          threshold: number | null
        }
        Insert: {
          active?: boolean | null
          createdAt?: string | null
          id: string
          productId?: string | null
          shopId: string
          threshold?: number | null
        }
        Update: {
          active?: boolean | null
          createdAt?: string | null
          id?: string
          productId?: string | null
          shopId?: string
          threshold?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_alerts_productId_fkey"
            columns: ["productId"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          city: string | null
          contact_number: string | null
          created_at: string | null
          email: string | null
          id: string
          name: string
          shop_id: string
        }
        Insert: {
          city?: string | null
          contact_number?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name: string
          shop_id: string
        }
        Update: {
          city?: string | null
          contact_number?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string
          shop_id?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string | null
          email: string
          id: string
          role: string
          shop_id: string | null
          updated_at: string | null
          username: string
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          role: string
          shop_id?: string | null
          updated_at?: string | null
          username: string
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          role?: string
          shop_id?: string | null
          updated_at?: string | null
          username?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      archive_finance_account: {
        Args: {
          p_id: string
        }
        Returns: Json
      }
      create_finance_account: {
        Args: {
          p_account_number?: string | null
          p_bank_name?: string | null
          p_id: string
          p_name: string
          p_opening_balance?: number
          p_opening_tx_id?: string | null
          p_shop_id: string
          p_type: string
        }
        Returns: Json
      }
      delete_expense: {
        Args: {
          p_expense_id: string
          p_rev_tx_id?: string | null
          p_shop_id: string
        }
        Returns: Json
      }
      ensure_shop_finance_accounts: {
        Args: {
          p_shop_id?: string | null
        }
        Returns: Json
      }
      get_linked_shops_finance_summary: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      process_checkout: {
        Args: {
          p_bottle_updates: Json
          p_credit_increment: number
          p_customer_id: string
          p_inventory_logs: Json
          p_product_updates: Json
          p_sale_data: Json
          p_shop_id: string
        }
        Returns: Json
      }
      process_reversal: {
        Args: {
          p_bottle_updates: Json
          p_credit_decrement: number
          p_customer_id: string
          p_delete_sale: boolean
          p_inventory_logs: Json
          p_product_updates: Json
          p_sale_id: string
          p_shop_id: string
        }
        Returns: Json
      }
      process_stock_adjustment: {
        Args: {
          p_bottle_inserts: Json
          p_bottle_updates: Json
          p_inventory_logs: Json
          p_product_id: string
          p_product_update: Json
          p_shop_id: string
        }
        Returns: undefined
      }
      record_credit_payment: {
        Args: {
          p_amount: number
          p_credit_id: string
          p_customer_id: string
          p_description?: string | null
          p_payment_method?: string
          p_shop_id: string
          p_tx_id: string
        }
        Returns: Json
      }
      record_expense: {
        Args: {
          p_account_id: string
          p_amount: number
          p_category: string
          p_description: string
          p_expense_date: string
          p_expense_id: string
          p_shop_id: string
          p_tx_id: string
        }
        Returns: Json
      }
      record_opening_balance: {
        Args: {
          p_account_id: string
          p_amount: number
          p_id: string
          p_notes?: string | null
          p_occurred_at?: string | null
          p_shop_id: string
        }
        Returns: Json
      }
      record_payout: {
        Args: {
          p_account_id: string
          p_amount: number
          p_category: string
          p_description?: string | null
          p_id: string
          p_notes?: string | null
          p_occurred_at?: string | null
          p_paid_to: string
          p_shop_id: string
        }
        Returns: Json
      }
      reverse_finance_transaction: {
        Args: {
          p_id: string
          p_occurred_at?: string | null
          p_original_tx_id: string
          p_reason: string
          p_shop_id: string
        }
        Returns: Json
      }
      transfer_funds: {
        Args: {
          p_amount: number
          p_description?: string | null
          p_from_account_id: string
          p_in_tx_id: string
          p_notes?: string | null
          p_occurred_at?: string | null
          p_out_tx_id: string
          p_shop_id: string
          p_to_account_id: string
          p_transfer_id: string
        }
        Returns: Json
      }
      update_expense: {
        Args: {
          p_account_id?: string | null
          p_amount: number
          p_category: string
          p_description: string
          p_expense_date: string
          p_expense_id: string
          p_new_tx_id?: string | null
          p_rev_tx_id?: string | null
          p_shop_id: string
        }
        Returns: Json
      }
      update_finance_account: {
        Args: {
          p_account_number?: string | null
          p_bank_name?: string | null
          p_id: string
          p_name: string
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
