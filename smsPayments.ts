/**
 * Detects UPI *credit* alerts in bank SMS text so the app can auto-record a fare.
 * Conservative on purpose: anything that looks like a debit, OTP, request or failure is ignored.
 */

export type DetectedUpiPayment = {
  amount: number;
  ref: string | null;
  payer: string | null;
};

const CREDIT_WORDS = /\b(credited|credit|received|deposited)\b/i;
const REJECT_WORDS =
  /\b(debited|debit|withdrawn|withdrawal|spent|sent to|paid to|otp|one time password|requested|request from|declined|failed|unsuccessful|reversed|will be credited|to be credited|mandate|autopay|e-?mandate|kindly ignore)\b/i;
const UPI_HINT = /(upi|vpa|@[a-z][a-z0-9]{1,})/i;
const AMOUNT = /(?:rs\.?|inr|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;
const REF = /(?:ref(?:erence)?\.?\s*(?:no\.?|number)?\s*[:\-]?\s*|upi\s*[:\-]\s*)(\d{9,14})/i;
const PAYER = /\b(?:from|by)\s+([A-Za-z][A-Za-z .]{1,30}?)(?=\s*(?:\(|\.|,|\s+on\s|\s+ref|\s+upi|\s+via|$))/gi;
const PAYER_STOPWORDS = /^(a\/c|acct|account|your|upi|bank)\b/i;

export function detectUpiCredit(body: string): DetectedUpiPayment | null {
  if (!body) return null;
  const text = body.replace(/\s+/g, ' ').trim();
  if (!CREDIT_WORDS.test(text) || REJECT_WORDS.test(text) || !UPI_HINT.test(text)) return null;

  const amountMatch = text.match(AMOUNT);
  if (!amountMatch) return null;
  const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
  if (!isFinite(amount) || amount <= 0) return null;

  const ref = text.match(REF)?.[1] ?? null;
  // Scan every "from/by <name>" candidate (not just the first) and use the first one
  // that isn't a stray keyword like "by UPI" - real bank SMS often mention "by UPI"
  // before the actual payer name later in the same message.
  let payer: string | null = null;
  for (const match of text.matchAll(PAYER)) {
    const candidate = match[1]?.trim();
    if (candidate && !PAYER_STOPWORDS.test(candidate)) {
      payer = candidate;
      break;
    }
  }
  return { amount, ref, payer };
}
