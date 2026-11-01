import React, { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Badge, Btn, BtnRow, Card, Chips, ErrorBox, Notice, Screen, StockPill, errorText, num, useFood, useStockSubmit } from '../ui';

interface Message { id: string; role: 'user' | 'assistant'; text: string; proposal?: any; notice?: string }

/** A change the assistant wants to make. Nothing happens until the owner taps Confirm here. */
function ProposalCard({ proposal, onDone }: { proposal: any; onDone: (updated: any) => void }) {
  const { api, t, tf, c, bump, toast, open } = useFood();
  const [method, setMethod] = useState<'Cash' | 'UPI' | 'Credit'>('Cash');
  const { send, busy, error } = useStockSubmit();
  const [rejecting, setRejecting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const isPurchase = proposal.actionType === 'CREATE_PURCHASE';
  const confirm = async () => {
    const r = await send((_, extra) => api.post(`/ai/proposals/${proposal.id}/confirm`, { paymentMethod: method, ...extra }));
    if (r) { bump(); toast(tf('ai_confirmedToast')); onDone(r.proposal); }
  };
  const reject = async () => {
    setRejecting(true);
    try {
      const r = await api.post(`/ai/proposals/${proposal.id}/reject`, {});
      onDone(r.proposal);
    } catch (e) { setProblem(errorText(t, e)); } finally { setRejecting(false); }
  };
  const review = async () => {
    await reject();
    open('food_purchases', 'purchaseForm', { items: proposal.payload.items });
  };
  const pending = proposal.status === 'Pending';
  return (
    <View style={{ borderWidth: 1, borderColor: c.brand, borderRadius: 12, padding: 12, marginTop: 8, backgroundColor: c.card }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ color: c.brandText, fontWeight: '800' }}>{tf('ai_proposalTitle')}</Text>
        <Badge value={proposal.status === 'Confirmed' ? 'Approved' : pending ? 'Pending' : 'Cancelled'} label={tf(`st_${String(proposal.status).toLowerCase()}` as any)} />
      </View>
      <Text style={{ color: c.text }}>{proposal.summary}</Text>
      {pending && (
        <>
          <Text style={{ color: c.muted, fontSize: 12, marginVertical: 6 }}>{tf('ai_confirmHint')}</Text>
          {isPurchase && <Chips value={method} onChange={setMethod} options={[{ value: 'Cash', label: tf('pay_cash') }, { value: 'UPI', label: tf('pay_upi') }, { value: 'Credit', label: tf('pay_credit') }]} />}
          {!!(error || problem) && <ErrorBox message={(error || problem) as string} />}
          <BtnRow>
            <Btn small icon="✓" title={tf('ai_confirm')} onPress={confirm} busy={busy} disabled={rejecting} />
            {isPurchase && <Btn small kind="secondary" icon="✏️" title={tf('ai_review')} onPress={review} disabled={busy || rejecting} />}
            <Btn small kind="ghost" title={tf('ai_reject')} onPress={reject} busy={rejecting} disabled={busy} />
          </BtnRow>
        </>
      )}
    </View>
  );
}

const SUGGESTIONS: any[] = ['ai_q_stock', 'ai_q_spend', 'ai_q_net', 'ai_q_top', 'ai_q_oil', 'ai_q_buy', 'ai_q_low', 'ai_q_why', 'ai_q_target'];

export function AssistantScreen() {
  const { api, t, tf, c, lang } = useFood();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<ScrollView>(null);
  const seq = useRef(0);
  const nextId = () => `m${++seq.current}`;
  const scrollDown = () => setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 80);

  const ask = async (text: string) => {
    const message = text.trim();
    if (!message || thinking) return;
    setInput('');
    setError(null);
    const history = messages.slice(-6).map(m => ({ role: m.role, text: m.text }));
    setMessages(ms => [...ms, { id: nextId(), role: 'user', text: message }]);
    setThinking(true);
    scrollDown();
    try {
      const r = await api.post('/ai/chat', { message, lang, history });
      setMessages(ms => [...ms, { id: nextId(), role: 'assistant', text: r.reply, proposal: r.proposal || undefined, notice: r.notice || undefined }]);
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setThinking(false);
      scrollDown();
    }
  };
  const suggest = async () => {
    setThinking(true);
    setError(null);
    try {
      const r = await api.post('/ai/purchase-suggestions', {});
      const lines = r.plan.items.map((i: any) => `• ${i.name}: ${i.quantity} ${i.unit} (${tf('ai_inStock', { qty: Number(i.stockQty).toFixed(2) })})`).join('\n');
      setMessages(ms => [...ms, {
        id: nextId(), role: 'assistant', proposal: r.proposal || undefined,
        text: r.plan.items.length ? `${tf('ai_planIntro', { days: r.plan.coverDays })}\n${lines}` : tf('ai_planNone', { days: r.plan.coverDays }),
      }]);
    } catch (e) { setError(errorText(t, e)); } finally { setThinking(false); scrollDown(); }
  };
  const summary = async () => {
    setThinking(true);
    setError(null);
    try {
      const r = await api.get('/ai/daily-summary');
      const low = r.lowStock.length ? `\n${tf('ai_sumLow', { items: r.lowStock.map((s: any) => s.name).join(', ') })}` : '';
      const top = r.topFoods[0] ? `\n${tf('ai_sumTop', { name: r.topFoods[0].name, profit: `₹${r.topFoods[0].profit}` })}` : '';
      const pending = num(r.pending.toCollect) + num(r.pending.toPaySuppliers) > 0 ? `\n${tf('ai_sumPending', { collect: `₹${r.pending.toCollect}`, pay: `₹${r.pending.toPaySuppliers}` })}` : '';
      setMessages(ms => [...ms, {
        id: nextId(), role: 'assistant',
        text: `${tf('ai_sumHead', { revenue: `₹${r.today.revenue}`, purchases: `₹${r.today.purchases}`, consumption: `₹${r.today.consumption_cost}`, expenses: `₹${r.today.expenses}`, net: `₹${r.today.net_profit}` })}${top}${low}${pending}`,
      }]);
    } catch (e) { setError(errorText(t, e)); } finally { setThinking(false); scrollDown(); }
  };

  return (
    <View style={{ flex: 1 }}>
      <Screen title={tf('ai_title')} subtitle={tf('ai_subtitle')} noBack>
        <BtnRow>
          <Btn small icon="🛒" title={tf('ai_suggestBtn')} onPress={suggest} disabled={thinking} />
          <Btn small kind="secondary" icon="📋" title={tf('ai_summaryBtn')} onPress={summary} disabled={thinking} />
        </BtnRow>
        <View style={{ height: 8 }} />
        {!messages.length && (
          <>
            <Notice tone="blue" text={tf('ai_intro')} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              {SUGGESTIONS.map(key => (
                <Pressable key={key} onPress={() => ask(tf(key))} accessibilityRole="button"
                  style={{ borderWidth: 1, borderColor: c.border, backgroundColor: c.card, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 10, minHeight: 40 }}>
                  <Text style={{ color: c.brandText, fontSize: 13, fontWeight: '600' }}>{tf(key)}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
        {messages.map(m => (
          <View key={m.id} style={{ alignItems: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
            <View style={{ maxWidth: '92%', backgroundColor: m.role === 'user' ? c.brand : c.card, borderColor: c.border, borderWidth: m.role === 'user' ? 0 : 1, borderRadius: 14, padding: 12 }}>
              <Text style={{ color: m.role === 'user' ? c.onBrand : c.text, fontSize: 15, lineHeight: 21 }} selectable>{m.text}</Text>
              {!!m.notice && <Text style={{ color: c.muted, fontSize: 11, marginTop: 6 }}>{m.notice}</Text>}
              {m.proposal && <ProposalCard proposal={m.proposal} onDone={updated => setMessages(ms => ms.map(x => (x.id === m.id ? { ...x, proposal: updated } : x)))} />}
            </View>
          </View>
        ))}
        {thinking && <View style={{ alignItems: 'flex-start', padding: 8 }}><ActivityIndicator color={c.brand} /></View>}
        {!!error && <ErrorBox message={error} />}
      </Screen>
      <View style={{ flexDirection: 'row', gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.card, alignItems: 'flex-end' }}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={tf('ai_placeholder')}
          placeholderTextColor={c.muted}
          multiline
          maxLength={1000}
          accessibilityLabel={tf('ai_placeholder')}
          style={{ flex: 1, minHeight: 46, maxHeight: 110, borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: c.text, backgroundColor: c.input, fontSize: 15 }}
        />
        <Pressable onPress={() => ask(input)} disabled={!input.trim() || thinking} accessibilityRole="button" accessibilityLabel={tf('ai_send')}
          style={{ width: 48, height: 46, borderRadius: 12, backgroundColor: c.brand, alignItems: 'center', justifyContent: 'center', opacity: !input.trim() || thinking ? 0.5 : 1 }}>
          <Text style={{ color: c.onBrand, fontSize: 18, fontWeight: '800' }}>➤</Text>
        </Pressable>
      </View>
    </View>
  );
}
