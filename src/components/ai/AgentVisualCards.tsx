import React from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Coins,
  Copy,
  CreditCard,
  Droplets,
  Layers,
  Lock,
  MessageCircle,
  Package,
  Plus,
  Receipt,
  ScanLine,
  ShieldAlert,
  Tag,
  Trash2,
  TrendingUp,
  Unlock,
  UserCheck,
  Wallet,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { AgentVisualCard } from '../../types/aiAgent';

interface AgentVisualCardsProps {
  cards: AgentVisualCard[];
  onQuickPrompt: (prompt: string) => void;
}

const fmtRs = (n: number | undefined | null) => `Rs ${Number(n || 0).toLocaleString()}`;

export const AgentVisualCards: React.FC<AgentVisualCardsProps> = ({ cards, onQuickPrompt }) => {
  if (!cards || cards.length === 0) return null;

  return (
    <div className="space-y-2.5 w-full">
      {cards.map((card, idx) => {
        if (card.type === 'sales_pulse') {
          const total = Math.max(1, card.cashTotal + card.onlineTotal + card.creditTotal);
          const cashPct = Math.round((card.cashTotal / total) * 100);
          const onlinePct = Math.round((card.onlineTotal / total) * 100);
          const creditPct = Math.max(0, 100 - cashPct - onlinePct);

          return (
            <div
              key={idx}
              className="rounded-xl border border-indigo-200/80 bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 text-white p-3.5 shadow-md"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center">
                    <BarChart3 className="w-4 h-4 text-indigo-300" />
                  </div>
                  <span className="text-xs font-semibold tracking-wide text-indigo-100 uppercase">
                    {card.title}
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-white/10 text-indigo-200">
                  {card.salesCount} {card.salesCount === 1 ? 'Sale' : 'Sales'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="rounded-lg bg-white/5 border border-white/10 p-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Revenue</div>
                  <div className="text-base font-bold text-white mt-0.5">{fmtRs(card.totalRevenue)}</div>
                </div>
                {card.totalProfit !== undefined ? (
                  <div className="rounded-lg bg-emerald-500/10 border border-emerald-400/20 p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-emerald-300 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" /> Net Profit
                    </div>
                    <div className="text-base font-bold text-emerald-300 mt-0.5">
                      {fmtRs(card.totalProfit)}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg bg-white/5 border border-white/10 p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">Cash Split</div>
                    <div className="text-base font-bold text-emerald-300 mt-0.5">{cashPct}% Cash</div>
                  </div>
                )}
              </div>

              {/* Payment Breakdown Stacked Bar */}
              <div className="space-y-1.5">
                <div className="h-2.5 w-full rounded-full bg-slate-800 overflow-hidden flex">
                  {card.cashTotal > 0 && (
                    <div
                      style={{ width: `${Math.max(4, cashPct)}%` }}
                      className="bg-emerald-400 transition-all duration-500"
                      title={`Cash: ${fmtRs(card.cashTotal)}`}
                    />
                  )}
                  {card.onlineTotal > 0 && (
                    <div
                      style={{ width: `${Math.max(4, onlinePct)}%` }}
                      className="bg-sky-400 transition-all duration-500"
                      title={`Online: ${fmtRs(card.onlineTotal)}`}
                    />
                  )}
                  {card.creditTotal > 0 && (
                    <div
                      style={{ width: `${Math.max(4, creditPct)}%` }}
                      className="bg-amber-400 transition-all duration-500"
                      title={`Udhaar: ${fmtRs(card.creditTotal)}`}
                    />
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    Cash: <strong className="text-white">{fmtRs(card.cashTotal)}</strong>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-sky-400" />
                    Online: <strong className="text-white">{fmtRs(card.onlineTotal)}</strong>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    Udhaar: <strong className="text-white">{fmtRs(card.creditTotal)}</strong>
                  </span>
                </div>
              </div>

              {card.recentSales.length > 0 && (
                <div className="mt-3 pt-2.5 border-t border-white/10 space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Latest Bills</div>
                  {card.recentSales.slice(0, 3).map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between text-xs bg-white/5 rounded-lg px-2.5 py-1.5"
                    >
                      <div className="min-w-0 pr-2">
                        <span className="font-mono text-[10px] text-indigo-300 mr-1.5">#{s.shortId}</span>
                        <span className="text-slate-200 truncate">{s.customerName}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] uppercase text-slate-300">
                          {s.paymentMethod}
                        </span>
                        <span className="font-semibold text-white">{fmtRs(s.totalAmount)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        }

        if (card.type === 'stock_health') {
          return (
            <div
              key={idx}
              className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center">
                    <Package className="w-4 h-4 text-amber-600" />
                  </div>
                  <span className="text-xs font-semibold text-gray-800">{card.title}</span>
                </div>
                <span className="text-[11px] font-medium text-gray-500">
                  {card.products.length} {card.products.length === 1 ? 'item' : 'items'}
                </span>
              </div>

              <div className="space-y-2">
                {card.products.map((p) => {
                  const isLiquid = p.category === 'e-liquid';
                  const unit = isLiquid ? 'ml' : ' pcs';
                  const min = Math.max(1, p.minStockLevel || (isLiquid ? 30 : 2));
                  const ratio = Math.min(100, Math.round((p.stockQuantity / (min * 2.5)) * 100));
                  const isOut = p.stockQuantity <= 0;
                  const isLow = p.stockQuantity <= min;

                  return (
                    <div
                      key={p.id}
                      className="rounded-lg border border-gray-100 bg-slate-50/70 p-2.5 space-y-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-gray-900 truncate">{p.name}</div>
                          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-gray-500">
                            <span className="capitalize">{p.category}</span>
                            <span>•</span>
                            <span>{fmtRs(p.sellingPrice)}</span>
                            {p.openBottlesCount !== undefined && (
                              <>
                                <span>•</span>
                                <span className="inline-flex items-center gap-0.5 text-indigo-600 font-medium">
                                  <Droplets className="w-3 h-3" /> {p.openBottlesCount} open / {p.closedBottlesCount} closed
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                              isOut
                                ? 'bg-red-100 text-red-700'
                                : isLow
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-emerald-100 text-emerald-700'
                            }`}
                          >
                            {p.stockQuantity}
                            {unit}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              onQuickPrompt(
                                isLiquid
                                  ? `Sheru, add 2 new closed bottles to "${p.name}"`
                                  : `Sheru, restock 5 units of "${p.name}"`
                              )
                            }
                            className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-indigo-600 text-white text-[10px] font-semibold hover:bg-indigo-700 transition-colors"
                            title="Ask AI Agent to restock this product"
                          >
                            <Plus className="w-3 h-3" /> Restock
                          </button>
                        </div>
                      </div>

                      <div className="h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
                        <div
                          style={{ width: `${Math.max(4, ratio)}%` }}
                          className={`h-full rounded-full transition-all duration-500 ${
                            isOut ? 'bg-red-500' : isLow ? 'bg-amber-500' : 'bg-emerald-500'
                          }`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }

        if (card.type === 'customer_khata') {
          return (
            <div
              key={idx}
              className="rounded-xl border border-indigo-200 bg-white p-3.5 shadow-sm space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center">
                    <CreditCard className="w-4 h-4 text-indigo-600" />
                  </div>
                  <span className="text-xs font-semibold text-gray-900">{card.title}</span>
                </div>
                {card.totalUdhaar !== undefined && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">
                    Total: {fmtRs(card.totalUdhaar)}
                  </span>
                )}
              </div>

              {card.customer && (
                <div className="rounded-lg bg-gradient-to-r from-indigo-50 to-violet-50 border border-indigo-100 p-2.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                      {card.customer.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-gray-900 truncate">{card.customer.name}</div>
                      <div className="text-[11px] text-gray-500">{card.customer.phone || 'No phone on file'}</div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div
                      className={`text-sm font-bold ${
                        card.customer.creditBalance > 0 ? 'text-red-600' : 'text-emerald-600'
                      }`}
                    >
                      {fmtRs(card.customer.creditBalance)}
                    </div>
                    {card.customer.creditBalance > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          onQuickPrompt(
                            `Sheru, record ${card.customer!.creditBalance} Rs vasooli (payment received) from "${card.customer!.name}"`
                          )
                        }
                        className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-semibold hover:bg-emerald-700"
                      >
                        <Coins className="w-3 h-3" /> Collect Full
                      </button>
                    )}
                  </div>
                </div>
              )}

              {card.transactions && card.transactions.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    Recent Credit Ledger
                  </div>
                  {card.transactions.map((tx) => {
                    const isTaken = tx.transactionType === 'taken';
                    return (
                      <div
                        key={tx.id}
                        className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg bg-slate-50 border border-gray-100"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {isTaken ? (
                            <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          ) : (
                            <ArrowUpRight className="w-3.5 h-3.5 text-red-500 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="text-gray-800 font-medium truncate">
                              {tx.description || (isTaken ? 'Payment Received' : 'Credit Given')}
                            </div>
                            <div className="text-[10px] text-gray-400">{tx.date}</div>
                          </div>
                        </div>
                        <span
                          className={`font-bold shrink-0 ${
                            isTaken ? 'text-emerald-700' : 'text-red-600'
                          }`}
                        >
                          {isTaken ? '-' : '+'}
                          {fmtRs(tx.amount)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {card.customers && card.customers.length > 0 && (
                <div className="space-y-1.5">
                  {card.customers.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-slate-50 border border-gray-100"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <UserCheck className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-gray-800 truncate">{c.name}</div>
                          {c.phone && <div className="text-[10px] text-gray-400">{c.phone}</div>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`text-xs font-bold ${
                            c.creditBalance > 0 ? 'text-amber-700' : 'text-emerald-600'
                          }`}
                        >
                          {fmtRs(c.creditBalance)}
                        </span>
                        {c.creditBalance > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              onQuickPrompt(`Sheru, view credit history for "${c.name}"`)
                            }
                            className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-semibold hover:bg-indigo-100"
                          >
                            History
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        }

        if (card.type === 'finance_overview') {
          return (
            <div
              key={idx}
              className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-950 to-slate-900 text-white p-3.5 shadow-md"
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center">
                  <Wallet className="w-4 h-4 text-emerald-300" />
                </div>
                <span className="text-xs font-semibold tracking-wide text-emerald-100 uppercase">
                  {card.title}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {card.accounts.map((acc) => (
                  <div
                    key={acc.id}
                    className="rounded-lg bg-white/5 border border-white/10 p-2.5"
                  >
                    <div className="text-[10px] text-slate-400 truncate">{acc.name}</div>
                    <div className="text-sm font-bold text-white mt-0.5">{fmtRs(acc.balance)}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        }

        if (card.type === 'roughbook_scan') {
          return (
            <div
              key={idx}
              className="rounded-xl border border-violet-200 bg-white p-3.5 shadow-sm space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center">
                    <ScanLine className="w-4 h-4 text-violet-700" />
                  </div>
                  <span className="text-xs font-semibold text-gray-900">{card.title}</span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-violet-100 text-violet-800">
                  {card.summary.totalLines} Lines • {fmtRs(card.summary.totalAmount)}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1.5 text-center text-[11px]">
                <div className="rounded-lg bg-emerald-50 border border-emerald-100 py-1.5 px-2">
                  <div className="text-emerald-700 font-semibold">Cash</div>
                  <div className="font-bold text-emerald-900">{fmtRs(card.summary.cashAmount)}</div>
                </div>
                <div className="rounded-lg bg-sky-50 border border-sky-100 py-1.5 px-2">
                  <div className="text-sky-700 font-semibold">Online</div>
                  <div className="font-bold text-sky-900">{fmtRs(card.summary.onlineAmount)}</div>
                </div>
                <div className="rounded-lg bg-amber-50 border border-amber-100 py-1.5 px-2">
                  <div className="text-amber-700 font-semibold">Udhaar</div>
                  <div className="font-bold text-amber-900">{fmtRs(card.summary.creditAmount)}</div>
                </div>
              </div>

              <div className="space-y-1 max-h-48 overflow-y-auto">
                {card.lines.slice(0, 8).map((line: any, i: number) => (
                  <div
                    key={line.id || i}
                    className="flex items-center justify-between gap-2 text-xs px-2.5 py-1.5 rounded-lg bg-slate-50 border border-gray-100"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-gray-800 truncate flex items-center gap-1">
                        <Receipt className="w-3 h-3 text-violet-500 shrink-0" />
                        {line.matchedProductName || line.rawText}
                      </div>
                      <div className="text-[10px] text-gray-400 truncate">
                        {line.saleType === 'refill' ? `${line.refillAmount}ml` : `${line.quantity}x`} • {line.paymentMethod}
                        {line.customerName ? ` • ${line.customerName}` : ''}
                      </div>
                    </div>
                    <span className="font-bold text-gray-900 shrink-0">{fmtRs(line.totalPrice)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        }

        if (card.type === 'dead_stock_audit') {
          const allNamesPrompt = (pct: number) =>
            `Sheru, put ${pct}% sale on these dead stock items: ${card.items.map((i) => `"${i.name}"`).join(', ')}`;

          return (
            <div
              key={idx}
              className="rounded-xl border border-rose-200 bg-white p-3.5 shadow-sm space-y-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-rose-50 border border-rose-200 flex items-center justify-center shrink-0">
                    <Tag className="w-4 h-4 text-rose-600" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-gray-900">{card.title}</div>
                    <div className="text-[11px] text-gray-500">
                      {card.items.length} stagnant item{card.items.length === 1 ? '' : 's'} ({card.lookbackDays}d+ window)
                    </div>
                  </div>
                </div>
                {card.totalTiedUpCapital !== undefined && (
                  <div className="text-right shrink-0">
                    <div className="text-[10px] uppercase tracking-wider text-rose-600 font-semibold">Locked Capital</div>
                    <div className="text-xs font-extrabold text-rose-700">{fmtRs(card.totalTiedUpCapital)}</div>
                  </div>
                )}
              </div>

              {card.items.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => onQuickPrompt(allNamesPrompt(10))}
                    className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 text-[11px] font-bold transition-colors"
                  >
                    Put 10% Sale on All
                  </button>
                  <button
                    type="button"
                    onClick={() => onQuickPrompt(allNamesPrompt(15))}
                    className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold transition-colors"
                  >
                    Put 15% Sale on All
                  </button>
                </div>
              )}

              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {card.items.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-gray-100 bg-slate-50/80 p-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-semibold text-gray-900 truncate">{item.name}</span>
                        {item.currentDiscountPercent > 0 && (
                          <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-rose-100 text-rose-700">
                            ON SALE -{item.currentDiscountPercent}%
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5 flex flex-wrap gap-x-2">
                        <span>{item.stockDisplay}</span>
                        <span>•</span>
                        <span>{fmtRs(item.sellingPrice)}</span>
                        <span>•</span>
                        <span className="text-rose-600 font-medium">
                          {item.daysSinceLastSale === null
                            ? 'Never sold'
                            : `${item.daysSinceLastSale}d since last sale`}
                        </span>
                        {item.tiedUpCapital !== undefined && (
                          <>
                            <span>•</span>
                            <span className="font-semibold text-gray-700">Cost locked: {fmtRs(item.tiedUpCapital)}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => onQuickPrompt(`Sheru, put 10% sale on "${item.name}"`)}
                        className="px-2 py-1 rounded-md bg-white border border-gray-200 hover:border-amber-400 text-[10px] font-bold text-gray-700"
                      >
                        10%
                      </button>
                      <button
                        type="button"
                        onClick={() => onQuickPrompt(`Sheru, put 15% sale on "${item.name}"`)}
                        className="px-2 py-1 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold"
                      >
                        15%
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        }

        if (card.type === 'restock_plan') {
          return (
            <div
              key={idx}
              className="rounded-xl border border-indigo-200 bg-white p-3.5 shadow-sm space-y-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center shrink-0">
                    <Package className="w-4 h-4 text-indigo-600" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-gray-900">{card.title}</div>
                    <div className="text-[11px] text-gray-500">
                      {card.items.length} item{card.items.length === 1 ? '' : 's'}
                      {card.budget ? ` • Budget ${fmtRs(card.budget)}` : ''}
                    </div>
                  </div>
                </div>
                {card.totalEstimatedCost !== undefined && (
                  <div className="text-right shrink-0">
                    <div className="text-[10px] uppercase tracking-wider text-indigo-600 font-semibold">Est. Cost</div>
                    <div className="text-xs font-extrabold text-indigo-700">{fmtRs(card.totalEstimatedCost)}</div>
                  </div>
                )}
              </div>

              {card.items.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(card.whatsappOrderText);
                      toast.success('Supplier order copied!');
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-semibold"
                  >
                    <Copy className="w-3 h-3" /> Copy Order
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      window.open(`https://wa.me/?text=${encodeURIComponent(card.whatsappOrderText)}`, '_blank')
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold"
                  >
                    <MessageCircle className="w-3 h-3" /> WhatsApp Supplier
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onQuickPrompt(
                        `Sheru, receive this restock order into stock now: ${card.items
                          .map((i) => `${i.recommendedQty} ${i.unitLabel} of "${i.name}"`)
                          .join(', ')}`
                      )
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold"
                  >
                    <Plus className="w-3 h-3" /> Receive Stock
                  </button>
                </div>
              )}

              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {card.items.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-gray-100 bg-slate-50/80 p-2 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 truncate">{item.name}</div>
                      <div className="text-[11px] text-gray-500">
                        Now: {item.currentStockDisplay} • 30d sold: {item.soldLast30d}
                        {item.daysLeftEstimate !== null ? ` • ~${item.daysLeftEstimate}d left` : ''}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-indigo-700">
                        +{item.recommendedQty} {item.unitLabel}
                      </div>
                      {item.lineCost !== undefined && (
                        <div className="text-[10px] text-gray-500">{fmtRs(item.lineCost)}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        }

        if (card.type === 'udhaar_radar') {
          const allIdsPrompt = (block: boolean) =>
            `Sheru, ${block ? 'freeze' : 'unfreeze'} udhaar for: ${card.customers.map((c) => `"${c.name}"`).join(', ')}`;

          return (
            <div
              key={idx}
              className="rounded-xl border border-amber-200 bg-white p-3.5 shadow-sm space-y-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
                    <CreditCard className="w-4 h-4 text-amber-600" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-gray-900">{card.title}</div>
                    <div className="text-[11px] text-gray-500">
                      {card.customers.length} overdue ({card.daysThreshold}d+ quiet)
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold">At Risk</div>
                  <div className="text-xs font-extrabold text-amber-700">{fmtRs(card.totalAtRisk)}</div>
                </div>
              </div>

              {card.customers.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => onQuickPrompt(allIdsPrompt(true))}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold"
                  >
                    <Lock className="w-3 h-3" /> Freeze Udhaar on All
                  </button>
                </div>
              )}

              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {card.customers.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-lg border border-gray-100 bg-slate-50/80 p-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-semibold text-gray-900 truncate">{c.name}</span>
                        {c.udhaarBlocked && (
                          <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-rose-100 text-rose-700">
                            FROZEN
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        Owes <strong className="text-amber-700">{fmtRs(c.creditBalance)}</strong>
                        {' • '}
                        {c.daysSinceLastActivity === null ? 'No recent payment' : `${c.daysSinceLastActivity}d since activity`}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          if (c.whatsappReminderUrl) {
                            window.open(c.whatsappReminderUrl, '_blank');
                          } else {
                            navigator.clipboard?.writeText(c.reminderText);
                            toast.success('Reminder copied (no phone saved)');
                          }
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold"
                        title="Send WhatsApp Reminder"
                      >
                        <MessageCircle className="w-3 h-3" /> WA
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onQuickPrompt(
                            `Sheru, ${c.udhaarBlocked ? 'unfreeze' : 'freeze'} udhaar for "${c.name}"`
                          )
                        }
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold border ${
                          c.udhaarBlocked
                            ? 'bg-white border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                            : 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100'
                        }`}
                      >
                        {c.udhaarBlocked ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                        {c.udhaarBlocked ? 'Unfreeze' : 'Freeze'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        }

        if (card.type === 'open_bottle_risk') {
          const pushAllPrompt = (pct: number) =>
            `Sheru, pin priority refill push and ${pct}% sale on these aging open bottle products: ${card.bottles
              .map((b) => `"${b.productName}"`)
              .join(', ')}`;

          return (
            <div
              key={idx}
              className="rounded-xl border border-violet-200 bg-white p-3.5 shadow-sm space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-violet-50 border border-violet-200 flex items-center justify-center shrink-0">
                    <Droplets className="w-4 h-4 text-violet-600" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-gray-900">{card.title}</div>
                    <div className="text-[11px] text-gray-500">
                      {card.bottles.length} open bottle{card.bottles.length === 1 ? '' : 's'} ({card.minDaysOpen}d+ open)
                    </div>
                  </div>
                </div>
              </div>

              {card.bottles.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => onQuickPrompt(pushAllPrompt(15))}
                    className="px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-bold"
                  >
                    Pin Refill Push + 15% Off All
                  </button>
                </div>
              )}

              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {card.bottles.map((b) => (
                  <div
                    key={b.bottleId}
                    className="rounded-lg border border-gray-100 bg-slate-50/80 p-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-semibold text-gray-900 truncate">{b.productName}</span>
                        {b.priorityRefill && (
                          <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-violet-100 text-violet-700">
                            PUSH REFILL
                          </span>
                        )}
                        {b.currentDiscountPercent > 0 && (
                          <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-rose-100 text-rose-700">
                            -{b.currentDiscountPercent}%
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        {b.remainingMl}ml / {b.bottleSize}ml left • Open {b.daysOpen}d
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onQuickPrompt(
                          `Sheru, pin priority refill push and 15% sale on "${b.productName}"`
                        )
                      }
                      className="px-2 py-1 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-bold shrink-0"
                    >
                      Push + 15%
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        }

        if (card.type === 'combo_deals') {
          return (
            <div
              key={idx}
              className="rounded-xl border border-emerald-200 bg-white p-3.5 shadow-sm space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
                    <Layers className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-gray-900">{card.title}</div>
                    <div className="text-[11px] text-gray-500">
                      {card.mode === 'suggested' ? 'Suggested Pod + Slow Flavor Combos' : 'Live POS 1-Tap Combos'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {card.combos.map((c, cIdx) => (
                  <div
                    key={c.id || cIdx}
                    className="rounded-lg border border-gray-100 bg-slate-50/80 p-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-gray-900 truncate">{c.title}</div>
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        <span className="line-through mr-1.5">{fmtRs(c.regularTotal)}</span>
                        <strong className="text-emerald-700">{fmtRs(c.comboPrice)}</strong>
                        <span className="ml-1.5 text-rose-600 font-bold">(-{c.discountPercent}%)</span>
                      </div>
                    </div>
                    {card.mode === 'suggested' ? (
                      <button
                        type="button"
                        onClick={() =>
                          onQuickPrompt(
                            `Sheru, activate combo deal "${c.title}" pairing "${c.primaryProductName}" + "${c.secondaryProductName}" at ${c.discountPercent}% off`
                          )
                        }
                        className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold shrink-0"
                      >
                        Activate Combo
                      </button>
                    ) : c.id ? (
                      <button
                        type="button"
                        onClick={() => onQuickPrompt(`Sheru, remove combo deal "${c.title}"`)}
                        className="p-1.5 rounded-md text-rose-600 hover:bg-rose-50 shrink-0"
                        title="Remove Combo"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          );
        }

        if (card.type === 'leakage_audit') {
          return (
            <div
              key={idx}
              className="rounded-xl border border-red-200 bg-white p-3.5 shadow-sm space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
                    <ShieldAlert className="w-4 h-4 text-red-600" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-gray-900">{card.title}</div>
                    <div className="text-[11px] text-gray-500">
                      Last {card.lookbackDays} days • {card.flags.length} alert{card.flags.length === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {card.flags.map((f) => (
                  <div
                    key={f.id}
                    className={`rounded-lg border p-2.5 text-xs ${
                      f.severity === 'high' ? 'border-red-200 bg-red-50/70' : 'border-amber-200 bg-amber-50/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-gray-900 flex items-center gap-1">
                        <AlertTriangle className={`w-3.5 h-3.5 ${f.severity === 'high' ? 'text-red-600' : 'text-amber-600'}`} />
                        {f.title}
                      </span>
                      <span className="text-[10px] font-mono text-gray-500 shrink-0">{f.date}</span>
                    </div>
                    <div className="text-[11px] text-gray-700 mt-0.5">{f.detail}</div>
                    <div className="text-[10px] text-gray-500 mt-1">Staff: {f.actorName || 'Unknown'}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        }

        if (card.type === 'day_closing_audit') {
          return (
            <div
              key={idx}
              className="rounded-xl border border-emerald-300/80 bg-gradient-to-br from-slate-900 to-emerald-950 text-white p-3.5 shadow-md space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center">
                    <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white">{card.title}</div>
                    <div className="text-[10px] text-emerald-200">{card.date} • {card.salesCount} Bills</div>
                  </div>
                </div>
                {card.saved && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                    SAVED
                  </span>
                )}
              </div>

              <div className="rounded-lg bg-white/10 border border-white/15 p-2.5 flex items-center justify-between">
                <span className="text-xs text-slate-200 font-medium">Expected Cash in Galla</span>
                <span className="text-lg font-extrabold text-emerald-300">{fmtRs(card.expectedCashInDrawer)}</span>
              </div>

              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <div className="rounded bg-white/5 px-2.5 py-1.5 flex justify-between">
                  <span className="text-slate-300">Cash Sales</span>
                  <strong>{fmtRs(card.cashSales)}</strong>
                </div>
                <div className="rounded bg-white/5 px-2.5 py-1.5 flex justify-between">
                  <span className="text-slate-300">Cash Vasooli</span>
                  <strong>+{fmtRs(card.cashVasooli)}</strong>
                </div>
                <div className="rounded bg-white/5 px-2.5 py-1.5 flex justify-between">
                  <span className="text-slate-300">Expenses</span>
                  <strong className="text-rose-300">-{fmtRs(card.expensesTotal)}</strong>
                </div>
                <div className="rounded bg-white/5 px-2.5 py-1.5 flex justify-between">
                  <span className="text-slate-300">Online / Bank</span>
                  <strong className="text-sky-300">{fmtRs(card.onlineSales)}</strong>
                </div>
              </div>

              {card.zeroStockAlerts.length > 0 && (
                <div className="text-[11px] text-amber-200 bg-amber-500/10 border border-amber-400/20 rounded-lg px-2.5 py-1.5">
                  <strong>Out-of-stock alerts:</strong> {card.zeroStockAlerts.slice(0, 4).join(', ')}
                </div>
              )}

              <div className="flex flex-wrap gap-1.5">
                {!card.saved && (
                  <button
                    type="button"
                    onClick={() => onQuickPrompt(`Sheru, save day closing entry for ${card.date}`)}
                    className="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[11px] font-extrabold"
                  >
                    Save Closing Snapshot
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    window.open(`https://wa.me/?text=${encodeURIComponent(card.whatsappSummaryText)}`, '_blank')
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11px] font-semibold"
                >
                  <MessageCircle className="w-3 h-3" /> WhatsApp Owner
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(card.whatsappSummaryText);
                    toast.success('Closing summary copied!');
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11px] font-semibold"
                >
                  <Copy className="w-3 h-3" /> Copy
                </button>
              </div>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
};
