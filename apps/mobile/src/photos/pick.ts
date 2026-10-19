/**
 * Opens the phone's picker: on iPhone, Take Photo or Photo Library (spec §6).
 * The input is attached while open because Safari ignores a click on a
 * detached one. Resolves to [] when the picker is cancelled.
 */
export function pickPhotos(multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = multiple;
    input.style.display = 'none';
    let settled = false;
    // Some browsers send no "cancel" when the picker closes: when the page has
    // focus again and no files arrived soon after, treat it as cancelled.
    const onFocus = () => setTimeout(() => done([]), 1000);
    const done = (files: File[]) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      input.remove();
      resolve(files);
    };
    window.addEventListener('focus', onFocus, { once: true });
    input.addEventListener('change', () => done([...(input.files ?? [])]));
    input.addEventListener('cancel', () => done([]));
    document.body.append(input);
    input.click();
  });
}
