import type { Bindings } from './env';

/** Adresse d'expédition « simple » : accepte « Nom <a@b.fr> » ou « a@b.fr ». */
function fromAddress(v: string): string {
  const m = v.match(/<([^>]+)>/);
  return (m ? m[1] : v).trim();
}

export function emailEnabled(env: Bindings): boolean {
  return !!(env.EMAIL && env.EMAIL_FROM) || env.DEV_ECHO_CODE === '1';
}

export async function sendEmail(env: Bindings, to: string, subject: string, text: string, html: string): Promise<void> {
  if (!env.EMAIL || !env.EMAIL_FROM) throw new Error('email_not_configured');
  await env.EMAIL.send({ to, from: { email: fromAddress(env.EMAIL_FROM), name: 'JusteDose' }, subject, text, html });
}

const shell = (inner: string) =>
  `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px;color:#0f172a">${inner}<p style="color:#64748b;font-size:13px;margin-top:32px">JusteDose — moins de gaspillage, plus d'économies.</p></div>`;

export function codeEmail(code: string, purpose: 'secure' | 'recover') {
  const what = purpose === 'secure' ? 'associer cette adresse à votre compte' : 'retrouver votre compte';
  return {
    subject: `Votre code JusteDose : ${code}`,
    text: `Votre code JusteDose : ${code}\n\nSaisissez-le dans l'application pour ${what}. Il est valable 10 minutes.\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message : rien ne sera modifié.`,
    html: shell(
      `<p>Voici votre code pour ${what} :</p><p style="font-size:32px;font-weight:800;letter-spacing:6px">${code}</p><p>Il est valable 10 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : rien ne sera modifié.</p>`,
    ),
  };
}

export function alreadyLinkedEmail() {
  return {
    subject: 'Cette adresse est déjà utilisée sur JusteDose',
    text: "Quelqu'un a demandé à associer cette adresse à un compte JusteDose, mais elle est déjà liée à un compte.\n\nPour le retrouver, ouvrez JusteDose, puis « Réglages » > « J'ai déjà un compte ». Sinon, ignorez ce message.",
    html: shell(
      `<p>Quelqu'un a demandé à associer cette adresse à un compte JusteDose, mais elle est déjà liée à un compte.</p><p>Pour le retrouver, ouvrez JusteDose, puis <strong>Réglages</strong> &gt; <strong>J'ai déjà un compte</strong>. Sinon, ignorez ce message.</p>`,
    ),
  };
}
