import { useQuery } from '@powersync/react';
import {
  FEEDBACK_AREAS,
  FEEDBACK_FREQUENCIES,
  FEEDBACK_NOTICE,
  FEEDBACK_QUESTIONS,
  feedbackDetailLines,
  feedbackReportSchema,
  type FeedbackReport,
  type FeedbackRole,
} from '@recipe-app/domain';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { config } from '../config';
import { unitsPreferenceNow } from '../cooking/useUnitsPreference';
import { useNetworkOnline } from '../db/useNetworkOnline';
import { FEEDBACK_MESSAGES, sendFeedback, type FeedbackResult } from '../feedback/api';
import { feedbackDetails, runsStandalone } from '../feedback/details';
import { offlineWithin } from '../feedback/offline';
import { withSession } from '../imports/api';
import { useStorageStatus } from '../pwa/storageStatus';
import type { Claims } from '../session/claims';
import { colors, space, useAppearance } from '../theme';
import { Banner, Button, Card, Chip, Icon, PillTabs, Screen, Text, TextField } from '../ui';

type Kind = FeedbackReport['kind'];
type Fields = {
  summary: string;
  want: string;
  why: string;
  today: string;
  happened: string;
  expected: string;
  steps: string;
  frequency: string;
  area: string;
};
type Field = keyof Fields;

const EMPTY: Fields = {
  summary: '',
  want: '',
  why: '',
  today: '',
  happened: '',
  expected: '',
  steps: '1. ',
  frequency: '',
  area: '',
};

const KINDS = [
  { value: 'idea' as const, label: 'Suggest an idea' },
  { value: 'problem' as const, label: 'Report a problem' },
];

const TEN_MINUTES = 10 * 60 * 1000;
const ROLES: readonly FeedbackRole[] = ['admin', 'member', 'viewer'];

function reportFrom(kind: Kind, fields: Fields): unknown {
  return kind === 'idea'
    ? {
        kind,
        summary: fields.summary,
        want: fields.want,
        why: fields.why,
        ...(fields.today.trim() ? { today: fields.today } : {}),
      }
    : {
        kind,
        summary: fields.summary,
        happened: fields.happened,
        expected: fields.expected,
        // An untouched "1. " is no answer.
        steps: fields.steps.trim() === '1.' ? '' : fields.steps,
        frequency: fields.frequency,
        area: fields.area,
      };
}

/** FR-45: an idea or a problem, filed on GitHub without the person's name or email. */
export function FeedbackScreen({ claims }: { claims: Claims }) {
  const online = useNetworkOnline();
  const storage = useStorageStatus();
  const { appearance } = useAppearance();
  // ps_crud is PowerSync's queue of local writes not yet uploaded.
  const { data: queued } = useQuery<{ pending: number }>('select count(*) as pending from ps_crud');
  const [kind, setKind] = useState<Kind>('idea');
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [showDetails, setShowDetails] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<FeedbackResult | null>(null);
  const role = ROLES.find((name) => name === claims.role) ?? 'member';

  const details = feedbackDetails(
    {
      buildTime: config.buildTime,
      storage,
      userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
      standalone: runsStandalone(),
      screen:
        typeof window === 'undefined'
          ? { width: 0, height: 0 }
          : { width: window.screen.width, height: window.screen.height },
      appearance,
      units: unitsPreferenceNow(),
      online,
      now: new Date(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    kind === 'problem'
      ? { offlineRecently: offlineWithin(TEN_MINUTES), waitingUploads: queued[0]?.pending ?? 0 }
      : null,
  );

  const set = (key: Field) => (value: string) => {
    setFields((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  async function send() {
    if (sending || !online) return;
    const parsed = feedbackReportSchema.safeParse(reportFrom(kind, fields));
    if (!parsed.success) {
      const next: Partial<Record<Field, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as Field;
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setSending(true);
    const outcome =
      (await withSession((deps) => sendFeedback({ report: parsed.data, details }, deps))) ??
      ({ ok: false, reason: 'reauth' } as const);
    setSending(false);
    setResult(outcome);
    // The draft is kept unless it was filed.
    if (outcome.ok) setFields(EMPTY);
  }

  if (result?.ok) {
    return (
      <Screen back={{ href: '/household', label: 'Household' }}>
        <Text role="heading" aria-level={1} variant="h1">
          Send feedback
        </Text>
        <Banner role="status">
          <View style={{ gap: space.sm }}>
            <Text>Thanks! We got it.</Text>
            <Link
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              role="link"
              style={{ color: colors.accent, textDecorationLine: 'underline' }}
            >
              Follow it on GitHub
            </Link>
          </View>
        </Banner>
        <Button variant="secondary" label="Send another" onPress={() => setResult(null)} />
      </Screen>
    );
  }

  const field = (key: Field, label: string, extra: object = {}) => (
    <TextField
      label={label}
      value={fields[key]}
      onChangeText={set(key)}
      error={errors[key] ?? null}
      {...extra}
    />
  );
  const multiline = {
    multiline: true,
    numberOfLines: 4,
    textAlignVertical: 'top' as const,
    style: { minHeight: 96 },
  };
  const choices = (key: 'frequency' | 'area', label: string, options: readonly string[]) => (
    <View style={{ gap: space.xs }}>
      <Text variant="label" nativeID={`feedback-${key}`}>
        {label}
      </Text>
      <View
        role="group"
        aria-labelledby={`feedback-${key}`}
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}
      >
        {options.map((option) => (
          <Chip
            key={option}
            label={option}
            tone={fields[key] === option ? 'selected' : 'neutral'}
            aria-pressed={fields[key] === option}
            onPress={() => set(key)(option)}
          />
        ))}
      </View>
      {errors[key] ? (
        <Text variant="small" tone="danger" role="alert">
          {errors[key]}
        </Text>
      ) : null}
    </View>
  );

  return (
    <Screen back={{ href: '/household', label: 'Household' }}>
      <Text role="heading" aria-level={1} variant="h1">
        Send feedback
      </Text>
      <PillTabs
        tabs={KINDS}
        value={kind}
        onChange={(next) => {
          setKind(next);
          setErrors({});
          setResult(null);
        }}
      />
      <Banner tone="tag" icon="eye-outline">
        {FEEDBACK_NOTICE}
      </Banner>
      <Card>
        {field('summary', 'Short summary', { maxLength: 120 })}
        {kind === 'idea' ? (
          <>
            {field('want', FEEDBACK_QUESTIONS.want, multiline)}
            {field('why', FEEDBACK_QUESTIONS.why, multiline)}
            {field('today', `${FEEDBACK_QUESTIONS.today} (optional)`, multiline)}
          </>
        ) : (
          <>
            {field('happened', FEEDBACK_QUESTIONS.happened, multiline)}
            {field('expected', FEEDBACK_QUESTIONS.expected, multiline)}
            {field('steps', FEEDBACK_QUESTIONS.steps, multiline)}
            {choices('frequency', FEEDBACK_QUESTIONS.frequency, FEEDBACK_FREQUENCIES)}
            {choices('area', FEEDBACK_QUESTIONS.area, FEEDBACK_AREAS)}
          </>
        )}
      </Card>
      <Card>
        <Pressable
          role="button"
          aria-expanded={showDetails}
          onPress={() => setShowDetails((open) => !open)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 }}
        >
          <Icon name={showDetails ? 'chevron-down' : 'chevron-forward'} color={colors.muted} />
          <Text variant="label">Details we&apos;ll include</Text>
        </Pressable>
        {showDetails ? (
          <View style={{ gap: space.xs }}>
            {feedbackDetailLines(details, role).map(([name, value]) => (
              <Text key={name} variant="small">
                <Text variant="small" tone="muted">
                  {name}:{' '}
                </Text>
                {value}
              </Text>
            ))}
            <Text variant="small" tone="muted">
              Never included: your email, names, your household, recipes, or invite and share links.
            </Text>
          </View>
        ) : null}
      </Card>
      {result && !result.ok ? (
        <Banner tone="danger" role="alert">
          {FEEDBACK_MESSAGES[result.reason]}
        </Banner>
      ) : null}
      {online ? null : (
        <Banner tone="danger" role="alert">
          Needs a connection.
        </Banner>
      )}
      <Button
        full
        label={result && !result.ok && result.reason === 'unavailable' ? 'Try again' : 'Send'}
        disabled={!online || sending}
        aria-disabled={!online || sending}
        onPress={() => void send()}
      />
    </Screen>
  );
}
