import { useState } from 'react';
import { Image, View } from 'react-native';
import { BuildFooter } from '../components/BuildFooter';
import { useSession } from '../session/SessionProvider';
import { peekPendingShare } from '../sharing/pending';
import { space } from '../theme';
import { Banner, Button, Card, Screen, Text, TextField } from '../ui';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro asset
const MARK = require('../../assets/brand/mark.png');

export function SignInScreen({ intro }: { intro?: string } = {}) {
  const { requestCode, verifyCode } = useSession();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingShare] = useState(() => peekPendingShare());

  async function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    if (busy) return false;
    setBusy(true);
    setMessage(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) setMessage(result.message);
    return result.ok;
  }

  async function sendCode() {
    if (await run(() => requestCode(email))) setStep('code');
  }

  async function submitCode() {
    // On success the session changes and the route redirects to the list.
    await run(() => verifyCode(email, code));
  }

  return (
    <Screen>
      <View style={{ alignItems: 'center', gap: space.sm, marginTop: space.xl }}>
        <Image source={MARK} aria-hidden style={{ width: 96, height: 96 }} />
        <Text role="heading" aria-level={1} variant="h1">
          Dishkept
        </Text>
        <Text tone="muted">Keep Your Kitchen Inspired</Text>
      </View>
      <Card title="Sign in">
        {intro ? <Text>{intro}</Text> : null}
        {pendingShare ? (
          <Text>Sign in or create an account to save {pendingShare.title}</Text>
        ) : null}
        {step === 'email' ? (
          <>
            <TextField
              label="Email"
              value={email}
              onChangeText={setEmail}
              onSubmitEditing={sendCode}
              placeholder="you@example.com"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
            />
            <Button full label="Send code" aria-disabled={busy} onPress={sendCode} />
          </>
        ) : (
          <>
            <Text>We sent an 8-digit code to {email.trim().toLowerCase()}.</Text>
            {/* GOTRUE_MAILER_OTP_EXP in docker-compose.yml: keep them in step. */}
            <Text tone="muted">It expires in 10 minutes.</Text>
            <TextField
              label="Code"
              value={code}
              onChangeText={setCode}
              onSubmitEditing={submitCode}
              placeholder="12345678"
              autoComplete="one-time-code"
              keyboardType="number-pad"
            />
            <Button full label="Sign in" aria-disabled={busy} onPress={submitCode} />
            <Button
              variant="ghost"
              label="Use a different email"
              onPress={() => {
                setStep('email');
                setCode('');
                setMessage(null);
              }}
            />
          </>
        )}
        {message ? (
          <Banner tone="danger" role="alert">
            {message}
          </Banner>
        ) : null}
      </Card>
      <BuildFooter />
    </Screen>
  );
}
