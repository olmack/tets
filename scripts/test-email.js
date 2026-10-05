'use strict';
// Envoie un email de test au dirigeant pour vérifier la configuration SMTP du fichier .env
const config = require('../server/config');
const { sendMail } = require('../server/smtp');

(async () => {
  console.log(`SMTP : ${config.smtp.host || '(non configuré)'}:${config.smtp.port} · utilisateur : ${config.smtp.user || '(aucun)'}`);
  console.log(`Destinataire(s) : ${config.ownerEmails.join(', ')}`);
  try {
    const r = await sendMail({
      to: config.ownerEmails,
      subject: `[${config.garage.name}] Test d’envoi d’email`,
      text: 'Si vous lisez ceci, la configuration email du site fonctionne.',
      html: '<p>Si vous lisez ceci, la configuration email du site <strong>fonctionne</strong>. ✔</p>',
    });
    console.log(r.simulated ? '\nSMTP non configuré : email simulé (affiché ci-dessus).' : '\n✅ Email envoyé ! Vérifiez votre boîte de réception (et les spams).');
  } catch (err) {
    console.error('\n❌ Échec de l’envoi :', err.message);
    console.error('Vérifiez SMTP_HOST, SMTP_PORT, SMTP_USER et SMTP_PASS dans le fichier .env (voir README).');
    process.exit(1);
  }
})();
