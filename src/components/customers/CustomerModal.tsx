import React, { useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { useData } from '../../contexts/DataContext';
import { formatCurrency } from '../../lib/utils';
import { roundRupees } from '../../lib/quantities';
import { removeLocalRows, writeThrough } from '../../lib/liveStock';
import { friendlyError } from '../../lib/errors';

interface CustomerModalProps {
  customer?: any;
  onClose: () => void;
  onSuccess?: (customerId: string) => void;
}

const CustomerModal: React.FC<CustomerModalProps> = ({ customer, onClose, onSuccess }) => {
  const { shopId } = useAuth();
  const { customers } = useData();
  const isEditing = !!customer;
  const [formData, setFormData] = useState({
    name: customer?.name || '',
    phone: customer?.phone || '',
    email: customer?.email || '',
    // Only used when adding a customer. An existing customer's balance changes
    // only through sales and payments, never by editing it here.
    creditBalance: '' as number | string
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId) {
      toast.error('Shop not loaded yet. Please wait a moment and try again.');
      return;
    }

    const isNameDuplicate = customers.some(
      c => c.name?.trim().toLowerCase() === formData.name.trim().toLowerCase() && c.id !== customer?.id
    );

    if (isNameDuplicate) {
      toast.error('A customer with this exact name already exists.');
      return;
    }

    const cleanedPhone = formData.phone.trim();
    if (cleanedPhone) {
      const isPhoneDuplicate = customers.some(
        c => c.phone?.trim() === cleanedPhone && c.id !== customer?.id
      );
      
      if (isPhoneDuplicate) {
        toast.error('A customer with this phone number already exists.');
        return;
      }
    }

    const initialCredit = Number(formData.creditBalance) || 0;
    if (!isEditing && !Number.isFinite(initialCredit)) {
      toast.error('Initial credit balance must be a number.');
      return;
    }

    setSaving(true);
    try {
      const timestampIso = new Date().toISOString();
      const details = {
        name: formData.name.trim(),
        phone: cleanedPhone,
        email: formData.email.trim()
      };

      if (customer) {
        // creditBalance is never sent from here: the balance is the result of
        // the customer's sales and payments. updatedAt marks the change, so a device
        // catching up after a short disconnect sees that this row changed.
        // Write-through: the list and the POS show the change at once (a newer change
        // from another device that lands meanwhile is kept).
        await writeThrough(shopId, 'customers', [customer.id], async store => {
          const { data: updated, error } = await supabase
            .from('customers')
            .update({ ...details, updatedAt: timestampIso })
            .eq('id', customer.id)
            .eq('shopId', shopId)
            .select('*');
          if (error) throw error;
          if (!updated || updated.length === 0) {
            // Deleted (archived) on another device: it leaves this device's list too.
            await removeLocalRows('customers', [customer.id]).catch(() => {});
            throw new Error('This customer was deleted on another device, so nothing was saved.');
          }
          await store(updated);
        });
        toast.success('Customer updated successfully');
        if (onSuccess) {
          onSuccess(customer.id);
        }
      } else {
        const newCustomerId = crypto.randomUUID();
        // Write-through: the new customer can be picked on the POS straight away.
        await writeThrough(shopId, 'customers', [newCustomerId], async store => {
          const { data: created, error } = await supabase.from('customers').insert({
            id: newCustomerId,
            ...details,
            creditBalance: roundRupees(initialCredit),
            shopId,
            createdAt: timestampIso,
            updatedAt: timestampIso
          }).select('*');
          if (error) throw error;
          await store(created);
        });
        toast.success('Customer added successfully');
        if (onSuccess) {
          onSuccess(newCustomerId);
        }
      }
      onClose();
    } catch (error: any) {
      console.error('Customer save error:', error);
      toast.error(friendlyError(error, 'The customer could not be saved. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-2xl animate-in zoom-in duration-300">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 rounded-t-2xl">
          <h2 className="text-xl font-bold text-slate-900">{customer ? 'Edit Customer' : 'Add New Customer'}</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-lg text-slate-400 transition-colors"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Full Name</label>
              <input 
                required
                type="text" 
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:ring-2 focus:ring-violet-500/20 outline-none transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Phone Number</label>
              <input 
                required
                type="text" 
                value={formData.phone}
                onChange={(e) => setFormData({...formData, phone: e.target.value})}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:ring-2 focus:ring-violet-500/20 outline-none transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Email Address (Optional)</label>
              <input 
                type="email" 
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:ring-2 focus:ring-violet-500/20 outline-none transition-all"
              />
            </div>
            {isEditing ? (
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Credit Balance (Rs)</label>
                <div className="w-full px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-700 font-bold">
                  {formatCurrency(Number(customer?.creditBalance) || 0)}
                </div>
                <p className="text-xs text-slate-400">Changes only through sales and payments.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Initial Credit Balance (Rs)</label>
                <input
                  type="number"
                  step={1}
                  value={formData.creditBalance}
                  onChange={(e) => setFormData({...formData, creditBalance: e.target.value === '' ? '' : parseFloat(e.target.value)})}
                  onFocus={(e) => e.target.select()}
                  placeholder="0"
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:ring-2 focus:ring-violet-500/20 outline-none transition-all"
                />
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-4">
            <button 
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl transition-all uppercase tracking-widest text-xs"
            >
              Cancel
            </button>
            <button 
              type="submit"
              disabled={saving || !shopId}
              className="flex-1 py-3 px-4 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-bold rounded-xl shadow-lg shadow-violet-600/20 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-widest text-xs"
            >
              {saving ? 'Saving...' : customer ? 'Update Customer' : 'Add Customer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CustomerModal;
