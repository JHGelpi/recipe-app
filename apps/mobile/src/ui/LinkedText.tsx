import { linkify } from '@recipe-app/domain';
import { Link } from 'expo-router';
import { colors } from '../theme';
import { Text } from './Text';

/**
 * FR-36: text with its http(s) links tappable, for display only. On the web each
 * link is a real anchor opening in a new tab, so the browser supplies long-press
 * Copy and Share and screen readers announce it as a link.
 */
export function LinkedText({ children }: { children: string }) {
  return (
    <Text selectable>
      {linkify(children).map((segment, index) =>
        segment.kind === 'text' ? (
          segment.text
        ) : (
          <Link
            key={index}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer"
            role="link"
            style={{ color: colors.accent, textDecorationLine: 'underline' }}
          >
            {segment.text}
          </Link>
        ),
      )}
    </Text>
  );
}
