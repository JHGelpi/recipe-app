/** The share sheet with text, or the clipboard where there is none. */
export async function shareOrCopy(content: {
  title: string;
  text: string;
}): Promise<'shared' | 'copied' | 'cancelled'> {
  const nav = globalThis.navigator as Navigator | undefined;
  if (nav?.share) {
    try {
      await nav.share(content);
      return 'shared';
    } catch {
      return 'cancelled';
    }
  }
  try {
    await nav?.clipboard?.writeText(content.text);
    return 'copied';
  } catch {
    return 'cancelled';
  }
}

/** The share sheet with a file where it can take files; otherwise a download. */
export async function shareFile(
  file: File,
  title: string,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const nav = globalThis.navigator as Navigator | undefined;
  if (nav?.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return 'shared';
    } catch {
      return 'cancelled';
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
