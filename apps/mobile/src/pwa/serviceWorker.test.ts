import { afterEach, describe, expect, it } from 'vitest';
import { resetUpdateStateForTests, updateReady, watchRegistration } from './serviceWorker';

class FakeWorker extends EventTarget {
  state = 'installing';
  postMessage(): void {}
  finishInstalling(): void {
    this.state = 'installed';
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  async update(): Promise<void> {}
  startUpdate(worker: FakeWorker): void {
    this.installing = worker;
    this.dispatchEvent(new Event('updatefound'));
  }
}

afterEach(() => resetUpdateStateForTests());

describe('watchRegistration', () => {
  it('reports a worker that is already waiting when the page has a controller', () => {
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker();
    watchRegistration(registration, () => true);
    expect(updateReady()).toBe(true);
  });

  it('does not report the first install, when nothing controls the page yet', () => {
    const registration = new FakeRegistration();
    const worker = new FakeWorker();
    watchRegistration(registration, () => false);
    registration.startUpdate(worker);
    registration.waiting = worker;
    worker.finishInstalling();
    expect(updateReady()).toBe(false);
  });

  it('reports a replacement worker once it finishes installing', () => {
    const registration = new FakeRegistration();
    const worker = new FakeWorker();
    watchRegistration(registration, () => true);
    registration.startUpdate(worker);
    expect(updateReady()).toBe(false);
    registration.waiting = worker;
    worker.finishInstalling();
    expect(updateReady()).toBe(true);
  });
});
