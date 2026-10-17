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
    const done = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => done([...(input.files ?? [])]));
    input.addEventListener('cancel', () => done([]));
    document.body.append(input);
    input.click();
  });
}
