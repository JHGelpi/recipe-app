type MessageSummary = { ID: string };

async function newestMessageId(mailUrl: string, email: string): Promise<string | null> {
  const query = encodeURIComponent(`to:${email}`);
  const response = await fetch(`${mailUrl}/api/v1/search?query=${query}`);
  if (!response.ok) throw new Error(`Mail catcher returned ${response.status}`);
  const body = (await response.json()) as { messages: MessageSummary[] };
  return body.messages[0]?.ID ?? null;
}

/**
 * Call BEFORE requesting a code. `nextCode()` then waits for a message newer
 * than anything already in the mailbox, so an old code is never returned.
 */
export async function watchMailbox(mailUrl: string, email: string) {
  const before = await newestMessageId(mailUrl, email);
  return {
    async nextCode(): Promise<string> {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const newest = await newestMessageId(mailUrl, email);
        if (newest && newest !== before) {
          const response = await fetch(`${mailUrl}/api/v1/message/${newest}`);
          const message = (await response.json()) as { Text?: string; HTML?: string };
          const match = /\b(\d{6})\b/.exec(`${message.Text ?? ''} ${message.HTML ?? ''}`);
          if (match?.[1]) return match[1];
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error(`No sign-in code arrived for ${email}`);
    },
  };
}
