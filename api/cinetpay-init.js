// Fonction serverless Vercel — Initialisation d'un paiement CinetPay
// Les identifiants (CINETPAY_API_KEY / CINETPAY_API_PASSWORD) restent côté serveur,
// jamais exposés au navigateur du client.

const BASE_URL = 'https://api.cinetpay.net';

// Cle anon Supabase (projet dell-digital-partner, reutilise pour le backend
// Workplace) -- volontairement publique/publiable, ne necessite pas de
// variable d'environnement secrete.
const WP_SUPABASE_URL = 'https://hednrngduqyttcdgnbxu.supabase.co';
const WP_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhlZG5ybmdkdXF5dHRjZGduYnh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxODgxNjYsImV4cCI6MjA5OTc2NDE2Nn0.OCAFkFfH_tQ9Y2bKOidmtAlU6BZJdnhcsBF8LMljEXQ';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const {
      amount,
      designation,
      client_email,
      client_first_name,
      client_last_name,
      client_phone_number
    } = body;

    if (!amount || !designation || !client_email || !client_first_name || !client_last_name) {
      res.status(400).json({ error: 'Champs requis manquants (montant, désignation, email, prénom, nom).' });
      return;
    }

    const apiKey = process.env.CINETPAY_API_KEY;
    const apiPassword = process.env.CINETPAY_API_PASSWORD;
    if (!apiKey || !apiPassword) {
      res.status(500).json({ error: 'Configuration serveur incomplète (clés CinetPay manquantes).' });
      return;
    }

    // 1. Authentification OAuth — récupération du jeton d'accès
    const authResp = await fetch(`${BASE_URL}/v1/oauth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, api_password: apiPassword })
    });
    const authData = await authResp.json();
    const token =
      authData.access_token ||
      authData.token ||
      (authData.data && (authData.data.access_token || authData.data.token));

    if (!authResp.ok || !token) {
      res.status(502).json({ error: 'Authentification CinetPay échouée.', details: authData });
      return;
    }

    // 2. Initialisation de la transaction de paiement
    const merchantTransactionId = 'DD' + Date.now().toString(36).toUpperCase();
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const origin = `${proto}://${req.headers.host}`;

    const payResp = await fetch(`${BASE_URL}/v1/payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        currency: 'XOF',
        merchant_transaction_id: merchantTransactionId,
        amount: Math.round(Number(amount)),
        lang: 'fr',
        designation: String(designation).slice(0, 100),
        client_email,
        client_phone_number: client_phone_number || '',
        client_first_name: String(client_first_name).slice(0, 255),
        client_last_name: String(client_last_name).slice(0, 255),
        success_url: `${origin}/?payment=success&txn=${merchantTransactionId}`,
        failed_url: `${origin}/?payment=failed&txn=${merchantTransactionId}`,
        notify_url: `${origin}/api/cinetpay-notify`
      })
    });
    const payData = await payResp.json();

    if (!payResp.ok || !payData.payment_url) {
      res.status(502).json({ error: "Initialisation du paiement échouée.", details: payData });
      return;
    }

    // Enregistre la commande cote serveur (Supabase) pour que l'admin la
    // voie depuis n'importe quel appareil -- ne bloque jamais le paiement
    // du client si cet appel echoue.
    try {
      await fetch(`${WP_SUPABASE_URL}/functions/v1/wp-create-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WP_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({
          produit_id: body.produit_id || null,
          produit_titre: designation,
          montant: Math.round(Number(amount)),
          client_nom: `${client_first_name} ${client_last_name}`,
          client_email,
          client_tel: client_phone_number || null,
          txn_id: merchantTransactionId
        })
      });
    } catch (e) {
      console.log('wp-create-order — echec non bloquant:', e.message);
    }

    res.status(200).json({
      payment_url: payData.payment_url,
      transaction_id: payData.transaction_id,
      merchant_transaction_id: merchantTransactionId
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur', message: err.message });
  }
};
