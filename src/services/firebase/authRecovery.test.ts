// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ recovery: vi.fn(), whatsapp: vi.fn(), query: vi.fn() }));
vi.mock('../../config/firebase', () => ({ auth: { currentUser: { uid: 'admin' } }, db: {} }));
vi.mock('../../i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('./appConfig', () => ({ getAppConfig: vi.fn() }));
vi.mock('./passwordResetEmail', () => ({ sendRecoveryEmail: mocks.recovery }));
vi.mock('../whapi/integrations', () => ({ sendPasswordResetToUser: mocks.whatsapp }));
vi.mock('firebase/firestore', async importOriginal => ({
  ...await importOriginal<typeof import('firebase/firestore')>(), getDocs: mocks.query,
}));
import { sendPasswordResetEmailFor } from './auth';

describe('email recovery channel isolation', () => {
  beforeEach(() => vi.resetAllMocks());
  it.each(['firebase', 'resend'])('does not send a second invalid WhatsApp link after %s email recovery', async provider => {
    mocks.recovery.mockResolvedValue(provider);
    expect(await sendPasswordResetEmailFor('member@example.com')).toEqual({ success: true });
    expect(mocks.recovery).toHaveBeenCalledWith('member@example.com');
    expect(mocks.whatsapp).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('reports the email error without switching to WhatsApp', async () => {
    const error = new Error('service-unavailable');
    mocks.recovery.mockRejectedValue(error);
    expect(await sendPasswordResetEmailFor('member@example.com')).toEqual({ success: false, error });
    expect(mocks.whatsapp).not.toHaveBeenCalled();
  });
});
