import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, ArrowDownRight, ArrowUpRight } from 'lucide-react';
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

const toPaisa = (rupees: number) => Math.round(rupees * 100);

interface AddCreditModalProps {
  customers: any[];
  onClose: () => void;
  initialCustomerId?: string;
}

const AddCreditModal: React.FC<AddCreditModalProps> = ({ customers, onClose, initialCustomerId }) => {
  const { shopId, currentUser, userRole } = useAuth();

  // Tab state: 'taken' means receive payment, 'given' means add credit
  const [activeTab, setActiveTab] = useState<CreditTransactionType>('taken');

  const [formData, setFormData] = useState({
    creditType: initialCustomerId ? 'customer' : 'customer',
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
  }, [formData, activeTab]);

  // Sync tab with formData logic conceptually, but we can just use activeTab for transactionType
  const transactionType = activeTab;

  const transactionHint = useMemo(
    () =>
      transactionType === 'given'
        ? 'Increases customer credit balance.'
        : 'Decreases customer credit balance.',
    [transactionType]
  );

  const selectedCustomer = formData.creditType === 'customer'
    ? customers.find(c => c.id === formData.customerId)
    : undefined;
  const settleAmount = selectedCustomer ? settleAmountFor(selectedCustomer.creditBalance, transactionType) : null;
  const settleHasPaisa = settleAmount !== null && !Number.isInteger(settleAmount);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId) {
      toast.error('Shop not loaded yet. Please wait a moment and try again.');
      return;
    }
    const normalizedAmount = Math.abs(Number(formData.amount) || 0);
    if (!(normalizedAmount > 0)) {
      toast.error('Amount must be greater than 0');
      return;
    }
    const settlesInFull = settleAmount !== null && toPaisa(normalizedAmount) === toPaisa(settleAmount);
    if (!Number.isInteger(normalizedAmount) && !settlesInFull) {
      toast.error(settleHasPaisa
        ? 'Amounts are in whole rupees (no paisa). To clear this balance exactly, use "Settle in full".'
        : 'Amounts are in whole rupees (no paisa).');
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
    // Set once the history entry is saved: entries are permanent, so a later failure
    // must never lead to saving the same entry twice.
    let entrySaved = false;
    try {
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
      const actorMeta = buildActorMeta({ currentUser, userRole });
      const timestampIso = new Date().toISOString();
      const entryId = entryIdRef.current;
      const { error: insertError } = await supabase.from('credits').insert({
        id: entryId,
        creditType: formData.creditType,
        customerId: customerId || null,
        entityName: formData.entityName || null,
        description: formData.description || '',
        transactionType,
        amount: normalizedAmount,
        shopId,
        ...actorMeta,
        createdAt: timestampIso
      });
      // 23505 (this id exists): an earlier try of this same entry was saved although
      // its answer never arrived, and its balance step never ran: carry on from there.
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
        if (!check.data) throw insertError; // not saved: safe to try again
      }
      entrySaved = true;
      entryIdRef.current = crypto.randomUUID();
      notifyTableChanged('credits');

      // 3. The udhaar. The ticket is taken before the write goes out, so a newer change
      //    from another device that arrives meanwhile is never overwritten on screen.
      if (customerId) {
        await writeThrough(shopId, 'customers', [customerId], async store => {
          const saved = await addToCustomerBalance(shopId, customerId, getCreditBalanceDelta(transactionType, normalizedAmount), server);
          await store([saved]);
        });
      }

      toast.success(transactionType === 'taken' ? 'Payment received successfully' : 'Credit added successfully');
      onClose();
    } catch (error: any) {
      console.error('Credit save error:', error);
      if (error?.customerGone && customerId) void removeLocalRows('customers', [customerId]).catch(() => {});
      if (entrySaved) {
        // Fixed wording, never "try again": the entry is permanent.
        toast.error(
          error?.customerGone
            ? `The ${word} IS recorded in the history, but this customer was deleted on another device, so no balance was changed. Do not enter it again.`
            : error?.unknown
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
                min={settleHasPaisa ? 0.01 : 1}
                step={settleHasPaisa ? 'any' : 1}
                inputMode={settleHasPaisa ? 'decimal' : 'numeric'}
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
            {settleAmount !== null && (
              <button
                type="button"
                onClick={() => setFormData({ ...formData, amount: settleAmount })}
                className="text-xs font-bold text-violet-600 hover:text-violet-700 underline underline-offset-2"
              >
                Settle in full ({formatCurrency(settleAmount)})
              </button>
            )}
          </div>

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
