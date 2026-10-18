import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { BuildFooter } from '../components/BuildFooter';
import { useSession } from '../session/SessionProvider';
import { peekPendingShare } from '../sharing/pending';

const input = {
  borderWidth: 1,
  borderColor: '#888',
  borderRadius: 6,
  padding: 10,
  fontSize: 16,
} as const;
const button = { backgroundColor: '#1a5d3a', borderRadius: 6, padding: 12 } as const;
const buttonText = { color: '#fff', fontSize: 16, textAlign: 'center' } as const;

export function SignInScreen() {
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
    <View style={{ padding: 16, gap: 12, maxWidth: 480 }}>
      <Text role="heading" aria-level={1} style={{ fontSize: 24, fontWeight: '600' }}>
        Sign in
      </Text>
      {pendingShare ? <Text>Sign in or create an account to save {pendingShare.title}</Text> : null}
      {step === 'email' ? (
        <>
          <TextInput
            aria-label="Email"
            value={email}
            onChangeText={setEmail}
            onSubmitEditing={sendCode}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            style={input}
          />
          <Pressable role="button" aria-disabled={busy} onPress={sendCode} style={button}>
            <Text style={buttonText}>Send code</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text>We sent a 6-digit code to {email.trim().toLowerCase()}.</Text>
          <TextInput
            aria-label="Code"
            value={code}
            onChangeText={setCode}
            onSubmitEditing={submitCode}
            placeholder="123456"
            autoComplete="one-time-code"
            keyboardType="number-pad"
            style={input}
          />
          <Pressable role="button" aria-disabled={busy} onPress={submitCode} style={button}>
            <Text style={buttonText}>Sign in</Text>
          </Pressable>
          <Pressable
            role="button"
            onPress={() => {
              setStep('email');
              setCode('');
              setMessage(null);
            }}
          >
            <Text style={{ textDecorationLine: 'underline' }}>Use a different email</Text>
          </Pressable>
        </>
      )}
      {message ? (
        <Text role="alert" style={{ color: '#b00020' }}>
          {message}
        </Text>
      ) : null}
      <BuildFooter />
    </View>
  );
}
