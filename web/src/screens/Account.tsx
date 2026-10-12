import { useState } from 'react';
import { Button, Muted, cx } from '../components/ui';
import { api, ApiError, type EmailPurpose } from '../lib/api';
import { adoptAccount, getToken, setEmail as storeEmail } from '../lib/store';
import { inputClass } from './steps';

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

function errorText(e: unknown, step: 'email' | 'code'): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return 'Trop de demandes pour cette adresse. Réessayez dans une heure.';
    if (e.status === 503) return "L'envoi d'emails n'est pas encore disponible. Réessayez plus tard.";
    if (e.status === 409) return 'Cette adresse est déjà liée à un autre compte.';
    if (e.code === 'invalid_code') return 'Code incorrect ou expiré. Vérifiez-le ou demandez-en un nouveau.';
    if (e.status === 401) return 'Votre session a expiré. Rouvrez l\'application et réessayez.';
  }
  return step === 'email' ? "Impossible d'envoyer le code (connexion ?). Réessayez." : 'Impossible de vérifier le code (connexion ?). Réessayez.';
}

/**
 * Deux parcours, même écran :
 *  - « secure » : associer une adresse à ce compte anonyme, pour pouvoir le retrouver ;
 *  - « recover » : retrouver son compte sur un nouvel appareil.
 * Un code à 6 chiffres (et non un lien) : sur iPhone, un lien s'ouvrirait dans Safari, pas dans l'app installée.
 */
export function EmailFlow({ purpose, onDone }: { purpose: EmailPurpose; onDone: () => void }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const cleanEmail = email.trim().toLowerCase();
  const emailOk = EMAIL_RE.test(cleanEmail);

  async function sendCode() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const token = purpose === 'secure' ? await getToken() : null;
      if (purpose === 'secure' && !token) throw new Error('offline');
      const res = await api.requestEmailCode(cleanEmail, purpose, token);
      if (res.alreadyLinked) {
        storeEmail(cleanEmail);
        onDone();
        return;
      }
      setStep('code');
      setInfo(`Si l'adresse est valide, un code à 6 chiffres vient d'être envoyé à ${cleanEmail} (pensez aux courriers indésirables).`);
    } catch (e) {
      setError(errorText(e, 'email'));
    } finally {
      setBusy(false);
    }
  }

  async function checkCode() {
    setBusy(true);
    setError(null);
    try {
      if (purpose === 'secure') {
        const token = await getToken();
        if (!token) throw new Error('offline');
        const res = await api.verifyEmailCode(cleanEmail, code, 'secure', token);
        storeEmail(res.email);
      } else {
        const res = await api.recoverAccount(cleanEmail, code);
        await adoptAccount(res.token, cleanEmail);
      }
      onDone();
    } catch (e) {
      setError(errorText(e, 'code'));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      {step === 'email' ? (
        <>
          <div>
            <label htmlFor="email" className="mb-2 block text-sm font-semibold">
              Votre adresse email
            </label>
            <input
              id="email"
              className={inputClass}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              placeholder="prenom@exemple.fr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Muted>
            {purpose === 'secure'
              ? "Elle sert uniquement à retrouver votre compte (changement ou perte de téléphone). Aucune publicité, aucun envoi commercial."
              : 'Saisissez l\'adresse associée à votre compte : nous vous enverrons un code de connexion.'}
          </Muted>
        </>
      ) : (
        <>
          <div>
            <label htmlFor="code" className="mb-2 block text-sm font-semibold">
              Code reçu par email
            </label>
            <input
              id="code"
              className={cx(inputClass, 'text-center text-3xl tracking-[0.4em] tabular')}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="······"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </div>
          {info && <Muted>{info}</Muted>}
          <Button variant="ghost" className="h-14 text-base" disabled={busy} onClick={() => void sendCode()}>
            Renvoyer un code
          </Button>
          <Button variant="ghost" className="h-14 text-base" onClick={() => (setStep('email'), setCode(''), setError(null))}>
            Changer d'adresse
          </Button>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm font-semibold text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="mt-auto pt-4">
        {step === 'email' ? (
          <Button disabled={!emailOk || busy} onClick={() => void sendCode()}>
            {busy ? 'Envoi…' : 'Recevoir un code'}
          </Button>
        ) : (
          <Button disabled={code.length !== 6 || busy} onClick={() => void checkCode()}>
            {busy ? 'Vérification…' : purpose === 'secure' ? 'Valider' : 'Retrouver mon compte'}
          </Button>
        )}
      </div>
    </div>
  );
}
