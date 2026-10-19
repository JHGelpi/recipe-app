import { useEffect, useRef, useState } from 'react';
import { resumeAfterSignIn } from './resume';

/**
 * Where to go after sign-in, read once in an effect (it consumes the pending
 * invite). undefined until read.
 */
export function useResumeAfterSignIn(): string | null | undefined {
  const [target, setTarget] = useState<string | null | undefined>(undefined);
  const read = useRef(false);
  useEffect(() => {
    if (read.current) return;
    read.current = true;
    setTarget(resumeAfterSignIn());
  }, []);
  return target;
}
