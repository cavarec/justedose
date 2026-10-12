// L'envoi d'emails choisit son canal selon la configuration ; le client SMTP est simulé (pas de réseau).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bindings } from '../worker/src/env';

const send = vi.fn(async () => undefined);
const close = vi.fn(async () => undefined);
const connect = vi.fn(async () => ({ send, close }));
vi.mock('worker-mailer', () => ({ WorkerMailer: { connect } }));

const { emailConfigured, emailEnabled, sendEmail } = await import('../worker/src/email');
const env = (o: Partial<Bindings>) => o as Bindings;

beforeEach(() => vi.clearAllMocks());

describe('canal d\'envoi des emails', () => {
  it('est désactivé sans configuration, activé par SMTP ou par Cloudflare Email', () => {
    expect(emailEnabled(env({}))).toBe(false);
    expect(emailEnabled(env({ SMTP_USER: 'a@gmail.com' }))).toBe(false); // mot de passe manquant
    expect(emailConfigured(env({ SMTP_USER: 'a@gmail.com', SMTP_PASSWORD: 'x' }))).toBe(true);
    expect(emailConfigured(env({ EMAIL: { send: vi.fn() }, EMAIL_FROM: 'c@d.fr' }))).toBe(true);
    expect(emailEnabled(env({ DEV_ECHO_CODE: '1' }))).toBe(true);
    expect(emailConfigured(env({ DEV_ECHO_CODE: '1' }))).toBe(false);
  });

  it('envoie par SMTP (Gmail, TLS direct) depuis le compte configuré', async () => {
    await sendEmail(env({ SMTP_USER: 'moi@gmail.com', SMTP_PASSWORD: 'abcd efgh' }), 'x@y.fr', 'Sujet', 'texte', '<p>html</p>');
    expect(connect).toHaveBeenCalledWith({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      authType: 'plain',
      credentials: { username: 'moi@gmail.com', password: 'abcd efgh' },
    });
    expect(send).toHaveBeenCalledWith({ from: { name: 'JusteDose', email: 'moi@gmail.com' }, to: { email: 'x@y.fr' }, subject: 'Sujet', text: 'texte', html: '<p>html</p>' });
    expect(close).toHaveBeenCalled();
  });

  it('referme la connexion même si l\'envoi échoue', async () => {
    send.mockRejectedValueOnce(new Error('550'));
    await expect(sendEmail(env({ SMTP_USER: 'm@gmail.com', SMTP_PASSWORD: 'x' }), 'x@y.fr', 's', 't', 'h')).rejects.toThrow('550');
    expect(close).toHaveBeenCalled();
  });

  it('préfère Cloudflare Email quand un domaine est configuré', async () => {
    const cf = vi.fn(async () => ({}));
    await sendEmail(env({ EMAIL: { send: cf }, EMAIL_FROM: 'JusteDose <connexion@exemple.fr>', SMTP_USER: 'm@gmail.com', SMTP_PASSWORD: 'x' }), 'x@y.fr', 's', 't', 'h');
    expect(cf).toHaveBeenCalledTimes(1);
    expect(connect).not.toHaveBeenCalled();
  });

  it('échoue clairement sans configuration', async () => {
    await expect(sendEmail(env({}), 'x@y.fr', 's', 't', 'h')).rejects.toThrow('email_not_configured');
  });
});
