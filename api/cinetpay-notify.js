// Fonction serverless Vercel — Webhook de notification CinetPay.
// CinetPay appelle cette URL en arrière-plan (serveur à serveur) lorsqu'une
// transaction se termine. La notification elle-même n'est JAMAIS considérée
// fiable (CinetPay n'a pas de signature de webhook) : on en extrait
// uniquement le transaction_id, puis on revérifie systématiquement le statut
// auprès de l'API CinetPay avant de marquer quoi que ce soit comme payé —
// même pattern que dell-digital-partner (services/cinetpayService.ts).

const BASE_URL = 'https://api.cinetpay.net';
const WP_SUPABASE_URL = 'https://hednrngduqyttcdgnbxu.supabase.co';
const WP_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhlZG5ybmdkdXF5dHRjZGduYnh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxODgxNjYsImV4cCI6MjA5OTc2NDE2Nn0.OCAFkFfH_tQ9Y2bKOidmtAlU6BZJdnhcsBF8LMljEXQ';

async function checkPaymentStatus(transactionId) {
  const apiKey = process.env.CINETPAY_API_KEY;
  const apiPassword = process.env.CINETPAY_API_PASSWORD;
  if (!apiKey || !apiPassword) return false;
  try {
    const authResp = await fetch(`${BASE_URL}/v1/oauth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, api_password: apiPassword })
    });
    const authData = await authResp.json();
    const token = authData.access_token || authData.token || (authData.data && (authData.data.access_token || authData.data.token));
    if (!token) return false;
    const resp = await fetch(`${BASE_URL}/v1/payment/${transactionId}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await resp.json();
    const status = data?.status || (data?.data && data.data.status);
    return status === 'ACCEPTED';
  } catch {
    return false;
  }
}

function extractTransactionId(payload) {
  return payload.transaction_id || payload.cpm_trans_id || null;
}

module.exports = async (req, res) => {
  let payload = {};
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || req.query || {});
  } catch (err) {
    console.log('CinetPay notify_url — erreur de parsing:', err.message);
  }
  console.log('CinetPay notify_url reçu:', JSON.stringify(payload));

  const transactionId = extractTransactionId(payload);
  if (transactionId) {
    const accepted = await checkPaymentStatus(transactionId);
    if (accepted) {
      try {
        await fetch(`${WP_SUPABASE_URL}/functions/v1/wp-record-payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WP_SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ txn_id: transactionId })
        });
      } catch (e) {
        console.log('wp-record-payment — echec:', e.message);
      }
    } else {
      console.log('Paiement non confirme par CinetPay pour', transactionId);
    }
  }

  // CinetPay attend une réponse 200 pour considérer la notification comme reçue.
  res.status(200).send('OK');
};
