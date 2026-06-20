// Fonction serverless Vercel — Webhook de notification CinetPay.
// CinetPay appelle cette URL en arrière-plan (serveur à serveur) lorsqu'une
// transaction se termine (SUCCESS ou FAILED). Pour l'instant on journalise
// l'évènement (visible dans Vercel > Observability > Runtime Logs) ; la
// confirmation visible par le client se fait via success_url/failed_url.

module.exports = async (req, res) => {
  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || req.query || {});
    console.log('CinetPay notify_url reçu:', JSON.stringify(payload));
  } catch (err) {
    console.log('CinetPay notify_url — erreur de parsing:', err.message);
  }
  // CinetPay attend une réponse 200 pour considérer la notification comme reçue.
  res.status(200).send('OK');
};
