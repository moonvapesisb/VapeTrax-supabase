import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, ArrowDownRight, ArrowUpRight, Banknote, CreditCard } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { getCreditBalanceDelta, type CreditTransactionType } from '../../lib/credits';
import { buildActorMeta } from '../../lib/actor';
import { cn, formatCurrency } from '../../lib/utils';
import { removeLocalRows, writeThrough } from '../../lib/liveStock';
import { notifyTableChanged } from '../../lib/liveSync';
import { friendlyError, isNetworkError } from '../../lib/errors';
import { addToCustomerBalance, readServerCustomer, settleAmountFor, type ServerCustomer } from '../../lib/customerBalance';
import type { Customer } from '../../lib/db';
import { recordCreditPayment, type ActorMeta } from '../../lib/financeAccounts';

interface AddCreditModalProps {
  customers: Customer[];
  onClose: () => void;
  initialCustomerId?: string;
}

const AddCreditModal: React.FC<AddCreditModalProps> = ({ customers, onClose, initialCustomerId }) => {
  const { shopId, currentUser, userRole } = useAuth();

  // Tab state: 'taken' means receive payment, 'given' means add credit
  const [activeTab, setActiveTab] = useState<CreditTransactionType>('taken');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'online'>('cash');

  const [formData, setFormData] = useState({
    creditType: 'customer',
    customerId: initialCustomerId || '',
    entityName: '',
    entityContact: '',
    amount: '' as number | string,
    description: '',
  });

  const [saving, setSaving] = useState(false);

  // The history entry's id stays the same while the form is unchanged, so trying the
  // same entry again (after an error) can never save it twice: the server refuses a
  // second row with the same id. Any change to the form makes it a new entry.
  const entryIdRef = useRef<string>(crypto.randomUUID());
  useEffect(() => {
    entryIdRef.current = crypto.randomUUID();
  }, [formData, activeTab, paymentMethod]);

  // Sync tab with formData logic conceptually, but we can just use activeTab for transactionType
  const transactionType = activeTab;

  const transactionHint = useMemo(
    () =>
      transactionType === 'given'
        ? 'Increases customer credit balance.'
        : 'Decreases customer credit balance and records receipt in finance ledger.',
    [transactionType]
  );

  const selectedCustomer = formData.creditType === 'customer'
    ? customers.find(c => c.id === formData.customerId)
    : undefined;
  const settleAmount = selectedCustomer ? settleAmountFor(selectedCustomer.creditBalance, transactionType) : null;
  const wholeSettleAmount = settleAmount !== null ? Math.round(settleAmount) : null;
  const isOfflineCreditPayment = activeTab === 'taken' && formData.creditType === 'customer';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId) {
      toast.error('Shop not loaded yet. Please wait a moment and try again.');
      return;
    }
    const normalizedAmount = Number(formData.amount);
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      toast.error('Amount must be greater than 0');
      return;
    }
    if (!Number.isInteger(normalizedAmount)) {
      toast.error('Amounts must be in whole rupees (no decimals).');
      return;
    }
    const isCustomer = formData.creditType === 'customer';
    const customerId = isCustomer ? formData.customerId : '';
    if (isCustomer && !customerId) {
      toast.error('Please select a customer');
      return;
    }
    const word = transactionType === 'taken' ? 'payment' : 'credit';

    setSaving(true);
    let entrySaved = false;
    try {
      const rawActor = buildActorMeta({ currentUser, userRole });
      const actor: ActorMeta = {
        createdBy: rawActor.createdBy,
        actorRole: rawActor.actorRole === 'cashier' ? 'cashier' : 'admin',
        actorName: rawActor.actorName,
      };

      // Customer credit payments work offline & atomically update local creditBalance + cash/online account.
      if (isOfflineCreditPayment) {
        if (navigator.onLine) {
          try {
            const server = await readServerCustomer(shopId, customerId);
            if (!server) {
              void removeLocalRows('customers', [customerId]).catch(() => {});
              toast.error('This customer was deleted on another device. Nothing was saved.');
              onClose();
              return;
            }
          } catch (checkErr) {
            if (!isNetworkError(checkErr)) throw checkErr;
          }
        }
        await recordCreditPayment({
          shopId,
          customerId,
          amount: normalizedAmount,
          paymentMethod,
          description: formData.description,
          actor,
          customerFallback: selectedCustomer,
        });
        notifyTableChanged('credits');
        toast.success(
          navigator.onLine
            ? 'Payment received and recorded to account'
            : 'Payment saved offline; will sync automatically',
        );
        onClose();
        return;
      }

      // 1. The customer must still exist BEFORE the permanent entry is written.
      let server: ServerCustomer | undefined;
      if (customerId) {
        server = await readServerCustomer(shopId, customerId);
        if (!server) {
          void removeLocalRows('customers', [customerId]).catch(() => {});
          toast.error('This customer was deleted on another device. Nothing was saved.');
          onClose();
          return;
        }
      }

      // 2. The permanent history entry. If the answer is lost, it is looked up by id
      //    before anyone is told to try again.
      const timestampIso = new Date().toISOString();
      const entryId = entryIdRef.current;
      const { error: insertError } = await supabase.from('credits').insert({
        id: entryId,
        creditType: formData.creditType,
        customerId: customerId || null,
        entityName: formData.entityName || null,
        entityContact: formData.entityContact || null,
        description: formData.description || '',
        transactionType,
        amount: normalizedAmount,
        shopId,
        ...rawActor,
        createdAt: timestampIso
      });
      if (insertError && insertError.code !== '23505') {
        if (!isNetworkError(insertError)) throw insertError;
        const check = await supabase.from('credits').select('id').eq('id', entryId).eq('shopId', shopId).maybeSingle();
        if (check.error) {
          toast.error(
            `The connection dropped, so it is not known whether the ${word} was saved. Open the customer's credit history to check before entering it again.`,
            { duration: 12000 }
          );
          notifyTableChanged('credits');
          onClose();
          return;
        }
        if (!check.data) throw insertError;
      }
      entrySaved = true;
      entryIdRef.current = crypto.randomUUID();
      notifyTableChanged('credits');

      // 3. The udhaar. The ticket is taken before the write goes out.
      if (customerId) {
        await writeThrough(shopId, 'customers', [customerId], async store => {
          const saved = await addToCustomerBalance(shopId, customerId, getCreditBalanceDelta(transactionType, normalizedAmount), server);
          await store([saved]);
        });
      }

      toast.success(transactionType === 'taken' ? 'Payment received successfully' : 'Credit added successfully');
      onClose();
    } catch (error: unknown) {
      console.error('Credit save error:', error);
      const errObj = (typeof error === 'object' && error !== null ? error : {}) as {
        customerGone?: boolean;
        unknown?: boolean;
      };
      if (errObj.customerGone && customerId) void removeLocalRows('customers', [customerId]).catch(() => {});
      if (entrySaved) {
        toast.error(
          errObj.customerGone
            ? `The ${word} IS recorded in the history, but this customer was deleted on another device, so no balance was changed. Do not enter it again.`
            : errObj.unknown
              ? `The ${word} IS recorded in the history, but the connection dropped, so it is not known whether the customer's balance changed. Do not enter it again: ask the shop admin to check this customer's balance.`
              : `The ${word} IS recorded in the history, but the customer's balance was not updated. Do not enter it again: ask the shop admin to check this customer's balance.`,
          { duration: 12000 }
        );
        onClose();
      } else {
        toast.error(friendlyError(error, 'The transaction could not be saved. Please try again.'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-[32px] w-full max-w-md shadow-2xl animate-in zoom-in duration-300 overflow-hidden border border-slate-200">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Manage Credit</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-2xl text-slate-400 transition-colors">
            <X size={24} strokeWidth={2.5} />
          </button>
        </div>
        
        {/* Tabs */}
        <div className="flex p-4 gap-2 bg-slate-50/50">
          <button
            type="button"
            onClick={() => setActiveTab('taken')}
            className={cn(
              "flex-1 flex flex-col items-center justify-center py-4 rounded-2xl transition-all font-bold border-2",
              activeTab === 'taken' 
                ? "bg-emerald-50 border-emerald-500 text-emerald-700 shadow-sm" 
                : "bg-white border-transparent text-slate-500 hover:bg-slate-100"
            )}
          >
            <ArrowDownRight size={24} className={activeTab === 'taken' ? "text-emerald-500 mb-1" : "text-slate-400 mb-1"} />
            Receive Payment
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('given')}
            className={cn(
              "flex-1 flex flex-col items-center justify-center py-4 rounded-2xl transition-all font-bold border-2",
              activeTab === 'given' 
                ? "bg-orange-50 border-orange-500 text-orange-700 shadow-sm" 
                : "bg-white border-transparent text-slate-500 hover:bg-slate-100"
            )}
          >
            <ArrowUpRight size={24} className={activeTab === 'given' ? "text-orange-500 mb-1" : "text-slate-400 mb-1"} />
            Add Credit
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Credit Type</label>
            <select
              value={formData.creditType}
              onChange={(e) => setFormData({ ...formData, creditType: e.target.value })}
              className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 font-bold focus:outline-none focus:ring-4 focus:ring-violet-500/10 focus:border-violet-300 transition-all"
            >
              <option value="customer">Customer</option>
              <option value="others">Others</option>
            </select>
          </div>

          {formData.creditType === 'customer' && (
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Select Customer</label>
              <select
                required
                value={formData.customerId}
                onChange={(e) => setFormData({ ...formData, customerId: e.target.value })}
                className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 font-bold focus:outline-none focus:ring-4 focus:ring-violet-500/10 focus:border-violet-300 transition-all"
              >
                <option value="">Choose a customer...</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {formData.creditType === 'others' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Entity Name</label>
                <input
                  required
                  type="text"
                  value={formData.entityName}
                  onChange={(e) => setFormData({ ...formData, entityName: e.target.value })}
                  className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 font-bold focus:outline-none focus:ring-4 focus:ring-violet-500/10 focus:border-violet-300 transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Contact</label>
                <input
                  type="text"
                  value={formData.entityContact}
                  onChange={(e) => setFormData({ ...formData, entityContact: e.target.value })}
                  className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 font-bold focus:outline-none focus:ring-4 focus:ring-violet-500/10 focus:border-violet-300 transition-all"
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Amount (Rs)</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">Rs.</span>
              <input
                required
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value === '' ? '' : (parseFloat(e.target.value) || 0) })}
                onFocus={(e) => e.target.select()}
                placeholder="0"
                className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 font-bold focus:outline-none focus:ring-4 focus:ring-violet-500/10 focus:border-violet-300 transition-all text-lg"
              />
            </div>
            <p className={cn(
              "text-xs font-bold mt-2",
              activeTab === 'taken' ? "text-emerald-600" : "text-orange-600"
            )}>
              {transactionHint}
            </p>
            {wholeSettleAmount !== null && wholeSettleAmount > 0 && (
              <button
                type="button"
                onClick={() => setFormData({ ...formData, amount: wholeSettleAmount })}
                className="text-xs font-bold text-violet-600 hover:text-violet-700 underline underline-offset-2"
              >
                Settle in full ({formatCurrency(wholeSettleAmount)})
              </button>
            )}
          </div>

          {isOfflineCreditPayment && (
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Payment Account</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('cash')}
                  className={cn(
                    "flex items-center justify-center gap-2 py-3 rounded-2xl border-2 font-bold text-sm transition-all",
                    paymentMethod === 'cash'
                      ? "bg-emerald-50 border-emerald-500 text-emerald-700"
                      : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                  )}
                >
                  <Banknote size={18} />
                  Cash
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('online')}
                  className={cn(
                    "flex items-center justify-center gap-2 py-3 rounded-2xl border-2 font-bold text-sm transition-all",
                    paymentMethod === 'online'
                      ? "bg-violet-50 border-violet-500 text-violet-700"
                      : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                  )}
                >
                  <CreditCard size={18} />
                  Online
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 font-medium focus:outline-none focus:ring-4 focus:ring-violet-500/10 focus:border-violet-300 transition-all h-24 resize-none"
              placeholder="Reason for transaction..."
            />
          </div>

          <button
            type="submit"
            disabled={saving || !shopId}
            className={cn(
              "w-full py-4 px-4 text-white font-black rounded-2xl shadow-lg transition-all active:scale-95 uppercase tracking-wider text-sm",
              activeTab === 'taken' 
                ? "bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20" 
                : "bg-orange-500 hover:bg-orange-600 shadow-orange-500/20",
              (saving || !shopId) && "opacity-50 cursor-not-allowed"
            )}
          >
            {saving ? 'Processing...' : (activeTab === 'taken' ? 'Confirm Payment' : 'Confirm Credit')}
          </button>
        </form>
      </div>
    </div>
  );
};

export default AddCreditModal;
